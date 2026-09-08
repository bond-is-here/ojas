import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../server/errors.ts';
import { serverHarness, loadModule } from './module-harness.mjs';
import type { OAuthProvider, ConnectionStatus } from '../lib/connections.ts';

const day = '2026-09-07';
function managed(
  h: ReturnType<typeof serverHarness>,
  provider: OAuthProvider = 'oura',
  client = 'managed-client',
  secret = 'managed-secret',
) {
  const prefix = provider.toUpperCase();
  h.environment[`${prefix}_CLIENT_ID`] = client;
  h.environment[`${prefix}_CLIENT_SECRET`] = secret;
}
async function connect(
  h: ReturnType<typeof serverHarness>,
  user = 'alice',
  provider: OAuthProvider = 'oura',
) {
  const start = await h.api.authorize(user, provider);
  await h.api.completeAuthorization(
    user,
    provider,
    start.state,
    'synthetic-code',
  );
  return h.api.getConnection(user, provider);
}
function expire(
  h: ReturnType<typeof serverHarness>,
  user = 'alice',
  provider: OAuthProvider = 'oura',
) {
  h.sqlite
    .prepare(
      'UPDATE connections SET expires_at=0,token_cipher=? WHERE user_id=? AND provider=?',
    )
    .run(
      JSON.stringify({
        accessToken: 'old-access',
        refreshToken: 'old',
        expiresAt: 0,
      }),
      user,
      provider,
    );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

await test('new customers can authorize either managed provider without storing its app secret', async () => {
  for (const provider of ['whoop', 'oura'] as const) {
    const h = serverHarness();
    try {
      managed(h, provider);
      const initial = (
        await h.api.getConnections('alice', day)
      ).connections.find((c: ConnectionStatus) => c.provider === provider);
      assert.equal(initial.managedAvailable, true);
      assert.equal(initial.configured, false);
      assert.equal(initial.credentialSource, null);
      const start = await h.api.authorize('alice', provider);
      const url = new URL(start.url);
      assert.equal(url.searchParams.get('client_id'), 'managed-client');
      assert.equal(
        url.searchParams.get('redirect_uri'),
        `https://ojas.example/api/connections/${provider}/callback`,
      );
      const pending = await h.api.getConnection('alice', provider);
      assert.equal(pending.client_id, null);
      assert.equal(pending.token_cipher, null);
      assert.equal(pending.secret_cipher, null);
      const state = h.sqlite
        .prepare(
          'SELECT client_id,credential_source FROM oauth_states WHERE user_id=?',
        )
        .get('alice');
      assert.deepEqual(
        { ...state },
        { client_id: 'managed-client', credential_source: 'managed' },
      );
      await h.api.completeAuthorization(
        'alice',
        provider,
        start.state,
        'synthetic-code',
      );
      const saved = await h.api.getConnection('alice', provider);
      assert.equal(saved.client_id, 'managed-client');
      assert.equal(saved.credential_source, 'managed');
      assert.equal(saved.secret_cipher, null);
      assert.equal(saved.status, 'connected');
      assert.ok(h.sealedContexts.includes(`alice:${provider}:tokens`));
      const data = await h.api.getConnections('alice', day);
      assert.equal(
        data.connections.find((c: ConnectionStatus) => c.provider === provider)
          .configured,
        true,
      );
      assert.equal(JSON.stringify(data).includes('managed-secret'), false);
      assert.equal(JSON.stringify(data).includes('token_cipher'), false);
      const exportApi = loadModule('server/export.ts', {
        './runtime': h.runtime,
      });
      const exported = await new Response(
        exportApi.accountExport('alice'),
      ).text();
      assert.equal(exported.includes('managed-secret'), false);
      assert.equal(exported.includes('new-authorization'), false);
      assert.equal(exported.includes('client_id'), false);
    } finally {
      h.sqlite.close();
    }
  }
});

await test('managed availability never replaces an existing personal app or its encrypted secret', async () => {
  const h = serverHarness();
  try {
    managed(h);
    await h.api.saveCredentials('alice', 'oura', {
      clientId: 'personal-client',
      clientSecret: 'personal-secret',
    });
    const before = await h.api.getConnection('alice', 'oura');
    const start = await h.api.authorize('alice', 'oura');
    assert.equal(
      new URL(start.url).searchParams.get('client_id'),
      'personal-client',
    );
    assert.deepEqual(await h.api.getConnection('alice', 'oura'), before);
    await h.api.completeAuthorization(
      'alice',
      'oura',
      start.state,
      'synthetic-code',
    );
    assert.deepEqual(h.provider.exchanges.at(-1)?.credentials, {
      clientId: 'personal-client',
      secret: 'personal-secret',
    });
    const saved = await h.api.getConnection('alice', 'oura');
    assert.equal(saved.secret_cipher, before.secret_cipher);
    assert.equal(saved.credential_source, 'personal');
    const publicData = await h.api.getConnections('alice', day);
    const capability = publicData.connections.find(
      (c: ConnectionStatus) => c.provider === 'oura',
    );
    assert.equal(capability.managedAvailable, true);
    assert.equal(capability.credentialSource, 'personal');
    assert.equal(JSON.stringify(publicData).includes('personal-secret'), false);
  } finally {
    h.sqlite.close();
  }
});

await test('same-client managed secret rotation is used for refresh without replacing its grant', async () => {
  const h = serverHarness();
  try {
    managed(h);
    await connect(h);
    expire(h);
    managed(h, 'oura', 'managed-client', 'rotated-secret');
    await h.api.syncProvider('alice', 'oura');
    const exchange = h.provider.exchanges.at(-1)!;
    assert.deepEqual(exchange.credentials, {
      clientId: 'managed-client',
      secret: 'rotated-secret',
    });
    assert.equal(exchange.grant.refresh_token, 'old');
    const saved = await h.api.getConnection('alice', 'oura');
    assert.equal(saved.status, 'connected');
    assert.equal(saved.secret_cipher, null);
    assert.equal(JSON.parse(saved.token_cipher).refreshToken, 'rotated');
  } finally {
    h.sqlite.close();
  }
});

await test('missing managed configuration retains tokens and history and can recover without new consent', async () => {
  const h = serverHarness();
  try {
    h.environment.OURA_CLIENT_ID = 'managed-client';
    await assert.rejects(h.api.authorize('alice', 'oura'), { status: 503 });
    assert.equal(await h.api.getConnection('alice', 'oura'), null);
    managed(h);
    await connect(h);
    expire(h);
    h.sqlite
      .prepare(
        'INSERT INTO source_entries(user_id,provider,record_id,day,time,type,amount,title) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        'alice',
        'oura',
        'saved',
        '2026-07-01',
        '12:00',
        'activity',
        1000,
        'Saved steps',
      );
    const before = await h.api.getConnection('alice', 'oura');
    delete h.environment.OURA_CLIENT_SECRET;
    const calls = h.provider.exchanges.length;
    await assert.rejects(h.api.syncProvider('alice', 'oura'), { status: 503 });
    const failed = await h.api.getConnection('alice', 'oura');
    assert.equal(failed.token_cipher, before.token_cipher);
    assert.equal(failed.status, 'connected');
    assert.equal(failed.sync_until, 0);
    assert.equal(h.provider.exchanges.length, calls);
    assert.equal(
      h.sqlite.prepare('SELECT COUNT(*) n FROM source_entries').get()?.n,
      1,
    );
    managed(h);
    h.expireSyncCooldown('alice', 'oura');
    await h.api.syncProvider('alice', 'oura');
    assert.equal(
      (await h.api.getConnection('alice', 'oura')).status,
      'connected',
    );
  } finally {
    h.sqlite.close();
  }
});

await test('a replacement managed client requires consent and stays pinned until that consent succeeds', async () => {
  const h = serverHarness();
  try {
    managed(h);
    await connect(h);
    expire(h);
    const before = await h.api.getConnection('alice', 'oura');
    managed(h, 'oura', 'replacement-client', 'replacement-secret');
    const calls = h.provider.exchanges.length;
    await assert.rejects(h.api.syncProvider('alice', 'oura'), { status: 409 });
    assert.equal(h.provider.exchanges.length, calls);
    const old = await h.api.getConnection('alice', 'oura');
    assert.equal(old.client_id, before.client_id);
    assert.equal(old.token_cipher, before.token_cipher);
    const start = await h.api.authorize('alice', 'oura');
    assert.equal(
      new URL(start.url).searchParams.get('client_id'),
      'replacement-client',
    );
    assert.deepEqual(await h.api.getConnection('alice', 'oura'), old);
    h.provider.beforeAuthorization = async () => {
      throw new ApiError('Provider rejected consent', 409);
    };
    await assert.rejects(
      h.api.completeAuthorization('alice', 'oura', start.state, 'bad-code'),
      { status: 409 },
    );
    assert.deepEqual(await h.api.getConnection('alice', 'oura'), old);
    h.provider.beforeAuthorization = async () => {};
    await connect(h);
    const replaced = await h.api.getConnection('alice', 'oura');
    assert.equal(replaced.client_id, 'replacement-client');
    assert.equal(replaced.status, 'connected');
    assert.notEqual(replaced.revision, before.revision);
  } finally {
    h.sqlite.close();
  }
});

await test('client rotation during consent rejects before exchanging the code, while secret rotation stays usable', async () => {
  const h = serverHarness();
  try {
    managed(h);
    const first = await h.api.authorize('alice', 'oura');
    managed(h, 'oura', 'changed-client', 'changed-secret');
    await assert.rejects(
      h.api.completeAuthorization('alice', 'oura', first.state, 'code'),
      { status: 409 },
    );
    assert.equal(h.provider.exchanges.length, 0);
    const second = await h.api.authorize('alice', 'oura');
    managed(h, 'oura', 'changed-client', 'rotated-secret');
    await h.api.completeAuthorization('alice', 'oura', second.state, 'code');
    assert.equal(
      h.provider.exchanges.at(-1)?.credentials.secret,
      'rotated-secret',
    );
  } finally {
    h.sqlite.close();
  }
});

await test('managed OAuth state and token installation remain isolated between accounts', async () => {
  const h = serverHarness();
  try {
    managed(h);
    const alice = await h.api.authorize('alice', 'oura');
    const bob = await h.api.authorize('bob', 'oura');
    await assert.rejects(
      h.api.completeAuthorization('bob', 'oura', alice.state, 'wrong-account'),
      { status: 409 },
    );
    assert.equal(h.provider.exchanges.length, 0);
    await h.api.completeAuthorization(
      'alice',
      'oura',
      alice.state,
      'alice-code',
    );
    const savedAlice = await h.api.getConnection('alice', 'oura');
    await h.api.completeAuthorization('bob', 'oura', bob.state, 'bob-code');
    assert.deepEqual(await h.api.getConnection('alice', 'oura'), savedAlice);
    assert.notEqual(
      (await h.api.getConnection('bob', 'oura')).revision,
      savedAlice.revision,
    );
    assert.ok(h.sealedContexts.includes('alice:oura:tokens'));
    assert.ok(h.sealedContexts.includes('bob:oura:tokens'));
  } finally {
    h.sqlite.close();
  }
});

await test('disconnect or personal setup during managed token exchange prevents stale installation', async () => {
  for (const replace of ['disconnect', 'personal'] as const) {
    const h = serverHarness();
    try {
      managed(h);
      const start = await h.api.authorize('alice', 'oura');
      const started = deferred(),
        release = deferred();
      h.provider.beforeAuthorization = async () => {
        started.resolve();
        await release.promise;
      };
      const completing = h.api.completeAuthorization(
        'alice',
        'oura',
        start.state,
        'code',
      );
      await started.promise;
      if (replace === 'disconnect')
        await h.api.disconnect('alice', 'oura', false);
      else
        await h.api.saveCredentials('alice', 'oura', {
          clientId: 'personal-client',
          clientSecret: 'personal-secret',
        });
      const current = await h.api.getConnection('alice', 'oura');
      release.resolve();
      await assert.rejects(completing, { status: 409 });
      assert.deepEqual(await h.api.getConnection('alice', 'oura'), current);
      assert.equal(current.token_cipher, null);
    } finally {
      h.sqlite.close();
    }
  }
});

await test('successful managed reauthorization invalidates an older in-flight refresh', async () => {
  const h = serverHarness();
  try {
    managed(h);
    await connect(h);
    expire(h);
    const started = deferred(),
      release = deferred();
    h.provider.beforeRefresh = async () => {
      started.resolve();
      await release.promise;
    };
    const syncing = h.api.syncProvider('alice', 'oura');
    await started.promise;
    await connect(h);
    const fresh = await h.api.getConnection('alice', 'oura');
    release.resolve();
    await assert.rejects(syncing, { status: 409 });
    assert.deepEqual(await h.api.getConnection('alice', 'oura'), fresh);
    assert.equal(fresh.sync_until, 0);
    assert.equal(
      JSON.parse(fresh.token_cipher).accessToken,
      'new-authorization',
    );
  } finally {
    h.sqlite.close();
  }
});

await test('personal OAuth states created before the migration still complete safely', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000);
    h.sqlite
      .prepare(
        'INSERT INTO oauth_states(state_hash,user_id,provider,revision,expires_at) VALUES (?,?,?,?,?)',
      )
      .run('legacy-state', 'user', 'oura', 'revision-1', Date.now() + 60000);
    await h.api.completeAuthorization('user', 'oura', 'legacy-state', 'code');
    const saved = await h.api.getConnection('user', 'oura');
    assert.equal(saved.client_id, 'client');
    assert.equal(saved.credential_source, 'personal');
    assert.equal(saved.status, 'connected');
  } finally {
    h.sqlite.close();
  }
});
