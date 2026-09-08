import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WORKSPACE, totals, formatAmount } from '../lib/health.ts';
import {
  DEFAULT_SOURCE_PREFERENCES,
  mergeSourceEntries,
  whoopSleep,
  ouraEntries,
  validateImportedEntries,
  type SyncedEntry,
} from '../lib/connections.ts';
import { parseAppleHealth } from '../lib/apple-health.ts';
import { exchangeTokens, fetchSourceData } from '../server/providers.ts';
const day = '2026-09-05';
const source = (
  provider: SyncedEntry['source'],
  amount: number,
): SyncedEntry => ({
  id: `${provider}:activity:${day}`,
  source: provider,
  recordId: `activity:${day}`,
  day,
  time: '23:59',
  type: 'activity',
  amount,
  title: 'Daily steps',
});
await test('one preferred source replaces overlapping totals, while keeping the manual log', () => {
  const personal = {
    ...DEFAULT_WORKSPACE,
    demo: false,
    entries: [
      {
        id: 'manual',
        day,
        time: '12:00',
        type: 'activity' as const,
        amount: 2000,
        title: 'Walk',
      },
    ],
  };
  const sources = [source('apple-health', 8000), source('oura', 7900)];
  const merged = mergeSourceEntries(
    personal,
    sources,
    DEFAULT_SOURCE_PREFERENCES,
  );
  assert.equal(totals(merged.entries).activity, 8000);
  assert.equal(merged.entries.length, 2);
  assert.equal(personal.entries[0].amount, 2000);
  assert.equal(
    totals(
      mergeSourceEntries(personal, sources, {
        ...DEFAULT_SOURCE_PREFERENCES,
        activity: 'oura',
      }).entries,
    ).activity,
    7900,
  );
  assert.equal(
    totals(
      mergeSourceEntries(personal, sources, {
        ...DEFAULT_SOURCE_PREFERENCES,
        activity: 'manual',
      }).entries,
    ).activity,
    2000,
  );
  assert.equal(
    totals(
      mergeSourceEntries(
        personal,
        [source('oura', 7900)],
        DEFAULT_SOURCE_PREFERENCES,
      ).entries,
    ).activity,
    7900,
  );
});
await test('WHOOP sleep uses actual asleep stages and the recorded local wake-up date', () => {
  const entries = whoopSleep([
    {
      id: 'sleep-1',
      end: '2026-09-06T03:00:00Z',
      timezone_offset: '-07:00',
      score_state: 'SCORED',
      nap: false,
      score: {
        stage_summary: {
          total_in_bed_time_milli: 36000000,
          total_awake_time_milli: 3600000,
          total_light_sleep_time_milli: 18000000,
          total_slow_wave_sleep_time_milli: 3600000,
          total_rem_sleep_time_milli: 5400000,
        },
      },
    },
    { id: 'pending', score_state: 'PENDING_SCORE' },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].day, day);
  assert.equal(entries[0].time, '20:00');
  assert.equal(entries[0].amount, 7.5);
  assert.equal(entries[0].type, 'sleep');
});
await test('Oura burned calories are never confused with food intake', () => {
  const entries = ouraEntries(
    [
      {
        id: 'activity-1',
        day,
        steps: 8000,
        active_calories: 500,
        total_calories: 2400,
      },
    ],
    [
      {
        id: 'sleep-1',
        day,
        bedtime_end: '2026-09-05T07:31:00-07:00',
        total_sleep_duration: 27000,
      },
    ],
  );
  assert.equal(entries.length, 2);
  assert.equal(totals(entries).nutrition, 0);
  assert.equal(totals(entries).activity, 8000);
  assert.equal(totals(entries).sleep, 7.5);
  assert.equal(formatAmount('sleep', 7.999), '8h');
});
const xml = `<?xml version="1.0"?><HealthData locale="en_US"><ExportDate value="2026-09-05 23:59:00 -0700"/>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" value="1000" startDate="2026-09-05 08:00:00 -0700" endDate="2026-09-05 09:00:00 -0700"/>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="Apple Watch" unit="count" value="1000" startDate="2026-09-05 08:00:00 -0700" endDate="2026-09-05 09:00:00 -0700"/>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" value="900" startDate="2026-09-05 08:00:00 -0700" endDate="2026-09-05 09:00:00 -0700"/>
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisInBed" startDate="2026-09-04 22:00:00 -0700" endDate="2026-09-05 08:00:00 -0700"/>
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepCore" startDate="2026-09-04 23:00:00 -0700" endDate="2026-09-05 04:00:00 -0700"/>
<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Apple Watch" value="HKCategoryValueSleepAnalysisAsleepUnspecified" startDate="2026-09-04 23:00:00 -0700" endDate="2026-09-05 07:00:00 -0700"/>
<Record type="HKQuantityTypeIdentifierDietaryWater" sourceName="Apple Watch" unit="L" value="0.5" startDate="2026-09-05 09:00:00 -0700" endDate="2026-09-05 09:00:00 -0700"/>
<Record type="HKQuantityTypeIdentifierDietaryEnergyConsumed" sourceName="Apple Watch" unit="kJ" value="418.4" startDate="2026-09-05 09:00:00 -0700" endDate="2026-09-05 09:00:00 -0700"/>
</HealthData>`;
async function* chunks(value: string, size = 37) {
  for (let i = 0; i < value.length; i += size) yield value.slice(i, i + size);
}
await test('Apple XML streams across tag boundaries, keeps devices separate, converts units, and merges duplicate sleep stages', async () => {
  const parsed = await parseAppleHealth(chunks(xml), day);
  const sources = parsed.sources;
  assert.equal(sources.length, 2);
  const watch = sources.find((s) => s.name === 'Apple Watch')!;
  assert.deepEqual(totals(watch.entries), {
    activity: 1000,
    nutrition: 100,
    water: 500,
    sleep: 8,
  });
  assert.equal(watch.entries.find((e) => e.type === 'sleep')?.day, day);
  assert.equal(
    sources.find((s) => s.name === 'iPhone')?.entries[0].amount,
    900,
  );
  assert.deepEqual(validateImportedEntries(watch.entries), watch.entries);
  const again = await parseAppleHealth(chunks(xml, 91), day);
  assert.deepEqual(again, parsed);
  await assert.rejects(
    parseAppleHealth(chunks(xml.replace('</HealthData>', '')), day),
    /incomplete/,
  );
  await assert.rejects(
    parseAppleHealth(chunks('<html>Not an export</html>'), day),
    /export.xml/,
  );
});
await test('malformed or duplicate import identities are rejected', () => {
  assert.throws(() =>
    validateImportedEntries([
      { ...source('apple-health', 8000), recordId: 'wrong' },
    ]),
  );
  assert.throws(() =>
    validateImportedEntries([
      source('apple-health', 8000),
      source('apple-health', 9000),
    ]),
  );
  assert.throws(() =>
    validateImportedEntries([{ ...source('apple-health', 8000), amount: -1 }]),
  );
});
await test('OAuth credentials go only to fixed token endpoints and rotated refresh tokens are retained', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(
        input instanceof Request ? input.url : input.toString(),
        'https://api.prod.whoop.com/oauth/oauth2/token',
      );
      const body = init?.body as URLSearchParams;
      assert.equal(body.get('client_secret'), 'test-secret');
      assert.equal(body.get('refresh_token'), 'old-refresh');
      assert.equal(init?.redirect, 'error');
      return Response.json({
        access_token: 'access',
        refresh_token: 'rotated-refresh',
        expires_in: 3600,
      });
    };
    const tokens = await exchangeTokens(
      'whoop',
      { clientId: 'client', secret: 'test-secret' },
      {
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh',
        scope: 'offline',
      },
    );
    assert.equal(tokens.refreshToken, 'rotated-refresh');
    assert.equal(tokens.accessToken, 'access');
    assert.ok(tokens.expiresAt > Date.now() + 3500000);
  } finally {
    globalThis.fetch = original;
  }
});
await test('temporary OAuth token outages remain retryable without revoking the connection', async () => {
  const original = globalThis.fetch;
  try {
    for (const [responseStatus, expectedStatus] of [
      [503, 502],
      [429, 429],
      [400, 409],
    ]) {
      globalThis.fetch = async () =>
        Response.json(
          { error: 'synthetic_failure' },
          { status: responseStatus },
        );
      await assert.rejects(
        exchangeTokens(
          'whoop',
          { clientId: 'client', secret: 'secret' },
          { grant_type: 'refresh_token', refresh_token: 'refresh' },
        ),
        { status: expectedStatus },
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});
await test('WHOOP pagination is followed before a sync can be reported complete', async () => {
  const original = globalThis.fetch;
  let sleepPages = 0;
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      assert.equal(url.hostname, 'api.prod.whoop.com');
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer test-token',
      );
      if (url.pathname.endsWith('/activity/sleep')) {
        sleepPages++;
        if (sleepPages === 1)
          return Response.json({ records: [], next_token: 'page-two' });
        assert.equal(url.searchParams.get('nextToken'), 'page-two');
      }
      return Response.json({ records: [], next_token: null });
    };
    const result = await fetchSourceData('whoop', 'test-token');
    assert.equal(sleepPages, 2);
    assert.deepEqual(result.entries, []);
  } finally {
    globalThis.fetch = original;
  }
});
