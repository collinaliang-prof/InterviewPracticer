export const DATA_VERSION = 1;

export type RecordMode = 'audio' | 'video' | 'none';
export type PracticeMode = 'single' | 'mock';

export interface Question {
  id: string;
  text: string;
  notes: string;
  createdAt: number;
}

export interface Settings {
  recordMode: RecordMode;
  timed: boolean;
  durationSec: number;
  prepSec: number;
  speechOn: boolean;
  voiceURI: string;
  rate: number;
  shuffle: boolean;
  fillers: string[];
  liveTranscript: boolean;
}

export interface Take {
  v: number;
  id: string;
  questionId: string;
  questionText: string;
  sessionId: string;
  createdAt: number;
  durationMs: number;
  recordMode: RecordMode;
  mimeType: string;
  /** true only when the media blob was confirmed written to IndexedDB */
  mediaSaved: boolean;
  notes: string;
  transcript: string;
  checklist: Record<string, boolean>;
}

export interface Session {
  v: number;
  id: string;
  mode: PracticeMode;
  startedAt: number;
  endedAt: number | null;
  questionIds: string[];
  answeredIds: string[];
  endedEarly: boolean;
}

export const DEFAULT_FILLERS = ['um', 'uh', 'er', 'ah', 'like', 'you know', 'basically', 'actually', 'literally', 'sort of', 'kind of', 'i mean'];

export const DEFAULT_SETTINGS: Settings = {
  recordMode: 'audio',
  timed: true,
  durationSec: 120,
  prepSec: 0,
  speechOn: true,
  voiceURI: '',
  rate: 1,
  shuffle: false,
  fillers: DEFAULT_FILLERS,
  liveTranscript: false,
};

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
