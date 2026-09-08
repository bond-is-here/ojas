'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  createAccountWorkspace,
  initialWorkspaceState,
} from '@/lib/account-workspace';
import type { AccountWorkspace, WorkspaceAction } from '@/lib/workspace';

export function useAccountWorkspace(accountId: string, day: string) {
  const [state, setState] = useState(initialWorkspaceState);
  const [client] = useState(() => {
    const key = `ojas.pending.v1:${encodeURIComponent(accountId)}:`;
    const request = async <T>(url: string, body?: unknown): Promise<T> => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(20000),
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'X-Ojas-Account': accountId,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (await response.json()) as T & { error?: string };
      if (!response.ok)
        throw new Error(
          data.error ||
            'Your log could not be saved. Retry when you are connected.',
        );
      return data;
    };
    return createAccountWorkspace(
      accountId,
      {
        readPending: () =>
          Object.keys(localStorage)
            .filter((candidate) => candidate.startsWith(key))
            .sort()
            .map((candidate) => localStorage.getItem(candidate)!)
            .filter(Boolean),
        writePending: (id, value) =>
          value === null
            ? localStorage.removeItem(key + id)
            : localStorage.setItem(key + id, value),
        lock: async (run) => {
          if (navigator.locks) await navigator.locks.request(key, run);
          else await run();
        },
        read: (selectedDay) =>
          request<AccountWorkspace>(
            `/api/workspace?day=${encodeURIComponent(selectedDay)}`,
          ),
        send: (mutation) => request('/api/workspace', mutation),
      },
      setState,
    );
  });
  /* oxlint-disable react/react-compiler -- Load account data after hydration and refresh on return. */
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !client.pending)
        void client.load(day);
    };
    void client.load(day);
    const leave = (event: BeforeUnloadEvent) => {
      if (client.pending) event.preventDefault();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('beforeunload', leave);
    };
  }, [client, day]);
  /* oxlint-enable react/react-compiler */
  const mutate = useCallback(
    (action: WorkspaceAction) => client.mutate(action),
    [client],
  );
  const retry = useCallback(() => client.retry(), [client]);
  const refresh = useCallback(() => client.load(day), [client, day]);
  return {
    ...state,
    ready: state.loaded && !state.saving && !state.pending,
    mutate,
    retry,
    refresh,
  };
}
