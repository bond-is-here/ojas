import test from 'node:test';
import assert from 'node:assert/strict';
import { whoopSleep } from '../lib/connections.ts';
import { fetchSourceData } from '../server/providers.ts';
import { serverHarness } from './module-harness.mjs';

const day = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const whoopNight = {
  id: 'sleep-1',
  end: `${day}T08:00:00Z`,
  timezone_offset: 'Z',
  score_state: 'SCORED',
  score: {
    stage_summary: {
      total_light_sleep_time_milli: 14400000,
      total_slow_wave_sleep_time_milli: 7200000,
      total_rem_sleep_time_milli: 7200000,
    },
  },
};
const workout = (id: string, label = 'Walk') => ({
  id,
  day,
  label,
  start_datetime: `${day}T10:00:00Z`,
  end_datetime: `${day}T10:30:00Z`,
});
function pathname(input: Parameters<typeof fetch>[0]) {
  return new URL(input instanceof Request ? input.url : input.toString())
    .pathname;
}
await test('WHOOP accepts the documented Z timezone offset for scored sleep', () => {
  assert.deepEqual(
    whoopSleep([whoopNight]),
    whoopSleep([{ ...whoopNight, timezone_offset: '+00:00' }]),
  );
  assert.equal(whoopSleep([whoopNight])[0].amount, 8);
  assert.equal(whoopSleep([whoopNight])[0].day, day);
});
await test('partial successful source snapshots preserve unreadable history while updating usable records', async () => {
  const h = serverHarness();
  const original = globalThis.fetch;
  let partial = false;
  try {
    h.seed(Date.now() + 3600000);
    globalThis.fetch = async (input) => {
      const route = pathname(input);
      const data = route.endsWith('/daily_activity')
        ? [
            { id: 'daily-1', day, steps: partial ? null : 9000 },
            { id: 'daily-2', day, steps: partial ? 6000 : 5000 },
          ]
        : route.endsWith('/workout')
          ? [
              {
                ...workout('workout-1'),
                start_datetime: partial ? 'invalid' : `${day}T10:00:00Z`,
              },
              workout('workout-2', partial ? 'Run' : 'Walk'),
            ]
          : [];
      return Response.json({ data, next_token: null });
    };
    Object.assign(h.provider.data, await fetchSourceData('oura', 'synthetic'));
    assert.equal(h.provider.data.entriesComplete, true);
    assert.equal(h.provider.data.workoutsComplete, true);
    await h.api.syncProvider('user', 'oura');
    partial = true;
    const partialSnapshot = await fetchSourceData('oura', 'synthetic');
    Object.assign(h.provider.data, partialSnapshot);
    assert.equal(h.provider.data.entriesComplete, false);
    assert.equal(h.provider.data.workoutsComplete, false);
    assert.match(
      String(partialSnapshot.summary['Daily data']),
      /previous records were kept/,
    );
    assert.match(
      String(partialSnapshot.summary.Workouts),
      /previous workouts were kept/,
    );
    h.expireSyncCooldown();
    await h.api.syncProvider('user', 'oura');
    assert.deepEqual(
      h.sqlite
        .prepare(
          'SELECT record_id,amount FROM source_entries ORDER BY record_id',
        )
        .all()
        .map((r) => ({ ...r })),
      [
        { record_id: 'activity:daily-1', amount: 9000 },
        { record_id: 'activity:daily-2', amount: 6000 },
      ],
    );
    assert.deepEqual(
      h.sqlite
        .prepare(
          "SELECT id,json_extract(payload,'$.title') title FROM source_workouts ORDER BY id",
        )
        .all()
        .map((r) => ({ ...r })),
      [
        { id: 'workout-1', title: 'Walk' },
        { id: 'workout-2', title: 'Run' },
      ],
    );
    // A later authoritative empty response still removes genuinely deleted records.
    globalThis.fetch = async () =>
      Response.json({ data: [], next_token: null });
    Object.assign(h.provider.data, await fetchSourceData('oura', 'synthetic'));
    assert.equal(h.provider.data.entriesComplete, true);
    assert.equal(h.provider.data.workoutsComplete, true);
    h.expireSyncCooldown();
    await h.api.syncProvider('user', 'oura');
    assert.equal(
      h.sqlite.prepare('SELECT COUNT(*) n FROM source_entries').get()?.n,
      0,
    );
    assert.equal(
      h.sqlite.prepare('SELECT COUNT(*) n FROM source_workouts').get()?.n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    h.sqlite.close();
  }
});
await test('WHOOP distinguishes intentionally unscored sleeps from unreadable scored data', async () => {
  const original = globalThis.fetch;
  let sleep: unknown[] = [
    whoopNight,
    { id: 'pending', score_state: 'PENDING_SCORE' },
    { id: 'unscorable', score_state: 'UNSCORABLE' },
  ];
  try {
    globalThis.fetch = async (input) =>
      Response.json({
        records: pathname(input).endsWith('/activity/sleep') ? sleep : [],
        next_token: null,
      });
    const valid = await fetchSourceData('whoop', 'synthetic');
    assert.equal(valid.entriesComplete, true);
    assert.equal(valid.entries.length, 1);
    sleep = [...sleep, { ...whoopNight, id: 'invalid', score: null }];
    assert.equal(
      (await fetchSourceData('whoop', 'synthetic')).entriesComplete,
      false,
    );
    sleep = [{ id: 'unknown', score_state: 'UNKNOWN' }];
    assert.equal(
      (await fetchSourceData('whoop', 'synthetic')).entriesComplete,
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
await test('an unreadable sleep does not make an Oura snapshot authoritative', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) =>
      Response.json({
        data: pathname(input).endsWith('/sleep')
          ? [{ id: 'sleep-1', day, total_sleep_duration: null }]
          : [],
        next_token: null,
      });
    const result = await fetchSourceData('oura', 'synthetic');
    assert.equal(result.entriesComplete, false);
    assert.equal(result.workoutsComplete, true);
  } finally {
    globalThis.fetch = original;
  }
});
await test('invalid nonempty page cursors cannot turn truncated source data into a complete snapshot', async () => {
  const original = globalThis.fetch;
  try {
    for (const next of [42, {}, [], false]) {
      globalThis.fetch = async () =>
        Response.json({ data: [], next_token: next });
      await assert.rejects(fetchSourceData('oura', 'synthetic'), {
        status: 502,
      });
    }
    for (const next of [null, undefined, '']) {
      globalThis.fetch = async () =>
        Response.json({ data: [], next_token: next });
      const result = await fetchSourceData('oura', 'synthetic');
      assert.equal(result.entriesComplete, true);
      assert.equal(result.workoutsComplete, true);
    }
  } finally {
    globalThis.fetch = original;
  }
});
await test('repeated source page cursors fail promptly and optional workout failures preserve completeness', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ records: [], next_token: 'same-page' });
    };
    await assert.rejects(fetchSourceData('whoop', 'synthetic'), {
      status: 502,
    });
    assert.equal(calls, 2);
    let workoutCalls = 0;
    globalThis.fetch = async (input) => {
      const isWorkout = pathname(input).endsWith('/workout');
      if (isWorkout) workoutCalls++;
      return Response.json({
        data: [],
        next_token: isWorkout ? 'same-page' : null,
      });
    };
    const result = await fetchSourceData('oura', 'synthetic');
    assert.equal(workoutCalls, 2);
    assert.equal(result.entriesComplete, true);
    assert.equal(result.workoutsComplete, false);
    assert.match(String(result.summary.Workouts), /unavailable/);
  } finally {
    globalThis.fetch = original;
  }
});
