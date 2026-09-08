import { validateWorkout, type Workout } from './training.ts';
import type { WorkoutQueueState } from './workout-save-queue.ts';

export type WorkoutRecovery = {
  schema: 1;
  accountId: string;
  latest: Workout;
  queue: WorkoutQueueState;
  duration: { value: string; original: string } | null;
  updatedAt: string;
};
export type RecoveryRecord = {
  key: string;
  raw: string;
  data: WorkoutRecovery;
};
export const recoveryPrefix = (accountId: string) =>
  `ojas.workout.v1:${encodeURIComponent(accountId)}:`;
export function parseRecovery(raw: string, accountId: string): WorkoutRecovery {
  if (raw.length > 250000)
    throw new Error('Workout recovery data is too large.');
  const data = JSON.parse(raw) as WorkoutRecovery;
  if (
    data.schema !== 1 ||
    data.accountId !== accountId ||
    !data.queue ||
    !Number.isInteger(data.queue.version) ||
    data.queue.version < 0 ||
    typeof data.queue.rejected !== 'boolean' ||
    !Number.isFinite(Date.parse(data.updatedAt))
  )
    throw new Error('This workout recovery copy could not be read.');
  const latest = validateWorkout(data.latest);
  const retry = data.queue.retry ? validateWorkout(data.queue.retry) : null;
  const pending = data.queue.pending
    ? validateWorkout(data.queue.pending)
    : null;
  if (
    [retry, pending].some((workout) => workout && workout.id !== latest.id) ||
    (data.duration &&
      (typeof data.duration.value !== 'string' ||
        typeof data.duration.original !== 'string' ||
        data.duration.value.length > 20 ||
        data.duration.original.length > 20))
  )
    throw new Error('This workout recovery copy does not match its session.');
  return {
    schema: 1,
    accountId,
    latest,
    queue: {
      version: data.queue.version,
      retry,
      pending,
      rejected: data.queue.rejected,
    },
    duration: data.duration,
    updatedAt: data.updatedAt,
  };
}
