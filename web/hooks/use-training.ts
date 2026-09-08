'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkoutSaveError } from '@/lib/workout-save-queue';
import { ClientRequestError, requestJSON } from '@/lib/client-request';
import {
  DEFAULT_PLAN,
  type TrainingData,
  type Workout,
  type PlanPreferences,
  validatePlan,
  validateWorkout,
} from '@/lib/training';

function sameCanonicalWorkout(submitted: unknown, saved: unknown) {
  try {
    const expected = validateWorkout(submitted);
    const actual = validateWorkout(saved);
    return (
      actual.id === expected.id &&
      actual.version === expected.version + 1 &&
      JSON.stringify(actual) ===
        JSON.stringify({ ...expected, version: expected.version + 1 })
    );
  } catch {
    return false;
  }
}
function sameCanonicalPlan(submitted: unknown, saved: unknown) {
  try {
    return (
      JSON.stringify(validatePlan(saved)) ===
      JSON.stringify(validatePlan(submitted))
    );
  } catch {
    return false;
  }
}
function isTrainingData(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const value = data as {
    preferences?: unknown;
    sessions?: unknown;
    imported?: unknown;
  };
  if (!Array.isArray(value.sessions) || !Array.isArray(value.imported))
    return false;
  try {
    validatePlan(value.preferences);
    value.sessions.forEach(validateWorkout);
    return value.imported.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        return false;
      const workout = item as Record<string, unknown>;
      return (
        typeof workout.id === 'string' &&
        (workout.source === 'whoop' || workout.source === 'oura') &&
        typeof workout.title === 'string' &&
        typeof workout.day === 'string' &&
        typeof workout.startedAt === 'string' &&
        typeof workout.endedAt === 'string' &&
        typeof workout.durationSeconds === 'number' &&
        Number.isFinite(workout.durationSeconds) &&
        workout.durationSeconds >= 0
      );
    });
  } catch {
    return false;
  }
}
async function request<T>(
  day: string,
  body?: unknown,
  accountId?: string,
  validate?: (data: unknown) => boolean,
): Promise<T> {
  try {
    return await requestJSON<T>(
      `/api/training?day=${encodeURIComponent(day)}`,
      {
        method: body ? 'POST' : 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          ...(accountId ? { 'X-Ojas-Account': accountId } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      20000,
      validate,
    );
  } catch (error) {
    if (error instanceof ClientRequestError)
      throw new WorkoutSaveError(error.message, error.status);
    throw error;
  }
}
export function useTraining(day: string, accountId?: string) {
  const [data, setData] = useState<TrainingData>({
    preferences: DEFAULT_PLAN,
    sessions: [],
    imported: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await request<TrainingData>(
        day,
        undefined,
        accountId,
        isTrainingData,
      );
      if (generation.current === current) {
        setData(next);
        setError('');
      }
      return next;
    } catch (e) {
      if (generation.current === current)
        setError(e instanceof Error ? e.message : 'Could not load your plan.');
      throw e;
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [day, accountId]);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  /* oxlint-disable react/react-compiler -- Load account data after hydration. */
  useEffect(() => {
    void refresh().catch(() => undefined);
    return invalidate;
  }, [refresh, invalidate]);
  /* oxlint-enable react/react-compiler */
  const save = useCallback(
    async (workout: Workout) => {
      const result = await request<{ workout: Workout }>(
        day,
        {
          action: 'workout',
          workout,
        },
        accountId,
        (data) =>
          !!data &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          sameCanonicalWorkout(
            workout,
            (data as { workout?: unknown }).workout,
          ),
      );
      ++generation.current;
      setData((d) => ({
        ...d,
        sessions: [
          result.workout,
          ...d.sessions.filter((s) => s.id !== workout.id),
        ],
      }));
      if (loading) void refresh().catch(() => undefined);
      return result.workout;
    },
    [day, accountId, loading, refresh],
  );
  const savePreferences = useCallback(
    async (preferences: PlanPreferences) => {
      const result = await request<{ preferences: PlanPreferences }>(
        day,
        {
          action: 'plan',
          preferences,
        },
        accountId,
        (data) =>
          !!data &&
          typeof data === 'object' &&
          !Array.isArray(data) &&
          sameCanonicalPlan(
            preferences,
            (data as { preferences?: unknown }).preferences,
          ),
      );
      ++generation.current;
      setData((d) => ({ ...d, preferences: result.preferences }));
    },
    [day, accountId],
  );
  const removeSourceHistory = useCallback(
    (source: string) => {
      ++generation.current;
      setData((d) => ({
        ...d,
        imported: d.imported.filter((w) => w.source !== source),
      }));
      void refresh().catch(() => undefined);
    },
    [refresh],
  );
  return {
    accountId,
    data,
    error,
    loading,
    refresh,
    save,
    savePreferences,
    removeSourceHistory,
  };
}
export type TrainingController = ReturnType<typeof useTraining>;
