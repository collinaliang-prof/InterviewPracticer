// Pausable timer that counts elapsed time and optionally a countdown target.

export class Timer {
  private startedAt = 0;
  private accumulated = 0;
  private handle = 0;
  running = false;

  constructor(
    private readonly onTick: (elapsedMs: number) => void,
    private readonly limitMs: number | null,
    private readonly onExpire: () => void,
  ) {}

  get elapsed(): number {
    return this.accumulated + (this.running ? performance.now() - this.startedAt : 0);
  }

  get remaining(): number | null {
    return this.limitMs == null ? null : Math.max(0, this.limitMs - this.elapsed);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = performance.now();
    this.handle = window.setInterval(() => this.tick(), 200);
    this.tick();
  }

  pause(): void {
    if (!this.running) return;
    this.accumulated = this.elapsed;
    this.running = false;
    clearInterval(this.handle);
  }

  stop(): number {
    this.pause();
    return this.accumulated;
  }

  private tick(): void {
    const e = this.elapsed;
    this.onTick(e);
    if (this.limitMs != null && e >= this.limitMs) {
      this.stop();
      this.onExpire();
    }
  }
}

export function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
