import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  hashProviderClientId,
  providerBlockedUntil,
  reserveProviderRequest,
  createProviderBudgetRequester,
} from '../server/provider-budget.ts';
import { ApiError } from '../server/errors.ts';
import { exchangeTokens, fetchSourceData } from '../server/providers.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE provider_request_budget (
    provider TEXT NOT NULL, client_id_hash TEXT NOT NULL,
    blocked_until INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(provider, client_id_hash));
    CREATE TABLE provider_request_ledger (
      reservation_id TEXT PRIMARY KEY, provider TEXT NOT NULL,
      client_id_hash TEXT NOT NULL, reserved_at INTEGER NOT NULL);
    CREATE INDEX idx_provider_request_ledger_key_time
      ON provider_request_ledger(provider, client_id_hash, reserved_at);`);
  const db = {
    prepare(query: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          args = values;
          return statement;
        },
        async run() {
          const result = sqlite.prepare(query).run(...(args as never[]));
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } as never;
  return { db, sqlite };
}

await test('provider client identities are hashed before persistence', async () => {
  const digest = await hashProviderClientId('private-app-client');
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(digest.includes('private-app-client'), false);
});

await test('rolling reservations enforce the cap at the exact boundary', async () => {
  const { db, sqlite } = database();
  try {
    const now = 1_700_000_000_000;
    const limits = { perMinute: 2, perDay: 3 };
    await reserveProviderRequest(db, 'whoop', 'client', now, limits);
    await reserveProviderRequest(db, 'whoop', 'client', now + 1, limits);
    await assert.rejects(
      reserveProviderRequest(db, 'whoop', 'client', now + 59_999, limits),
      (error: unknown) => error instanceof ApiError && error.status === 429,
    );
    await reserveProviderRequest(db, 'whoop', 'client', now + 60_000, limits);
  } finally {
    sqlite.close();
  }
});

await test('provider reset headers use WHOOP relative and Oura epoch semantics', () => {
  const now = 1_700_000_000_000;
  assert.equal(
    providerBlockedUntil(
      'whoop',
      new Response(null, {
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '7' },
      }),
      now,
    ),
    now + 7_000,
  );
  assert.equal(
    providerBlockedUntil(
      'oura',
      new Response(null, {
        status: 429,
        headers: {
          'Retry-After': '20',
          'X-RateLimit-Reset': String((now + 12_000) / 1000),
        },
      }),
      now,
    ),
    now + 20_000,
  );
});

await test('the budget requester injects every provider page and OAuth exchange', async () => {
  const { db, sqlite } = database();
  const paths: string[] = [];
  const requester = createProviderBudgetRequester(db, async (input) => {
    paths.push(
      new URL(input instanceof Request ? input.url : input.toString()).pathname,
    );
    return Response.json({
      data: [],
      next_token: null,
      access_token: 'access',
      expires_in: 3600,
    });
  });
  try {
    await fetchSourceData('oura', 'token', { clientId: 'client', requester });
    await exchangeTokens(
      'oura',
      { clientId: 'client', secret: 'secret' },
      { grant_type: 'refresh_token', refresh_token: 'refresh' },
      'refresh',
      requester,
    );
    assert.equal(paths.length, 5);
    assert.ok(paths.some((path) => path.endsWith('/oauth/token')));
  } finally {
    sqlite.close();
  }
});
