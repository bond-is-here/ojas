'use client';
import { useEffect, useState } from 'react';
import { Upload, LoaderCircle } from 'lucide-react';
import { parseWorkspace, STORAGE_KEY, type Entry } from '@/lib/health';

export default function LegacyLogImport({
  accountId,
  enabled,
  onImport,
}: {
  accountId: string;
  enabled: boolean;
  onImport: (entries: Entry[]) => Promise<void>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* oxlint-disable react/react-compiler -- Offer explicit ownership confirmation for old browser-only records. */
  useEffect(() => {
    try {
      if (localStorage.getItem('ojas.legacy-imported.v1')) return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setEntries(parseWorkspace(raw).entries);
    } catch {
      setError(
        'Your older browser log could not be read. Its saved copy has been kept.',
      );
    }
  }, []);
  /* oxlint-enable react/react-compiler */
  const importEntries = async () => {
    if (!enabled || busy) return;
    setBusy(true);
    setError('');
    try {
      for (let i = 0; i < entries.length; i += 100)
        await onImport(entries.slice(i, i + 100));
      try {
        localStorage.setItem('ojas.legacy-imported.v1', accountId);
      } catch {
        /* Account copy has already saved; no local data is removed. */
      }
      setEntries([]);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Import paused. Retry to finish importing your entries.',
      );
    } finally {
      setBusy(false);
    }
  };
  if (!entries.length && !error) return null;
  return (
    <section className="legacy-import" aria-label="Older browser log">
      <div>
        <strong>
          {entries.length
            ? `${entries.length} older ${entries.length === 1 ? 'entry' : 'entries'} on this device`
            : 'Older browser log'}
        </strong>
        <p>
          Import only if these records are yours. They’ll be saved to this
          account; the original browser copy is kept.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {!!entries.length && (
        <button
          className="secondary-button"
          disabled={!enabled || busy}
          onClick={() => {
            void importEntries();
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Upload size={16} />
          )}
          {busy ? 'Importing…' : 'Import my entries'}
        </button>
      )}
    </section>
  );
}
