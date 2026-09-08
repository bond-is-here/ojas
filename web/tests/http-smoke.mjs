// Exercises only the local Worker with isolated synthetic users. No provider API calls.
import assert from 'node:assert/strict';
const base = process.env.OJAS_TEST_URL || 'http://localhost:3001';
assert.equal(
  new URL(base).hostname,
  'localhost',
  'Smoke tests must only run against a local isolated Worker.',
);
const userA = `ojas-test-a-${crypto.randomUUID()}`,
  userB = `ojas-test-b-${crypto.randomUUID()}`;
async function call(path, { user = userA, body, origin = base } = {}) {
  const response = await fetch(base + '/api/connections' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(user ? { 'oai-authenticated-user-id': user } : {}),
      ...(body !== undefined
        ? { 'content-type': 'application/json', Origin: origin }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (response.status >= 500) {
    const detail = await response
      .clone()
      .text()
      .catch(() => '<response body unavailable>');
    console.error(
      `[HTTP smoke] ${body === undefined ? 'GET' : 'POST'} /api/connections${path} returned ${response.status} (${response.headers.get('content-type') || 'unknown content type'}): ${detail.slice(0, 4000)}`,
    );
  }
  return response;
}
try {
  assert.equal((await call('', { user: '' })).status, 401);
  assert.equal(
    (
      await call('/preferences', {
        body: {},
        origin: 'https://untrusted.example',
      })
    ).status,
    403,
  );
  const invalidImport = await call('/apple-health/import', {
    body: { entries: [] },
  });
  assert.equal(invalidImport.status, 400, await invalidImport.text());
  const day = new Date().toISOString().slice(0, 10);
  const exportedAt = new Date().toISOString();
  const fromDay = new Date(Date.parse(`${day}T12:00:00Z`) - 29 * 86400000)
    .toISOString()
    .slice(0, 10);
  const record = {
    recordId: `activity:${day}`,
    day,
    time: '23:59',
    type: 'activity',
    amount: 2345,
    title: 'Synthetic test steps',
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await call('/apple-health/import', {
          body: {
            source: 'Test watch',
            entries: [record],
            fromDay,
            throughDay: day,
            exportedAt,
            metrics: ['activity'],
          },
        })
      ).status,
      200,
    );
  const a = await (await call('')).json();
  assert.equal(a.entries.length, 1);
  assert.equal(a.entries[0].amount, 2345);
  assert.equal(
    a.connections.find((c) => c.provider === 'apple-health').count,
    1,
  );
  const b = await (await call('', { user: userB })).json();
  assert.equal(b.entries.length, 0);
  const preferences = {
    activity: 'manual',
    nutrition: 'auto',
    sleep: 'auto',
    water: 'auto',
  };
  assert.equal((await call('/preferences', { body: preferences })).status, 200);
  assert.equal((await (await call('')).json()).preferences.activity, 'manual');
  assert.equal(
    (await (await call('', { user: userB })).json()).preferences.activity,
    'auto',
  );
  assert.equal(
    (
      await call('/whoop/setup', {
        body: {
          clientId: 'synthetic-client',
          clientSecret: 'synthetic-secret-not-a-real-credential',
        },
      })
    ).status,
    200,
  );
  const ready = await (await call('')).json();
  const serialized = JSON.stringify(ready);
  assert.equal(serialized.includes('synthetic-secret'), false);
  assert.equal(serialized.includes('token_cipher'), false);
  assert.equal(
    ready.connections.find((c) => c.provider === 'whoop').status,
    'configured',
  );
  assert.equal(
    (await call('/whoop/authorize?account=another-account')).status,
    409,
  );
  const authorize = await call(`/whoop/authorize?account=${userA}`);
  assert.equal(authorize.status, 302);
  const url = new URL(authorize.headers.get('location'));
  assert.equal(url.origin, 'https://api.prod.whoop.com');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    base + '/api/connections/whoop/callback',
  );
  assert.ok(url.searchParams.get('state').length >= 64);
  assert.match(authorize.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  const invalid = await call('/whoop/callback?code=not-real&state=wrong');
  assert.equal(invalid.status, 303);
  assert.equal(
    new URL(invalid.headers.get('location')).searchParams.get('connection'),
    'failed',
  );
  assert.equal(
    (await (await call('')).json()).connections.find(
      (c) => c.provider === 'whoop',
    ).status,
    'configured',
  );
  await call('/apple-health/disconnect', { body: { removeData: false } });
  assert.equal((await (await call('')).json()).entries.length, 1);
  await call('/apple-health/disconnect', { body: { removeData: true } });
  assert.equal((await (await call('')).json()).entries.length, 0);
  console.log(
    'Passed: authentication, origin checks, validation, idempotent import, account isolation, preferences, secret redaction, OAuth state/cookie binding, and disconnect behavior.',
  );
} finally {
  await call('/apple-health/disconnect', { body: { removeData: true } });
  await call('/whoop/disconnect', { body: { removeData: true } });
}
