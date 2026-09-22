/**
 * Decides *when* to save. It does not know how.
 *
 * Two timers run together, which is what makes the behaviour feel like Google
 * Docs rather than like a text editor with a save button:
 *
 *  - a **debounce**, so a burst of typing produces one save when the user
 *    pauses rather than one per keystroke;
 *  - a **maximum interval**, so someone who types continuously for two minutes
 *    still has their work persisted every few seconds instead of never.
 *
 * Kept free of React and of Drive so it can be tested with fake timers.
 */
export interface AutosaveSchedulerOptions {
  debounceMs: number;
  maxIntervalMs: number;
  /** Invoked when a save should be attempted. */
  onDue: () => void;
  /** Injectable for tests. */
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class AutosaveScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** When the current run of unsaved edits began. */
  private pendingSince: number | null = null;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly options: AutosaveSchedulerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle));
  }

  /** Called on every edit. */
  noteEdit(): void {
    const now = this.now();
    if (this.pendingSince === null) this.pendingSince = now;

    // The debounce would otherwise reset forever under continuous typing, so
    // the deadline is clamped to the max-interval cap measured from the first
    // unsaved edit.
    const debounceDeadline = now + this.options.debounceMs;
    const maxDeadline = this.pendingSince + this.options.maxIntervalMs;
    const deadline = Math.min(debounceDeadline, maxDeadline);
    const delay = Math.max(0, deadline - now);

    this.clearTimer();
    this.timer = this.schedule(() => {
      this.timer = null;
      this.options.onDue();
    }, delay);
  }

  /**
   * Called when a save completes successfully and nothing is left to write.
   *
   * Resets the max-interval clock. Deliberately *not* called after a failed
   * save or after a save that left the document dirty, so a long typing run
   * that keeps failing keeps being retried on the cap rather than drifting.
   */
  noteSaved(): void {
    this.pendingSince = null;
    this.clearTimer();
  }

  /** Suspends scheduling — used while a remote change is unresolved. */
  suspend(): void {
    this.clearTimer();
  }

  /** Runs the pending save immediately, if one is due. */
  flush(): void {
    if (this.timer === null) return;
    this.clearTimer();
    this.options.onDue();
  }

  dispose(): void {
    this.clearTimer();
    this.pendingSince = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }
}
