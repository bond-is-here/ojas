// Local compiled Worker only, using isolated D1 persistence and synthetic users.
import assert from 'node:assert/strict';
const base = process.env.OJAS_TEST_URL || 'http://localhost:3002';
assert.equal(new URL(base).hostname, 'localhost');
const userA = `training-a-${crypto.randomUUID()}`,
  userB = `training-b-${crypto.randomUUID()}`,
  userC = `training-c-${crypto.randomUUID()}`;
const day = new Date().toISOString().slice(0, 10);
async function call(body, user = userA, origin = base) {
  return fetch(`${base}/api/training?day=${day}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      ...(user ? { 'oai-authenticated-user-id': user } : {}),
      ...(body ? { 'Content-Type': 'application/json', Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function workout() {
  return {
    id: crypto.randomUUID(),
    day,
    name: 'Synthetic strength session',
    kind: 'strength',
    status: 'active',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    runningSince: new Date().toISOString(),
    elapsedSeconds: 0,
    targetMinutes: 30,
    note: '',
    version: 0,
    exercises: [
      {
        id: crypto.randomUUID(),
        name: 'Squat',
        sets: [{ id: crypto.randomUUID(), reps: 10, weight: 0, done: false }],
      },
    ],
  };
}
assert.equal((await call(undefined, '')).status, 401);
const initial = await (await call()).json();
assert.equal(initial.sessions.length, 0);
const preferences = {
  ...initial.preferences,
  goal: 'strength',
  autoSync: false,
};
assert.equal(
  (
    await call(
      { action: 'plan', preferences },
      userA,
      'https://untrusted.example',
    )
  ).status,
  403,
);
assert.equal((await call({ action: 'plan', preferences })).status, 200);
assert.equal((await (await call()).json()).preferences.autoSync, false);
assert.equal(
  (await (await call(undefined, userB)).json()).preferences.autoSync,
  true,
);
const first = workout();
let response = await call({ action: 'workout', workout: first });
assert.equal(response.status, 200);
let saved = (await response.json()).workout;
assert.equal(saved.version, 1);
response = await call({ action: 'workout', workout: first });
assert.equal(
  response.status,
  200,
  'Retrying a lost start response is idempotent',
);
assert.equal((await response.json()).workout.id, first.id);
assert.equal(
  (await call({ action: 'workout', workout: workout() })).status,
  409,
  'A second active session must not be created',
);
assert.equal((await (await call()).json()).sessions.length, 1);
assert.equal((await (await call(undefined, userB)).json()).sessions.length, 0);
const edited = {
  ...saved,
  exercises: saved.exercises.map((e) => ({
    ...e,
    sets: e.sets.map((s) => ({ ...s, reps: 8, weight: 12.5, done: true })),
  })),
};
response = await call({ action: 'workout', workout: edited });
assert.equal(response.status, 200);
saved = (await response.json()).workout;
assert.equal(saved.version, 2);
assert.equal(
  (await call({ action: 'workout', workout: edited })).status,
  409,
  'Stale writes must not overwrite newer set logs',
);
assert.equal(
  (await call({ action: 'workout', workout: saved }, userB)).status,
  409,
  'Other users cannot update this session',
);
const kept = (await (await call()).json()).sessions[0];
assert.equal(kept.exercises[0].sets[0].weight, 12.5);
assert.equal(
  (await call({ action: 'workout', workout: { ...saved, elapsedSeconds: -1 } }))
    .status,
  400,
);
response = await call({
  action: 'workout',
  workout: {
    ...saved,
    status: 'completed',
    elapsedSeconds: 1800,
    runningSince: null,
    finishedAt: new Date().toISOString(),
  },
});
assert.equal(response.status, 200);
const done = (await response.json()).workout;
assert.equal(done.status, 'completed');
assert.equal(done.exercises[0].sets[0].done, true);
const concurrent = await Promise.all([
  call({ action: 'workout', workout: workout() }, userC),
  call({ action: 'workout', workout: workout() }, userC),
]);
assert.deepEqual(
  concurrent.map((r) => r.status).sort((a, b) => a - b),
  [200, 409],
);
assert.equal((await (await call(undefined, userC)).json()).sessions.length, 1);
console.log(
  'Passed: training authentication, origin enforcement, private preferences and sessions, idempotent starts, concurrent starts, version conflicts, set persistence, validation, and completion.',
);
