'use client';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDot,
  Copy,
  FileUp,
  Link2,
  LoaderCircle,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Unplug,
  Watch,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  SOURCE_NAMES,
  SOURCE_ORDER,
  isOAuthProvider,
  type SourceId,
  type SourcePreferences,
  type SourceChoice,
  type ConnectionStatus,
} from '@/lib/connections';
import { TYPES, TYPE_META, dateKey } from '@/lib/health';
import type { AppleSource } from '@/lib/apple-health';
import {
  connectionRequest,
  type ConnectionsController,
} from '@/hooks/use-connections';
const DETAILS = {
  'apple-health': {
    icon: Watch,
    name: 'Apple Health',
    subtitle: 'Apple Watch & iPhone',
    metrics: ['Steps', 'Sleep', 'Nutrition', 'Water'],
    description: 'Bring in the health data already on your iPhone.',
    guide: 'https://developer.apple.com/documentation/healthkit',
    accent: 'apple',
  },
  whoop: {
    icon: Activity,
    name: 'WHOOP',
    subtitle: 'Recovery, connected',
    metrics: ['Sleep', 'Recovery', 'Workouts'],
    description: 'Keep your sleep and recovery in the picture.',
    guide: 'https://developer.whoop.com/docs/developing/oauth/',
    accent: 'whoop',
  },
  oura: {
    icon: CircleDot,
    name: 'Oura',
    subtitle: 'Your daily rhythm',
    metrics: ['Steps', 'Sleep', 'Workouts'],
    description: 'Bring your ring’s daily signals together.',
    guide: 'https://cloud.ouraring.com/docs/authentication',
    accent: 'oura',
  },
};
function when(value: string | null) {
  if (!value) return 'Not synced yet';
  const d = new Date(value);
  return `Updated ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
function statusLabel(status: ConnectionStatus['status']) {
  return {
    not_connected: 'Not connected',
    configured: 'Ready to authorize',
    connected: 'Connected',
    imported: 'Imported',
    reconnect: 'Reconnect needed',
  }[status];
}
export default function ConnectionsPanel({
  controller,
  onImported,
}: {
  controller: ConnectionsController;
  onImported: () => void;
}) {
  const { data, loading, error, busy, refresh, sync } = controller;
  const [selected, setSelected] = useState<SourceId | null>(null);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [configuring, setConfiguring] = useState(false);
  const [confirm, setConfirm] = useState<'disconnect' | 'remove' | null>(null);
  const [saving, setSaving] = useState(false);
  const current = data.connections.find((c) => c.provider === selected);
  /* oxlint-disable react/react-compiler -- Read the provider callback result after client navigation. */
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('connection');
    if (outcome) {
      if (outcome === 'connected')
        setNotice('Account connected. Sync now to bring in your last 30 days.');
      else
        setActionError(
          outcome === 'cancelled'
            ? 'Authorization was cancelled. You can connect whenever you are ready.'
            : 'Authorization could not finish. Check your app settings and try connecting again.',
        );
      url.searchParams.delete('connection');
      history.replaceState(null, '', url.pathname + url.search);
    }
  }, []);
  /* oxlint-enable react/react-compiler */
  const open = (provider: SourceId) => {
    setSelected(provider);
    setActionError('');
    setConfiguring(false);
  };
  const runSync = async (provider: SourceId) => {
    setActionError('');
    setNotice('');
    try {
      const result = await sync(provider);
      setNotice(
        result.count
          ? `${result.count} ${SOURCE_NAMES[provider]} records are up to date.`
          : 'Sync finished. This source has no supported records in the last 30 days.',
      );
      if (result.count) onImported();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Sync could not finish.');
    }
  };
  const remove = async () => {
    if (!selected) return;
    setSaving(true);
    setActionError('');
    try {
      await connectionRequest(`/${selected}/disconnect`, {
        removeData: confirm === 'remove',
      });
      await refresh();
      setNotice(
        confirm === 'remove'
          ? `${SOURCE_NAMES[selected]} history removed.`
          : `${SOURCE_NAMES[selected]} disconnected. Your imported history is kept.`,
      );
      setConfirm(null);
      setSelected(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not disconnect.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="connections-view">
      <div className="connections-toolbar">
        <p>Let your devices do the logging.</p>
        <button
          className="secondary-button"
          disabled={loading || !!error}
          onClick={() => setPriorityOpen(true)}
        >
          <Settings2 size={15} />
          Data priority
        </button>
      </div>
      {(error || actionError) && (
        <div className="storage-message" role="alert">
          {actionError || error}
          {error && (
            <button
              className="text-link"
              onClick={() => {
                void refresh().catch(() => undefined);
              }}
            >
              Try again
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      )}
      {notice && (
        <output className="notice">
          <Check size={15} />
          {notice}
        </output>
      )}
      <div className="source-grid">
        {SOURCE_ORDER.map((provider) => {
          const detail = DETAILS[provider];
          const Icon = detail.icon;
          const state = data.connections.find((c) => c.provider === provider);
          const status = state?.status || 'not_connected';
          const connected = status === 'connected' || status === 'imported';
          return (
            <article className={`source-card ${detail.accent}`} key={provider}>
              <div className="source-card-top">
                <span className="source-icon">
                  <Icon size={24} strokeWidth={1.6} />
                </span>
                <span
                  className={`connection-state ${connected ? 'is-connected' : status === 'reconnect' ? 'needs-action' : ''}`}
                >
                  <i />
                  {loading ? 'Loading' : statusLabel(status)}
                </span>
              </div>
              <h2>{detail.name}</h2>
              <div className="source-metrics">
                {detail.metrics.map((m) => (
                  <span key={m}>{m}</span>
                ))}
              </div>
              <div className="source-card-bottom">
                <span>{when(state?.lastSync || null)}</span>
                <div>
                  {provider !== 'apple-health' && status === 'connected' && (
                    <button
                      className="source-sync"
                      aria-label={`Sync ${detail.name}`}
                      disabled={!!busy || saving}
                      onClick={() => {
                        void runSync(provider);
                      }}
                    >
                      {busy === provider ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <RefreshCw size={16} />
                      )}
                    </button>
                  )}
                  <button
                    className={
                      connected ? 'secondary-button' : 'primary-button'
                    }
                    disabled={loading || !!error}
                    onClick={() => open(provider)}
                  >
                    {provider === 'apple-health'
                      ? connected
                        ? 'Import again'
                        : 'Import data'
                      : connected
                        ? 'Manage'
                        : 'Connect'}
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </div>
              {state?.lastError && (
                <p className="source-error">{state.lastError}</p>
              )}
            </article>
          );
        })}
      </div>
      <div className="connections-footnote">
        <ShieldCheck size={17} />
        <p>
          Connected-source history is saved privately to your Ojas account.
          Choose which source counts for each metric.
        </p>
        <span>Last 30 days</span>
      </div>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setSelected(null);
        }}
      >
        <DialogContent className="ojas-dialog source-dialog">
          <DialogHeader>
            <DialogTitle>
              {selected === 'apple-health'
                ? 'Your Apple Health data'
                : selected
                  ? `${configuring ? 'Set up' : 'Connect'} ${SOURCE_NAMES[selected]}`
                  : ''}
            </DialogTitle>
            <DialogDescription>
              {selected === 'apple-health'
                ? 'Import a recent snapshot from your iPhone.'
                : current?.status === 'connected' && !configuring
                  ? 'Your source is connected to Ojas.'
                  : 'Authorize Ojas through your source account.'}
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          {selected === 'apple-health' ? (
            <AppleImport
              onImported={async () => {
                await refresh();
                onImported();
                setSelected(null);
                setNotice(
                  'Apple Health imported. Your dashboard is up to date.',
                );
              }}
              hasHistory={!!current?.count}
              onRemove={() => setConfirm('remove')}
            />
          ) : selected && isOAuthProvider(selected) ? (
            current?.status === 'connected' && !configuring ? (
              <div className="source-manage">
                <div className="managed-status">
                  <span className="status-dot" />
                  Connected<span>{when(current.lastSync)}</span>
                </div>
                {current.summary && (
                  <div className="source-summary">
                    {Object.entries(current.summary).map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>
                          {typeof value === 'number'
                            ? Number(value.toFixed(1))
                            : value}
                          {label === 'HRV' && <small> ms</small>}
                          {label === 'Resting HR' && <small> bpm</small>}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
                <p>
                  {current.count} records in your saved history. Sync after your
                  wearable has updated its own app.
                </p>
                {current.summary?.Workouts ===
                  'Reconnect to allow workout sync' && (
                  <a
                    className="secondary-button full-width"
                    href={`/api/connections/${selected}/authorize`}
                  >
                    <Link2 size={15} />
                    Authorize workouts
                  </a>
                )}
                <button
                  className="primary-button full-width"
                  disabled={!!busy || saving}
                  onClick={() => {
                    void runSync(selected);
                  }}
                >
                  {busy === selected ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  Sync now
                </button>
                <div className="source-manage-links">
                  <button onClick={() => setConfirm('disconnect')}>
                    <Unplug size={14} />
                    Disconnect
                  </button>
                  <button onClick={() => setConfirm('remove')}>
                    Remove history
                  </button>
                  <button onClick={() => setConfiguring(true)}>
                    App settings
                  </button>
                </div>
              </div>
            ) : (
              <OAuthSetup
                key={selected}
                provider={selected}
                callbackUrl={current?.callbackUrl || ''}
                configured={!!current?.configured && !configuring}
                onSaved={refresh}
              />
            )
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={priorityOpen} onOpenChange={setPriorityOpen}>
        <DialogContent className="ojas-dialog">
          <DialogHeader>
            <DialogTitle>One source for each signal</DialogTitle>
            <DialogDescription>
              Keep overlapping device data from being counted twice.
            </DialogDescription>
          </DialogHeader>
          <PriorityForm
            current={data.preferences}
            onSave={async (preferences) => {
              await connectionRequest('/preferences', preferences);
              await refresh();
              setPriorityOpen(false);
              setNotice('Your data priority is saved.');
            }}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setConfirm(null);
        }}
      >
        <AlertDialogContent className="ojas-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'remove'
                ? 'Remove this source’s history?'
                : 'Disconnect this source?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'remove'
                ? 'This removes imported records and saved credentials for this source from Ojas. Your manual entries are kept.'
                : 'Ojas will remove this source’s credentials and stop syncing. Previously imported history stays in your account.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {saving
                ? 'Working…'
                : confirm === 'remove'
                  ? 'Remove history'
                  : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
function OAuthSetup({
  provider,
  callbackUrl,
  configured,
  onSaved,
}: {
  provider: 'whoop' | 'oura';
  callbackUrl: string;
  configured: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [ready, setReady] = useState(configured);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await connectionRequest(`/${provider}/setup`, {
        clientId,
        clientSecret: secret,
      });
      setSecret('');
      await onSaved();
      setReady(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not save your app settings.',
      );
    } finally {
      setBusy(false);
    }
  };
  return ready ? (
    <div className="oauth-ready">
      <span className="ready-symbol">
        <Link2 size={28} />
      </span>
      <h3>Ready when you are.</h3>
      <p>
        You’ll continue to {SOURCE_NAMES[provider]} to choose whether Ojas can
        read your{' '}
        {provider === 'whoop'
          ? 'sleep and recovery'
          : 'activity, sleep, and readiness'}
        .
      </p>
      <a
        className="primary-button full-width"
        href={`/api/connections/${provider}/authorize`}
      >
        Continue to {SOURCE_NAMES[provider]}
        <ArrowRight size={16} />
      </a>
      <button className="text-link" onClick={() => setReady(false)}>
        Edit app settings
      </button>
    </div>
  ) : (
    <form
      className="health-form oauth-setup"
      onSubmit={(event) => {
        void save(event);
      }}
    >
      <div className="setup-intro">
        <p>
          A developer app is needed for this personal connection. Create one
          with {SOURCE_NAMES[provider]}, then add its credentials here.
        </p>
        <a
          href={DETAILS[provider].guide}
          target="_blank"
          rel="noreferrer"
          className="text-link"
        >
          Open setup guide
          <ArrowUpRight size={14} />
        </a>
      </div>
      <div className="field">
        <label htmlFor="callback-url">Redirect URL</label>
        <div className="copy-field">
          <input id="callback-url" value={callbackUrl} readOnly />
          <button
            type="button"
            aria-label="Copy redirect URL"
            onClick={() => {
              void navigator.clipboard
                .writeText(callbackUrl)
                .then(() => setCopied(true))
                .catch(() =>
                  setError('Select and copy the redirect URL manually.'),
                );
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>
        <span className="field-help">
          Add this exact address to your developer app.
        </span>
      </div>
      <div className="field">
        <label htmlFor="oauth-client">Client ID</label>
        <input
          id="oauth-client"
          required
          maxLength={300}
          autoComplete="off"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="oauth-secret">Client secret</label>
        <input
          id="oauth-secret"
          required
          type="password"
          maxLength={5000}
          autoComplete="new-password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        <span className="field-help">
          Encrypted in your private account. Never saved in browser storage.
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button full-width" disabled={busy}>
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <ShieldCheck size={16} />
        )}
        Save app settings
      </button>
    </form>
  );
}
function AppleImport({
  onImported,
  hasHistory,
  onRemove,
}: {
  onImported: () => Promise<void>;
  hasHistory: boolean;
  onRemove: () => void;
}) {
  const [sources, setSources] = useState<AppleSource[]>([]);
  const [source, setSource] = useState('');
  const [progress, setProgress] = useState(0);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const selected = sources.find((s) => s.name === source);
  useEffect(() => () => worker.current?.terminate(), []);
  const read = (file: File | undefined) => {
    if (!file) return;
    setError('');
    setSources([]);
    if (!file.name.toLowerCase().endsWith('.xml')) {
      setError('Unzip your Apple Health export, then choose export.xml.');
      return;
    }
    if (file.size > 1000000000) {
      setError('Choose an XML export smaller than 1 GB.');
      return;
    }
    setReading(true);
    setProgress(0);
    worker.current?.terminate();
    try {
      worker.current = new Worker(
        new URL('../workers/apple-health.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.current.onmessage = (
        event: MessageEvent<{
          kind: string;
          percent?: number;
          sources?: AppleSource[];
          message?: string;
        }>,
      ) => {
        const message = event.data;
        if (message.kind === 'progress') setProgress(message.percent || 0);
        if (message.kind === 'complete') {
          setSources(message.sources || []);
          setSource(message.sources?.[0]?.name || '');
          setReading(false);
          worker.current?.terminate();
        }
        if (message.kind === 'error') {
          setError(message.message || 'The export could not be read.');
          setReading(false);
          worker.current?.terminate();
        }
      };
      worker.current.onerror = () => {
        setError(
          'The export could not be processed. Try again with a smaller file.',
        );
        setReading(false);
        worker.current?.terminate();
      };
      worker.current.postMessage({ file, today: dateKey(new Date()) });
    } catch {
      setReading(false);
      setError(
        'This browser could not start the importer. Try a current browser.',
      );
    }
  };
  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      await connectionRequest('/apple-health/import', {
        source: selected.name,
        entries: selected.entries,
      });
      await onImported();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'The import could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="apple-import">
      <div className="import-explanation">
        <Watch size={21} />
        <p>
          Apple Health has no browser connection. Export from the Health app on
          your iPhone: <strong>profile picture → Export All Health Data</strong>
          , then unzip the file.
        </p>
      </div>
      <label
        className={`upload-zone ${reading ? 'reading' : ''}`}
        htmlFor="apple-file"
      >
        <FileUp size={27} />
        <strong>
          {reading ? 'Reading your export…' : 'Choose export.xml'}
        </strong>
        <span>
          {reading
            ? 'Processing on this device'
            : 'Only the last 30 days · XML up to 1 GB'}
        </span>
        <input
          id="apple-file"
          type="file"
          accept=".xml,text/xml,application/xml"
          disabled={reading || saving}
          onChange={(e) => read(e.target.files?.[0])}
        />
      </label>
      {reading && (
        <Progress
          value={progress}
          aria-label="Apple Health file processing progress"
        />
      )}
      {sources.length > 0 && (
        <div className="import-preview">
          <label htmlFor="apple-source">Choose one device or app</label>
          <Select
            value={source}
            onValueChange={(value) => setSource(value || '')}
          >
            <SelectTrigger id="apple-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p>
            Choose your preferred device to avoid overlapping phone and watch
            data.
          </p>
          {selected && (
            <div className="import-counts">
              {TYPES.filter((t) =>
                selected.entries.some((e) => e.type === t),
              ).map((t) => (
                <span key={t}>
                  {TYPE_META[t].label}
                  <strong>
                    {selected.entries.filter((e) => e.type === t).length} days
                  </strong>
                </span>
              ))}
            </div>
          )}
          <button
            className="primary-button full-width"
            disabled={!selected || saving}
            onClick={() => {
              void save();
            }}
          >
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            Import {selected?.entries.length || 0} daily records
          </button>
          <span className="field-help">
            Only the previewed daily totals are uploaded to your private
            account. Matching days are updated, not duplicated.
          </span>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {hasHistory && (
        <button
          className="remove-imports"
          disabled={saving || reading}
          onClick={onRemove}
        >
          Remove imported history
        </button>
      )}
    </div>
  );
}
function PriorityForm({
  current,
  onSave,
}: {
  current: SourcePreferences;
  onSave: (preferences: SourcePreferences) => Promise<void>;
}) {
  const [preferences, setPreferences] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      className="health-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSave(preferences)
          .catch((e) =>
            setError(
              e instanceof Error ? e.message : 'Could not save preferences.',
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      {TYPES.map((t) => (
        <div className="field" key={t}>
          <label htmlFor={`source-${t}`}>{TYPE_META[t].label}</label>
          <Select
            value={preferences[t]}
            onValueChange={(value) =>
              setPreferences({ ...preferences, [t]: value as SourceChoice })
            }
          >
            <SelectTrigger id={`source-${t}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Automatic</SelectItem>
              <SelectItem value="manual">Manual entries only</SelectItem>
              {SOURCE_ORDER.filter(
                (s) =>
                  s === 'apple-health' ||
                  t === 'sleep' ||
                  (s === 'oura' && t === 'activity'),
              ).map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_NAMES[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <p className="priority-explanation">
        Automatic prefers Apple Health, then Oura, then WHOOP when data is
        available for a day. Source totals take priority over manual entries for
        the same metric. Your manual entries are kept.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button" disabled={busy}>
        {busy ? 'Saving…' : 'Save priority'}
      </button>
    </form>
  );
}
