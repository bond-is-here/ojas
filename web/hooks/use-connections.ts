'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SOURCE_PREFERENCES,
  type ConnectionsData,
  type SourceId,
} from '@/lib/connections';
export async function connectionRequest<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/connections${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Sign in to Ojas to access your connections.');
  }
  if (!response.ok) {
    const error = (data as { error?: string })?.error;
    throw new Error(error || 'This action could not be completed.');
  }
  return data as T;
}
export function useConnections(day: string) {
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
  const refresh = useCallback(async () => {
    try {
      const next = await connectionRequest<ConnectionsData>(
        `?day=${encodeURIComponent(day)}`,
      );
      if (mounted.current) {
        setData(next);
        setError('');
      }
      return next;
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : 'Could not load your connections.',
        );
      throw e;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [day]);
  const sync = useCallback(
    async (provider: SourceId) => {
      if (syncing.current)
        throw new Error('Another source is syncing. Try again shortly.');
      syncing.current = true;
      setBusy(provider);
      try {
        const result = await connectionRequest<{ count: number }>(
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
    [refresh],
  );
  /* oxlint-disable react/react-compiler -- Fetch stored source state on mount; asynchronous results update the view. */
  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  /* oxlint-enable react/react-compiler */
  // Refresh the signed-in view after returning from a provider. No background polling or hidden sync jobs.
  useEffect(() => {
    const focus = () => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [refresh]);
  return { data, loading, error, busy, refresh, sync };
}
export type ConnectionsController = ReturnType<typeof useConnections>;
