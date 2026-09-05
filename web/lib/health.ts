export type EntryType = 'activity' | 'nutrition' | 'water' | 'sleep';
export type Entry = {
  id: string;
  day: string;
  time: string;
  type: EntryType;
  amount: number;
  title: string;
  sample?: boolean;
  source?: 'apple-health' | 'whoop' | 'oura';
};
export type Goals = Record<EntryType, number>;
export type Workspace = {
  version: 1;
  entries: Entry[];
  goals: Goals;
  demo: boolean;
  motion: boolean;
};
export const STORAGE_KEY = 'ojas.workspace.v1';
export const DEFAULT_GOALS: Goals = {
  activity: 8000,
  nutrition: 2200,
  water: 2500,
  sleep: 8,
};
export const DEFAULT_WORKSPACE: Workspace = {
  version: 1,
  entries: [],
  goals: DEFAULT_GOALS,
  demo: true,
  motion: true,
};
export const TYPE_META = {
  activity: {
    label: 'Activity',
    unit: 'steps',
    color: 'green',
    max: 200000,
    step: 1,
    placeholder: 'Morning walk',
    amount: 'Steps',
  },
  nutrition: {
    label: 'Nutrition',
    unit: 'kcal',
    color: 'peach',
    max: 20000,
    step: 1,
    placeholder: 'Breakfast, made simple',
    amount: 'Calories',
  },
  water: {
    label: 'Water',
    unit: 'mL',
    color: 'blue',
    max: 10000,
    step: 1,
    placeholder: 'A glass of water',
    amount: 'Water',
  },
  sleep: {
    label: 'Sleep',
    unit: 'hours',
    color: 'lilac',
    max: 24,
    step: 0.25,
    placeholder: 'A good night’s rest',
    amount: 'Hours slept',
  },
} as const;
export const TYPES = Object.keys(TYPE_META) as EntryType[];
export function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function shiftDay(day: string, offset: number) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + offset);
  return dateKey(d);
}
export function validDay(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T12:00:00`);
  return !Number.isNaN(d.valueOf()) && dateKey(d) === day;
}
export function validAmount(type: EntryType, amount: number) {
  return (
    Number.isFinite(amount) &&
    amount > 0 &&
    amount <= TYPE_META[type].max &&
    (type === 'sleep' ? Number.isInteger(amount * 4) : Number.isInteger(amount))
  );
}
export function parseWorkspace(raw: string): Workspace {
  const p: unknown = JSON.parse(raw);
  if (!p || typeof p !== 'object') throw new Error('Invalid workspace');
  const w = p as Partial<Workspace>;
  if (
    w.version !== 1 ||
    !Array.isArray(w.entries) ||
    typeof w.demo !== 'boolean' ||
    typeof w.motion !== 'boolean' ||
    !w.goals
  )
    throw new Error('Invalid workspace');
  for (const type of TYPES)
    if (!validAmount(type, w.goals[type])) throw new Error('Invalid goals');
  const ids = new Set<string>();
  for (const e of w.entries) {
    if (
      !e ||
      typeof e !== 'object' ||
      typeof e.id !== 'string' ||
      ids.has(e.id) ||
      !validDay(e.day) ||
      !TYPES.includes(e.type) ||
      !validAmount(e.type, e.amount) ||
      typeof e.title !== 'string' ||
      !e.title.trim() ||
      e.title.length > 100 ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)
    )
      throw new Error('Invalid entry');
    ids.add(e.id);
  }
  return {
    version: 1,
    demo: w.demo,
    motion: w.motion,
    goals: { ...w.goals },
    entries: w.entries.map(({ id, day, time, type, amount, title }) => ({
      id,
      day,
      time,
      type,
      amount,
      title,
    })),
  };
}
export function sampleEntries(day: string, today: string): Entry[] {
  if (day > today || day < shiftDay(today, -365)) return [];
  const days = Math.round(
    (new Date(`${today}T12:00:00`).valueOf() -
      new Date(`${day}T12:00:00`).valueOf()) /
      86400000,
  );
  const steps = [6420, 7380, 8940, 5840, 7650, 6280, 8110][days % 7];
  const calories = [1640, 2080, 2260, 1840, 2130, 2020, 1950][days % 7];
  const water = [1500, 2250, 2500, 1750, 2000, 2250, 2000][days % 7];
  const sleep = [7.5, 8, 7.25, 6.75, 8.25, 7, 7.75][days % 7];
  const data: [EntryType, number, string, string][] = [
    ['sleep', sleep, 'A good night’s rest', '07:00'],
    ['activity', 2840, 'Morning walk', '07:45'],
    ['nutrition', 420, 'Breakfast, made simple', '08:30'],
    ['water', water, 'Water throughout the day', '12:00'],
    ['nutrition', calories - 420, 'Lunch & afternoon snack', '13:00'],
    ['activity', steps - 2840, 'A little afternoon movement', '15:30'],
  ];
  return data.map(([type, amount, title, time], i) => ({
    id: `sample-${day}-${i}`,
    day,
    time,
    type,
    amount,
    title,
    sample: true,
  }));
}
export function entriesForDay(
  workspace: Workspace,
  day: string,
  today: string,
) {
  return [
    ...(workspace.demo ? sampleEntries(day, today) : []),
    ...workspace.entries.filter((e) => e.day === day),
  ].sort((a, b) => a.time.localeCompare(b.time));
}
export function totals(entries: Entry[]): Goals {
  const sum: Goals = { activity: 0, nutrition: 0, water: 0, sleep: 0 };
  const sourceDays = new Set(
    entries.filter((e) => e.source).map((e) => `${e.day}:${e.type}`),
  );
  for (const e of entries)
    if (e.source || !sourceDays.has(`${e.day}:${e.type}`))
      sum[e.type] += e.amount;
  return sum;
}
export function progress(amount: number, goal: number) {
  return Math.min(100, Math.max(0, (amount / goal) * 100));
}
export function balance(values: Goals, goals: Goals) {
  return Math.round(
    TYPES.reduce((sum, type) => sum + progress(values[type], goals[type]), 0) /
      TYPES.length,
  );
}
export function formatAmount(type: EntryType, amount: number) {
  if (type === 'sleep') {
    const minutes = Math.round(amount * 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h${m ? ` ${m}m` : ''}`;
  }
  if (type === 'water') return `${Number((amount / 1000).toFixed(2))} L`;
  return amount.toLocaleString('en-US');
}
export function formatTime(time: string) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
