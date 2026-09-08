'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  createAccountWorkspace,
  initialWorkspaceState,
} from '@/lib/account-workspace';
import { parseWorkspace } from '@/lib/health';
import type { AccountWorkspace, WorkspaceAction } from '@/lib/workspace';
import { requestJSON } from '@/lib/client-request';

function isAccountWorkspace(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const value = data as { accountId?: unknown; workspace?: unknown };
  if (typeof value.accountId !== 'string') return false;
  try {
    parseWorkspace(JSON.stringify(value.workspace));
    return true;
  } catch {
    return false;
  }
}

export function useAccountWorkspace(accountId: string, day: string) {
  const [state, setState] = useState(initialWorkspaceState);
  const [client] = useState(() => {
    const key = `ojas.pending.v1:${encodeURIComponent(accountId)}:`;
    const request = async <T>(
      url: string,
      body?: unknown,
      validate?: (data: unknown) => boolean,
    ): Promise<T> => {
      return requestJSON<T>(
        url,
        {
          method: body === undefined ? 'GET' : 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'X-Ojas-Account': accountId,
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        20000,
        validate,
      );
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
            undefined,
            isAccountWorkspace,
          ),
        send: (mutation) =>
          request('/api/workspace', mutation, (data) => {
            return (
              !!data &&
              typeof data === 'object' &&
              !Array.isArray(data) &&
              (data as { saved?: unknown }).saved === true
            );
          }),
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
