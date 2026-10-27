// Small structured values in localStorage, with an in-memory fallback when storage
// is blocked (private mode, disabled cookies) or full.
import { DATA_VERSION, DEFAULT_SETTINGS, Question, Settings } from './types';

const PREFIX = 'ipa:';
const memory = new Map<string, string>();
let available = true;

try {
  const k = PREFIX + '__probe';
  localStorage.setItem(k, '1');
  localStorage.removeItem(k);
} catch {
  available = false;
}

export function localAvailable(): boolean {
  return available;
}

function read(key: string): string | null {
  if (available) {
    try {
      return localStorage.getItem(PREFIX + key);
    } catch {
      available = false;
    }
  }
  return memory.get(key) ?? null;
}

/** Returns false if the value could only be kept in memory. */
function write(key: string, value: string): boolean {
  memory.set(key, value);
  if (!available) return false;
  try {
    localStorage.setItem(PREFIX + key, value);
    return true;
  } catch {
    return false;
  }
}

function readJSON<T>(key: string): T | null {
  const raw = read(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null; // corrupt value: treat as missing rather than breaking the app
  }
}

interface Envelope<T> {
  v: number;
  data: T;
}

function migrate<T>(env: Envelope<T> | null): T | null {
  if (!env || typeof env !== 'object' || !('data' in env)) return null;
  // Future migrations go here, keyed on env.v < DATA_VERSION.
  return env.data;
}

export function loadQuestions(): Question[] {
  const data = migrate(readJSON<Envelope<Question[]>>('questions'));
  if (!Array.isArray(data)) return [];
  return data.filter((q) => q && typeof q.id === 'string' && typeof q.text === 'string').map((q) => ({ ...q, notes: q.notes ?? '', createdAt: q.createdAt ?? Date.now() }));
}

export function saveQuestions(questions: Question[]): boolean {
  return write('questions', JSON.stringify({ v: DATA_VERSION, data: questions }));
}

export function loadSettings(): Settings {
  const data = migrate(readJSON<Envelope<Partial<Settings>>>('settings'));
  return { ...DEFAULT_SETTINGS, ...(data ?? {}) };
}

export function saveSettings(s: Settings): boolean {
  return write('settings', JSON.stringify({ v: DATA_VERSION, data: s }));
}

export function clearLocal(): void {
  memory.clear();
  if (!available) return;
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
