'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkoutSaveError } from '@/lib/workout-save-queue';
import {
  DEFAULT_PLAN,
  type TrainingData,
  type Workout,
  type PlanPreferences,
} from '@/lib/training';
async function request<T>(
  day: string,
  body?: unknown,
  accountId?: string,
): Promise<T> {
  const response = await fetch(`/api/training?day=${encodeURIComponent(day)}`, {
    signal: AbortSignal.timeout(20000),
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(accountId ? { 'X-Ojas-Account': accountId } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
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
      const next = await request<TrainingData>(day, undefined, accountId);
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
