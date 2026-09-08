'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  parseRecovery,
  recoveryPrefix,
  type RecoveryRecord,
} from '@/lib/workout-recovery';

export function useWorkoutRecovery(accountId: string) {
  const [records, setRecords] = useState<RecoveryRecord[]>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    const records: RecoveryRecord[] = [];
    let error = '';
    try {
      for (const key of Object.keys(localStorage).filter((key) =>
        key.startsWith(recoveryPrefix(accountId)),
      )) {
        try {
          const raw = localStorage.getItem(key)!;
          records.push({ key, raw, data: parseRecovery(raw, accountId) });
        } catch {
          error =
            'A workout recovery copy could not be read. Export browser recovery data from Settings before clearing it.';
        }
      }
    } catch {
      error =
        'Browser recovery storage is unavailable. Keep Ojas open until your workout is saved.';
    }
    setRecords(
      records.sort((a, b) => b.data.updatedAt.localeCompare(a.data.updatedAt)),
    );
    setError(error);
  }, [accountId]);
  /* oxlint-disable react/react-compiler -- Discover account-scoped recovery copies after hydration. */
  useEffect(() => {
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  /* oxlint-enable react/react-compiler */
  return { records, error, refresh };
}
