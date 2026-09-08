import type { Workout } from './training.ts';

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
  constructor(version: number) {
    this.version = version;
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
        try {
          latest = await save(attempt);
          this.version = latest.version;
          this.retry = null;
          this.rejected = false;
        } catch (error) {
          this.retry = attempt;
          this.rejected =
            error instanceof WorkoutSaveError &&
            [400, 422].includes(error.status);
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
