import type { OAuthProvider } from '../lib/connections.ts';
import { ApiError } from './errors.ts';
import type { ProviderRequester } from './providers.ts';

export type ProviderBudgetLimits = { perMinute: number; perDay: number };
export const PROVIDER_BUDGETS: Record<OAuthProvider, ProviderBudgetLimits> = {
  whoop: { perMinute: 90, perDay: 9000 },
  oura: { perMinute: 300, perDay: 20000 },
};
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
export type ProviderBudgetDatabase = Pick<D1Database, 'prepare' | 'batch'>;
export type ProviderReservation = {
  provider: OAuthProvider;
  clientIdHash: string;
  reservationId: string;
  reservedAt: number;
};
const localBlocks = new Map<string, number>();
function key(provider: OAuthProvider, clientIdHash: string) {
  return `${provider}:${clientIdHash}`;
}
function hex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
export async function hashProviderClientId(clientId: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(clientId),
  );
  return hex(new Uint8Array(digest));
}
function unavailable(error: unknown): ApiError {
  console.error(
    '[provider-budget] request reservation unavailable',
    error instanceof Error ? error.message : 'unknown error',
  );
  return new ApiError(
    'This source is temporarily unavailable. Try again later.',
    503,
  );
}
function exhausted() {
  return new ApiError(
    'This source is busy. Try syncing again in a few minutes.',
    429,
  );
}
export async function reserveProviderRequest(
  db: ProviderBudgetDatabase,
  provider: OAuthProvider,
  clientId: string,
  now = Date.now(),
  limits = PROVIDER_BUDGETS[provider],
): Promise<ProviderReservation> {
  if (!Number.isFinite(now) || now < 0) throw unavailable('invalid clock');
  const clientIdHash = await hashProviderClientId(clientId).catch((error) => {
    throw unavailable(error);
  });
  const localKey = key(provider, clientIdHash);
  const localUntil = localBlocks.get(localKey) || 0;
  if (localUntil > now) throw exhausted();
  if (localUntil) localBlocks.delete(localKey);
  const minuteCutoff = now - MINUTE_MS;
  const dayCutoff = now - DAY_MS;
  try {
    const reservationId = crypto.randomUUID();
    const results = await db.batch([
      db
        .prepare('DELETE FROM provider_request_ledger WHERE reserved_at<=?')
        .bind(dayCutoff),
      db
        .prepare(`INSERT INTO provider_request_ledger
        (reservation_id,provider,client_id_hash,reserved_at)
        SELECT ?,?,?,?
        WHERE COALESCE((SELECT blocked_until FROM provider_request_budget
          WHERE provider=? AND client_id_hash=?),0)<=?
          AND (SELECT COUNT(*) FROM provider_request_ledger
            WHERE provider=? AND client_id_hash=? AND reserved_at>?) < ?
          AND (SELECT COUNT(*) FROM provider_request_ledger
            WHERE provider=? AND client_id_hash=? AND reserved_at>?) < ?`)
        .bind(
          reservationId,
          provider,
          clientIdHash,
          now,
          provider,
          clientIdHash,
          now,
          provider,
          clientIdHash,
          minuteCutoff,
          limits.perMinute,
          provider,
          clientIdHash,
          dayCutoff,
          limits.perDay,
        ),
    ]);
    if (results[1]?.meta.changes !== 1) throw exhausted();
    return { provider, clientIdHash, reservationId, reservedAt: now };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailable(error);
  }
}
function seconds(value: string | null) {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function retryAfterUntil(value: string | null, now: number) {
  const delay = seconds(value);
  if (delay !== null) return now + Math.ceil(delay * 1000);
  if (!value) return 0;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now, date) : 0;
}
function resetUntil(
  provider: OAuthProvider,
  value: string | null,
  now: number,
) {
  const parsed = seconds(value);
  if (parsed === null) return 0;
  return provider === 'whoop'
    ? now + Math.ceil(parsed * 1000)
    : Math.ceil(parsed * 1000);
}
export function providerBlockedUntil(
  provider: OAuthProvider,
  response: Response,
  now = Date.now(),
) {
  const retry = retryAfterUntil(response.headers.get('Retry-After'), now);
  const remaining = seconds(response.headers.get('X-RateLimit-Remaining'));
  const reset = resetUntil(
    provider,
    response.headers.get('X-RateLimit-Reset'),
    now,
  );
  const window = seconds(response.headers.get('X-RateLimit-Window'));
  const exhaustedUntil =
    response.status === 429 || remaining === 0
      ? reset > now
        ? reset
        : now + Math.ceil((window ?? (provider === 'oura' ? 300 : 60)) * 1000)
      : 0;
  return Math.max(retry, exhaustedUntil);
}
export async function observeProviderResponse(
  db: ProviderBudgetDatabase,
  reservation: ProviderReservation,
  response: Response,
  now = Date.now(),
) {
  const blockedUntil = providerBlockedUntil(
    reservation.provider,
    response,
    now,
  );
  if (blockedUntil <= now) return blockedUntil;
  const localKey = key(reservation.provider, reservation.clientIdHash);
  localBlocks.set(
    localKey,
    Math.max(localBlocks.get(localKey) || 0, blockedUntil),
  );
  try {
    await db
      .prepare(`INSERT INTO provider_request_budget(provider,client_id_hash,blocked_until)
      VALUES (?,?,?) ON CONFLICT(provider,client_id_hash) DO UPDATE SET blocked_until=
      CASE WHEN provider_request_budget.blocked_until > excluded.blocked_until
        THEN provider_request_budget.blocked_until ELSE excluded.blocked_until END`)
      .bind(reservation.provider, reservation.clientIdHash, blockedUntil)
      .run();
  } catch {
    console.error('[provider-budget] response block persistence unavailable');
  }
  return blockedUntil;
}
export function createProviderBudgetRequester(
  db: ProviderBudgetDatabase,
  fetcher: typeof fetch = globalThis.fetch,
): ProviderRequester {
  return async (provider, clientId, input, init) => {
    const reservation = await reserveProviderRequest(db, provider, clientId);
    const response = await fetcher(input, init);
    await observeProviderResponse(db, reservation, response);
    return response;
  };
}
