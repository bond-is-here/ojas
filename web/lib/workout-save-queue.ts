import type { Workout } from './training.ts';
export type WorkoutQueueState = {
  version: number;
  pending: Workout | null;
  retry: Workout | null;
  rejected: boolean;
};

export class WorkoutSaveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Keep an uncertain request intact so it can be acknowledged before newer edits.
export class WorkoutSaveQueue {
  private version: number;
  private pending: Workout | null = null;
  private retry: Workout | null = null;
  private rejected = false;
  private running: Promise<Workout | undefined> | null = null;
  onChange: (state: WorkoutQueueState) => void = () => {};
  observe(callback: (state: WorkoutQueueState) => void) {
    this.onChange = callback;
  }
  constructor(version: number, recovered?: WorkoutQueueState) {
    this.version = recovered?.version ?? version;
    this.pending = recovered?.pending ?? null;
    this.retry = recovered?.retry ?? null;
    this.rejected = recovered?.rejected ?? false;
  }
  snapshot(): WorkoutQueueState {
    return structuredClone({
      version: this.version,
      pending: this.pending,
      retry: this.retry,
      rejected: this.rejected,
    });
  }
  get hasPending() {
    return !!(this.pending || this.retry || this.running);
  }
  enqueue(workout: Workout) {
    if (this.rejected) {
      this.retry = null;
      this.rejected = false;
    }
    this.pending = workout;
    this.onChange(this.snapshot());
  }
  flush(
    save: (workout: Workout) => Promise<Workout>,
  ): Promise<Workout | undefined> {
    if (this.running) return this.running;
    const run = async () => {
      let latest: Workout | undefined;
      while (this.retry || this.pending) {
        const attempt = this.retry || {
          ...this.pending!,
          version: this.version,
        };
        if (!this.retry) this.pending = null;
        this.retry = attempt;
        this.onChange(this.snapshot());
        try {
          latest = await save(attempt);
          this.version = latest.version;
          this.retry = null;
          this.rejected = false;
          this.onChange(this.snapshot());
        } catch (error) {
          this.retry = attempt;
          this.rejected =
            error instanceof WorkoutSaveError &&
            [400, 422].includes(error.status);
          this.onChange(this.snapshot());
          if (this.rejected && this.pending) {
            this.retry = null;
            continue;
          }
          throw error;
        }
      }
      return latest;
    };
    this.running = run().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
