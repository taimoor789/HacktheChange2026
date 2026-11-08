/**
 * Background music using Web Audio so the loop is gapless
 * (an <audio loop> element leaves a small gap with compressed files).
 *
 * Browsers block sound until the user interacts with the page, so
 * `play()` before the first click/tap/key just waits and starts on that
 * interaction (unless the interaction is on an element marked
 * `data-no-music-unlock`, e.g. the PLAY button, which leaves the page anyway).
 */

export interface MusicOptions {
  /** Loop length in seconds; trims any encoder padding at the end. Default: the whole file. */
  loopSeconds?: number;
  /** Tried when the browser can't decode `url` (e.g. OGG on an older Safari). */
  fallbackUrl?: string;
}

export class Music {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffer: Promise<AudioBuffer> | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private wanted = false;

  constructor(
    private url: string,
    private volume = 0.25,
    private opts: MusicOptions = {},
  ) {}

  private get loopSeconds() {
    return this.opts.loopSeconds ?? Infinity;
  }

  private ensureCtx() {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    const load = (url: string) =>
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx!.decodeAudioData(b));
    const fallback = this.opts.fallbackUrl;
    this.buffer = fallback ? load(this.url).catch(() => load(fallback)) : load(this.url);
    return this.ctx;
  }

  /** Start (or resume) with a fade-in. Safe to call before any user interaction. */
  play(fadeMs = 2500) {
    this.wanted = true;
    const ctx = this.ensureCtx();
    if (ctx.state === 'running') void this.start(fadeMs);
    else {
      // A new AudioContext starts 'suspended' for a moment even when sound is allowed:
      // try to resume now, and also start on the next interaction if the browser says no.
      void ctx
        .resume()
        .then(() => {
          if (this.wanted && ctx.state === 'running') void this.start(fadeMs);
        })
        .catch(() => {});
      this.waitForUnlock(fadeMs);
    }
  }

  /** Fade out and pause, remembering the position for next time. */
  stop(fadeMs = 400) {
    this.wanted = false;
    if (!this.ctx || !this.gain || !this.source) return;
    const now = this.ctx.currentTime;
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fadeMs / 1000);
    const src = this.source;
    this.source = null;
    const len = Math.min(this.loopSeconds, src.buffer?.duration ?? Infinity);
    this.offset = Number.isFinite(len) ? (this.offset + now - this.startedAt) % len : 0;
    src.stop(now + fadeMs / 1000 + 0.05);
  }

  private starting = false;
  private async start(fadeMs: number) {
    if (this.source || this.starting || !this.ctx || !this.gain) return;
    this.starting = true;
    const buf = await this.buffer!.finally(() => (this.starting = false));
    if (!this.wanted || this.source) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = Math.min(this.loopSeconds, buf.duration);
    src.connect(this.gain);
    const now = ctx.currentTime;
    src.start(now, this.offset);
    this.startedAt = now;
    this.source = src;
    const g = this.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.volume, now + fadeMs / 1000);
  }

  private unlockBound = false;
  private waitForUnlock(fadeMs: number) {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const events = ['pointerdown', 'keydown', 'touchstart'] as const;
    const unlock = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.closest?.('[data-no-music-unlock]')) return; // e.g. PLAY: we're leaving anyway
      events.forEach((ev) => window.removeEventListener(ev, unlock, true));
      this.unlockBound = false;
      void this.ctx!.resume().then(() => {
        if (this.wanted) void this.start(fadeMs);
      });
    };
    events.forEach((ev) => window.addEventListener(ev, unlock, true));
  }
}
