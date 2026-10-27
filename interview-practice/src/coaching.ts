// Self-review aids: filler counts from a supplied transcript, an answer-structure
// checklist, and optional browser speech recognition.

export const STRUCTURE_CHECKLIST: { id: string; label: string; hint: string }[] = [
  { id: 'situation', label: 'Situation / context', hint: 'Did I set the scene briefly — where, when, what was at stake?' },
  { id: 'task', label: 'Task / goal', hint: 'Was my specific responsibility or objective clear?' },
  { id: 'action', label: 'Action', hint: 'Did I describe what I did, using “I” rather than only “we”?' },
  { id: 'result', label: 'Result', hint: 'Did I state the outcome, ideally with something concrete or measurable?' },
  { id: 'reflection', label: 'Reflection', hint: 'Did I say what I learned or would do differently?' },
  { id: 'answered', label: 'Answered the question asked', hint: 'Did I address the actual question and stay on point?' },
  { id: 'length', label: 'Reasonable length', hint: 'Was it focused — not cut short, not rambling?' },
];

export interface FillerCount {
  word: string;
  count: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countFillers(transcript: string, fillers: string[]): { counts: FillerCount[]; total: number; words: number } {
  const text = transcript.toLowerCase().replace(/[’']/g, "'");
  const words = (text.match(/[a-z0-9']+/g) ?? []).length;
  const counts = fillers
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean)
    .map((word) => {
      const pattern = word.split(/\s+/).map(escapeRegExp).join('\\s+');
      // Allow stretched hesitations like "ummm" / "uhh" for single-syllable fillers.
      const stretched = /^(um|uh|er|ah|hmm)$/.test(word) ? `${escapeRegExp(word)}+` : pattern;
      const re = new RegExp(`(?<![a-z0-9'])${stretched}(?![a-z0-9'])`, 'g');
      return { word, count: (text.match(re) ?? []).length };
    })
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  return { counts, total: counts.reduce((n, c) => n + c.count, 0), words };
}

// --- Optional speech recognition (non-standard API) ---

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognitionSupported(): boolean {
  return getCtor() !== null;
}

/** Live transcript while recording. Restarts on silence timeouts until stopped. */
export class LiveTranscriber {
  private rec: RecognitionLike | null = null;
  private finalText = '';
  private interim = '';
  private wanted = false;
  error = '';

  constructor(private readonly onUpdate: (text: string) => void) {}

  get text(): string {
    return (this.finalText + ' ' + this.interim).replace(/\s+/g, ' ').trim();
  }

  start(): boolean {
    const Ctor = getCtor();
    if (!Ctor) return false;
    this.wanted = true;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += ' ' + r[0].transcript;
        else interim += ' ' + r[0].transcript;
      }
      this.interim = interim;
      this.onUpdate(this.text);
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.error = e.error;
        this.wanted = false;
      }
    };
    rec.onend = () => {
      this.finalText += ' ' + this.interim;
      this.interim = '';
      if (this.wanted) {
        try {
          rec.start();
        } catch {
          this.wanted = false;
        }
      }
    };
    this.rec = rec;
    try {
      rec.start();
      return true;
    } catch {
      this.wanted = false;
      return false;
    }
  }

  stop(): string {
    this.wanted = false;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.rec = null;
    return this.text;
  }
}
