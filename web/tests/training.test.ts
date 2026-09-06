import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickLog, recentCaptures } from '../lib/quick-log.ts';
import {
  DEFAULT_PLAN,
  defaultExercises,
  dedupeWorkouts,
  elapsed,
  startWorkout,
  suggestWorkout,
  validatePlan,
  validateWorkout,
  weeklySessions,
  type SourceWorkout,
} from '../lib/training.ts';
import { mapWorkouts } from '../lib/source-workouts.ts';
import { fetchSourceData, PROVIDERS } from '../server/providers.ts';

await test('quick capture recognizes explicit units and rejects ambiguous or invented totals', () => {
  assert.equal(parseQuickLog('water 500 ml')?.amount, 500);
  assert.equal(parseQuickLog('water 1.5 l')?.amount, 1500);
  assert.equal(parseQuickLog('lunch 520 kcal')?.type, 'nutrition');
  assert.equal(parseQuickLog('walk 4k steps')?.amount, 4000);
  assert.equal(parseQuickLog('slept 7 h 30 min')?.amount, 7.5);
  for (const input of [
    'chicken and rice',
    'water 500 ml and 250 ml',
    'water 1 l 500 ml',
    'sleep 2 h then 3 h',
    'lunch 400 kcal dinner 600 kcal',
    'water 500 ml and 4000 steps',
    'water -500 ml',
    'lunch 90000 kcal',
  ])
    assert.equal(parseQuickLog(input), null, input);
});
await test('repeat suggestions use real manual entries and remove exact repeats', () => {
  const e = {
    id: '1',
    day: '2026-09-05',
    time: '12:00',
    type: 'nutrition' as const,
    amount: 520,
    title: 'Lunch',
  };
  assert.deepEqual(
    recentCaptures([
      e,
      { ...e, id: '2' },
      { ...e, id: '3', sample: true },
      { ...e, id: '4', source: 'oura' },
    ]),
    [{ type: 'nutrition', amount: 520, title: 'Lunch' }],
  );
});
await test('workout timers preserve paused duration and detailed sets through validation', () => {
  const suggestion = suggestWorkout(DEFAULT_PLAN, [], [], '2026-09-05');
  const w = startWorkout(
    DEFAULT_PLAN,
    suggestion,
    new Date('2026-09-05T12:00:00Z'),
  );
  assert.equal(elapsed(w, Date.parse('2026-09-05T12:02:10Z')), 130);
  const paused = { ...w, runningSince: null, elapsedSeconds: 130 };
  assert.equal(elapsed(paused, Date.parse('2026-09-05T13:00:00Z')), 130);
  paused.exercises[0].sets[0] = {
    ...paused.exercises[0].sets[0],
    reps: 8,
    weight: 12.5,
    done: true,
  };
  assert.deepEqual(validateWorkout(JSON.parse(JSON.stringify(paused))), paused);
  assert.throws(() => validateWorkout({ ...paused, elapsedSeconds: NaN }));
  assert.throws(() =>
    validateWorkout({ ...paused, status: 'completed', finishedAt: null }),
  );
  assert.throws(() =>
    validateWorkout({
      ...paused,
      exercises: [
        {
          ...paused.exercises[0],
          sets: [{ ...paused.exercises[0].sets[0], reps: 0 }],
        },
      ],
    }),
  );
  assert.throws(() => validatePlan({ ...DEFAULT_PLAN, days: 10 }));
  assert.throws(() => validatePlan({ ...DEFAULT_PLAN, exercises: [] }));
});
await test('suggestions respond to preference, weekly progress and yesterday’s strength session', () => {
  const first = suggestWorkout(DEFAULT_PLAN, [], [], '2026-09-05');
  const done = {
    ...startWorkout(DEFAULT_PLAN, first, new Date('2026-09-05T12:00:00Z')),
    day: '2026-09-05',
    status: 'completed' as const,
    runningSince: null,
    finishedAt: '2026-09-05T12:30:00Z',
    elapsedSeconds: 1800,
  };
  assert.equal(
    suggestWorkout(DEFAULT_PLAN, [done], [], '2026-09-06').kind,
    'walk',
  );
  assert.equal(
    suggestWorkout({ ...DEFAULT_PLAN, goal: 'move' }, [], [], '2026-09-05')
      .kind,
    'walk',
  );
  assert.equal(defaultExercises('dumbbells', 20)[0].sets.length, 2);
  assert.equal(defaultExercises('gym', 45)[0].sets.length, 3);
  assert.equal(
    suggestWorkout(
      { ...DEFAULT_PLAN, days: 2 },
      [done, { ...done, id: crypto.randomUUID(), day: '2026-09-04' }],
      [],
      '2026-09-06',
    ).kind,
    'mobility',
  );
});
await test('one overlapping workout from two wearables and a manual session counts once', () => {
  const source: SourceWorkout = {
    id: 'w1',
    source: 'whoop',
    title: 'Strength',
    day: '2026-09-05',
    startedAt: '2026-09-05T12:00:00Z',
    endedAt: '2026-09-05T12:30:00Z',
    durationSeconds: 1800,
  };
  const other = { ...source, id: 'o1', source: 'oura' as const };
  assert.equal(dedupeWorkouts([other, source]).length, 1);
  const manual = {
    ...startWorkout(
      DEFAULT_PLAN,
      suggestWorkout(DEFAULT_PLAN, [], [], '2026-09-05'),
      new Date(source.startedAt),
    ),
    status: 'completed' as const,
    finishedAt: source.endedAt,
    runningSince: null,
    elapsedSeconds: 1800,
  };
  assert.equal(
    weeklySessions([manual], [source, other], '2026-09-05').count,
    1,
  );
  const separate = {
    ...other,
    id: 'o2',
    startedAt: '2026-09-05T15:00:00Z',
    endedAt: '2026-09-05T15:30:00Z',
  };
  assert.equal(
    weeklySessions([manual], [source, other, separate], '2026-09-05').count,
    2,
  );
});
await test('provider workouts preserve local dates and elapsed duration without inventing steps or sets', () => {
  const whoop = mapWorkouts('whoop', [
    {
      id: 'w1',
      sport_name: 'Weightlifting',
      start: '2026-09-06T01:00:00Z',
      end: '2026-09-06T01:30:00Z',
      timezone_offset: '-07:00',
      score_state: 'PENDING_SCORE',
    },
  ]);
  assert.equal(whoop[0].day, '2026-09-05');
  assert.equal(whoop[0].durationSeconds, 1800);
  assert.equal('exercises' in whoop[0], false);
  const oura = mapWorkouts('oura', [
    {
      id: 'o1',
      activity: 'walking',
      label: null,
      day: '2026-09-05',
      start_datetime: '2026-09-05T18:00:00-07:00',
      end_datetime: '2026-09-05T18:30:00-07:00',
      calories: 140,
    },
  ]);
  assert.equal(oura[0].title, 'walking');
  assert.equal(oura[0].durationSeconds, 1800);
  assert.equal('calories' in oura[0], false);
  assert.equal(
    mapWorkouts('oura', [
      {
        id: 'bad',
        day: '2026-09-05',
        start_datetime: 'invalid',
        end_datetime: 'invalid',
      },
    ]).length,
    0,
  );
});
await test('missing workout scope keeps existing daily sync usable and asks for reauthorization', async () => {
  assert.match(PROVIDERS.whoop.scope, /read:workout/);
  assert.match(PROVIDERS.oura.scope, /workout/);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.pathname.endsWith('/activity/workout'))
        return Response.json({}, { status: 403 });
      return Response.json({ records: [], next_token: null });
    };
    const result = await fetchSourceData('whoop', 'test-token');
    assert.deepEqual(result.entries, []);
    assert.deepEqual(result.workouts, []);
    assert.equal(result.summary.Workouts, 'Reconnect to allow workout sync');
  } finally {
    globalThis.fetch = original;
  }
});
