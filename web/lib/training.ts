import { dateKey, shiftDay, validDay } from './health.ts';

export type PlanGoal = 'balanced' | 'strength' | 'move';
export type Equipment = 'bodyweight' | 'dumbbells' | 'gym';
export type WorkoutSet = {
  id: string;
  reps: number;
  weight: number;
  done: boolean;
};
export type Exercise = { id: string; name: string; sets: WorkoutSet[] };
export type PlanPreferences = {
  goal: PlanGoal;
  equipment: Equipment;
  days: number;
  minutes: number;
  autoSync: boolean;
  exercises: Exercise[] | null;
};
export const DEFAULT_PLAN: PlanPreferences = {
  goal: 'balanced',
  equipment: 'bodyweight',
  days: 3,
  minutes: 30,
  autoSync: true,
  exercises: null,
};
export type Workout = {
  id: string;
  day: string;
  name: string;
  kind: 'strength' | 'walk' | 'mobility';
  status: 'active' | 'completed';
  startedAt: string;
  finishedAt: string | null;
  elapsedSeconds: number;
  runningSince: string | null;
  targetMinutes: number;
  exercises: Exercise[];
  note: string;
  version: number;
};
export type SourceWorkout = {
  id: string;
  source: 'whoop' | 'oura';
  title: string;
  day: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
};
export type TrainingData = {
  preferences: PlanPreferences;
  sessions: Workout[];
  imported: SourceWorkout[];
};
export function exercise(name: string, sets = 3, reps = 10): Exercise {
  return {
    id: crypto.randomUUID(),
    name,
    sets: Array.from({ length: sets }, () => ({
      id: crypto.randomUUID(),
      reps,
      weight: 0,
      done: false,
    })),
  };
}
export function defaultExercises(
  equipment: Equipment,
  minutes: number,
): Exercise[] {
  const names =
    equipment === 'bodyweight'
      ? ['Bodyweight squat', 'Incline push-up', 'Glute bridge', 'Dead bug']
      : equipment === 'dumbbells'
        ? [
            'Goblet squat',
            'Dumbbell floor press',
            'Dumbbell row',
            'Romanian deadlift',
          ]
        : ['Leg press', 'Chest press', 'Seated cable row', 'Leg curl'];
  return names.map((name) => exercise(name, minutes <= 20 ? 2 : 3, 10));
}
export function weekStart(day: string) {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return shiftDay(day, -(weekday === 0 ? 6 : weekday - 1));
}
export function weeklySessions(
  sessions: Workout[],
  imported: SourceWorkout[],
  day: string,
) {
  const start = weekStart(day),
    end = shiftDay(start, 6);
  const manual = sessions.filter(
    (s) => s.status === 'completed' && s.day >= start && s.day <= end,
  );
  const selected = dedupeWorkouts(imported).filter(
    (s) =>
      s.day >= start &&
      s.day <= end &&
      !manual.some((m) => overlapsWorkout(m, s)),
  );
  return { manual, imported: selected, count: manual.length + selected.length };
}
export function overlapsWorkout(
  a: Pick<Workout, 'startedAt' | 'finishedAt' | 'elapsedSeconds'>,
  b: SourceWorkout,
) {
  const start = Date.parse(a.startedAt),
    end = a.finishedAt
      ? Date.parse(a.finishedAt)
      : start + a.elapsedSeconds * 1000;
  const otherStart = Date.parse(b.startedAt),
    otherEnd = Date.parse(b.endedAt);
  const overlap = Math.max(
    0,
    Math.min(end, otherEnd) - Math.max(start, otherStart),
  );
  return (
    overlap > 0 &&
    overlap / Math.max(1, Math.min(end - start, otherEnd - otherStart)) >= 0.6
  );
}
export function dedupeWorkouts(input: SourceWorkout[]) {
  const chosen: SourceWorkout[] = [];
  // WHOOP is the stable tie-breaker when the same session appears on both devices.
  for (const s of [...input].sort((a, b) =>
    a.source === b.source
      ? a.startedAt.localeCompare(b.startedAt)
      : a.source === 'whoop'
        ? -1
        : 1,
  )) {
    if (
      !chosen.some(
        (c) =>
          c.source !== s.source &&
          overlapsWorkout(
            {
              startedAt: c.startedAt,
              finishedAt: c.endedAt,
              elapsedSeconds: c.durationSeconds,
            },
            s,
          ),
      )
    )
      chosen.push(s);
  }
  return chosen.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
export function suggestWorkout(
  preferences: PlanPreferences,
  sessions: Workout[],
  imported: SourceWorkout[],
  day: string,
) {
  const week = weeklySessions(sessions, imported, day);
  const yesterdayStrength = sessions.some(
    (s) =>
      s.day === shiftDay(day, -1) &&
      s.kind === 'strength' &&
      s.status === 'completed',
  );
  const kind: Workout['kind'] =
    week.count >= preferences.days
      ? 'mobility'
      : preferences.goal === 'move' ||
          yesterdayStrength ||
          (preferences.goal === 'balanced' && week.count % 2 === 1)
        ? 'walk'
        : 'strength';
  return {
    kind,
    name:
      kind === 'strength'
        ? 'Full-body strength'
        : kind === 'walk'
          ? 'A little fresh air'
          : 'Reset & stretch',
    minutes: kind === 'mobility' ? 10 : preferences.minutes,
    reason:
      week.count >= preferences.days
        ? 'Weekly target met. Make room to recover.'
        : yesterdayStrength
          ? 'A lighter day after your strength session.'
          : preferences.goal === 'move'
            ? 'An easy walk, at your own pace.'
            : 'A simple session built around your preferences.',
  };
}
export function startWorkout(
  preferences: PlanPreferences,
  suggestion: ReturnType<typeof suggestWorkout>,
  now = new Date(),
): Workout {
  const source =
    preferences.exercises ||
    defaultExercises(preferences.equipment, preferences.minutes);
  return {
    id: crypto.randomUUID(),
    day: dateKey(now),
    name: suggestion.name,
    kind: suggestion.kind,
    status: 'active',
    startedAt: now.toISOString(),
    finishedAt: null,
    elapsedSeconds: 0,
    runningSince: now.toISOString(),
    targetMinutes: suggestion.minutes,
    note: '',
    version: 0,
    exercises:
      suggestion.kind === 'strength'
        ? source.map((e) => ({
            ...e,
            id: crypto.randomUUID(),
            sets: e.sets.map((s) => ({
              ...s,
              id: crypto.randomUUID(),
              done: false,
            })),
          }))
        : [],
  };
}
export function elapsed(workout: Workout, now = Date.now()) {
  return (
    workout.elapsedSeconds +
    (workout.runningSince
      ? Math.max(0, Math.floor((now - Date.parse(workout.runningSince)) / 1000))
      : 0)
  );
}
function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function numberIn(v: unknown, low: number, high: number) {
  return typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
}
function uuid(v: unknown): v is string {
  return typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v);
}
function text(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}
function timestamp(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(v) &&
    Number.isFinite(Date.parse(v))
  );
}
export function validExercises(v: unknown): v is Exercise[] {
  return (
    Array.isArray(v) &&
    v.length <= 15 &&
    new Set(v.map((e) => (isObject(e) ? e.id : null))).size === v.length &&
    v.every(
      (e) =>
        isObject(e) &&
        uuid(e.id) &&
        text(e.name, 80) &&
        !!e.name.trim() &&
        Array.isArray(e.sets) &&
        e.sets.length >= 1 &&
        e.sets.length <= 12 &&
        new Set(e.sets.map((s) => (isObject(s) ? s.id : null))).size ===
          e.sets.length &&
        e.sets.every(
          (s) =>
            isObject(s) &&
            uuid(s.id) &&
            numberIn(s.reps, 1, 500) &&
            Number.isInteger(s.reps) &&
            numberIn(s.weight, 0, 1000) &&
            typeof s.done === 'boolean',
        ),
    )
  );
}
export function validatePlan(v: unknown): PlanPreferences {
  if (
    !isObject(v) ||
    !['balanced', 'strength', 'move'].includes(String(v.goal)) ||
    !['bodyweight', 'dumbbells', 'gym'].includes(String(v.equipment)) ||
    ![2, 3, 4, 5].includes(Number(v.days)) ||
    ![15, 20, 30, 45, 60].includes(Number(v.minutes)) ||
    typeof v.autoSync !== 'boolean' ||
    (v.exercises !== null &&
      (!validExercises(v.exercises) || !v.exercises.length))
  )
    throw new Error('Check your plan settings.');
  return {
    goal: v.goal as PlanGoal,
    equipment: v.equipment as Equipment,
    days: Number(v.days),
    minutes: Number(v.minutes),
    autoSync: v.autoSync,
    exercises: v.exercises as Exercise[] | null,
  };
}
export function validateWorkout(v: unknown): Workout {
  if (
    !isObject(v) ||
    !uuid(v.id) ||
    !validDay(v.day) ||
    v.day > shiftDay(dateKey(new Date()), 1) ||
    !text(v.name, 80) ||
    !v.name.trim() ||
    !['strength', 'walk', 'mobility'].includes(String(v.kind)) ||
    !['active', 'completed'].includes(String(v.status)) ||
    !timestamp(v.startedAt) ||
    (v.finishedAt !== null && !timestamp(v.finishedAt)) ||
    (v.runningSince !== null && !timestamp(v.runningSince)) ||
    !numberIn(v.elapsedSeconds, 0, 604800) ||
    !Number.isInteger(v.elapsedSeconds) ||
    !numberIn(v.targetMinutes, 1, 240) ||
    !validExercises(v.exercises) ||
    !text(v.note, 1000) ||
    !numberIn(v.version, 0, 1000000) ||
    !Number.isInteger(v.version)
  )
    throw new Error('Check your workout details.');
  if (v.status === 'completed' && (!v.finishedAt || v.runningSince !== null))
    throw new Error('Finish the timer before saving a completed workout.');
  if (
    (v.finishedAt &&
      Date.parse(v.finishedAt as string) < Date.parse(v.startedAt as string)) ||
    (v.runningSince &&
      Date.parse(v.runningSince as string) < Date.parse(v.startedAt as string))
  )
    throw new Error('Check the workout times.');
  return {
    id: v.id,
    day: v.day,
    name: v.name,
    kind: v.kind as Workout['kind'],
    status: v.status as Workout['status'],
    startedAt: v.startedAt as string,
    finishedAt: v.finishedAt as string | null,
    runningSince: v.runningSince as string | null,
    elapsedSeconds: v.elapsedSeconds as number,
    targetMinutes: v.targetMinutes as number,
    exercises: v.exercises as Exercise[],
    note: v.note,
    version: v.version as number,
  };
}
