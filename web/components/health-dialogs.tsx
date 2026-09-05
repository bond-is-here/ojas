'use client';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  ArrowRight,
  Check,
  Droplets,
  Flame,
  Footprints,
  Moon,
  Pause,
  Play,
  Plus,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import VitalityHalo from '@/components/halo-loader';
import {
  formatAmount,
  TYPE_META,
  TYPES,
  validAmount,
  validDay,
  type Entry,
  type EntryType,
  type Workspace,
} from '@/lib/health';
const ICONS = {
  activity: Footprints,
  nutrition: Flame,
  water: Droplets,
  sleep: Moon,
};
export function LogForm({
  type: initialType,
  day,
  today,
  onSave,
}: {
  type: EntryType;
  day: string;
  today: string;
  onSave: (e: Entry) => void;
}) {
  const [type, setType] = useState(initialType);
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [entryDay, setEntryDay] = useState(day);
  const [time, setTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });
  const [error, setError] = useState('');
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const n = Number(amount);
    if (!validDay(entryDay) || entryDay > today) {
      setError('Choose today or a date in the past.');
      return;
    }
    if (!validAmount(type, n)) {
      setError(
        `Enter ${type === 'sleep' ? 'hours in 15-minute increments' : 'a whole number'} between ${TYPE_META[type].step} and ${TYPE_META[type].max.toLocaleString()}.`,
      );
      return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setError('Choose a valid time.');
      return;
    }
    onSave({
      id: crypto.randomUUID(),
      type,
      amount: n,
      title: title.trim() || TYPE_META[type].placeholder,
      day: entryDay,
      time,
    });
  };
  return (
    <form className="health-form" onSubmit={submit}>
      <Tabs
        value={type}
        onValueChange={(value) => {
          setType(value as EntryType);
          setAmount('');
          setTitle('');
          setError('');
        }}
      >
        <TabsList className="log-tabs" aria-label="Entry type">
          {TYPES.map((t) => {
            const Icon = ICONS[t];
            return (
              <TabsTrigger key={t} value={t}>
                <Icon size={15} />
                {TYPE_META[t].label}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {TYPES.map((t) => (
          <TabsContent key={t} value={t}>
            <div className={`entry-type-note ${TYPE_META[t].color}`}>
              {t === 'activity'
                ? 'Every bit of movement belongs here.'
                : t === 'nutrition'
                  ? 'A meal, a snack, a moment of nourishment.'
                  : t === 'water'
                    ? 'Make a little space to hydrate.'
                    : 'Last night’s sleep, or a little afternoon rest.'}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      <div className="field">
        <label htmlFor="entry-amount">
          {TYPE_META[type].amount}
          <span>{TYPE_META[type].unit}</span>
        </label>
        <input
          id="entry-amount"
          type="number"
          required
          min={TYPE_META[type].step}
          max={TYPE_META[type].max}
          step={TYPE_META[type].step}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={
            type === 'sleep'
              ? '7.5'
              : type === 'water'
                ? '250'
                : type === 'activity'
                  ? '2,000'
                  : '420'
          }
        />
        {type === 'water' && (
          <div className="water-presets">
            {[250, 500, 750].map((n) => (
              <button
                className={amount === String(n) ? 'selected' : ''}
                type="button"
                key={n}
                onClick={() => setAmount(String(n))}
              >
                {n} mL
              </button>
            ))}
          </div>
        )}
        {type === 'sleep' && (
          <span className="field-help">
            Use 7.5 for 7 hours and 30 minutes.
          </span>
        )}
      </div>
      <div className="field">
        <label htmlFor="entry-title">
          A little context<span>Optional</span>
        </label>
        <input
          id="entry-title"
          type="text"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={TYPE_META[type].placeholder}
        />
      </div>
      <div className="field-pair">
        <div className="field">
          <label htmlFor="entry-date">Date</label>
          <input
            id="entry-date"
            type="date"
            required
            max={today}
            value={entryDay}
            onChange={(e) => setEntryDay(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="entry-time">Time</label>
          <input
            id="entry-time"
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-bottom">
        <span>Saved only in this browser.</span>
        <button className="primary-button" type="submit">
          <Plus size={16} />
          Save entry
        </button>
      </div>
    </form>
  );
}
export function PreferencesForm({
  workspace,
  onSave,
}: {
  workspace: Workspace;
  onSave: (w: Pick<Workspace, 'goals' | 'demo' | 'motion'>) => void;
}) {
  const [goals, setGoals] = useState(workspace.goals);
  const [demo, setDemo] = useState(workspace.demo);
  const [motion, setMotion] = useState(workspace.motion);
  const [error, setError] = useState('');
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    for (const t of TYPES)
      if (!validAmount(t, goals[t])) {
        setError(
          `Set a valid ${TYPE_META[t].label.toLowerCase()} goal, up to ${formatAmount(t, TYPE_META[t].max)}.`,
        );
        return;
      }
    onSave({ goals, demo, motion });
  };
  return (
    <form className="health-form" onSubmit={submit}>
      <div className="preferences-goals">
        {TYPES.map((t) => (
          <div className="field" key={t}>
            <label htmlFor={`goal-${t}`}>
              {TYPE_META[t].label}
              <span>{TYPE_META[t].unit} / day</span>
            </label>
            <input
              id={`goal-${t}`}
              required
              type="number"
              min={TYPE_META[t].step}
              max={TYPE_META[t].max}
              step={TYPE_META[t].step}
              value={goals[t] || ''}
              onChange={(e) =>
                setGoals({ ...goals, [t]: Number(e.target.value) })
              }
            />
          </div>
        ))}
      </div>
      <p className="preferences-caption">
        These are personal targets. Adjust them to suit your routine.
      </p>
      <div className="preference-toggle">
        <div>
          <label htmlFor="show-demo">Show sample data</label>
          <p>
            Turn off to start with your own entries. You can switch back
            anytime.
          </p>
        </div>
        <Switch id="show-demo" checked={demo} onCheckedChange={setDemo} />
      </div>
      <div className="preference-toggle">
        <div>
          <label htmlFor="show-motion">A little motion</label>
          <p>Let your vitality halo move with you.</p>
        </div>
        <Switch id="show-motion" checked={motion} onCheckedChange={setMotion} />
      </div>
      <div className="local-info">
        <span className="status-dot" />
        <p>
          Manual entries and goals stay in this browser. Connected-source
          history is saved privately to your Ojas account.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-button full-width" type="submit">
        <Check size={16} />
        Save preferences
      </button>
    </form>
  );
}
export function BreathingMoment({
  motion,
  onFinish,
}: {
  motion: boolean;
  onFinish: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const elapsedRef = useRef(0);
  const done = elapsed >= 64;
  useEffect(() => {
    if (!running) return;
    const start = performance.now() - elapsedRef.current * 1000;
    const timer = setInterval(() => {
      const seconds = Math.min(64, (performance.now() - start) / 1000);
      elapsedRef.current = seconds;
      setElapsed(seconds);
      if (seconds >= 64) setRunning(false);
    }, 100);
    return () => clearInterval(timer);
  }, [running]);
  const phase = elapsed % 8 < 4 ? 'Breathe in' : 'Breathe out';
  return (
    <div className="breathing-content">
      <div className="breathing-visual">
        <VitalityHalo breathing={running} paused={!motion || !running} />
        <div className="breathing-center">
          <span>
            {done
              ? 'A little lighter'
              : running
                ? phase
                : elapsed
                  ? 'Take your time'
                  : 'Just be here'}
          </span>
          <small>
            {done
              ? 'A MOMENT WELL SPENT'
              : running
                ? `${Math.ceil(4 - (elapsed % 4))} seconds`
                : 'AT YOUR OWN PACE'}
          </small>
        </div>
      </div>
      <p>
        {done
          ? 'Carry a little of this calm into your day.'
          : 'Breathe in for 4 seconds, then out for 4. Keep it comfortable.'}
      </p>
      <div className="breathing-progress">
        <Progress
          value={(elapsed / 64) * 100}
          aria-label="Breathing session progress"
        />
        <span>{Math.floor(elapsed)} / 64 seconds</span>
      </div>
      {done ? (
        <button className="primary-button" onClick={onFinish}>
          Back to my day
          <ArrowRight size={16} />
        </button>
      ) : (
        <button className="primary-button" onClick={() => setRunning(!running)}>
          {running ? <Pause size={15} /> : <Play size={15} />}{' '}
          {running ? 'Pause' : elapsed ? 'Continue' : 'Begin a moment'}
        </button>
      )}
      <span className="breathing-footnote">
        8 easy breaths. No rush, no pressure.
      </span>
    </div>
  );
}
