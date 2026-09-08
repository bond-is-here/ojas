'use client';
import { useRef, useState, type SubmitEvent } from 'react';
import {
  ArrowUp,
  Check,
  Droplets,
  Footprints,
  Flame,
  Moon,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { parseQuickLog, recentCaptures, type Capture } from '@/lib/quick-log';
import { formatAmount, type Entry, type EntryType } from '@/lib/health';
const icons = {
  water: Droplets,
  activity: Footprints,
  nutrition: Flame,
  sleep: Moon,
};
export default function QuickCapture({
  entries,
  day,
  enabled,
  onSave,
  onDetails,
}: {
  entries: Entry[];
  day: string;
  enabled: boolean;
  onSave: (e: Entry) => Promise<void>;
  onDetails: (type: EntryType) => void;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<Entry | null>(null);
  const capture = parseQuickLog(input);
  const save = async (value: Capture) => {
    if (!enabled || busy) return;
    const now = new Date();
    const previous = attempt.current;
    const entry =
      previous &&
      previous.day === day &&
      previous.type === value.type &&
      previous.amount === value.amount &&
      previous.title === value.title
        ? previous
        : {
            ...value,
            id: crypto.randomUUID(),
            day,
            time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
          };
    attempt.current = entry;
    setBusy(true);
    try {
      await onSave(entry);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Your entry could not be saved.',
      );
      return;
    } finally {
      setBusy(false);
    }
    attempt.current = null;
    setInput('');
    setError('');
    setSuccess(`${formatAmount(value.type, value.amount)} saved`);
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (capture) void save(capture);
    else
      setError(
        'Include one amount and unit, like “lunch 520 kcal”, “water 500 ml”, “sleep 7 h 30 min”, or “4k steps”.',
      );
  };
  return (
    <section className="quick-capture" aria-label="Quick log">
      <form className="capture-bar" onSubmit={submit}>
        <Sparkles size={20} aria-hidden="true" />
        <input
          aria-label="Quick log: enter one amount and unit"
          placeholder="Water 500 ml, lunch 520 kcal…"
          value={input}
          maxLength={160}
          disabled={busy}
          onChange={(e) => {
            setInput(e.target.value);
            setError('');
            setSuccess('');
          }}
        />
        <button
          className="capture-details icon-control"
          type="button"
          onClick={() => onDetails(capture?.type || 'nutrition')}
          title="Detailed entry"
          aria-label="Open detailed entry"
        >
          <SlidersHorizontal size={18} />
        </button>
        <button
          className="capture-submit"
          disabled={!enabled || busy || !input.trim()}
          aria-label={
            capture
              ? `Save ${formatAmount(capture.type, capture.amount)}`
              : 'Read quick entry'
          }
        >
          <ArrowUp size={19} />
        </button>
      </form>
      {capture && (
        <output className="capture-preview">
          <Check size={14} />
          {formatAmount(capture.type, capture.amount)} ·{' '}
          {capture.type === 'activity'
            ? 'Movement'
            : capture.type === 'nutrition'
              ? 'Food'
              : capture.type === 'water'
                ? 'Water'
                : 'Sleep'}
          <span>Enter to save</span>
        </output>
      )}
      <div className="capture-presets">
        {[250, 500].map((amount) => (
          <button
            key={amount}
            disabled={!enabled || busy}
            onClick={() => {
              void save({ type: 'water', amount, title: 'Water' });
            }}
          >
            <Droplets size={15} />
            <span>+{amount} ml</span>
          </button>
        ))}
        {recentCaptures(entries)
          .slice(0, 2)
          .map((e) => {
            const Icon = icons[e.type];
            return (
              <button
                key={`${e.type}:${e.title}:${e.amount}`}
                className="repeat-chip"
                title={`Repeat ${e.title}: ${formatAmount(e.type, e.amount)}`}
                disabled={!enabled || busy}
                onClick={() => {
                  void save(e);
                }}
              >
                <Icon size={15} />
                <span>{e.title}</span>
                <RotateCcw size={12} />
              </button>
            );
          })}
        <output className="capture-status">
          {success && (
            <>
              <Check size={13} />
              {success}
            </>
          )}
        </output>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
