import test from 'node:test';
import assert from 'node:assert/strict';
import * as connectionModel from '../lib/connections.ts';
import type { ConnectionStatus } from '../lib/connections.ts';
import * as trainingModel from '../lib/training.ts';
import * as workoutQueue from '../lib/workout-save-queue.ts';
import * as clientRequest from '../lib/client-request.ts';
import { fetchSourceData } from '../server/providers.ts';
import { serverHarness, hookHarness, loadModule } from './module-harness.mjs';

const day = '2026-09-07';
const sourceWorkout: trainingModel.SourceWorkout = {
  id: 'workout-1',
  source: 'oura',
  title: 'Run',
  day,
  startedAt: `${day}T10:00:00.000Z`,
  endedAt: `${day}T10:30:00.000Z`,
  durationSeconds: 1800,
};
function expectApiError(error: unknown, status: number) {
  assert.ok(error instanceof Error);
  const apiError = error as Error & { status: number };
  assert.equal(apiError.status, status);
  return apiError;
}
await test('sync reconciles missing entries and workouts, handles zero corrections, and retains older history', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000);
    h.provider.data.entries = connectionModel.ouraEntries(
      [
        { id: 'daily-1', day, steps: 9000 },
        { id: 'older', day: '2026-07-01', steps: 1000 },
      ],
      [],
    );
    h.provider.data.workouts = [
      sourceWorkout,
      { ...sourceWorkout, id: 'older', day: '2026-07-01' },
    ];
    await h.api.syncProvider('user', 'oura');
    h.provider.data.entries = connectionModel.ouraEntries(
      [{ id: 'daily-1', day, steps: 0 }],
      [],
    );
    h.provider.data.workouts = [];
    h.expireSyncCooldown();
    await h.api.syncProvider('user', 'oura');
    assert.equal(
      h.sqlite.prepare('SELECT amount FROM source_entries WHERE day=?').get(day)
        ?.amount,
      0,
    );
    assert.equal(
      h.sqlite
        .prepare('SELECT COUNT(*) AS n FROM source_workouts WHERE day=?')
        .get(day)?.n,
      0,
    );
    assert.equal(
      h.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM source_workouts WHERE day='2026-07-01'",
        )
        .get()?.n,
      1,
    );
    h.provider.data.entries = [];
    h.expireSyncCooldown();
    await h.api.syncProvider('user', 'oura');
    assert.equal(
      h.sqlite
        .prepare('SELECT COUNT(*) AS n FROM source_entries WHERE day=?')
        .get(day)?.n,
      0,
    );
    assert.equal(
      h.sqlite
        .prepare(
          "SELECT COUNT(*) AS n FROM source_entries WHERE day='2026-07-01'",
        )
        .get()?.n,
      1,
    );
  } finally {
    h.sqlite.close();
  }
});
await test('optional workout failures retain previously synced workouts', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000);
    h.provider.data.workouts = [sourceWorkout];
    await h.api.syncProvider('user', 'oura');
    h.provider.data.workouts = [];
    h.provider.data.workoutsComplete = false;
    h.expireSyncCooldown();
    await h.api.syncProvider('user', 'oura');
    assert.equal(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM source_workouts').get()?.n,
      1,
    );
  } finally {
    h.sqlite.close();
  }
});
await test('repeated syncs expose and retain the per-account cooldown across reloads', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000);
    await h.api.syncProvider('user', 'oura');
    const first = h.sqlite
      .prepare('SELECT next_sync_at,sync_until FROM connections')
      .get() as { next_sync_at: number; sync_until: number };
    assert.ok(first.next_sync_at > Date.now());
    assert.equal(first.sync_until, 0);
    const status = (await h.api.getConnections('user')).connections.find(
      (connection: ConnectionStatus) => connection.provider === 'oura',
    );
    assert.equal(status?.nextSyncAt, first.next_sync_at);
    const reloaded = h.reloadApi();
    await assert.rejects(reloaded.syncProvider('user', 'oura'), (error) => {
      const apiError = expectApiError(error, 429);
      assert.match(
        apiError.message,
        /^Wait \d+ seconds? before syncing this source again\.$/,
      );
      return true;
    });
    assert.equal(h.provider.fetchCalls, 1);
  } finally {
    h.sqlite.close();
  }
});
await test('a failed sync retains its cooldown and becomes retryable after expiry', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000);
    h.provider.beforeFetch = async () => {
      throw new Error('provider unavailable');
    };
    await assert.rejects(h.api.syncProvider('user', 'oura'), { status: 502 });
    const failed = h.sqlite
      .prepare('SELECT next_sync_at,sync_until,last_error FROM connections')
      .get() as {
      next_sync_at: number;
      sync_until: number;
      last_error: string;
    };
    assert.ok(failed.next_sync_at > Date.now());
    assert.equal(failed.sync_until, 0);
    assert.equal(
      failed.last_error,
      'Sync could not finish. Your previous data is unchanged.',
    );
    await assert.rejects(h.api.syncProvider('user', 'oura'), { status: 429 });
    assert.equal(h.provider.fetchCalls, 1);
    h.expireSyncCooldown();
    h.provider.beforeFetch = async () => {};
    await h.api.syncProvider('user', 'oura');
    assert.equal(h.provider.fetchCalls, 2);
  } finally {
    h.sqlite.close();
  }
});
await test('cooldowns are isolated per account', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000, 'oura', 'alice');
    h.seed(Date.now() + 3600000, 'oura', 'bob');
    await h.api.syncProvider('alice', 'oura');
    await h.api.syncProvider('bob', 'oura');
    assert.equal(h.provider.fetchCalls, 2);
    const alice = h.sqlite
      .prepare('SELECT next_sync_at FROM connections WHERE user_id=?')
      .get('alice') as { next_sync_at: number };
    const bob = h.sqlite
      .prepare('SELECT next_sync_at FROM connections WHERE user_id=?')
      .get('bob') as { next_sync_at: number };
    assert.ok(alice.next_sync_at > Date.now());
    assert.ok(bob.next_sync_at > Date.now());
  } finally {
    h.sqlite.close();
  }
});
await test('active leases and revision changes keep their 409 responses ahead of cooldowns', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000);
    h.sqlite
      .prepare('UPDATE connections SET sync_until=?,next_sync_at=?')
      .run(Date.now() + 120000, Date.now() + 60000);
    await assert.rejects(h.api.syncProvider('user', 'oura'), (error) => {
      const apiError = expectApiError(error, 409);
      assert.equal(
        apiError.message,
        'This source is already syncing. Try again shortly.',
      );
      return true;
    });
    assert.equal(h.provider.fetchCalls, 0);
    h.sqlite
      .prepare('UPDATE connections SET sync_until=0,next_sync_at=0')
      .run();
    let changed = false;
    h.hooks.before = async (sql: string) => {
      if (!changed && sql.startsWith('UPDATE connections SET sync_until=?')) {
        changed = true;
        h.sqlite
          .prepare('UPDATE connections SET revision=?')
          .run('new-revision');
      }
    };
    await assert.rejects(h.api.syncProvider('user', 'oura'), (error) => {
      const apiError = expectApiError(error, 409);
      assert.equal(
        apiError.message,
        'The connection changed. Reload Ojas and try syncing again.',
      );
      return true;
    });
    assert.equal(h.provider.fetchCalls, 0);
  } finally {
    h.sqlite.close();
  }
});
await test('an expired sync cannot overwrite history or release a newer sync lease', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000);
    h.provider.data.workouts = [sourceWorkout];
    await h.api.syncProvider('user', 'oura');
    h.provider.data.workouts = [];
    let newerLease = 0;
    h.hooks.before = async (sql: string) => {
      if (!newerLease && sql.startsWith('DELETE FROM source_entries')) {
        newerLease =
          Number(
            h.sqlite.prepare('SELECT sync_until FROM connections').get()
              ?.sync_until,
          ) + 60000;
        h.sqlite
          .prepare(
            "UPDATE connections SET sync_until=?,last_sync='newer sync',last_error=NULL",
          )
          .run(newerLease);
      }
    };
    h.expireSyncCooldown();
    await assert.rejects(h.api.syncProvider('user', 'oura'), { status: 409 });
    assert.deepEqual(
      {
        ...h.sqlite
          .prepare(
            'SELECT sync_until,last_sync,last_error,status FROM connections',
          )
          .get(),
      },
      {
        sync_until: newerLease,
        last_sync: 'newer sync',
        last_error: null,
        status: 'connected',
      },
    );
    assert.equal(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM source_workouts').get()?.n,
      1,
    );
  } finally {
    h.sqlite.close();
  }
});
await test('WHOOP reconciliation keeps partial boundary days and workouts outside the fetched interval', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() + 3600000, 'whoop');
    h.provider.data.window.fromDay = '2026-08-09';
    h.provider.data.window.untilDay = '2026-09-06';
    h.provider.data.workouts = [
      {
        ...sourceWorkout,
        source: 'whoop',
        id: 'before',
        startedAt: '2026-08-07T10:00:00.000Z',
        endedAt: '2026-08-07T10:30:00.000Z',
      },
      { ...sourceWorkout, source: 'whoop', id: 'inside' },
    ];
    h.provider.data.entries = ['2026-08-07', '2026-08-15', day].map((d) => ({
      id: d,
      recordId: `sleep:${d}`,
      source: 'whoop',
      day: d,
      time: '08:00',
      type: 'sleep',
      amount: 8,
      title: 'Sleep',
    }));
    await h.api.syncProvider('user', 'whoop');
    h.provider.data.workouts = [];
    h.provider.data.entries = [];
    h.expireSyncCooldown('user', 'whoop');
    await h.api.syncProvider('user', 'whoop');
    assert.deepEqual(
      h.sqlite
        .prepare('SELECT id FROM source_workouts')
        .all()
        .map((r) => r.id),
      ['before'],
    );
    assert.deepEqual(
      h.sqlite
        .prepare('SELECT day FROM source_entries ORDER BY day')
        .all()
        .map((r) => r.day),
      ['2026-08-07', day],
    );
  } finally {
    h.sqlite.close();
  }
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
await test('a sync that acquires after another sync refreshes uses the newly rotated token', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() - 1000);
    const started = deferred(),
      release = deferred(),
      lockReached = deferred(),
      releaseLock = deferred();
    h.provider.beforeRefresh = async () => {
      started.resolve();
      await release.promise;
    };
    let locks = 0;
    h.hooks.before = async (sql: string) => {
      if (
        sql.startsWith('UPDATE connections SET sync_until=?') &&
        ++locks === 2
      ) {
        lockReached.resolve();
        await releaseLock.promise;
      }
    };
    const first = h.api.syncProvider('user', 'oura');
    await started.promise;
    const second = h.api.syncProvider('user', 'oura');
    await lockReached.promise;
    release.resolve();
    await first;
    h.expireSyncCooldown();
    releaseLock.resolve();
    await second;
    assert.deepEqual(h.provider.refreshSubmissions, ['old']);
    assert.equal(
      h.sqlite.prepare('SELECT status FROM connections').get()?.status,
      'connected',
    );
  } finally {
    h.sqlite.close();
  }
});
await test('newer source responses win when requests resolve out of order', async () => {
  const { states, react } = hookHarness();
  const pending: ((r: Response) => void)[] = [];
  const original = globalThis.fetch;
  try {
    globalThis.fetch = () =>
      new Promise((resolve) => {
        pending.push(resolve);
      });
    const { useConnections } = loadModule('hooks/use-connections.ts', {
      '@/lib/client-request': clientRequest,
      react,
      '@/lib/connections': connectionModel,
    });
    const controller = useConnections(day);
    const older = controller.refresh(),
      newer = controller.refresh();
    const response = (entries: unknown[]) =>
      Response.json({
        connections: [],
        entries,
        preferences: connectionModel.DEFAULT_SOURCE_PREFERENCES,
      });
    pending[1](response([]));
    await newer;
    pending[0](
      response(
        connectionModel.ouraEntries(
          [{ id: 'removed-record', day, steps: 1200 }],
          [],
        ),
      ),
    );
    await older;
    assert.deepEqual(states[0].entries, []);
  } finally {
    globalThis.fetch = original;
  }
});
await test('removing source history invalidates an in-flight training response', async () => {
  const { states, react } = hookHarness();
  const response = deferred();
  const original = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => {
      const first = ++calls === 1;
      await response.promise;
      return Response.json({
        preferences: trainingModel.DEFAULT_PLAN,
        sessions: [],
        imported: first ? [sourceWorkout] : [],
      });
    };
    const { useTraining } = loadModule('hooks/use-training.ts', {
      '@/lib/client-request': clientRequest,
      react,
      '@/lib/training': trainingModel,
      '@/lib/workout-save-queue': workoutQueue,
    });
    const controller = useTraining(day);
    states[0].imported = [sourceWorkout];
    const older = controller.refresh();
    controller.removeSourceHistory('oura');
    assert.deepEqual(states[0].imported, []);
    response.resolve();
    await older;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(states[0].imported, []);
    assert.equal(states[1], false);
  } finally {
    globalThis.fetch = original;
  }
});
await test('provider snapshots identify successful empty workout collections separately from failed ones', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ data: [], next_token: null });
    assert.equal(
      (await fetchSourceData('oura', 'synthetic')).workoutsComplete,
      true,
    );
    globalThis.fetch = async (input) =>
      new URL(
        input instanceof Request ? input.url : input.toString(),
      ).pathname.endsWith('/workout')
        ? Response.json({}, { status: 403 })
        : Response.json({ data: [], next_token: null });
    assert.equal(
      (await fetchSourceData('oura', 'synthetic')).workoutsComplete,
      false,
    );
    assert.deepEqual(
      connectionModel.ouraEntries([{ id: 'missing', day }], []),
      [],
    );
  } finally {
    globalThis.fetch = original;
  }
});
await test('reauthorization invalidates an older in-flight token refresh', async () => {
  const h = serverHarness();
  try {
    h.seed(Date.now() - 1000);
    const started = deferred(),
      finish = deferred();
    h.provider.beforeRefresh = async () => {
      started.resolve();
      await finish.promise;
    };
    h.sqlite
      .prepare(
        'INSERT INTO oauth_states(state_hash,user_id,provider,revision,expires_at) VALUES (?,?,?,?,?)',
      )
      .run('state', 'user', 'oura', 'revision-1', Date.now() + 60000);
    const syncing = h.api.syncProvider('user', 'oura');
    await started.promise;
    await h.api.completeAuthorization('user', 'oura', 'state', 'code');
    finish.resolve();
    await assert.rejects(syncing, { status: 409 });
    const row = h.sqlite
      .prepare(
        'SELECT token_cipher,status,sync_until,last_error,revision FROM connections',
      )
      .get()!;
    assert.equal(
      JSON.parse(String(row.token_cipher)).accessToken,
      'new-authorization',
    );
    assert.equal(row.status, 'connected');
    assert.equal(row.sync_until, 0);
    assert.equal(row.last_error, null);
    assert.notEqual(row.revision, 'revision-1');
  } finally {
    h.sqlite.close();
  }
});
