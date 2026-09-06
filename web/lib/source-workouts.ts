import { object, type OAuthProvider } from './connections.ts';
import { validDay } from './health.ts';
import type { SourceWorkout } from './training.ts';
export function mapWorkouts(
  provider: OAuthProvider,
  records: unknown[],
): SourceWorkout[] {
  return records.flatMap((raw) => {
    const r = object(raw);
    const start = provider === 'whoop' ? r.start : r.start_datetime;
    const end = provider === 'whoop' ? r.end : r.end_datetime;
    if (
      typeof start !== 'string' ||
      typeof end !== 'string' ||
      typeof r.id !== 'string' ||
      !r.id ||
      r.id.length > 100
    )
      return [];
    const startMs = Date.parse(start),
      endMs = Date.parse(end);
    const durationSeconds = Math.round((endMs - startMs) / 1000);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      durationSeconds <= 0 ||
      durationSeconds > 86400
    )
      return [];
    let day = String(r.day);
    if (provider === 'whoop') {
      const offset =
        typeof r.timezone_offset === 'string' &&
        /^[-+]\d{2}:\d{2}$/.test(r.timezone_offset)
          ? r.timezone_offset
          : '+00:00';
      const minutes =
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) *
        (offset[0] === '-' ? -1 : 1);
      day = new Date(startMs + minutes * 60000).toISOString().slice(0, 10);
    }
    if (!validDay(day)) return [];
    const label = provider === 'whoop' ? r.sport_name : r.label || r.activity;
    const title =
      typeof label === 'string' && label.trim()
        ? label.replace(/_/g, ' ').slice(0, 80)
        : 'Workout';
    return [
      {
        id: r.id,
        source: provider,
        title,
        day,
        startedAt: new Date(startMs).toISOString(),
        endedAt: new Date(endMs).toISOString(),
        durationSeconds,
      },
    ];
  });
}
