import {
  DEFAULT_PLAN,
  validatePlan,
  validateWorkout,
  type Workout,
  type SourceWorkout,
} from '../lib/training.ts';
import { shiftDay } from '../lib/health.ts';
import { database, ApiError } from './runtime';

export async function getTraining(user: string, day: string) {
  const db = database();
  const result = await db.batch([
    db
      .prepare('SELECT preferences FROM training_preferences WHERE user_id=?')
      .bind(user),
    db
      .prepare(
        "SELECT payload FROM workout_sessions WHERE user_id=? AND (day>=? AND day<=? OR status='active') ORDER BY day DESC LIMIT 200",
      )
      .bind(user, shiftDay(day, -60), day),
    db
      .prepare(
        'SELECT payload FROM source_workouts WHERE user_id=? AND day>=? AND day<=? ORDER BY day DESC LIMIT 300',
      )
      .bind(user, shiftDay(day, -60), day),
  ]);
  const stored = result[0].results[0] as { preferences: string } | undefined;
  return {
    preferences: stored
      ? validatePlan(JSON.parse(stored.preferences))
      : DEFAULT_PLAN,
    sessions: result[1].results.map(
      (r) => JSON.parse(String((r as { payload: string }).payload)) as Workout,
    ),
    imported: result[2].results.map(
      (r) =>
        JSON.parse(String((r as { payload: string }).payload)) as SourceWorkout,
    ),
  };
}
export async function savePlan(user: string, input: unknown) {
  let preferences;
  try {
    preferences = validatePlan(input);
  } catch {
    throw new ApiError('Check your plan settings.');
  }
  await database()
    .prepare(
      'INSERT INTO training_preferences(user_id,preferences) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET preferences=excluded.preferences',
    )
    .bind(user, JSON.stringify(preferences))
    .run();
  return preferences;
}
export async function saveWorkout(user: string, input: unknown) {
  let workout;
  try {
    workout = validateWorkout(input);
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Invalid workout.');
  }
  const version = workout.version;
  const next = { ...workout, version: version + 1 };
  const db = database();
  const result =
    version === 0
      ? await db
          .prepare(
            "INSERT INTO workout_sessions(user_id,id,day,status,version,payload) SELECT ?,?,?,?,?,? WHERE (? <> 'active' OR NOT EXISTS(SELECT 1 FROM workout_sessions WHERE user_id=? AND status='active')) ON CONFLICT(user_id,id) DO NOTHING",
          )
          .bind(
            user,
            next.id,
            next.day,
            next.status,
            next.version,
            JSON.stringify(next),
            next.status,
            user,
          )
          .run()
      : await db
          .prepare(
            'UPDATE workout_sessions SET day=?,status=?,version=?,payload=? WHERE user_id=? AND id=? AND version=?',
          )
          .bind(
            next.day,
            next.status,
            next.version,
            JSON.stringify(next),
            user,
            next.id,
            version,
          )
          .run();
  if (!result.meta.changes) {
    if (version === 0) {
      const previous = await db
        .prepare(
          'SELECT payload FROM workout_sessions WHERE user_id=? AND id=?',
        )
        .bind(user, next.id)
        .first<{ payload: string }>();
      if (previous) {
        const saved = validateWorkout(JSON.parse(previous.payload));
        if (
          saved.version === 1 &&
          JSON.stringify({ ...saved, version: 0 }) === JSON.stringify(workout)
        )
          return saved;
      }
      throw new ApiError(
        'A session is already in progress. Reload your plan to resume it.',
        409,
      );
    }
    throw new ApiError(
      'This workout changed in another tab. Reload its latest version before editing.',
      409,
    );
  }
  return next;
}
