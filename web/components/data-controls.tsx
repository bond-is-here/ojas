'use client';
import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import { STORAGE_KEY } from '@/lib/health';
import { recoveryPrefix } from '@/lib/workout-recovery';
import { ClientRequestError, requestExport } from '@/lib/client-request';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function DataControls({ accountId }: { accountId: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const exportAccount = async () => {
    setBusy(true);
    setError('');
    try {
      download(
        await requestExport(accountId),
        `ojas-${new Date().toISOString().slice(0, 10)}.jsonl`,
      );
    } catch (error) {
      setError(
        error instanceof ClientRequestError
          ? error.message
          : 'Your export could not be downloaded.',
      );
    } finally {
      setBusy(false);
    }
  };
  const exportRecovery = () => {
    setError('');
    try {
      const prefixes = [
        recoveryPrefix(accountId),
        `ojas.pending.v1:${encodeURIComponent(accountId)}:`,
      ];
      const records = Object.fromEntries(
        Object.keys(localStorage)
          .filter(
            (key) =>
              key === STORAGE_KEY ||
              prefixes.some((prefix) => key.startsWith(prefix)),
          )
          .map((key) => [key, localStorage.getItem(key)]),
      );
      download(
        new Blob(
          [
            JSON.stringify(
              { accountId, exportedAt: new Date().toISOString(), records },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
        'ojas-browser-recovery.json',
      );
    } catch {
      setError(
        'Browser storage could not be read. Keep any unsaved forms open.',
      );
    }
  };
  return (
    <div className="data-controls">
      <strong>Your data</strong>
      <p className="field-help">
        Export your account’s logs, goals, workouts and imported history.
        Credentials are excluded.
      </p>
      <button
        type="button"
        className="secondary-button full-width"
        disabled={busy}
        onClick={() => {
          void exportAccount();
        }}
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Download size={16} />
        )}{' '}
        Export account data
      </button>
      <button type="button" className="text-link" onClick={exportRecovery}>
        Export browser recovery
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
