import test from 'node:test';
import assert from 'node:assert/strict';
import * as connectionModel from '../lib/connections.ts';
import * as trainingModel from '../lib/training.ts';
import * as workoutQueue from '../lib/workout-save-queue.ts';
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
    await h.api.syncProvider('user', 'oura');
    assert.equal(
      h.sqlite.prepare('SELECT COUNT(*) AS n FROM source_workouts').get()?.n,
      1,
    );
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
    pending[0](response([{ id: 'removed-record' }]));
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
    globalThis.fetch = async () => {
      await response.promise;
      return Response.json({
        preferences: trainingModel.DEFAULT_PLAN,
        sessions: [],
        imported: [sourceWorkout],
      });
    };
    const { useTraining } = loadModule('hooks/use-training.ts', {
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
    assert.deepEqual(states[0].imported, []);
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
