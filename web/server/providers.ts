import {
  object,
  number,
  whoopSleep,
  ouraEntries,
  type OAuthProvider,
  type SyncedEntry,
} from '../lib/connections.ts';
import { ApiError } from './errors.ts';
import { mapWorkouts } from '../lib/source-workouts.ts';
import type { SourceWorkout } from '../lib/training.ts';

export type ProviderRequester = (
  provider: OAuthProvider,
  clientId: string,
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
const directRequester: ProviderRequester = (
  _provider,
  _clientId,
  input,
  init,
) => fetch(input, init);
export const PROVIDERS = {
  whoop: {
    authorize: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    token: 'https://api.prod.whoop.com/oauth/oauth2/token',
    api: 'https://api.prod.whoop.com/developer/v2/',
    scope: 'read:sleep read:recovery read:workout offline',
  },
  oura: {
    authorize: 'https://cloud.ouraring.com/oauth/authorize',
    token: 'https://api.ouraring.com/oauth/token',
    api: 'https://api.ouraring.com/v2/usercollection/',
    scope: 'daily workout',
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
  requester: ProviderRequester = directRequester,
): Promise<Tokens> {
  const response = await requester(
    provider,
    credentials.clientId,
    PROVIDERS[provider].token,
    {
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
    },
  );
  if (!response.ok)
    throw new ApiError(
      response.status === 429
        ? 'This source is busy. Try again in a few minutes.'
        : response.status >= 500
          ? 'This source is temporarily unavailable. Try syncing again later.'
          : 'Authorization could not be completed. Check your app credentials and reconnect.',
      response.status === 429 ? 429 : response.status >= 500 ? 502 : 409,
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
  clientId: string,
  requester: ProviderRequester,
): Promise<unknown[]> {
  const all: unknown[] = [];
  let next: string | undefined;
  const seen = new Set<string>();
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
    const response = await requester(provider, clientId, url, {
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
    if (
      data.next_token !== undefined &&
      data.next_token !== null &&
      typeof data.next_token !== 'string'
    )
      throw new ApiError('The source returned an invalid page cursor.', 502);
    next =
      typeof data.next_token === 'string'
        ? data.next_token || undefined
        : undefined;
    if (!next) return all;
    if (seen.has(next))
      throw new ApiError('The source returned a repeated page cursor.', 502);
    seen.add(next);
  }
  throw new ApiError(
    'This date range contains more records than can be synced in one request. Your previous data is unchanged.',
    422,
  );
}
export type ProviderRequestOptions = {
  clientId?: string;
  requester?: ProviderRequester;
};
export async function fetchSourceData(
  provider: OAuthProvider,
  accessToken: string,
  options: ProviderRequestOptions = {},
): Promise<{
  entries: SyncedEntry[];
  summary: Record<string, string | number>;
  workouts: SourceWorkout[];
  window: { start: string; end: string; fromDay: string; untilDay: string };
  entriesComplete: boolean;
  workoutsComplete: boolean;
}> {
  if (options.requester && !options.clientId)
    throw new ApiError(
      'This source is temporarily unavailable. Try again later.',
      503,
    );
  const requester = options.requester || directRequester;
  const clientId = options.clientId || '';
  const end = new Date();
  const start = new Date(end.valueOf() - 31 * 86400000);
  const signal = AbortSignal.timeout(45000);
  let workoutsComplete = false;
  const loadWorkouts = async (
    params: Record<string, string>,
    summary: Record<string, string | number>,
  ) => {
    try {
      const records = await collection(
        provider,
        provider === 'whoop' ? 'activity/workout' : 'workout',
        accessToken,
        params,
        signal,
        clientId,
        requester,
      );
      const workouts = mapWorkouts(provider, records);
      workoutsComplete = workouts.length === records.length;
      if (!workoutsComplete)
        summary.Workouts =
          'Some workouts could not be read; previous workouts were kept';
      return workouts;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      summary.Workouts =
        error instanceof ApiError && error.status === 403
          ? 'Reconnect to allow workout sync'
          : 'Workout sync unavailable; try again later';
      return [];
    }
  };
  if (provider === 'whoop') {
    const params = { start: start.toISOString(), end: end.toISOString() };
    const sleep = await collection(
      provider,
      'activity/sleep',
      accessToken,
      params,
      signal,
      clientId,
      requester,
    );
    const recovery = await collection(
      provider,
      'recovery',
      accessToken,
      params,
      signal,
      clientId,
      requester,
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
    const entries = whoopSleep(sleep);
    // Pending and unscorable sleeps intentionally have no sleep metric. Any
    // other skipped record makes this snapshot unsafe to use for deletions.
    const expected = sleep.filter((raw) => {
      const state = object(raw).score_state;
      return state !== 'PENDING_SCORE' && state !== 'UNSCORABLE';
    });
    const entriesComplete = entries.length === expected.length;
    if (!entriesComplete)
      summary['Daily data'] =
        'Some daily records could not be read; previous records were kept';
    return {
      entries,
      entriesComplete,
      workouts: await loadWorkouts(params, summary),
      workoutsComplete,
      // Sleep entries store local wake-up dates, not UTC start timestamps.
      // Reconcile only full interior days to retain records crossing the query boundary.
      window: {
        start: params.start,
        end: params.end,
        fromDay: new Date(start.valueOf() + 2 * 86400000)
          .toISOString()
          .slice(0, 10),
        untilDay: new Date(end.valueOf() - 86400000).toISOString().slice(0, 10),
      },
      summary,
    };
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
    clientId,
    requester,
  );
  const sleep = await collection(
    provider,
    'sleep',
    accessToken,
    params,
    signal,
    clientId,
    requester,
  );
  const readiness = await collection(
    provider,
    'daily_readiness',
    accessToken,
    params,
    signal,
    clientId,
    requester,
  );
  const latest = readiness
    .map(object)
    .sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
  const summary: Record<string, string | number> = {};
  if (number(latest?.score) !== null) summary.Readiness = Number(latest.score);
  if (latest && typeof latest.day === 'string') summary['As of'] = latest.day;
  const entries = ouraEntries(activity, sleep);
  const entriesComplete = entries.length === activity.length + sleep.length;
  if (!entriesComplete)
    summary['Daily data'] =
      'Some daily records could not be read; previous records were kept';
  return {
    entries,
    entriesComplete,
    workouts: await loadWorkouts(params, summary),
    workoutsComplete,
    window: {
      start: start.toISOString(),
      end: end.toISOString(),
      fromDay: params.start_date,
      untilDay: params.end_date,
    },
    summary,
  };
}
