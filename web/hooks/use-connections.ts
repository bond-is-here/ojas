'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJSON } from '@/lib/client-request';
import {
  DEFAULT_SOURCE_PREFERENCES,
  validConnectionsData,
  type ConnectionsData,
  type SourceId,
} from '@/lib/connections';
export async function connectionRequest<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  accountId?: string,
): Promise<T> {
  return requestJSON<T>(
    `/api/connections${path}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: {
        ...(accountId ? { 'X-Ojas-Account': accountId } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    },
    path.endsWith('/sync') ? 130000 : 20000,
    body === undefined && (!path || path.startsWith('?'))
      ? validConnectionsData
      : undefined,
  );
}
export type ConnectionRequest = <T = Record<string, unknown>>(
  path: string,
  body?: unknown,
) => Promise<T>;
export function useConnections(
  day: string,
  autoSync = false,
  accountId?: string,
) {
  const request: ConnectionRequest = useCallback(
    (path, body) => connectionRequest(path, body, accountId),
    [accountId],
  );
  const [data, setData] = useState<ConnectionsData>({
    connections: [],
    entries: [],
    preferences: DEFAULT_SOURCE_PREFERENCES,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<SourceId | null>(null);
  const mounted = useRef(true);
  const syncing = useRef(false);
  const attempts = useRef<Record<string, number>>({});
  const requestDay = useRef(day);
  const generation = useRef(0);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  useEffect(() => {
    requestDay.current = day;
  }, [day]);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await request<ConnectionsData>(
        `?day=${encodeURIComponent(day)}`,
      );
      if (
        mounted.current &&
        requestDay.current === day &&
        generation.current === current
      ) {
        setData(next);
        setError('');
      }
      return next;
    } catch (e) {
      if (
        mounted.current &&
        requestDay.current === day &&
        generation.current === current
      )
        setError(
          e instanceof Error ? e.message : 'Could not load your connections.',
        );
      throw e;
    } finally {
      if (
        mounted.current &&
        requestDay.current === day &&
        generation.current === current
      )
        setLoading(false);
    }
  }, [day, request]);
  const sync = useCallback(
    async (provider: SourceId) => {
      if (syncing.current)
        throw new Error('Another source is syncing. Try again shortly.');
      syncing.current = true;
      setBusy(provider);
      try {
        const result = await request<{ count: number }>(
          `/${provider}/sync`,
          {},
        );
        await refresh();
        return result;
      } catch (e) {
        await refresh().catch(() => undefined);
        throw e;
      } finally {
        syncing.current = false;
        if (mounted.current) setBusy(null);
      }
    },
    [refresh, request],
  );
  /* oxlint-disable react/react-compiler -- Fetch stored source state on mount; asynchronous results update the view. */
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
      invalidate();
    };
  }, [refresh, invalidate]);
  /* oxlint-enable react/react-compiler */
  // Sync only while this page is visible. Provider records retain their own timestamps.
  useEffect(() => {
    let disposed = false;
    let running = false;
    const update = async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const next = await refresh();
        if (!autoSync || disposed) return;
        for (const source of next.connections) {
          if (
            disposed ||
            syncing.current ||
            source.provider === 'apple-health' ||
            source.status !== 'connected' ||
            source.nextSyncAt > Date.now()
          )
            continue;
          const recent = Math.max(
            source.lastSync ? Date.parse(source.lastSync) : 0,
            attempts.current[source.provider] || 0,
          );
          if (Date.now() - recent < 15 * 60000) continue;
          attempts.current[source.provider] = Date.now();
          await sync(source.provider).catch(() => undefined);
        }
      } catch {
        /* The existing source state exposes errors and a retry action. */
      } finally {
        running = false;
      }
    };
    const focus = () => {
      void update();
    };
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    const interval = autoSync ? setInterval(focus, 60000) : undefined;
    if (autoSync) void update();
    return () => {
      disposed = true;
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
      if (interval) clearInterval(interval);
    };
  }, [refresh, sync, autoSync]);
  return { data, loading, error, busy, refresh, sync, request, accountId };
}
export type ConnectionsController = ReturnType<typeof useConnections>;
