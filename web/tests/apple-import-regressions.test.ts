import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAppleHealth, sleepByDay } from '../lib/apple-health.ts';
import {
  selectAppleImport,
  validateAppleImport,
  type AppleImportData,
} from '../lib/apple-import.ts';
import { serverHarness } from './module-harness.mjs';
import fs from 'node:fs';

const day = '2026-09-07';
const record = `<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Watch &amp; phone > old" unit="count" value="1000" startDate="2026-09-07 08:00:00 -0700" endDate="2026-09-07 09:00:00 -0700"><MetadataEntry key="note" value="paired record"/></Record>`;
const xml = (body = record) =>
  `\ufeff<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE HealthData [<!ELEMENT HealthData (ExportDate,Record*)><!ATTLIST HealthData locale CDATA #IMPLIED>]><HealthData locale="en_US"><ExportDate value="2026-09-07 23:00:00 -0700"/>${body}</HealthData>`;
async function* chunks(value: string, size: number) {
  for (let i = 0; i < value.length; i += size) yield value.slice(i, i + size);
}
await test('realistic Apple XML is chunk-independent and ignores comments, CDATA and metadata records', async () => {
  const input = xml(`<!--${record}--><![CDATA[${record}]]>${record}`);
  const expected = await parseAppleHealth(chunks(input, input.length), day);
  for (const size of [1, 2, 7, 37, 127])
    assert.deepEqual(
      await parseAppleHealth(chunks(input, size), day),
      expected,
    );
  assert.equal(expected.sources[0].entries[0].amount, 1000);
  assert.equal(expected.sources[0].name, 'Watch & phone > old');
  assert.equal(expected.fromDay, '2026-08-09');
  assert.equal(expected.throughDay, day);
});
await test('DTD comments cannot change quote or bracket parsing across chunk boundaries', async () => {
  const expected = await parseAppleHealth(chunks(xml(), 37), day);
  for (const comment of [
    "<!-- user's metadata -->",
    '<!-- ]> -->',
    '<!-- <Record value="999"/> -->',
  ])
    for (const size of [1, 7, 91])
      assert.deepEqual(
        await parseAppleHealth(
          chunks(xml().replace('<!ELEMENT', comment + '<!ELEMENT'), size),
          day,
        ),
        expected,
      );
});
await test('malformed structure and recent timestamps cannot become authoritative empty history', async () => {
  for (const invalid of [
    xml() + record,
    xml().replace('</HealthData>', ''),
    xml().replace('</Record>', '</Wrong>'),
    xml(record.replace('unit="count"', 'unit="count" unit="count"')),
    xml(record.replace('08:00:00', '24:00:00')),
    xml(record.replace('08:00:00', '08:61:00')),
    xml(record.replace('2026-09-07 08:00', '2026-02-30 08:00')),
    xml(record.replace('value="1000"', 'value="1e999"')),
    xml(record.replace('unit="count"', 'unit="unknown"')),
    xml(record.replace('value="1000"', 'value=""')),
    xml(record.replace('value="1000"', 'value="0x10"')),
    xml(record.replace('value="1000"', 'value="   "')),
    xml(
      record
        .replace(
          'HKQuantityTypeIdentifierStepCount',
          'HKCategoryTypeIdentifierSleepAnalysis',
        )
        .replace('value="1000"', 'value="garbage"'),
    ),
    xml(record.replace('&amp;', '&AMP;')),
    xml(record.replace('&amp;', '&custom;')),
    'Not XML' + xml(),
    xml() + 'truncated',
    xml(record.replace('value="1000"', `value="${'9'.repeat(17000)}"`)),
  ])
    await assert.rejects(parseAppleHealth(chunks(invalid, 7), day));
});
await test('an older complete export covers only its own snapshot dates and allows explicit empty metrics', async () => {
  const data = await parseAppleHealth(
    chunks(xml().replaceAll('2026-09-07', '2026-09-01'), 37),
    day,
  );
  assert.equal(data.throughDay, '2026-09-01');
  assert.equal(data.fromDay, '2026-08-03');
  const selected = selectAppleImport(data, {
    activity: `device:${data.sources[0].name}`,
    sleep: 'clear',
    water: 'skip',
  });
  assert.deepEqual(selected.metrics, ['activity', 'sleep']);
  assert.equal(selected.entries.length, 1);
  assert.equal(
    'sources' in selected,
    false,
    'Unselected source data must never be uploaded',
  );
  assert.equal(
    validateAppleImport(selected, new Date('2026-09-08T12:00:00Z')).entries
      .length,
    1,
  );
  assert.equal(
    selectAppleImport(data, { activity: 'clear' }).entries.length,
    0,
  );
  assert.throws(() => selectAppleImport(data, { activity: 'device:unknown' }));
});
await test('multi-day long sleep records do not collapse into an impossible single day', () => {
  const times = [5, 6].map((d) => ({
    start: Date.parse(`2026-09-0${d}T01:00:00Z`),
    end: Date.parse(`2026-09-0${d}T23:00:00Z`),
    endDay: `2026-09-0${d}`,
  }));
  assert.deepEqual(
    [...sleepByDay(times)],
    [
      ['2026-09-05', 22],
      ['2026-09-06', 22],
    ],
  );
});
const imported = (
  amount: number,
  type: 'activity' | 'water' = 'activity',
  d = day,
) => ({
  id: `apple-health:${type}:${d}`,
  recordId: `${type}:${d}`,
  source: 'apple-health' as const,
  day: d,
  time: '23:59',
  type,
  amount,
  title: 'Watch',
});
const snapshot = (
  entries: AppleImportData['entries'],
  exportedAt = '2026-09-08T06:00:00.000Z',
): AppleImportData => ({
  entries,
  source: 'Watch',
  exportedAt,
  fromDay: '2026-08-09',
  throughDay: day,
  metrics: ['activity'],
});
await test('Apple replacement is scoped by account, metric, window and snapshot freshness', async () => {
  const h = serverHarness();
  try {
    await h.api.importApple('alice', {
      ...snapshot([imported(1000), imported(500, 'water')]),
      metrics: ['activity', 'water'],
    });
    await h.api.importApple('bob', snapshot([imported(2000)]));
    h.sqlite
      .prepare(
        "INSERT INTO source_entries(user_id,provider,record_id,day,time,type,amount,title) VALUES ('alice','apple-health','activity:2026-07-01','2026-07-01','12:00','activity',999,'Older')",
      )
      .run();
    await h.api.importApple('alice', snapshot([]));
    assert.deepEqual(
      h.sqlite
        .prepare(
          "SELECT day,type,amount FROM source_entries WHERE user_id='alice' ORDER BY day",
        )
        .all()
        .map((row) => ({ ...row })),
      [
        { day: '2026-07-01', type: 'activity', amount: 999 },
        { day, type: 'water', amount: 500 },
      ],
    );
    assert.equal(
      h.sqlite
        .prepare("SELECT amount FROM source_entries WHERE user_id='bob'")
        .get()?.amount,
      2000,
    );
    await assert.rejects(
      h.api.importApple(
        'alice',
        snapshot([imported(3000)], '2026-09-08T05:00:00.000Z'),
      ),
      { status: 409 },
    );
    assert.equal(
      h.sqlite
        .prepare(
          "SELECT count(*) n FROM source_entries WHERE user_id='alice' AND day=? AND type='activity'",
        )
        .get(day)?.n,
      0,
    );
    await h.api.importApple(
      'alice',
      snapshot([imported(4000)], '2026-09-08T07:00:00.000Z'),
    );
    assert.equal(
      h.sqlite
        .prepare(
          "SELECT amount FROM source_entries WHERE user_id='alice' AND day=? AND type='activity'",
        )
        .get(day)?.amount,
      4000,
    );
  } finally {
    h.sqlite.close();
  }
});
await test('Apple freshness is checked again inside the replacement transaction', async () => {
  const h = serverHarness();
  try {
    await h.api.importApple('alice', snapshot([imported(1000)]));
    let raced = false;
    h.hooks.before = async (query: string) => {
      if (!raced && query.startsWith('DELETE FROM source_entries')) {
        raced = true;
        h.sqlite
          .prepare(
            "UPDATE apple_import_snapshots SET exported_at='2026-09-08T08:00:00.000Z'",
          )
          .run();
      }
    };
    await assert.rejects(h.api.importApple('alice', snapshot([])), {
      status: 409,
    });
    assert.equal(
      h.sqlite.prepare('SELECT amount FROM source_entries').get()?.amount,
      1000,
    );
  } finally {
    h.sqlite.close();
  }
});
await test('legacy imports gain a conservative freshness guard and removing history removes it', async () => {
  const h = serverHarness();
  try {
    await h.api.importApple('alice', snapshot([imported(9000)]));
    h.sqlite.prepare('DELETE FROM apple_import_snapshots').run();
    h.sqlite
      .prepare("UPDATE connections SET last_sync='2026-09-08T07:00:00.000Z'")
      .run();
    h.sqlite.exec(
      fs.readFileSync(
        new URL('../drizzle/0004_apple-import-freshness.sql', import.meta.url),
        'utf8',
      ),
    );
    await assert.rejects(
      h.api.importApple('alice', snapshot([imported(1000)])),
      { status: 409 },
    );
    assert.equal(
      h.sqlite.prepare('SELECT amount FROM source_entries').get()?.amount,
      9000,
    );
    await h.api.disconnect('alice', 'apple-health', true);
    assert.equal(
      h.sqlite.prepare('SELECT COUNT(*) n FROM apple_import_snapshots').get()
        ?.n,
      0,
    );
    await h.api.importApple('alice', snapshot([imported(1000)]));
    assert.equal(
      h.sqlite.prepare('SELECT amount FROM source_entries').get()?.amount,
      1000,
    );
  } finally {
    h.sqlite.close();
  }
});
