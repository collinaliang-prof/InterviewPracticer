// Text-to-speech via the Web Speech API, with guards for missing voices,
// errors, and browsers that never fire `end`.

export type SpeakResult = 'done' | 'cancelled' | 'unsupported' | 'error';

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

let voicesCache: SpeechSynthesisVoice[] = [];

export function getVoices(): SpeechSynthesisVoice[] {
  if (!speechSupported()) return [];
  const v = speechSynthesis.getVoices();
  if (v.length) voicesCache = v;
  return voicesCache;
}

export function onVoicesChanged(cb: () => void): void {
  if (!speechSupported()) return;
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    getVoices();
    cb();
  });
}

let active: { finish: (r: SpeakResult) => void } | null = null;

export function speak(text: string, opts: { voiceURI?: string; rate?: number }): Promise<SpeakResult> {
  if (!speechSupported()) return Promise.resolve('unsupported');
  cancelSpeech();
  return new Promise((resolve) => {
    let settled = false;
    let watchdog = 0;
    const finish = (r: SpeakResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      active = null;
      resolve(r);
    };
    active = { finish };

    const u = new SpeechSynthesisUtterance(text);
    const voice = getVoices().find((v) => v.voiceURI === opts.voiceURI);
    if (voice) u.voice = voice;
    u.rate = opts.rate ?? 1;
    u.onend = () => finish('done');
    u.onerror = (e) => finish(e.error === 'interrupted' || e.error === 'canceled' ? 'cancelled' : 'error');

    // Some engines silently drop utterances (no voices, background tab). Give up
    // after a generous estimate of speaking time so the session never gets stuck.
    const words = text.split(/\s+/).length;
    const estimateMs = ((words / 2.5) * 1000) / Math.max(0.5, u.rate) + 4000;
    watchdog = window.setTimeout(() => {
      if (!speechSynthesis.speaking && !speechSynthesis.pending) finish('error');
      else watchdog = window.setTimeout(() => finish('done'), estimateMs);
    }, Math.min(estimateMs, 3000));

    try {
      speechSynthesis.speak(u);
    } catch {
      finish('error');
    }
  });
}

export function cancelSpeech(): void {
  if (!speechSupported()) return;
  const a = active;
  active = null;
  try {
    speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  a?.finish('cancelled');
}
