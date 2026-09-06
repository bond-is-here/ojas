'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Dumbbell,
  Footprints,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
  Wind,
  X,
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
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  dedupeWorkouts,
  overlapsWorkout,
  defaultExercises,
  elapsed,
  exercise,
  startWorkout,
  suggestWorkout,
  weeklySessions,
  type Exercise,
  type PlanPreferences,
  type Workout,
} from '@/lib/training';
import { SOURCE_NAMES } from '@/lib/connections';
import type { TrainingController } from '@/hooks/use-training';

const KIND_ICON = { strength: Dumbbell, walk: Footprints, mobility: Wind };
function clock(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
export default function TrainingPanel({
  controller,
  day,
  compact = false,
}: {
  controller: TrainingController;
  day: string;
  compact?: boolean;
}) {
  const { data, loading, error, refresh, save, savePreferences } = controller;
  const [planOpen, setPlanOpen] = useState(false);
  const [selected, setSelected] = useState<Workout | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const starting = useRef<Workout | null>(null);
  const [actionError, setActionError] = useState('');
  const suggestion = suggestWorkout(
    data.preferences,
    data.sessions,
    data.imported,
    day,
  );
  const week = weeklySessions(data.sessions, data.imported, day);
  const importedHistory = dedupeWorkouts(data.imported).filter(
    (w) =>
      !data.sessions.some(
        (s) => s.status === 'completed' && overlapsWorkout(s, w),
      ),
  );
  const active = data.sessions.find((s) => s.status === 'active');
  const Icon = KIND_ICON[active?.kind || suggestion.kind];
  const begin = async () => {
    if (active) {
      setSelected(active);
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const next =
        starting.current || startWorkout(data.preferences, suggestion);
      const last = data.sessions
        .filter((s) => s.status === 'completed')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (!starting.current)
        next.exercises = next.exercises.map((e) => {
          const previous = last?.exercises.find(
            (p) => p.name.toLowerCase() === e.name.toLowerCase(),
          );
          return {
            ...e,
            sets: e.sets.map((s, i) => ({
              ...s,
              reps: previous?.sets[i]?.reps || s.reps,
              weight: previous?.sets[i]?.weight || s.weight,
            })),
          };
        });
      starting.current = next;
      setSelected(await save(next));
      starting.current = null;
    } catch (e) {
      const latest = await refresh().catch(() => null);
      const existing = latest?.sessions.find((s) => s.status === 'active');
      if (existing) {
        setSelected(existing);
        starting.current = null;
      } else
        setActionError(
          e instanceof Error ? e.message : 'Could not start your session.',
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={`training-panel ${compact ? 'training-compact' : ''}`}
      aria-label="Workout plan"
    >
      {(error || actionError) && (
        <div className="storage-message" role="alert">
          {actionError || error}
          <button
            onClick={() => {
              void refresh().catch(() => undefined);
            }}
            className="text-link"
          >
            Retry
          </button>
        </div>
      )}
      <div className="training-heading">
        <h2>{compact ? 'Up next' : 'Your plan'}</h2>
        <button
          className="icon-control"
          title="Customize your workout plan"
          aria-label="Customize your workout plan"
          disabled={loading || !!error}
          onClick={() => setPlanOpen(true)}
        >
          <Settings2 size={18} />
        </button>
      </div>
      <div className="workout-feature">
        <div className="workout-symbol">
          <Icon size={34} strokeWidth={1.4} />
          <span />
          <span />
        </div>
        <div className="workout-feature-copy">
          <div className="eyebrow">
            <span className="status-dot" />
            {active ? 'IN PROGRESS' : 'FOR YOU'}
          </div>
          <h3>{active?.name || suggestion.name}</h3>
          <div className="workout-metadata">
            <span>
              <Timer size={14} />
              {active?.targetMinutes || suggestion.minutes} min
            </span>
            <span>
              {active
                ? 'Pick up where you left off'
                : data.preferences.equipment === 'bodyweight'
                  ? 'No equipment'
                  : data.preferences.equipment === 'dumbbells'
                    ? 'Dumbbells'
                    : 'Gym'}
            </span>
          </div>
        </div>
        <button
          className="primary-button workout-start"
          disabled={loading || !!error || busy}
          onClick={() => {
            void begin();
          }}
        >
          {busy ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          {active ? 'Resume' : 'Start'}
        </button>
      </div>
      <div className="week-progress">
        <div>
          <span>This week</span>
          <strong>
            {week.count}
            <small> / {data.preferences.days} sessions</small>
          </strong>
        </div>
        <div
          className="week-dots"
          aria-label={`${week.count} of ${data.preferences.days} weekly sessions`}
        >
          {Array.from({ length: data.preferences.days }, (_, i) => (
            <span key={i} className={i < week.count ? 'complete' : ''}>
              {i < week.count ? <Check size={12} /> : null}
            </span>
          ))}
        </div>
      </div>
      {!compact && (
        <>
          <p className="plan-reason">
            <Sparkles size={16} />
            {suggestion.reason}
          </p>
          <div className="training-section-label">
            <h3>Session history</h3>
            <span>Last 60 days</span>
          </div>
          <div className="workout-history">
            {data.sessions
              .filter((s) => s.status === 'completed')
              .map((s) => {
                const SessionIcon = KIND_ICON[s.kind];
                return (
                  <button
                    className="workout-history-row"
                    key={s.id}
                    onClick={() => setSelected(s)}
                  >
                    <span className="history-mark">
                      <SessionIcon size={19} />
                    </span>
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {new Date(`${s.day}T12:00:00`).toLocaleDateString(
                          'en-US',
                          { month: 'short', day: 'numeric' },
                        )}{' '}
                        ·{' '}
                        {s.exercises.reduce(
                          (n, e) => n + e.sets.filter((x) => x.done).length,
                          0,
                        )}{' '}
                        sets logged
                      </small>
                    </span>
                    <b>{Math.max(1, Math.round(s.elapsedSeconds / 60))} min</b>
                    <ArrowUpRight size={16} />
                  </button>
                );
              })}
            {importedHistory.map((s) => (
              <div
                className="workout-history-row imported-workout"
                key={`${s.source}:${s.id}`}
              >
                <span className="history-mark">
                  <Footprints size={19} />
                </span>
                <span>
                  <strong>{s.title}</strong>
                  <small>
                    {new Date(`${s.day}T12:00:00`).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}{' '}
                    · {SOURCE_NAMES[s.source]}
                  </small>
                </span>
                <b>{Math.round(s.durationSeconds / 60)} min</b>
                <Check size={16} />
              </div>
            ))}
            {!data.sessions.some((s) => s.status === 'completed') &&
              !data.imported.length && (
                <div className="training-empty">
                  <Dumbbell size={24} />
                  <p>Your next session starts here.</p>
                  <span>Start the timer. Add sets only if you want to.</span>
                </div>
              )}
          </div>
        </>
      )}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="ojas-dialog plan-dialog">
          <DialogHeader>
            <DialogTitle>Make it yours</DialogTitle>
            <DialogDescription>
              A starting point you can change anytime.
            </DialogDescription>
          </DialogHeader>
          {planOpen && (
            <PlanEditor
              preferences={data.preferences}
              onSave={async (p) => {
                await savePreferences(p);
                setPlanOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      {selected && (
        <WorkoutEditor
          key={`${selected.id}:${editorEpoch}`}
          initial={selected}
          onSave={save}
          onClose={() => setSelected(null)}
          onReload={async () => {
            const latest = await refresh();
            const s = latest.sessions.find((s) => s.id === selected.id);
            if (!s) throw new Error('This session could not be found.');
            setSelected(s);
            setEditorEpoch((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

function Choice({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <Select
        value={value}
        onValueChange={(v) => {
          if (v) onChange(v);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>
            {values.find(([key]) => key === value)?.[1]}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {values.map(([key, name]) => (
            <SelectItem key={key} value={key}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function PlanEditor({
  preferences,
  onSave,
}: {
  preferences: PlanPreferences;
  onSave: (p: PlanPreferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => ({
    ...preferences,
    exercises:
      preferences.exercises ||
      defaultExercises(preferences.equipment, preferences.minutes),
  }));
  const [details, setDetails] = useState(!!preferences.exercises);
  const [customExercises, setCustomExercises] = useState(
    !!preferences.exercises,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const exercises = draft.exercises;
  return (
    <form
      className="health-form plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        void onSave({
          ...draft,
          exercises: customExercises ? draft.exercises : null,
        })
          .catch((e) =>
            setError(
              e instanceof Error ? e.message : 'Could not save your plan.',
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <div className="plan-goals" aria-label="Workout focus">
        {(
          [
            ['balanced', 'Balance', Sparkles],
            ['strength', 'Strength', Dumbbell],
            ['move', 'Move', Footprints],
          ] as const
        ).map(([goal, label, Icon]) => (
          <button
            key={goal}
            type="button"
            aria-pressed={draft.goal === goal}
            className={draft.goal === goal ? 'selected' : ''}
            onClick={() => setDraft({ ...draft, goal })}
          >
            <Icon size={23} />
            {label}
          </button>
        ))}
      </div>
      <div className="form-two">
        <Choice
          label="Sessions / week"
          value={String(draft.days)}
          values={[2, 3, 4, 5].map((n) => [String(n), String(n)])}
          onChange={(v) => setDraft({ ...draft, days: Number(v) })}
        />
        <Choice
          label="Session length"
          value={String(draft.minutes)}
          values={[15, 20, 30, 45, 60].map((n) => [String(n), `${n} minutes`])}
          onChange={(v) =>
            setDraft({
              ...draft,
              minutes: Number(v),
              exercises: customExercises
                ? draft.exercises
                : defaultExercises(draft.equipment, Number(v)),
            })
          }
        />
      </div>
      <Choice
        label="Equipment"
        value={draft.equipment}
        values={[
          ['bodyweight', 'Bodyweight'],
          ['dumbbells', 'Dumbbells'],
          ['gym', 'Gym'],
        ]}
        onChange={(v) =>
          setDraft({
            ...draft,
            equipment: v as PlanPreferences['equipment'],
            exercises: defaultExercises(
              v as PlanPreferences['equipment'],
              draft.minutes,
            ),
          })
        }
      />
      <div className="auto-sync-setting">
        <div>
          <strong>Sync when you open Ojas</strong>
          <span>Refresh connected wearables every 15 minutes while open.</span>
        </div>
        <Switch
          aria-label="Automatically sync connected wearables while Ojas is open"
          checked={draft.autoSync}
          onCheckedChange={(v) => setDraft({ ...draft, autoSync: v })}
        />
      </div>
      <button
        className="details-toggle"
        type="button"
        aria-expanded={details}
        onClick={() => setDetails(!details)}
      >
        <Settings2 size={16} />
        Exercises & sets
        <ChevronDown size={16} />
      </button>
      {details && (
        <>
          <p className="field-help">
            Set your own exercises, reps, and weight in kg. Zero means
            bodyweight.
          </p>
          <ExerciseEditor
            exercises={exercises}
            onChange={(exercises) => {
              setCustomExercises(true);
              setDraft({ ...draft, exercises });
            }}
            setup
          />
          <button
            type="button"
            className="text-link"
            onClick={() =>
              setDraft({
                ...draft,
                exercises: defaultExercises(draft.equipment, draft.minutes),
              })
            }
          >
            <RotateCcw size={14} />
            Reset exercises
          </button>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button full-width" disabled={busy}>
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Check size={16} />
        )}
        Save plan
      </button>
    </form>
  );
}

function WorkoutEditor({
  initial,
  onSave,
  onClose,
  onReload,
}: {
  initial: Workout;
  onSave: (s: Workout) => Promise<Workout>;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(initial);
  const [details, setDetails] = useState(initial.status === 'completed');
  const [status, setStatus] = useState('Saved');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [restUntil, setRestUntil] = useState(0);
  const [closing, setClosing] = useState(false);
  const latest = useRef(initial),
    version = useRef(initial.version),
    pending = useRef<Workout | null>(null),
    running = useRef<Promise<boolean> | null>(null),
    debounce = useRef<ReturnType<typeof setTimeout> | null>(null),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const leave = (e: BeforeUnloadEvent) => {
      if (pending.current || running.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      mounted.current = false;
      clearInterval(tick);
      if (debounce.current) clearTimeout(debounce.current);
      window.removeEventListener('beforeunload', leave);
    };
  }, []);
  const flush = (): Promise<boolean> => {
    if (debounce.current) clearTimeout(debounce.current);
    if (running.current) return running.current;
    if (pending.current) {
      setStatus('Saving…');
      setError('');
    }
    const job = async () => {
      while (pending.current) {
        const attempt = pending.current;
        pending.current = null;
        try {
          const saved = await onSave({ ...attempt, version: version.current });
          version.current = saved.version;
          if (!pending.current) {
            latest.current = saved;
            if (mounted.current) setDraft(saved);
          }
        } catch (e) {
          pending.current ||= attempt;
          if (mounted.current) {
            setError(e instanceof Error ? e.message : 'Could not save.');
            setStatus('Not saved');
          }
          return false;
        }
      }
      if (mounted.current) {
        setStatus('Saved');
        setError('');
      }
      return true;
    };
    running.current = job().finally(() => {
      running.current = null;
    });
    return running.current;
  };
  const change = (next: Workout, immediate = false) => {
    latest.current = next;
    setDraft(next);
    pending.current = next;
    setStatus('Saving…');
    setError('');
    if (debounce.current) clearTimeout(debounce.current);
    if (immediate) void flush();
    else
      debounce.current = setTimeout(() => {
        void flush();
      }, 650);
  };
  const close = async () => {
    setClosing(true);
    if (await flush()) onClose();
    else setClosing(false);
  };
  const finish = async () => {
    setClosing(true);
    const value = latest.current;
    const next = {
      ...value,
      status: 'completed' as const,
      elapsedSeconds: elapsed(value),
      runningSince: null,
      finishedAt: new Date().toISOString(),
    };
    latest.current = next;
    setDraft(next);
    pending.current = next;
    if (await flush()) onClose();
    else setClosing(false);
  };
  const pause = () => {
    const v = latest.current;
    change(
      {
        ...v,
        elapsedSeconds: elapsed(v),
        runningSince: v.runningSince ? null : new Date().toISOString(),
      },
      true,
    );
  };
  const done = draft.exercises.reduce(
      (n, e) => n + e.sets.filter((s) => s.done).length,
      0,
    ),
    total = draft.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !closing) void close();
      }}
    >
      <DialogContent
        className="ojas-dialog session-dialog"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{draft.name}</DialogTitle>
          <DialogDescription>
            {draft.status === 'completed'
              ? 'Your session, saved.'
              : 'The timer takes care of duration. Sets are optional.'}
          </DialogDescription>
        </DialogHeader>
        <button
          className="session-close icon-control"
          aria-label="Save and close workout"
          disabled={closing}
          onClick={() => {
            void close();
          }}
        >
          <X size={18} />
        </button>
        <div className="session-timer">
          <span>
            <Timer size={15} />
            {draft.status === 'completed' ? 'SESSION TIME' : 'ELAPSED'}
          </span>
          <strong>{clock(elapsed(draft, now))}</strong>
          {draft.status === 'active' && (
            <button
              className="icon-control"
              disabled={closing}
              onClick={pause}
              aria-label={
                draft.runningSince
                  ? 'Pause workout timer'
                  : 'Resume workout timer'
              }
            >
              {draft.runningSince ? <Pause size={22} /> : <Play size={22} />}
            </button>
          )}
        </div>
        {draft.kind === 'strength' && (
          <>
            <button
              className="details-toggle"
              aria-expanded={details}
              onClick={() => setDetails(!details)}
            >
              <Dumbbell size={16} />
              {details ? 'Exercise details' : 'Log exercises & sets'}
              <span>
                {done}/{total}
              </span>
              <ChevronDown size={16} />
            </button>
            <Progress
              value={total ? (done / total) * 100 : 0}
              aria-label="Workout sets completed"
            />
            {details && (
              <ExerciseEditor
                exercises={draft.exercises}
                onChange={(exercises, checked) => {
                  change({ ...latest.current, exercises }, checked);
                  if (checked) setRestUntil(Date.now() + 60000);
                }}
              />
            )}
          </>
        )}
        {draft.kind !== 'strength' && (
          <p className="session-guidance">
            {draft.kind === 'walk'
              ? 'Walk at a comfortable pace. Your connected device can add the activity summary later.'
              : 'Take a few easy stretches or a quiet recovery break. Keep the movement comfortable.'}
          </p>
        )}
        {restUntil > now && draft.status === 'active' && (
          <div className="rest-timer">
            <Wind size={17} />
            <span>Rest</span>
            <strong>{clock(Math.ceil((restUntil - now) / 1000))}</strong>
            <button onClick={() => setRestUntil(0)}>Skip</button>
          </div>
        )}
        <details className="workout-notes">
          <summary>Notes & time</summary>
          <label className="duration-adjust">
            Duration (minutes)
            <input
              type="number"
              min={1}
              max={1440}
              step={1}
              aria-label="Adjust workout duration in minutes"
              defaultValue={Math.max(1, Math.round(elapsed(draft) / 60))}
              onBlur={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1 && n <= 1440)
                  change({
                    ...latest.current,
                    elapsedSeconds: n * 60,
                    runningSince: latest.current.runningSince
                      ? new Date().toISOString()
                      : null,
                  });
              }}
            />
          </label>
          <textarea
            aria-label="Workout notes"
            maxLength={1000}
            placeholder="How did it feel?"
            value={draft.note}
            onChange={(e) =>
              change({ ...latest.current, note: e.target.value })
            }
          />
        </details>
        {error && (
          <div className="form-error" role="alert">
            {error}
            <div className="error-actions">
              <button
                onClick={() => {
                  void flush();
                }}
              >
                Retry save
              </button>
              <button
                onClick={() => {
                  void onReload().catch(() =>
                    setError('Could not reload. Your draft is still open.'),
                  );
                }}
              >
                Reload saved session
              </button>
            </div>
          </div>
        )}
        <div className="session-footer">
          <output>
            {status === 'Saved' ? (
              <Check size={13} />
            ) : (
              <LoaderCircle className={error ? '' : 'spin'} size={13} />
            )}{' '}
            {status}
          </output>
          <button
            className="primary-button"
            disabled={closing}
            onClick={() => {
              void (draft.status === 'completed' ? close() : finish());
            }}
          >
            {closing ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}{' '}
            {draft.status === 'completed' ? 'Done' : 'Finish session'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExerciseEditor({
  exercises,
  onChange,
  setup = false,
}: {
  exercises: Exercise[];
  onChange: (e: Exercise[], checked?: boolean) => void;
  setup?: boolean;
}) {
  const update = (id: string, value: Exercise, checked = false) =>
    onChange(
      exercises.map((e) => (e.id === id ? value : e)),
      checked,
    );
  return (
    <div className="exercise-editor">
      {exercises.map((e, index) => (
        <div className="exercise-block" key={e.id}>
          <div className="exercise-heading">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <input
              aria-label={`Exercise ${index + 1} name`}
              value={e.name}
              maxLength={80}
              onChange={(event) => {
                if (event.target.value.trim())
                  update(e.id, { ...e, name: event.target.value });
              }}
            />
            <button
              type="button"
              className="icon-control"
              aria-label={`Remove ${e.name}`}
              disabled={setup && exercises.length === 1}
              onClick={() => onChange(exercises.filter((x) => x.id !== e.id))}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <div className="sets-heading">
            <span>Set</span>
            <span>Reps</span>
            <span>kg</span>
            <span>{setup ? '' : 'Done'}</span>
            <span />
          </div>
          {e.sets.map((s, i) => (
            <div className={`set-row ${s.done ? 'set-done' : ''}`} key={s.id}>
              <span>{i + 1}</span>
              <input
                aria-label={`${e.name} set ${i + 1} reps`}
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                step={1}
                value={s.reps}
                onChange={(ev) => {
                  const reps = Number(ev.target.value);
                  if (Number.isInteger(reps) && reps >= 1 && reps <= 500)
                    update(e.id, {
                      ...e,
                      sets: e.sets.map((x) =>
                        x.id === s.id ? { ...x, reps } : x,
                      ),
                    });
                }}
              />
              <input
                aria-label={`${e.name} set ${i + 1} weight in kilograms`}
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step={0.5}
                value={s.weight}
                onChange={(ev) => {
                  const weight = Number(ev.target.value);
                  if (Number.isFinite(weight) && weight >= 0 && weight <= 1000)
                    update(e.id, {
                      ...e,
                      sets: e.sets.map((x) =>
                        x.id === s.id ? { ...x, weight } : x,
                      ),
                    });
                }}
              />
              {setup ? (
                <span />
              ) : (
                <Checkbox
                  aria-label={`Complete ${e.name} set ${i + 1}`}
                  checked={s.done}
                  onCheckedChange={(done) =>
                    update(
                      e.id,
                      {
                        ...e,
                        sets: e.sets.map((x) =>
                          x.id === s.id ? { ...x, done: !!done } : x,
                        ),
                      },
                      !!done,
                    )
                  }
                />
              )}
              <button
                type="button"
                className="icon-control"
                aria-label={`Remove ${e.name} set ${i + 1}`}
                disabled={e.sets.length === 1}
                onClick={() =>
                  update(e.id, {
                    ...e,
                    sets: e.sets.filter((x) => x.id !== s.id),
                  })
                }
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="add-set"
            disabled={e.sets.length >= 12}
            onClick={() =>
              update(e.id, {
                ...e,
                sets: [
                  ...e.sets,
                  {
                    ...e.sets[e.sets.length - 1],
                    id: crypto.randomUUID(),
                    done: false,
                  },
                ],
              })
            }
          >
            <Plus size={13} />
            Set
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary-button add-exercise"
        disabled={exercises.length >= 15}
        onClick={() => onChange([...exercises, exercise('New exercise')])}
      >
        <Plus size={16} />
        Exercise
      </button>
    </div>
  );
}
