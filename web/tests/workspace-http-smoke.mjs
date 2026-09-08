import assert from 'node:assert/strict';
const base = process.env.OJAS_TEST_URL;
assert.equal(new URL(base).hostname, 'localhost');
const user = `workspace-qa-${crypto.randomUUID()}`,
  other = `workspace-qa-${crypto.randomUUID()}`;
const day = new Date().toISOString().slice(0, 10);
async function call(
  path = '/api/workspace',
  body,
  actual = user,
  expected = user,
) {
  return fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'oai-authenticated-user-id': actual,
      'X-Ojas-Account': expected,
      ...(body ? { 'Content-Type': 'application/json', Origin: base } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
assert.equal((await call('/api/workspace', undefined, other)).status, 409);
const record = {
  id: crypto.randomUUID(),
  day,
  time: '12:00',
  type: 'water',
  amount: 250,
  title: 'Synthetic water',
};
const mutation = {
  id: crypto.randomUUID(),
  action: { type: 'add', entry: record },
};
assert.equal((await call('/api/workspace', mutation)).status, 200);
assert.equal((await call('/api/workspace', mutation)).status, 200);
let result = await (await call(`/api/workspace?day=${day}`)).json();
assert.equal(result.accountId, user);
assert.equal(result.workspace.demo, false);
assert.deepEqual(result.workspace.entries, [record]);
assert.equal(
  (await (await call('/api/workspace', undefined, other, other)).json())
    .workspace.entries.length,
  0,
);
assert.equal(
  (
    await call('/api/workspace', {
      id: crypto.randomUUID(),
      action: { type: 'remove', id: record.id },
    })
  ).status,
  200,
);
assert.equal((await call('/api/workspace', mutation)).status, 200);
result = await (await call()).json();
assert.equal(result.workspace.entries.length, 0);
assert.equal((await call('/api/export', undefined, other)).status, 409);
const response = await call('/api/export');
assert.equal(response.status, 200);
assert.equal(response.headers.get('Cache-Control'), 'no-store');
const exported = (await response.text())
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.equal(exported[0].accountId, user);
assert.equal(
  exported.some((line) => line.kind === 'workspace_preferences'),
  true,
);
console.log(
  'Passed: compiled workspace saves, retry receipts, account switches, private records, removal and export.',
);
