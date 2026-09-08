'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkoutSaveError } from '@/lib/workout-save-queue';
import {
  DEFAULT_PLAN,
  type TrainingData,
  type Workout,
  type PlanPreferences,
} from '@/lib/training';
async function request<T>(day: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/training?day=${encodeURIComponent(day)}`, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new WorkoutSaveError(
      data.error || 'Your workout could not be saved. Try again.',
      response.status,
    );
  return data;
}
export function useTraining(day: string) {
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
      const next = await request<TrainingData>(day);
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
  }, [day]);
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
      const result = await request<{ workout: Workout }>(day, {
        action: 'workout',
        workout,
      });
      ++generation.current;
      setData((d) => ({
        ...d,
        sessions: [
          result.workout,
          ...d.sessions.filter((s) => s.id !== workout.id),
        ],
      }));
      return result.workout;
    },
    [day],
  );
  const savePreferences = useCallback(
    async (preferences: PlanPreferences) => {
      const result = await request<{ preferences: PlanPreferences }>(day, {
        action: 'plan',
        preferences,
      });
      ++generation.current;
      setData((d) => ({ ...d, preferences: result.preferences }));
    },
    [day],
  );
  const removeSourceHistory = useCallback((source: string) => {
    ++generation.current;
    setData((d) => ({
      ...d,
      imported: d.imported.filter((w) => w.source !== source),
    }));
  }, []);
  return {
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
