import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';

const base = new URL(process.env.OJAS_TEST_URL);
assert.equal(base.hostname, 'localhost', 'Use only the isolated local Worker.');
const client = new URL('../dist/client/', import.meta.url);
const dashboards = (
  await readdir(new URL('_next/static/chunks/', client))
).filter((name) => /^dashboard-.*\.js$/.test(name));
assert.equal(
  dashboards.length,
  1,
  'Build one current dashboard before testing.',
);

async function javascript(url) {
  assert.equal(url.origin, base.origin, 'Worker assets must stay same-origin.');
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, `${url.pathname} must be served.`);
  assert.match(response.headers.get('content-type') || '', /javascript/);
  return response.text();
}

const dashboard = await javascript(
  new URL(`/_next/static/chunks/${dashboards[0]}`, base),
);
const assets = [...dashboard.matchAll(/new Worker\(\s*(["'`])([^"'`]+)\1/g)]
  .map((match) => match[2])
  .filter((url) => url.includes('apple-health.worker-'));
assert.equal(
  assets.length,
  1,
  'The importer must construct its emitted worker directly.',
);
assert.ok(
  assets[0].startsWith('/_next/static/'),
  'Do not resolve workers against a file URL.',
);
const worker = await javascript(new URL(assets[0], base));
const messages = [];
const context = vm.createContext({
  self: { postMessage: (message) => messages.push(message) },
  TextDecoder,
  performance,
});
new vm.Script(worker, { filename: assets[0] }).runInContext(context, {
  timeout: 1000,
});
const fixture = await readFile(
  new URL('fixtures/apple-export.xml', import.meta.url),
);
context.event = {
  data: {
    file: new File([fixture], 'export.xml', { type: 'application/xml' }),
    today: '2026-09-07',
  },
};
let timeout;
try {
  await Promise.race([
    new vm.Script('self.onmessage(event)').runInContext(context, {
      timeout: 1000,
    }),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('The built importer did not finish.')),
        5000,
      );
    }),
  ]);
} finally {
  clearTimeout(timeout);
}
assert.equal(
  messages.some((message) => message.kind === 'error'),
  false,
  JSON.stringify(messages),
);
const result = messages.find((message) => message.kind === 'complete')?.data;
assert.ok(result, 'The fetched worker must return a completed import.');
assert.equal(result.fromDay, '2026-08-09');
assert.equal(result.throughDay, '2026-09-07');
const totals = Object.fromEntries(
  result.sources.map((source) => [
    source.name,
    Object.fromEntries(
      source.entries.map((entry) => [entry.type, entry.amount]),
    ),
  ]),
);
assert.deepEqual(totals, {
  'QA Watch': { activity: 4000, sleep: 8 },
  'QA Phone': { activity: 2500 },
  'QA Food App': { nutrition: 520 },
  'QA Water App': { water: 500 },
});
console.log(
  'Passed: production worker URL, served JavaScript asset, and compiled Apple export parsing.',
);
