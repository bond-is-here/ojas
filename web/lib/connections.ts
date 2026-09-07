import {
  TYPES,
  validDay,
  TYPE_META,
  type Entry,
  type EntryType,
  type Workspace,
} from './health.ts';
export type SourceId = 'apple-health' | 'whoop' | 'oura';
export type OAuthProvider = 'whoop' | 'oura';
export type SourceChoice = SourceId | 'auto' | 'manual';
export type SourcePreferences = Record<EntryType, SourceChoice>;
export const DEFAULT_SOURCE_PREFERENCES: SourcePreferences = {
  activity: 'auto',
  nutrition: 'auto',
  water: 'auto',
  sleep: 'auto',
};
export const SOURCE_NAMES: Record<SourceId, string> = {
  'apple-health': 'Apple Health',
  whoop: 'WHOOP',
  oura: 'Oura',
};
export const SOURCE_ORDER: SourceId[] = ['apple-health', 'oura', 'whoop'];
export type SyncedEntry = Entry & { source: SourceId; recordId: string };
export type ConnectionStatus = {
  provider: SourceId;
  status:
    | 'not_connected'
    | 'configured'
    | 'connected'
    | 'imported'
    | 'reconnect';
  lastSync: string | null;
  lastError: string | null;
  count: number;
  summary: Record<string, string | number> | null;
  configured: boolean;
  callbackUrl?: string;
};
export type ConnectionsData = {
  connections: ConnectionStatus[];
  entries: SyncedEntry[];
  preferences: SourcePreferences;
};
export function isOAuthProvider(p: string): p is OAuthProvider {
  return p === 'whoop' || p === 'oura';
}
export function validPreferences(input: unknown): input is SourcePreferences {
  if (!input || typeof input !== 'object') return false;
  return TYPES.every((t) =>
    ['auto', 'manual', ...SOURCE_ORDER].includes(
      (input as SourcePreferences)[t],
    ),
  );
}
export function mergeSourceEntries(
  workspace: Workspace,
  synced: SyncedEntry[],
  preferences: SourcePreferences,
): Workspace {
  const selected: SyncedEntry[] = [];
  const groups = new Map<string, SyncedEntry[]>();
  for (const e of synced) {
    const key = `${e.day}:${e.type}`;
    groups.set(key, [...(groups.get(key) || []), e]);
  }
  for (const group of groups.values()) {
    const choice = preferences[group[0].type];
    if (choice === 'manual') continue;
    const source =
      choice === 'auto'
        ? SOURCE_ORDER.find((p) => group.some((e) => e.source === p))
        : choice;
    selected.push(...group.filter((e) => e.source === source));
  }
  return { ...workspace, entries: [...workspace.entries, ...selected] };
}
export function validateImportedEntries(input: unknown): SyncedEntry[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 400)
    throw new Error('Import between 1 and 400 daily records at a time.');
  const ids = new Set<string>();
  return input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid import record.');
    const e = raw as Partial<SyncedEntry>;
    if (
      typeof e.recordId !== 'string' ||
      e.recordId.length > 100 ||
      ids.has(e.recordId) ||
      !validDay(e.day) ||
      typeof e.time !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time) ||
      !TYPES.includes(e.type as EntryType) ||
      typeof e.amount !== 'number' ||
      !Number.isFinite(e.amount) ||
      e.amount <= 0 ||
      e.amount > TYPE_META[e.type as EntryType].max ||
      typeof e.title !== 'string' ||
      !e.title.trim() ||
      e.title.length > 100
    )
      throw new Error('Some imported records are invalid.');
    if (e.recordId !== `${e.type}:${e.day}`)
      throw new Error('An imported daily record has an invalid identity.');
    ids.add(e.recordId);
    return {
      id: `apple-health:${e.recordId}`,
      recordId: e.recordId,
      source: 'apple-health',
      day: e.day,
      time: e.time,
      type: e.type as EntryType,
      amount: e.amount,
      title: e.title,
    };
  });
}
export function object(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}
export function number(input: unknown): number | null {
  return typeof input === 'number' && Number.isFinite(input) ? input : null;
}
function sourceEntry(
  provider: OAuthProvider,
  id: unknown,
  day: string,
  time: string,
  type: EntryType,
  amount: number,
  title: string,
): SyncedEntry | null {
  if (
    typeof id !== 'string' ||
    !id ||
    !validDay(day) ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount > TYPE_META[type].max
  )
    return null;
  return {
    id: `${provider}:${type}:${id}`,
    recordId: `${type}:${id}`,
    source: provider,
    day,
    time: /^\d{2}:\d{2}$/.test(time) ? time : '12:00',
    type,
    amount,
    title,
  };
}
export function whoopSleep(records: unknown[]): SyncedEntry[] {
  return records.flatMap((raw) => {
    const r = object(raw);
    if (r.score_state !== 'SCORED' || typeof r.end !== 'string') return [];
    const stage = object(object(r.score).stage_summary);
    const values = [
      stage.total_light_sleep_time_milli,
      stage.total_slow_wave_sleep_time_milli,
      stage.total_rem_sleep_time_milli,
    ].map(number);
    if (values.some((n) => n === null)) return [];
    const duration =
      values.reduce<number>((sum, n) => sum + (n || 0), 0) / 3600000;
    const offset =
      typeof r.timezone_offset === 'string' ? r.timezone_offset : '+00:00';
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
    if (!match) return [];
    const minutes =
      (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '-' ? -1 : 1);
    const date = new Date(Date.parse(r.end) + minutes * 60000);
    if (Number.isNaN(date.valueOf())) return [];
    const iso = date.toISOString();
    const e = sourceEntry(
      'whoop',
      r.id,
      iso.slice(0, 10),
      iso.slice(11, 16),
      'sleep',
      duration,
      r.nap ? 'WHOOP nap' : 'WHOOP sleep',
    );
    return e ? [e] : [];
  });
}
export function ouraEntries(
  activity: unknown[],
  sleep: unknown[],
): SyncedEntry[] {
  const steps = activity.flatMap((raw) => {
    const r = object(raw);
    const e = sourceEntry(
      'oura',
      r.id,
      String(r.day),
      '23:59',
      'activity',
      number(r.steps) ?? NaN,
      'Oura daily steps',
    );
    return e ? [e] : [];
  });
  const nights = sleep.flatMap((raw) => {
    const r = object(raw);
    const end = typeof r.bedtime_end === 'string' ? r.bedtime_end : '';
    const e = sourceEntry(
      'oura',
      r.id,
      String(r.day),
      end.slice(11, 16),
      'sleep',
      (number(r.total_sleep_duration) ?? NaN) / 3600,
      'Oura sleep',
    );
    return e ? [e] : [];
  });
  return [...steps, ...nights];
}
