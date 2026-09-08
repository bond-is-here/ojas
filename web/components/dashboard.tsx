'use client';
import { DataControls } from '@/components/data-controls';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Dumbbell,
  Info,
  RefreshCw,
  CircleDot,
  Watch,
  Activity,
  Flame,
  Footprints,
  LayoutGrid,
  Leaf,
  Link2,
  Moon,
  Pause,
  Play,
  Plus,
  Settings2,
  Trash2,
  Utensils,
  Wind,
} from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import VitalityHalo from '@/components/halo-loader';
import {
  LogForm,
  PreferencesForm,
  BreathingMoment,
} from '@/components/health-dialogs';
import ConnectionsPanel from '@/components/connections-panel';
import QuickCapture from '@/components/quick-capture';
import LegacyLogImport from '@/components/legacy-log-import';
import TrainingPanel from '@/components/training-panel';
import { useTraining } from '@/hooks/use-training';
import { useConnections } from '@/hooks/use-connections';
import { useAccountWorkspace } from '@/hooks/use-account-workspace';
import { mergeSourceEntries, SOURCE_NAMES } from '@/lib/connections';
import {
  balance,
  advanceCalendar,
  dateKey,
  entriesForDay,
  formatAmount,
  formatTime,
  progress,
  shiftDay,
  totals,
  TYPE_META,
  TYPES,
  type Entry,
  type EntryType,
} from '@/lib/health';
const ICONS = {
  activity: Footprints,
  nutrition: Flame,
  water: Droplets,
  sleep: Moon,
};
const NAV = [
  { name: 'Overview', icon: LayoutGrid },
  { name: 'Training', icon: Dumbbell },
  { name: 'Activity', icon: Footprints },
  { name: 'Nutrition', icon: Utensils },
  { name: 'Sleep', icon: Moon },
  { name: 'Connections', icon: Link2 },
];
type Modal = 'log' | 'preferences' | 'balance' | 'breathing' | 'journal' | null;
const HEADINGS: Record<string, string> = {
  Overview: 'Today',
  Activity: 'Movement',
  Nutrition: 'Nourishment',
  Sleep: 'Rest',
  Connections: 'Connections',
  Training: 'Training',
};
export default function Dashboard({
  initialDay,
  accountId,
  accountLabel,
}: {
  initialDay: string;
  accountId: string;
  accountLabel: string;
}) {
  const [section, setSection] = useState('Overview');
  const [calendar, setCalendar] = useState({
    day: initialDay,
    today: initialDay,
  });
  const { day, today } = calendar;
  const setDay = (day: string) => setCalendar((c) => ({ ...c, day }));
  const {
    workspace,
    mutate,
    ready,
    loaded,
    error: storageError,
    saving,
    pending,
    retry,
    refresh: refreshWorkspace,
  } = useAccountWorkspace(accountId, day);
  const [modal, setModal] = useState<Modal>(null);
  const [logType, setLogType] = useState<EntryType>('activity');
  const [notice, setNotice] = useState('');
  const [removed, setRemoved] = useState<Entry | null>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const sourcesApplied = useRef(false);
  const training = useTraining(today, accountId);
  const connections = useConnections(
    day,
    !training.loading && !training.error && training.data.preferences.autoSync,
    accountId,
  );
  const refreshTraining = training.refresh;
  useEffect(() => {
    if (!connections.busy) void refreshTraining().catch(() => undefined);
  }, [connections.busy, refreshTraining]);
  /* oxlint-disable react/react-compiler -- Hydrate browser and server data after SSR and report storage failures. */
  useEffect(() => {
    const local = dateKey(new Date());
    setCalendar({ day: local, today: local });
    if (
      new URL(window.location.href).searchParams.get('view') === 'connections'
    )
      setSection('Connections');
  }, []);
  useEffect(() => {
    if (ready && connections.data.entries.length && !sourcesApplied.current) {
      sourcesApplied.current = true;
      void mutate({ type: 'preferences', demo: false }).catch(() => undefined);
    }
  }, [ready, connections.data.entries.length, mutate]);
  /* oxlint-enable react/react-compiler */
  useEffect(() => {
    const refresh = () =>
      setCalendar((c) => advanceCalendar(c, dateKey(new Date())));
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(timer);
    };
  }, []);
  const displayed = mergeSourceEntries(
    workspace,
    connections.data.entries,
    connections.data.preferences,
  );
  const entries = entriesForDay(displayed, day, today);
  const values = totals(entries);
  const score = balance(values, workspace.goals);
  const metric: EntryType =
    section === 'Nutrition'
      ? 'nutrition'
      : section === 'Sleep'
        ? 'sleep'
        : 'activity';
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = shiftDay(day, i - 6);
    return {
      day: d,
      value: totals(entriesForDay(displayed, d, today))[metric],
    };
  });
  const filtered =
    section === 'Overview'
      ? entries
      : entries.filter(
          (e) =>
            e.type === metric ||
            (section === 'Nutrition' && e.type === 'water'),
        );
  const connected = connections.data.connections.filter(
    (c) => c.status === 'connected' || c.status === 'imported',
  );
  const openLog = (type: EntryType = 'activity') => {
    setLogType(type);
    setModal('log');
  };
  const addEntry = async (entry: Entry) => {
    await mutate({ type: 'add', entry });
    setDay(entry.day);
    const hasSource = displayed.entries.some(
      (e) => e.source && e.type === entry.type && e.day === entry.day,
    );
    setNotice(
      hasSource
        ? 'Entry saved. Your connected source remains the total for this metric; change Data priority to use manual entries.'
        : `${TYPE_META[entry.type].label} added.`,
    );
    setRemoved(null);
    setLastAdded(entry.id);
    setModal(null);
  };
  const addWater = () => {
    const now = new Date();
    void addEntry({
      id: crypto.randomUUID(),
      day,
      type: 'water',
      amount: 250,
      title: 'A glass of water',
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    }).catch(() => undefined);
  };
  const removeEntry = (entry: Entry) => {
    void mutate({ type: 'remove', id: entry.id })
      .then(() => {
        setRemoved(entry);
        setLastAdded(null);
        setNotice('Entry removed.');
      })
      .catch(() => undefined);
  };
  const goalStatus =
    score >= 95
      ? 'Daily goals met'
      : score >= 75
        ? 'In balance'
        : score >= 40
          ? 'Finding your rhythm'
          : 'A fresh start';
  const sourceNote = (type: EntryType, fallback: string) => {
    const e = entries.find((e) => e.type === type && e.source);
    return e?.source ? `From ${SOURCE_NAMES[e.source]}` : fallback;
  };
  return (
    <SidebarProvider
      className="minimal-ojas studio-ojas"
      style={{ '--sidebar-width': '88px' } as CSSProperties}
    >
      <a href="#daily-content" className="skip-link">
        Skip to dashboard
      </a>
      <Sidebar className="ojas-sidebar">
        <SidebarHeader className="brand-area">
          <button
            className="brand"
            onClick={() => setSection('Overview')}
            aria-label="Ojas overview"
          >
            <span className="brand-mark">
              <Leaf size={20} strokeWidth={1.5} />
            </span>
            <span className="brand-word">
              ojas<span className="brand-period">.</span>
            </span>
          </button>
        </SidebarHeader>
        <SidebarContent className="nav-content">
          <Navigation section={section} onChange={setSection} />
        </SidebarContent>
        <SidebarFooter className="sidebar-bottom">
          <button
            className="profile"
            onClick={() => setModal('preferences')}
            aria-label="Open personal goals and preferences"
          >
            <div className="avatar">Y</div>
            <div>
              <strong>Your space</strong>
              <span title={accountLabel}>{accountLabel}</span>
            </div>
            <Settings2 size={16} />
          </button>
        </SidebarFooter>
      </Sidebar>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <SidebarTrigger className="mobile-trigger" />
            <span className="workspace-wordmark">
              ojas<span>.</span>
            </span>
          </div>
          <div className="topbar-right">
            <div className="source-orbit" aria-label="Health sources">
              {(
                [
                  ['apple-health', Watch, 'Apple Health'],
                  ['whoop', Activity, 'WHOOP'],
                  ['oura', CircleDot, 'Oura'],
                ] as const
              ).map(([id, Icon, name]) => (
                <button
                  key={id}
                  className={
                    connected.some((c) => c.provider === id)
                      ? 'source-connected'
                      : ''
                  }
                  onClick={() => setSection('Connections')}
                  aria-label={`Manage ${name}`}
                  title={name}
                >
                  <Icon size={18} />
                </button>
              ))}
            </div>
            <button
              className="icon-control sync-button"
              aria-label={
                connections.busy ? 'Syncing sources' : 'Open connections'
              }
              title={connections.busy ? 'Syncing' : 'Connections'}
              onClick={() => setSection('Connections')}
            >
              <RefreshCw size={16} className={connections.busy ? 'spin' : ''} />
            </button>
            <button
              className="profile-orb"
              aria-label="Goals and preferences"
              title="Preferences"
              onClick={() => setModal('preferences')}
            >
              Y
            </button>
          </div>
        </header>
        <main className="main-content" id="daily-content">
          <div className="page-heading">
            <div>
              <h1>
                {HEADINGS[section]}
                <span>.</span>
              </h1>
              {section === 'Overview' && (
                <p>
                  {new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                  {workspace.demo && (
                    <span className="demo-label">Sample data</span>
                  )}
                </p>
              )}
            </div>
            {section !== 'Connections' && section !== 'Training' && (
              <div className="heading-actions">
                <div className="date-controls">
                  <button
                    aria-label="Previous day"
                    onClick={() => setDay(shiftDay(day, -1))}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    className="date-display"
                    onClick={() => setDay(today)}
                    title="Return to today"
                  >
                    <CalendarDays size={14} />
                    {day === today
                      ? 'Today'
                      : new Date(`${day}T12:00:00`).toLocaleDateString(
                          'en-US',
                          { month: 'short', day: 'numeric' },
                        )}
                  </button>
                  <button
                    aria-label="Next day"
                    disabled={day >= today}
                    onClick={() => setDay(shiftDay(day, 1))}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <button
                  className="primary-button"
                  disabled={!ready}
                  onClick={() => openLog(metric)}
                >
                  <Plus size={16} />
                  Log
                </button>
              </div>
            )}
          </div>
          {storageError && (
            <div className="storage-message" role="alert">
              {storageError}
              <button
                className="text-link"
                disabled={saving}
                onClick={() => {
                  void (pending ? retry() : refreshWorkspace()).catch(
                    () => undefined,
                  );
                }}
              >
                Retry
              </button>
            </div>
          )}
          {saving && (
            <output className="notice" aria-live="polite">
              Saving to your account…
            </output>
          )}
          {!loaded && !storageError && (
            <output className="notice" aria-live="polite">
              Loading your account…
            </output>
          )}
          <LegacyLogImport
            accountId={accountId}
            enabled={ready}
            onImport={async (entries) => {
              await mutate({ type: 'import', entries });
            }}
          />
          {notice && (
            <output className="notice" aria-live="polite">
              <Check size={15} />
              {notice}
              {lastAdded && (
                <button
                  onClick={() => {
                    void mutate({ type: 'remove', id: lastAdded })
                      .then(() => {
                        setLastAdded(null);
                        setNotice('Entry undone.');
                      })
                      .catch(() => undefined);
                  }}
                >
                  Undo
                </button>
              )}
              {removed && (
                <button
                  onClick={() => {
                    void mutate({ type: 'add', entry: removed })
                      .then(() => {
                        setNotice('Entry restored.');
                        setRemoved(null);
                      })
                      .catch(() => undefined);
                  }}
                >
                  Undo
                </button>
              )}
              <button
                className="notice-dismiss"
                aria-label="Dismiss message"
                onClick={() => setNotice('')}
              >
                Dismiss
              </button>
            </output>
          )}
          {section === 'Connections' ? (
            <ConnectionsPanel
              controller={connections}
              onImported={() => {
                void mutate({ type: 'preferences', demo: false }).catch(
                  () => undefined,
                );
              }}
              onHistoryRemoved={training.removeSourceHistory}
            />
          ) : section === 'Training' ? (
            <TrainingPanel controller={training} day={today} />
          ) : (
            <>
              <QuickCapture
                entries={workspace.entries}
                day={day}
                enabled={ready}
                onSave={addEntry}
                onDetails={openLog}
              />
              {section === 'Overview' ? (
                <>
                  <div className="today-grid">
                    <section className="overview-focus">
                      <div className="balance-top">
                        <span>Daily balance</span>
                        <button
                          className="icon-control"
                          onClick={() => setModal('balance')}
                          aria-label="How daily balance is calculated"
                          title="About your balance score"
                        >
                          <Info size={16} />
                        </button>
                      </div>
                      <div className="focus-halo">
                        <VitalityHalo paused={!workspace.motion} />
                        <div className="halo-center">
                          <strong>
                            {score}
                            <small>/100</small>
                          </strong>
                          <span>{goalStatus}</span>
                        </div>
                      </div>
                      <div className="balance-bottom">
                        <button
                          className="icon-control"
                          onClick={() =>
                            void mutate({
                              type: 'preferences',
                              motion: !workspace.motion,
                            }).catch(() => undefined)
                          }
                          aria-label={
                            workspace.motion
                              ? 'Pause halo animation'
                              : 'Resume halo animation'
                          }
                        >
                          {workspace.motion ? (
                            <Pause size={15} />
                          ) : (
                            <Play size={15} />
                          )}
                        </button>
                        <button
                          className="breathe-shortcut"
                          onClick={() => setModal('breathing')}
                        >
                          <Wind size={16} />
                          Breathe
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </section>
                    <TrainingPanel controller={training} day={today} compact />
                  </div>
                  <div className="metric-grid essential-metrics">
                    <Metric
                      label="Movement"
                      type="activity"
                      completion={progress(
                        values.activity,
                        workspace.goals.activity,
                      )}
                      value={values.activity.toLocaleString('en-US')}
                      unit="steps"
                      note={sourceNote(
                        'activity',
                        `${Math.round(progress(values.activity, workspace.goals.activity))}% of daily goal`,
                      )}
                      onClick={() => setSection('Activity')}
                      data={[]}
                    />
                    <Metric
                      label="Sleep"
                      type="sleep"
                      completion={progress(values.sleep, workspace.goals.sleep)}
                      value={formatAmount('sleep', values.sleep)}
                      unit=""
                      note={sourceNote(
                        'sleep',
                        `${formatAmount('sleep', workspace.goals.sleep)} daily goal`,
                      )}
                      onClick={() => setSection('Sleep')}
                      data={[]}
                    />
                    <Metric
                      label="Food"
                      type="nutrition"
                      completion={progress(
                        values.nutrition,
                        workspace.goals.nutrition,
                      )}
                      value={Math.round(values.nutrition).toLocaleString(
                        'en-US',
                      )}
                      unit="kcal"
                      note={sourceNote(
                        'nutrition',
                        `${workspace.goals.nutrition.toLocaleString()} daily goal`,
                      )}
                      onClick={() => setSection('Nutrition')}
                      data={[]}
                    />
                    <Metric
                      label="Water"
                      type="water"
                      completion={progress(values.water, workspace.goals.water)}
                      value={String(Number((values.water / 1000).toFixed(2)))}
                      unit="L"
                      note={sourceNote(
                        'water',
                        `${formatAmount('water', workspace.goals.water)} daily goal`,
                      )}
                      onClick={() => openLog('water')}
                      data={[]}
                      action={
                        <button
                          className="water-add"
                          disabled={!ready}
                          onClick={addWater}
                          aria-label="Add 250 milliliters of water"
                        >
                          <Plus size={12} />
                          250 mL
                        </button>
                      }
                    />
                  </div>
                </>
              ) : (
                <div className="detail-view-grid">
                  <DetailCard
                    type={metric}
                    value={values[metric]}
                    goal={workspace.goals[metric]}
                    entries={filtered.filter((e) => e.type === metric)}
                    onLog={() => openLog(metric)}
                  />
                  <section
                    className={`panel movement-panel ${TYPE_META[metric].color}`}
                  >
                    <div className="section-title">
                      <h2>Your last 7 days</h2>
                      <span className="chart-period">
                        {TYPE_META[metric].unit.toUpperCase()}
                      </span>
                    </div>
                    <div className="chart-summary">
                      <strong>
                        {metric === 'sleep'
                          ? formatAmount(
                              'sleep',
                              week.reduce((s, d) => s + d.value, 0) / 7,
                            )
                          : Math.round(
                              week.reduce((s, d) => s + d.value, 0) / 7,
                            ).toLocaleString('en-US')}
                      </strong>
                      <span>daily average</span>
                    </div>
                    <WeekChart
                      data={week}
                      selected={day}
                      type={metric}
                      goal={workspace.goals[metric]}
                      onSelect={setDay}
                    />
                  </section>
                </div>
              )}
              <section className="panel recent-panel">
                <div className="section-title">
                  <h2>{day === today ? 'Today’s log' : 'Daily log'}</h2>
                  <button
                    className="text-link"
                    onClick={() => setModal('journal')}
                  >
                    View all
                    <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="rhythm-list">
                  {filtered.length ? (
                    [...filtered]
                      .reverse()
                      .slice(0, 3)
                      .map((e) => <EntryRow key={e.id} entry={e} />)
                  ) : (
                    <EmptyDay onLog={() => openLog(metric)} />
                  )}
                </div>
              </section>
              {connections.error && (
                <div className="sync-load-notice">
                  <span>Connected-source data is currently unavailable.</span>
                  <button
                    className="text-link"
                    onClick={() => setSection('Connections')}
                  >
                    View connections
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Leaf size={12} />
              At your pace.
            </span>
            <span>
              {workspace.demo ? 'Sample data · ' : ''}
              {connections.data.entries.length
                ? 'Your sources, privately connected'
                : 'Your log is saved privately to your account'}
            </span>
          </footer>
        </main>
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setModal(null);
        }}
      >
        <DialogContent
          className={`ojas-dialog ${modal === 'breathing' ? 'breathing-dialog' : ''}`}
        >
          <DialogHeader>
            <DialogTitle>
              {modal === 'log'
                ? 'Quick entry'
                : modal === 'preferences'
                  ? 'Your preferences'
                  : modal === 'balance'
                    ? 'Your daily balance'
                    : modal === 'journal'
                      ? 'Your daily log'
                      : 'Come back to yourself'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'log'
                ? 'Choose an amount. Add details only if you need them.'
                : modal === 'preferences'
                  ? 'Choose the goals that work for you.'
                  : modal === 'balance'
                    ? 'Four daily habits, each with an equal part.'
                    : modal === 'journal'
                      ? new Date(`${day}T12:00:00`).toLocaleDateString(
                          'en-US',
                          { weekday: 'long', month: 'long', day: 'numeric' },
                        )
                      : 'One minute. A little room to breathe.'}
            </DialogDescription>
          </DialogHeader>
          {modal === 'log' && (
            <LogForm
              key={`log-${logType}`}
              type={logType}
              day={day}
              today={today}
              onSave={addEntry}
            />
          )}
          {modal === 'preferences' && (
            <>
              <PreferencesForm
                workspace={workspace}
                onSave={async (changes) => {
                  await mutate({ type: 'preferences', ...changes });
                  setNotice('Your preferences are saved.');
                  setModal(null);
                }}
              />
              <DataControls accountId={accountId} />
            </>
          )}
          {modal === 'balance' && (
            <div className="balance-details">
              <div className="balance-large">
                {score}
                <span>/ 100</span>
              </div>
              {TYPES.map((type) => (
                <div
                  key={type}
                  className={`balance-row ${TYPE_META[type].color}`}
                >
                  <div>
                    <span>{TYPE_META[type].label}</span>
                    <strong>
                      {Math.round(
                        progress(values[type], workspace.goals[type]),
                      )}
                      %
                    </strong>
                  </div>
                  <Progress
                    value={progress(values[type], workspace.goals[type])}
                    aria-label={`${TYPE_META[type].label} goal completion`}
                  />
                </div>
              ))}
              <p>
                The average of your four goal completion percentages, each
                capped at 100%. This reflects the goals you set, and is not a
                medical assessment.
              </p>
              <button
                className="secondary-button"
                onClick={() => setModal('preferences')}
              >
                <Settings2 size={15} />
                Adjust your goals
              </button>
            </div>
          )}
          {modal === 'journal' && (
            <div className="journal-entries">
              {entries.length ? (
                entries.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    onRemove={
                      e.sample || e.source ? undefined : () => removeEntry(e)
                    }
                  />
                ))
              ) : (
                <EmptyDay onLog={() => openLog(metric)} />
              )}
              <button
                className="primary-button"
                onClick={() => openLog(metric)}
              >
                <Plus size={16} />
                Add to your day
              </button>
            </div>
          )}
          {modal === 'breathing' && (
            <BreathingMoment
              motion={workspace.motion}
              onFinish={() => {
                setNotice('A moment well spent. Welcome back.');
                setModal(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
function Navigation({
  section,
  onChange,
}: {
  section: string;
  onChange: (s: string) => void;
}) {
  const { setOpenMobile } = useSidebar();
  return (
    <nav aria-label="Main navigation">
      {NAV.map(({ name, icon: Icon }) => (
        <button
          key={name === 'Overview' ? 'Today' : name}
          className={`nav-item ${section === name ? 'active' : ''}`}
          aria-current={section === name ? 'page' : undefined}
          aria-label={name === 'Overview' ? 'Today' : name}
          title={name === 'Overview' ? 'Today' : name}
          onClick={() => {
            onChange(name);
            setOpenMobile(false);
          }}
        >
          <Icon size={18} strokeWidth={1.7} />
          <span className="nav-label">
            {name === 'Overview' ? 'Today' : name}
          </span>
          {section === name && <span className="nav-dot" />}
        </button>
      ))}
    </nav>
  );
}

function Metric({
  label,
  type,
  value,
  unit,
  note,
  data,
  onClick,
  action,
  completion,
}: {
  label: string;
  type: EntryType;
  value: string;
  unit: string;
  note: string;
  data: number[];
  onClick: () => void;
  action?: React.ReactNode;
  completion?: number;
}) {
  const Icon = ICONS[type];
  const max = Math.max(...data, 1);
  return (
    <section className={`metric-card ${TYPE_META[type].color}`}>
      <button
        className="metric-open"
        onClick={onClick}
        aria-label={`View ${TYPE_META[type].label.toLowerCase()} details`}
      >
        <div className="metric-label">
          <span>{label}</span>
          <Icon size={17} />
        </div>
        <div className="metric-value">
          {value}
          <span>{unit}</span>
        </div>
        {completion !== undefined && (
          <div
            className="metric-track"
            aria-label={`${label}: ${Math.round(completion)} percent of goal`}
          >
            <i style={{ width: `${Math.min(100, completion)}%` }} />
          </div>
        )}
        <div className="metric-bottom">
          <span>{note}</span>
          <svg
            className="sparkline"
            viewBox="0 0 100 42"
            aria-label={`${TYPE_META[type].label} over the past seven days`}
          >
            <polyline
              points={data
                .map((v, i) => `${i * 16.5},${40 - (v / max) * 36}`)
                .join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </button>
      {action}
    </section>
  );
}
function EntryRow({
  entry: e,
  onRemove,
}: {
  entry: Entry;
  onRemove?: () => void;
}) {
  const Icon = ICONS[e.type];
  return (
    <div className="rhythm-row">
      <div className={`rhythm-icon ${TYPE_META[e.type].color}`}>
        <Icon size={18} />
      </div>
      <div>
        <strong>{e.title}</strong>
        <span>
          {formatAmount(e.type, e.amount)}{' '}
          {e.type === 'activity'
            ? 'steps'
            : e.type === 'nutrition'
              ? 'kcal'
              : ''}{' '}
          · {e.sample ? 'Sample' : e.source ? SOURCE_NAMES[e.source] : 'Manual'}
        </span>
      </div>
      <time>{formatTime(e.time)}</time>
      {onRemove && (
        <button
          className="delete-entry"
          aria-label={`Remove ${e.title}`}
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}
function EmptyDay({ onLog }: { onLog: () => void }) {
  return (
    <div className="empty-day">
      <Leaf size={22} />
      <p>A fresh start for your day.</p>
      <span>Add your first entry whenever you’re ready.</span>
      <button className="text-link" onClick={onLog}>
        Log a little progress
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
function DetailCard({
  type,
  value,
  goal,
  entries,
  onLog,
}: {
  type: EntryType;
  value: number;
  goal: number;
  entries: Entry[];
  onLog: () => void;
}) {
  const Icon = ICONS[type];
  return (
    <section className={`detail-card ${TYPE_META[type].color}`}>
      <div className="detail-kicker">
        <Icon size={17} />
        {TYPE_META[type].label.toUpperCase()} AT A GLANCE
      </div>
      <div className="detail-main">
        <div>
          <span>
            {type === 'activity'
              ? 'A little further, every day'
              : type === 'nutrition'
                ? 'Good things, on your plate'
                : 'Rest is part of the rhythm'}
          </span>
          <div className="detail-value">
            {formatAmount(type, value)}
            <small>{type === 'sleep' ? '' : TYPE_META[type].unit}</small>
          </div>
          <p>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}{' '}
            recorded · {Math.round(progress(value, goal))}% of your goal
          </p>
        </div>
        <svg
          className="detail-ring"
          viewBox="0 0 160 160"
          aria-label={`${Math.round(progress(value, goal))} percent of goal`}
        >
          <circle
            cx="80"
            cy="80"
            r="65"
            fill="none"
            stroke="currentColor"
            strokeOpacity=".08"
            strokeWidth="7"
          />
          <circle
            cx="80"
            cy="80"
            r="65"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${(progress(value, goal) / 100) * 408.4} 408.4`}
            transform="rotate(-90 80 80)"
          />
          <text
            x="80"
            y="87"
            textAnchor="middle"
            fill="currentColor"
            fontSize="29"
          >
            {Math.round(progress(value, goal))}%
          </text>
        </svg>
      </div>
      <div className="detail-bottom">
        <span>
          Daily goal: {formatAmount(type, goal)}{' '}
          {type === 'sleep' ? '' : TYPE_META[type].unit}
        </span>
        <button className="text-link" onClick={onLog}>
          Log{' '}
          {type === 'nutrition'
            ? 'a meal'
            : type === 'sleep'
              ? 'your sleep'
              : 'some movement'}
          <Plus size={15} />
        </button>
      </div>
    </section>
  );
}
function WeekChart({
  data,
  selected,
  type,
  goal,
  onSelect,
}: {
  data: { day: string; value: number }[];
  selected: string;
  type: EntryType;
  goal: number;
  onSelect: (d: string) => void;
}) {
  const max =
    Math.ceil(
      Math.max(goal, ...data.map((d) => d.value), 1) /
        (type === 'sleep' ? 2 : 1000),
    ) * (type === 'sleep' ? 2 : 1000);
  const label = (v: number) => (v >= 1000 ? `${v / 1000}k` : String(v));
  return (
    <div className="bar-chart">
      <div className="chart-axis">
        <span>{label(max)}</span>
        <span>{label(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="bars">
        {data.map((d) => (
          <button
            className={`bar-column ${selected === d.day ? 'current' : ''}`}
            key={d.day}
            onClick={() => onSelect(d.day)}
            aria-label={`${d.day}: ${formatAmount(type, d.value)} ${type === 'sleep' ? '' : TYPE_META[type].unit}. Show this day.`}
          >
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  height: `${Math.max(d.value ? 2 : 0, (d.value / max) * 100)}%`,
                }}
              >
                <span>{formatAmount(type, d.value)}</span>
              </div>
            </div>
            <span>
              {new Date(`${d.day}T12:00:00`).toLocaleDateString('en-US', {
                weekday: 'narrow',
              })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
