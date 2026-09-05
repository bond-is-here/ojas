import {
  object,
  number,
  whoopSleep,
  ouraEntries,
  type OAuthProvider,
  type SyncedEntry,
} from '../lib/connections.ts';
import { ApiError } from './errors.ts';
export const PROVIDERS = {
  whoop: {
    authorize: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    token: 'https://api.prod.whoop.com/oauth/oauth2/token',
    api: 'https://api.prod.whoop.com/developer/v2/',
    scope: 'read:sleep read:recovery offline',
  },
  oura: {
    authorize: 'https://cloud.ouraring.com/oauth/authorize',
    token: 'https://api.ouraring.com/oauth/token',
    api: 'https://api.ouraring.com/v2/usercollection/',
    scope: 'daily',
  },
};
export type Tokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
};
export async function exchangeTokens(
  provider: OAuthProvider,
  credentials: { clientId: string; secret: string },
  grant: Record<string, string>,
  previousRefresh?: string | null,
): Promise<Tokens> {
  const response = await fetch(PROVIDERS[provider].token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      ...grant,
      client_id: credentials.clientId,
      client_secret: credentials.secret,
    }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok)
    throw new ApiError(
      response.status === 429
        ? 'This source is busy. Try again in a few minutes.'
        : 'Authorization could not be completed. Check your app credentials and reconnect.',
      response.status === 429 ? 429 : 409,
    );
  const token = object(await response.json());
  if (typeof token.access_token !== 'string' || !token.access_token)
    throw new ApiError('The source did not return a valid access token.', 502);
  return {
    accessToken: token.access_token,
    refreshToken:
      typeof token.refresh_token === 'string'
        ? token.refresh_token
        : previousRefresh || null,
    expiresAt:
      Date.now() + Math.max(60, number(token.expires_in) || 3600) * 1000,
  };
}
async function collection(
  provider: OAuthProvider,
  path: string,
  accessToken: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let next: string | undefined;
  for (let page = 0; page < 8; page++) {
    const url = new URL(path, PROVIDERS[provider].api);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    if (provider === 'whoop') url.searchParams.set('limit', '25');
    if (next) url.searchParams.set('nextToken', next);
    if (next && provider === 'oura') {
      url.searchParams.delete('nextToken');
      url.searchParams.set('next_token', next);
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      if (response.status === 401)
        throw new ApiError(
          'Your source authorization has expired. Reconnect to continue syncing.',
          401,
        );
      if (response.status === 403)
        throw new ApiError(
          'This source denied access. Check the permissions and membership on your source account.',
          403,
        );
      if (response.status === 429)
        throw new ApiError(
          'The source rate limit was reached. Try syncing again in a few minutes.',
          429,
        );
      throw new ApiError(
        'The source is temporarily unavailable. Try syncing again later.',
        502,
      );
    }
    const data = object(await response.json());
    const records = provider === 'whoop' ? data.records : data.data;
    if (!Array.isArray(records))
      throw new ApiError('The source returned an unexpected response.', 502);
    all.push(...records);
    next =
      typeof data.next_token === 'string' && data.next_token
        ? data.next_token
        : undefined;
    if (!next) return all;
  }
  throw new ApiError(
    'This date range contains more records than can be synced in one request. Your previous data is unchanged.',
    422,
  );
}
export async function fetchSourceData(
  provider: OAuthProvider,
  accessToken: string,
): Promise<{
  entries: SyncedEntry[];
  summary: Record<string, string | number>;
}> {
  const end = new Date();
  const start = new Date(end.valueOf() - 31 * 86400000);
  const signal = AbortSignal.timeout(45000);
  if (provider === 'whoop') {
    const params = { start: start.toISOString(), end: end.toISOString() };
    const sleep = await collection(
      provider,
      'activity/sleep',
      accessToken,
      params,
      signal,
    );
    const recovery = await collection(
      provider,
      'recovery',
      accessToken,
      params,
      signal,
    );
    const latest = recovery
      .map(object)
      .filter((r) => r.score_state === 'SCORED')
      .sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )[0];
    const score = object(latest?.score);
    const summary: Record<string, string | number> = {};
    for (const [key, value] of [
      ['Recovery', number(score.recovery_score)],
      ['Resting HR', number(score.resting_heart_rate)],
      ['HRV', number(score.hrv_rmssd_milli)],
    ] as const)
      if (value !== null) summary[key] = value;
    if (latest && typeof latest.created_at === 'string')
      summary['As of'] = latest.created_at.slice(0, 10);
    return { entries: whoopSleep(sleep), summary };
  }
  const params = {
    start_date: start.toISOString().slice(0, 10),
    end_date: new Date(end.valueOf() + 86400000).toISOString().slice(0, 10),
  };
  const activity = await collection(
    provider,
    'daily_activity',
    accessToken,
    params,
    signal,
  );
  const sleep = await collection(
    provider,
    'sleep',
    accessToken,
    params,
    signal,
  );
  const readiness = await collection(
    provider,
    'daily_readiness',
    accessToken,
    params,
    signal,
  );
  const latest = readiness
    .map(object)
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
  const summary: Record<string, string | number> = {};
  if (number(latest?.score) !== null) summary.Readiness = Number(latest.score);
  if (latest && typeof latest.day === 'string') summary['As of'] = latest.day;
  return { entries: ouraEntries(activity, sleep), summary };
}
