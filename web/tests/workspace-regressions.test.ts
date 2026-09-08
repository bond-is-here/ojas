import test from 'node:test';
import assert from 'node:assert/strict';
import * as health from '../lib/health.ts';
import * as model from '../lib/workspace.ts';
import {
  createAccountWorkspace,
  type WorkspaceState,
} from '../lib/account-workspace.ts';
import { serverHarness, loadModule } from './module-harness.mjs';

const day = '2026-09-07';
const entry = (id: string): health.Entry => ({
  id,
  day,
  time: '12:00',
  type: 'water',
  amount: 250,
  title: id,
});
function backend() {
  const harness = serverHarness();
  const api = loadModule('server/workspace.ts', {
    '../lib/health.ts': health,
    '../lib/workspace.ts': model,
    './runtime': harness.runtime,
  });
  return { ...harness, api };
}
await test('account records persist, remain isolated, and retry receipts cannot resurrect a deleted log', async () => {
  const h = backend();
  try {
    const a = { id: 'request-a', action: { type: 'add', entry: entry('a') } };
    await h.api.mutateWorkspace('alice', a);
    await h.api.mutateWorkspace('alice', a);
    const saved = await h.api.getWorkspace('alice', day);
    assert.equal(saved.accountId, 'alice');
    assert.equal(saved.workspace.demo, false);
    assert.deepEqual(saved.workspace.entries, [entry('a')]);
    assert.equal(
      (await h.api.getWorkspace('bob', day)).workspace.entries.length,
      0,
    );
    await h.api.mutateWorkspace('alice', {
      id: 'remove',
      action: { type: 'remove', id: 'a' },
    });
    await h.api.mutateWorkspace('alice', a);
    assert.equal(
      (await h.api.getWorkspace('alice', day)).workspace.entries.length,
      0,
    );
    await assert.rejects(
      h.api.mutateWorkspace('alice', {
        ...a,
        action: { type: 'add', entry: entry('different') },
      }),
      { status: 409 },
    );
  } finally {
    h.sqlite.close();
  }
});
await test('legacy imports are explicit, idempotent and cannot overwrite an edited account record', async () => {
  const h = backend();
  try {
    await h.api.mutateWorkspace('alice', {
      id: 'add',
      action: { type: 'add', entry: { ...entry('a'), amount: 500 } },
    });
    await h.api.mutateWorkspace('alice', {
      id: 'import',
      action: { type: 'import', entries: [entry('a'), entry('b')] },
    });
    const saved = await h.api.getWorkspace('alice', day);
    assert.equal(saved.workspace.entries.length, 2);
    assert.equal(
      saved.workspace.entries.find((e: health.Entry) => e.id === 'a').amount,
      500,
    );
    await h.api.mutateWorkspace('alice', {
      id: 'motion',
      action: { type: 'preferences', motion: false },
    });
    await h.api.mutateWorkspace('alice', {
      id: 'goals',
      action: {
        type: 'preferences',
        goals: { ...health.DEFAULT_GOALS, water: 3000 },
      },
    });
    const p = (await h.api.getWorkspace('alice', day)).workspace;
    assert.equal(p.motion, false);
    assert.equal(p.goals.water, 3000);
  } finally {
    h.sqlite.close();
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function clients() {
  const storage = new Map<string, string>();
  const received = new Map<string, model.WorkspaceMutation>();
  const saved = new Map<string, health.Entry>();
  const make = (
    send: (mutation: model.WorkspaceMutation) => Promise<unknown>,
  ) => {
    let state!: WorkspaceState;
    const client = createAccountWorkspace(
      'alice',
      {
        readPending: () => [...storage.values()],
        writePending: (id, value) => {
          if (value === null) storage.delete(id);
          else storage.set(id, value);
        },
        lock: async (run) => run(),
        read: async () => ({
          accountId: 'alice',
          workspace: {
            ...model.emptyWorkspace(),
            entries: [...saved.values()],
          },
        }),
        send,
      },
      (next) => {
        state = next;
      },
    );
    return { client, state: () => state };
  };
  const accept = async (request: model.WorkspaceMutation) => {
    received.set(request.id, request);
    if (request.action.type === 'add')
      saved.set(request.action.entry.id, request.action.entry);
  };
  return { storage, received, saved, make, accept };
}
await test('a stale tab retry cannot erase another tab’s pending manual log', async () => {
  const h = clients();
  let failA = true,
    failB = true;
  const a = h.make(async (m) => {
    if (failA) throw new Error('offline A');
    await h.accept(m);
  });
  const b = h.make(async (m) => {
    if (m.action.type === 'add' && m.action.entry.id === 'b' && failB)
      throw new Error('offline B');
    await h.accept(m);
  });
  await Promise.all([a.client.load(day), b.client.load(day)]);
  await assert.rejects(a.client.mutate({ type: 'add', entry: entry('a') }));
  await assert.rejects(b.client.mutate({ type: 'add', entry: entry('b') }));
  assert.equal(h.storage.size, 1);
  failA = false;
  failB = false;
  await a.client.retry();
  assert.deepEqual([...h.saved.keys()].sort(), ['a', 'b']);
  assert.equal(h.storage.size, 0);
});
await test('an older in-flight acknowledgment only clears its own request without Web Locks', async () => {
  const h = clients(),
    started = deferred<void>(),
    finish = deferred<void>();
  const a = h.make(async (m) => {
    await h.accept(m);
    started.resolve();
    await finish.promise;
  });
  const b = h.make(async (m) => {
    if (m.action.type === 'add' && m.action.entry.id === 'b')
      throw new Error('offline B');
    await h.accept(m);
  });
  await Promise.all([a.client.load(day), b.client.load(day)]);
  const first = a.client.mutate({ type: 'add', entry: entry('a') });
  await started.promise;
  await assert.rejects(b.client.mutate({ type: 'add', entry: entry('b') }));
  finish.resolve();
  await first;
  assert.equal(h.storage.size, 1);
  assert.equal(JSON.parse([...h.storage.values()][0]).action.entry.id, 'b');
});
await test('all stale load completions preserve the newer load’s data and error state', async () => {
  for (const olderFails of [true, false]) {
    const older = deferred<model.AccountWorkspace>(),
      newer = deferred<model.AccountWorkspace>();
    let state!: WorkspaceState;
    const client = createAccountWorkspace(
      'alice',
      {
        readPending: () => [],
        writePending: () => {},
        lock: async (run) => run(),
        send: async () => {},
        read: (d) => (d === day ? older.promise : newer.promise),
      },
      (next) => {
        state = next;
      },
    );
    const first = client.load(day),
      second = client.load('2026-09-08');
    if (olderFails)
      newer.resolve({ accountId: 'alice', workspace: model.emptyWorkspace() });
    else newer.reject(new Error('latest failure'));
    await second;
    if (olderFails) older.reject(new Error('stale failure'));
    else
      older.resolve({ accountId: 'alice', workspace: model.emptyWorkspace() });
    await first;
    assert.equal(state.loaded, olderFails);
    assert.equal(state.error, olderFails ? '' : 'latest failure');
  }
});
await test('an account mismatch never displays another account’s records', async () => {
  let state!: WorkspaceState;
  const client = createAccountWorkspace(
    'alice',
    {
      readPending: () => [],
      writePending: () => {},
      lock: async (run) => run(),
      send: async () => {},
      read: async () => ({
        accountId: 'bob',
        workspace: { ...model.emptyWorkspace(), entries: [entry('private')] },
      }),
    },
    (next) => {
      state = next;
    },
  );
  await client.load(day);
  assert.equal(state.loaded, false);
  assert.equal(state.workspace.entries.length, 0);
  assert.match(state.error, /account changed/);
});
await test('account exports paginate all saved records and exclude other accounts and credentials', async () => {
  const h = backend();
  try {
    for (let i = 0; i < 105; i++)
      h.sqlite
        .prepare(
          'INSERT INTO manual_entries(user_id,id,day,payload) VALUES (?,?,?,?)',
        )
        .run('alice', `entry-${i}`, day, JSON.stringify(entry(`entry-${i}`)));
    h.sqlite
      .prepare(
        'INSERT INTO manual_entries(user_id,id,day,payload) VALUES (?,?,?,?)',
      )
      .run('bob', 'private', day, JSON.stringify(entry('private')));
    h.seed(Date.now() + 60000);
    h.sqlite
      .prepare(
        "UPDATE connections SET user_id='alice',secret_cipher='must-never-export',token_cipher='private-token'",
      )
      .run();
    const api = loadModule('server/export.ts', { './runtime': h.runtime });
    const text = await new Response(api.accountExport('alice')).text();
    const lines = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(lines[0].accountId, 'alice');
    assert.equal(
      lines.filter((line) => line.kind === 'manual_entries').length,
      105,
    );
    for (const secret of [
      'must-never-export',
      'private-token',
      '"private"',
      'secret_cipher',
      'token_cipher',
    ])
      assert.equal(text.includes(secret), false, secret);
  } finally {
    h.sqlite.close();
  }
});
