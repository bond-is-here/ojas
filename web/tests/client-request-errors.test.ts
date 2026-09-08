import test from 'node:test';
import assert from 'node:assert/strict';
import * as requests from '../lib/client-request.ts';
import * as connections from '../lib/connections.ts';
import * as training from '../lib/training.ts';
import * as health from '../lib/health.ts';
import * as queueModel from '../lib/workout-save-queue.ts';
import * as workspaceClient from '../lib/account-workspace.ts';
import { emptyWorkspace, type WorkspaceMutation } from '../lib/workspace.ts';
import { hookHarness, loadModule } from './module-harness.mjs';

const day = '2026-09-07';
const accountId = 'request-error-alice';
const html = (status: number) =>
  new Response('<html>private upstream failure</html>', {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
async function withFetch(replacement: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = replacement;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}
function connectionAPI() {
  return loadModule('hooks/use-connections.ts', {
    react: hookHarness().react,
    '@/lib/connections': connections,
    '@/lib/client-request': requests,
  })
    .connectionRequest as typeof import('../hooks/use-connections').connectionRequest;
}
function trainingAPI() {
  const { useTraining: createController } = loadModule(
    'hooks/use-training.ts',
    {
      react: hookHarness().react,
      '@/lib/training': training,
      '@/lib/workout-save-queue': queueModel,
      '@/lib/client-request': requests,
    },
  );
  return createController(day, accountId) as ReturnType<
    typeof import('../hooks/use-training').useTraining
  >;
}
const freshWorkout = () => ({
  ...training.startWorkout(
    training.DEFAULT_PLAN,
    training.suggestWorkout(training.DEFAULT_PLAN, [], [], day),
    new Date('2026-09-07T12:00:00Z'),
  ),
  version: 3,
});

await test('connection requests distinguish gateway outages from authentication failures', async () => {
  const request = connectionAPI();
  for (const status of [503, 401]) {
    await withFetch(
      async (_input, init) => {
        assert.equal(
          new Headers(init?.headers).get('X-Ojas-Account'),
          accountId,
        );
        return html(status);
      },
      async () => {
        await assert.rejects(
          request('', undefined, accountId),
          (error: unknown) => {
            assert.ok(error instanceof requests.ClientRequestError);
            assert.equal(error.status, status);
            assert.match(
              error.message,
              status === 401 ? /Sign in/ : /temporarily unavailable/,
            );
            if (status === 503) assert.doesNotMatch(error.message, /sign in/i);
            assert.doesNotMatch(error.message, /html|private upstream/i);
            return true;
          },
        );
      },
    );
  }
});

await test('unreadable successful responses are controlled errors instead of acknowledgments', async () => {
  const request = connectionAPI();
  for (const body of [
    '{}',
    '{"connections":[],"entries":[null],"preferences":{}}',
    '<html>login or proxy page</html>',
    'null',
    '[]',
    '"unexpected"',
  ]) {
    await withFetch(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      async () => {
        await assert.rejects(
          request('', undefined, accountId),
          (error: unknown) => {
            assert.ok(error instanceof requests.ClientRequestError);
            assert.equal(error.status, 200);
            assert.match(error.message, /unreadable response/);
            assert.doesNotMatch(
              error.message,
              /SyntaxError|Unexpected token|html|proxy page/,
            );
            return true;
          },
        );
      },
    );
  }
});

await test('safe validation messages retain their status; HTML and stack details do not reach the UI', async () => {
  const request = connectionAPI();
  for (const status of [409, 422]) {
    await withFetch(
      async () =>
        Response.json(
          {
            error: 'Check your workout details.',
          },
          { status },
        ),
      async () => {
        await assert.rejects(request('/preferences', {}, accountId), {
          status,
          message: 'Check your workout details.',
        });
      },
    );
  }
  for (const error of [
    '<html>private error</html>',
    'TypeError: secret at handler (/private/server.js:17:2)',
    'SQLITE_ERROR: private database detail',
    'First line\n    at handler (/private/server.js:17:2)',
  ]) {
    await withFetch(
      async () => Response.json({ error }, { status: 400 }),
      async () => {
        await assert.rejects(
          request('/preferences', {}, accountId),
          (failure: unknown) => {
            assert.ok(failure instanceof requests.ClientRequestError);
            assert.equal(failure.status, 400);
            assert.doesNotMatch(
              failure.message,
              /html|private|TypeError|SQLITE|handler/,
            );
            assert.notEqual(failure.message, error);
            return true;
          },
        );
      },
    );
  }
  await withFetch(
    async () =>
      Response.json({ error: 'Internal private detail' }, { status: 503 }),
    async () => {
      await assert.rejects(request('', undefined, accountId), {
        status: 503,
        message: 'Ojas is temporarily unavailable. Try again shortly.',
      });
    },
  );
});

await test('training retries preserve the exact request after a 503 or an unreadable 200 acknowledgment', async () => {
  for (const firstResponse of [() => html(503), () => html(200)]) {
    const initial = freshWorkout();
    let server = structuredClone(initial);
    const attempts: training.Workout[] = [];
    await withFetch(
      async (_input, init) => {
        assert.equal(
          new Headers(init?.headers).get('X-Ojas-Account'),
          accountId,
        );
        if (init?.method !== 'POST')
          return Response.json({
            preferences: training.DEFAULT_PLAN,
            sessions: [server],
            imported: [],
          });
        assert.ok(typeof init.body === 'string');
        const { workout } = JSON.parse(init.body) as {
          workout: training.Workout;
        };
        attempts.push(workout);
        if (workout.version === server.version)
          server = { ...workout, version: workout.version + 1 };
        else
          assert.deepEqual(
            { ...workout, version: workout.version + 1 },
            server,
          );
        return attempts.length === 1
          ? firstResponse()
          : Response.json({ workout: server });
      },
      async () => {
        const controller = trainingAPI();
        const queue = new queueModel.WorkoutSaveQueue(initial.version);
        queue.enqueue({ ...initial, note: 'First edit' });
        await assert.rejects(queue.flush(controller.save), (error: unknown) => {
          assert.ok(error instanceof queueModel.WorkoutSaveError);
          assert.ok([200, 503].includes(error.status));
          return true;
        });
        assert.equal(queue.snapshot().rejected, false);
        assert.equal(queue.hasPending, true);
        queue.enqueue({ ...initial, note: 'Newer edit' });
        assert.equal(queue.snapshot().retry?.note, 'First edit');
        assert.equal(queue.snapshot().pending?.note, 'Newer edit');
        await queue.flush(controller.save);
        assert.deepEqual(attempts[1], attempts[0]);
        assert.deepEqual(
          attempts.map(({ note, version }) => [note, version]),
          [
            ['First edit', 3],
            ['First edit', 3],
            ['Newer edit', 4],
          ],
        );
        assert.equal(server.version, 5);
        assert.equal(server.note, 'Newer edit');
        assert.equal(queue.hasPending, false);
      },
    );
  }
});

await test('training 400 and 422 errors allow a corrected draft without advancing its version', async () => {
  for (const status of [400, 422]) {
    const initial = freshWorkout();
    const attempts: training.Workout[] = [];
    await withFetch(
      async (_input, init) => {
        if (init?.method !== 'POST')
          return Response.json({
            preferences: training.DEFAULT_PLAN,
            sessions: [],
            imported: [],
          });
        assert.ok(typeof init.body === 'string');
        const { workout } = JSON.parse(init.body) as {
          workout: training.Workout;
        };
        attempts.push(workout);
        return attempts.length === 1
          ? Response.json(
              { error: 'Choose a whole number of reps.' },
              { status },
            )
          : Response.json({
              workout: { ...workout, version: workout.version + 1 },
            });
      },
      async () => {
        const controller = trainingAPI();
        const queue = new queueModel.WorkoutSaveQueue(initial.version);
        queue.enqueue({ ...initial, note: 'Rejected edit' });
        await assert.rejects(queue.flush(controller.save), (error: unknown) => {
          assert.ok(error instanceof queueModel.WorkoutSaveError);
          assert.equal(error.status, status);
          assert.equal(error.message, 'Choose a whole number of reps.');
          return true;
        });
        assert.equal(queue.snapshot().rejected, true);
        queue.enqueue({ ...initial, note: 'Corrected edit' });
        await queue.flush(controller.save);
        assert.deepEqual(
          attempts.map(({ note, version }) => [note, version]),
          [
            ['Rejected edit', 3],
            ['Corrected edit', 3],
          ],
        );
        assert.equal(queue.hasPending, false);
      },
    );
  }
});

await test('the actual workspace request keeps its pending mutation after an invalid 200 until retry succeeds', async () => {
  const pending = new Map<string, string>();
  const attempts: WorkspaceMutation[] = [];
  let saved = emptyWorkspace();
  const { react, states } = hookHarness();
  const { useAccountWorkspace } = loadModule('hooks/use-account-workspace.ts', {
    react: {
      ...react,
      useState: (initial: unknown) =>
        react.useState(typeof initial === 'function' ? initial() : initial),
    },
    '@/lib/account-workspace': {
      ...workspaceClient,
      createAccountWorkspace: (
        id: string,
        dependencies: Parameters<
          typeof workspaceClient.createAccountWorkspace
        >[1],
        notify: Parameters<typeof workspaceClient.createAccountWorkspace>[2],
      ) =>
        workspaceClient.createAccountWorkspace(
          id,
          {
            ...dependencies,
            readPending: () => [...pending.values()],
            writePending: (key, value) =>
              value === null
                ? void pending.delete(key)
                : void pending.set(key, value),
            lock: async (run) => run(),
          },
          notify,
        ),
    },
    '@/lib/health': health,
    '@/lib/client-request': requests,
  });
  await withFetch(
    async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('X-Ojas-Account'), accountId);
      if (init?.method !== 'POST')
        return Response.json({ accountId, workspace: saved });
      assert.ok(typeof init.body === 'string');
      const mutation = JSON.parse(init.body) as WorkspaceMutation;
      attempts.push(mutation);
      assert.equal(mutation.action.type, 'add');
      if (mutation.action.type === 'add')
        saved = { ...saved, entries: [mutation.action.entry] };
      return attempts.length === 1 ? html(200) : Response.json({ saved: true });
    },
    async () => {
      const controller = useAccountWorkspace(accountId, day);
      await controller.refresh();
      await assert.rejects(
        controller.mutate({
          type: 'add',
          entry: {
            id: 'water-entry',
            day,
            time: '12:00',
            type: 'water',
            amount: 250,
            title: 'Water',
          },
        }),
        /unreadable response/,
      );
      assert.equal(pending.size, 1);
      assert.equal(states[0].pending, true);
      assert.match(states[0].error, /unreadable response/);
      const retained = [...pending.values()][0];
      assert.deepEqual(JSON.parse(retained), attempts[0]);
      await controller.retry();
      assert.deepEqual(attempts[1], attempts[0]);
      assert.equal(pending.size, 0);
      assert.equal(states[0].pending, false);
      assert.equal(states[0].workspace.entries.length, 1);
      assert.equal(states[0].workspace.entries[0].id, 'water-entry');
    },
  );
});

