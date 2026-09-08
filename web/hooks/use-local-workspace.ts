'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_WORKSPACE, STORAGE_KEY, type Workspace } from '@/lib/health';
import { createWorkspaceStore } from '@/lib/local-workspace';

export function useLocalWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace>(DEFAULT_WORKSPACE);
  const [storageError, setStorageError] = useState('');
  const [ready, setReady] = useState(false);
  const store = useRef<ReturnType<typeof createWorkspaceStore> | null>(null);
  /* oxlint-disable react/react-compiler -- Hydrate local records and listen for changes made in other tabs. */
  useEffect(() => {
    let mounted = true;
    const current = createWorkspaceStore(
      {
        read: () => localStorage.getItem(STORAGE_KEY),
        write: (value) => localStorage.setItem(STORAGE_KEY, value),
      },
      (workspace, error) => {
        if (mounted) {
          setWorkspace(workspace);
          setStorageError(error);
        }
      },
      async (run) => {
        if (navigator.locks) await navigator.locks.request(STORAGE_KEY, run);
        else run();
      },
    );
    store.current = current;
    current.load();
    setReady(true);
    const changed = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) current.load();
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (current.pending) e.preventDefault();
    };
    const focused = () => current.load();
    window.addEventListener('storage', changed);
    window.addEventListener('focus', focused);
    window.addEventListener('beforeunload', leave);
    return () => {
      mounted = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', focused);
      window.removeEventListener('beforeunload', leave);
    };
  }, []);
  /* oxlint-enable react/react-compiler */
  const update = useCallback((change: (workspace: Workspace) => Workspace) => {
    void store.current?.update(change);
  }, []);
  return { workspace, setWorkspace: update, storageError, ready };
}
