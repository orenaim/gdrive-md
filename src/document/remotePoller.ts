/**
 * Watches Drive for changes made outside this session.
 *
 * V0 polls rather than subscribing. Drive's push notifications need a
 * publicly reachable HTTPS endpoint to receive webhooks, which means a
 * backend, and this app deliberately does not have one. Polling `files.get`
 * for a handful of metadata fields is a small request, and at one every three
 * seconds it stays far inside Drive's per-user quota.
 *
 * The poller only *notices*; deciding what a change means is the session's
 * job.
 */
export interface RemotePollerOptions {
  activeIntervalMs: number;
  hiddenIntervalMs: number;
  /**
   * Performs one check. Resolving is enough — the poller does not inspect the
   * result. Rejections are swallowed: a failed poll is not worth surfacing,
   * because the next one is seconds away and a genuine outage will show up on
   * the next save attempt instead.
   */
  check: () => Promise<void>;
  /** Injectable for tests. */
  isHidden?: () => boolean;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void;
}

export class RemotePoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inFlight = false;
  private readonly schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly isHidden: () => boolean;
  private readonly onVisibilityChange = () => {
    if (!this.running) return;
    // Coming back to the tab is the moment a stale view is most likely and
    // most jarring, so check immediately rather than waiting out the timer.
    if (!this.isHidden()) void this.tick();
    else this.rearm();
  };

  constructor(private readonly options: RemotePollerOptions) {
    this.schedule = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.clearTimeout ?? ((handle) => clearTimeout(handle));
    this.isHidden =
      options.isHidden ?? (() => typeof document !== 'undefined' && document.hidden);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.rearm();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /** Checks right now, then resumes the normal cadence. */
  async pollNow(): Promise<void> {
    await this.tick();
  }

  private rearm(): void {
    if (!this.running) return;
    if (this.timer !== null) this.cancel(this.timer);
    const interval = this.isHidden()
      ? this.options.hiddenIntervalMs
      : this.options.activeIntervalMs;
    this.timer = this.schedule(() => void this.tick(), interval);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    // Never let checks pile up behind a slow response.
    if (this.inFlight) {
      this.rearm();
      return;
    }
    this.inFlight = true;
    try {
      await this.options.check();
    } catch {
      // Deliberately silent — see `check` above.
    } finally {
      this.inFlight = false;
      this.rearm();
    }
  }
}