await test('exports distinguish outages, sign-in, and invalid successful HTML from actual NDJSON', async () => {
  for (const status of [503, 401, 200]) {
    await withFetch(
      async () => html(status),
      async () => {
        await assert.rejects(
          requests.requestExport(accountId),
          (error: unknown) => {
            assert.ok(error instanceof requests.ClientRequestError);
            assert.equal(error.status, status);
            assert.match(
              error.message,
              status === 401
                ? /Sign in/
                : status === 503
                  ? /temporarily unavailable/
                  : /unreadable response/,
            );
            assert.doesNotMatch(error.message, /html|private upstream/i);
            return true;
          },
        );
      },
    );
  }
  const body = '{"kind":"ojas_export","accountId":"request-error-alice"}\n';
  await withFetch(
    async (input, init) => {
      assert.equal(input, '/api/export');
      assert.equal(new Headers(init?.headers).get('X-Ojas-Account'), accountId);
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response(body, {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      });
    },
    async () => {
      assert.equal(
        await (await requests.requestExport(accountId)).text(),
        body,
      );
    },
  );
});

await test('the export deadline cancels unfinished body consumption with a controlled timeout error', async () => {
  const originalTimeout = Object.getOwnPropertyDescriptor(
    AbortSignal,
    'timeout',
  )!;
  const abort = new AbortController();
  let timeoutMs = 0;
  Object.defineProperty(AbortSignal, 'timeout', {
    ...originalTimeout,
    value: (milliseconds: number) => {
      timeoutMs = milliseconds;
      return abort.signal;
    },
  });
  try {
    await withFetch(
      async (_input, init) => {
        assert.equal(init?.signal, abort.signal);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            abort.signal.addEventListener(
              'abort',
              () => controller.error(abort.signal.reason),
              { once: true },
            );
          },
        });
        queueMicrotask(() =>
          abort.abort(
            new DOMException('private transport details', 'TimeoutError'),
          ),
        );
        return new Response(stream, {
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      },
      async () => {
        await assert.rejects(
          requests.requestExport(accountId),
          (error: unknown) => {
            assert.ok(error instanceof requests.ClientRequestError);
            assert.equal(error.status, 0);
            assert.match(error.message, /too long/);
            assert.doesNotMatch(error.message, /private transport/);
            return true;
          },
        );
        assert.ok(
          Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000,
        );
        assert.equal(abort.signal.aborted, true);
      },
    );
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', originalTimeout);
  }
});

await test('unexpected network exceptions are replaced with a useful connection error', async () => {
  await withFetch(
    async () => {
      throw new Error('private stack or proxy details');
    },
    async () => {
      await assert.rejects(
        requests.requestJSON('/api/workspace'),
        (error: unknown) => {
          assert.ok(error instanceof requests.ClientRequestError);
          assert.equal(error.status, 0);
          assert.match(error.message, /Check your connection/);
          assert.doesNotMatch(error.message, /private|stack|proxy/);
          return true;
        },
      );
    },
  );
});
