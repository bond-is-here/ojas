import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceCalendar,
  DEFAULT_WORKSPACE,
  parseWorkspace,
  type Entry,
  type Workspace,
} from '../lib/health.ts';
import { parseQuickLog, recentCaptures } from '../lib/quick-log.ts';
import {
  adjustDuration,
  DEFAULT_PLAN,
  elapsed,
  repeatExercises,
  startWorkout,
  suggestWorkout,
  type Workout,
} from '../lib/training.ts';
import {
  WorkoutSaveQueue,
  WorkoutSaveError,
} from '../lib/workout-save-queue.ts';
import { createWorkspaceStore } from '../lib/local-workspace.ts';
import {
  parseRecovery,
  type WorkoutRecovery,
} from '../lib/workout-recovery.ts';

const workout = () =>
  startWorkout(
    DEFAULT_PLAN,
    suggestWorkout(DEFAULT_PLAN, [], [], '2026-09-07'),
    new Date('2026-09-07T12:00:00Z'),
  );
await test('unchanged duration edits preserve a running timer; deliberate corrections reset its base', () => {
  const w = workout();
  const now = new Date('2026-09-07T12:30:05Z');
  const unchanged = adjustDuration(w, '1', '1', now);
  assert.equal(unchanged, w);
  assert.equal(elapsed(unchanged, now.valueOf()), 1805);
  const edited = adjustDuration(w, '20', '30', now);
  assert.equal(elapsed(edited, now.valueOf() + 5000), 1205);
  assert.throws(() => adjustDuration(w, '', '30', now));
  assert.throws(() => adjustDuration(w, '1.5', '30', now));
});
await test('repeat exercise values preserve an explicitly logged bodyweight set', () => {
  const w = workout();
  const planned = w.exercises.map((e) => ({
    ...e,
    sets: e.sets.map((s) => ({ ...s, weight: 10 })),
  }));
  assert.equal(repeatExercises(planned, w)[0].sets[0].weight, 0);
  assert.equal(repeatExercises(planned)[0].sets[0].weight, 10);
});
await test('lost save acknowledgments retry the exact attempt before newer queued edits', async () => {
  const initial = { ...workout(), version: 1 };
  let server = initial;
  let rejectResponse!: (reason: Error) => void;
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const attempts: Workout[] = [];
  const save = async (attempt: Workout) => {
    attempts.push(attempt);
    if (attempt.version === server.version)
      server = { ...attempt, version: attempt.version + 1 };
    else assert.deepEqual({ ...attempt, version: attempt.version + 1 }, server);
    if (attempts.length === 1) {
      requestStarted();
      await new Promise<void>((_, reject) => {
        rejectResponse = reject;
      });
    }
    return server;
  };
  const queue = new WorkoutSaveQueue(initial.version);
  queue.enqueue({ ...initial, note: 'First edit' });
  const first = queue.flush(save);
  await started;
  queue.enqueue({ ...initial, note: 'Newer edit while saving' });
  rejectResponse(new Error('Response lost after commit'));
  await assert.rejects(first, /Response lost/);
  assert.equal(queue.hasPending, true);
  await queue.flush(save);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(attempts[2].version, 2);
  assert.equal(server.note, 'Newer edit while saving');
  assert.equal(server.version, 3);
  assert.equal(queue.hasPending, false);
});
await test('a corrected workout replaces a definitively rejected save without advancing its version', async () => {
  for (const correctionDuringSave of [false, true]) {
    const initial = { ...workout(), version: 3 };
    const queue = new WorkoutSaveQueue(initial.version);
    const corrected = { ...initial, note: 'Corrected' };
    const attempts: Workout[] = [];
    const save = async (attempt: Workout) => {
      attempts.push(attempt);
      if (attempt.note === 'Invalid') {
        if (correctionDuringSave) queue.enqueue(corrected);
        throw new WorkoutSaveError('Invalid workout', 400);
      }
      return { ...attempt, version: attempt.version + 1 };
    };
    queue.enqueue({ ...initial, note: 'Invalid' });
    if (correctionDuringSave) await queue.flush(save);
    else {
      await assert.rejects(queue.flush(save), /Invalid workout/);
      queue.enqueue(corrected);
      await queue.flush(save);
    }
    assert.deepEqual(
      attempts.map((a) => [a.note, a.version]),
      [
        ['Invalid', 3],
        ['Corrected', 3],
      ],
    );
    assert.equal(queue.hasPending, false);
  }
});
await test('workout recovery retains the exact in-flight request and newer edits across reload', async () => {
  const initial = { ...workout(), version: 1 };
  const queue = new WorkoutSaveQueue(initial.version);
  let journal = queue.snapshot();
  queue.onChange = (state) => {
    journal = state;
  };
  let release!: () => void;
  let server = initial;
  queue.enqueue({ ...initial, note: 'First' });
  const saving = queue.flush(async (attempt) => {
    assert.deepEqual(
      journal.retry,
      attempt,
      'attempt must already be durable before network submission',
    );
    server = { ...attempt, version: 2 };
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    throw new Error('response lost');
  });
  queue.enqueue({ ...initial, note: 'Newer' });
  const raw = JSON.stringify({
    schema: 1,
    accountId: 'alice',
    latest: { ...initial, note: 'Newer' },
    queue: journal,
    duration: { value: '20', original: '1' },
    updatedAt: new Date().toISOString(),
  } satisfies WorkoutRecovery);
  const recovered = parseRecovery(raw, 'alice');
  assert.throws(() => parseRecovery(raw, 'bob'));
  release();
  await assert.rejects(saving);
  const resumed = new WorkoutSaveQueue(initial.version, recovered.queue);
  const attempts: Workout[] = [];
  await resumed.flush(async (attempt) => {
    attempts.push(attempt);
    if (attempt.version === server.version)
      server = { ...attempt, version: attempt.version + 1 };
    else assert.deepEqual({ ...attempt, version: attempt.version + 1 }, server);
    return server;
  });
  assert.deepEqual(
    attempts.map((a) => [a.note, a.version]),
    [
      ['First', 1],
      ['Newer', 2],
    ],
  );
  assert.equal(server.note, 'Newer');
  assert.equal(resumed.hasPending, false);
});
await test('a recovered conflict retains its draft and exact attempted version', async () => {
  const queue = new WorkoutSaveQueue(3);
  queue.enqueue({ ...workout(), version: 3, note: 'Keep this' });
  const recovered = new WorkoutSaveQueue(3, queue.snapshot());
  await assert.rejects(
    recovered.flush(async () => {
      throw new WorkoutSaveError('Changed elsewhere', 409);
    }),
  );
  assert.equal(recovered.snapshot().retry?.version, 3);
  assert.equal(recovered.snapshot().retry?.note, 'Keep this');
  assert.equal(recovered.hasPending, true);
});
await test('quick capture handles attached units and rejects partly parsed quantities', () => {
  for (const [input, amount] of [
    ['500ml', 500],
    ['500kcal', 500],
    ['4,000 steps', 4000],
    ['post-workout 500 ml', 500],
  ] as const)
    assert.equal(parseQuickLog(input)?.amount, amount, input);
  for (const input of [
    'water 0,5 l',
    'water 5,00 ml',
    'sleep -7 h 30 min',
    'sleep 7 h -30 min',
    'sleep 7 h - 30 min',
    'sleep 7.5.5 h',
    'water 1e3 ml',
    'water 500 ml and 2 glasses',
  ])
    assert.equal(parseQuickLog(input), null, input);
});
const entry = (id: string, type: Entry['type'] = 'water'): Entry => ({
  id,
  day: '2026-09-07',
  time: '12:00',
  type,
  amount: 250,
  title: id,
});
await test('recent water entries do not hide meal repeat shortcuts', () => {
  assert.deepEqual(
    recentCaptures([
      entry('water 1'),
      entry('water 2'),
      entry('water 3'),
      entry('Lunch', 'nutrition'),
    ]),
    [{ type: 'nutrition', amount: 250, title: 'Lunch' }],
  );
});
await test('the current day rolls forward at midnight while a historical selection stays put', () => {
  assert.deepEqual(
    advanceCalendar({ day: '2026-09-07', today: '2026-09-07' }, '2026-09-08'),
    { day: '2026-09-08', today: '2026-09-08' },
  );
  assert.deepEqual(
    advanceCalendar({ day: '2026-09-01', today: '2026-09-07' }, '2026-09-08'),
    { day: '2026-09-01', today: '2026-09-08' },
  );
});
await test('local mutations from two tabs retain both logs and never resurrect a removed entry', async () => {
  let raw = JSON.stringify(DEFAULT_WORKSPACE);
  let lockTail = Promise.resolve();
  const lock = (run: () => void) => {
    lockTail = lockTail.then(run);
    return lockTail;
  };
  const storage = {
    read: () => raw,
    write: (next: string) => {
      raw = next;
    },
  };
  const a = createWorkspaceStore(storage, () => {}, lock);
  const b = createWorkspaceStore(storage, () => {}, lock);
  a.load();
  b.load();
  await Promise.all([
    a.update((w) => ({ ...w, entries: [...w.entries, entry('a')] })),
    b.update((w) => ({ ...w, entries: [...w.entries, entry('b')] })),
  ]);
  assert.deepEqual(
    parseWorkspace(raw).entries.map((e) => e.id),
    ['a', 'b'],
  );
  await a.update((w) => ({
    ...w,
    entries: w.entries.filter((e) => e.id !== 'a'),
  }));
  await b.update((w) => ({ ...w, motion: false }));
  assert.deepEqual(
    parseWorkspace(raw).entries.map((e) => e.id),
    ['b'],
  );
});
await test('corrupt storage and failed writes preserve the saved copy and keep subsequent session entries', async () => {
  for (const corrupt of [false, true]) {
    let raw = corrupt ? '{broken' : JSON.stringify(DEFAULT_WORKSPACE);
    const saved = raw;
    let visible: Workspace = DEFAULT_WORKSPACE;
    let message = '';
    const store = createWorkspaceStore(
      {
        read: () => raw,
        write: () => {
          throw new Error('Quota exceeded');
        },
      },
      (w, error) => {
        visible = w;
        message = error;
      },
    );
    store.load();
    await store.update((w) => ({ ...w, entries: [...w.entries, entry('a')] }));
    await store.update((w) => ({ ...w, entries: [...w.entries, entry('b')] }));
    assert.deepEqual(
      visible.entries.map((e) => e.id),
      ['a', 'b'],
    );
    assert.equal(raw, saved);
    assert.ok(message.includes('session'));
    raw = saved;
  }
});
