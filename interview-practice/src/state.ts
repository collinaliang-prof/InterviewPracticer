// Shared app state and small helpers used by every view.
import * as db from './db';
import { loadQuestions, loadSettings, saveQuestions, saveSettings } from './local';
import { Question, Session, Settings, Take } from './types';

export type View = 'questions' | 'practice' | 'history' | 'settings';

export const state = {
  view: 'questions' as View,
  questions: [] as Question[],
  settings: loadSettings(),
  takes: [] as Take[],
  sessions: [] as Session[],
  /** Question ids excluded from a mock interview (everything else is included). */
  excluded: new Set<string>(),
  /** Take opened from the History list. */
  openTakeId: null as string | null,
  /** Messages shown once at the top of the next render. */
  notices: [] as { kind: 'warn' | 'error' | 'info'; text: string }[],
};

state.questions = loadQuestions();

let renderer: () => void = () => undefined;
export function setRenderer(fn: () => void): void {
  renderer = fn;
}
export function rerender(): void {
  renderer();
}

export function notice(kind: 'warn' | 'error' | 'info', text: string): void {
  state.notices.push({ kind, text });
}

export function persistQuestions(): void {
  if (!saveQuestions(state.questions)) {
    notice('warn', "Couldn't save questions to browser storage. They'll be kept until you close this tab.");
  }
}

export function persistSettings(): void {
  saveSettings(state.settings);
}

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(state.settings, patch);
  persistSettings();
}

export async function loadRecords(): Promise<void> {
  [state.takes, state.sessions] = await Promise.all([db.listTakes(), db.listSessions()]);
}

/** Persist take metadata; returns an error message on failure. */
export async function storeTake(t: Take): Promise<string> {
  const i = state.takes.findIndex((x) => x.id === t.id);
  if (i >= 0) state.takes[i] = t;
  else state.takes.unshift(t);
  try {
    await db.saveTake(t);
    return '';
  } catch (e) {
    return db.isQuotaError(e) ? 'Browser storage is full.' : 'Browser storage rejected the save.';
  }
}

export async function storeSession(s: Session): Promise<void> {
  const i = state.sessions.findIndex((x) => x.id === s.id);
  if (i >= 0) state.sessions[i] = s;
  else state.sessions.unshift(s);
  try {
    await db.saveSession(s);
  } catch {
    /* session summaries are non-critical; the in-memory copy still drives this page */
  }
}

// --- DOM helpers ---

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function announce(text: string, assertive = false): void {
  const el = document.getElementById(assertive ? 'alert' : 'status');
  if (!el) return;
  el.textContent = '';
  // A fresh text node after a tick makes screen readers re-announce repeated messages.
  setTimeout(() => (el.textContent = text), 30);
}

const urls = new Set<string>();
export function objectURL(blob: Blob): string {
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}
export function revokeURLs(): void {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms = 400): (...a: A) => void {
  let h = 0;
  return (...a: A) => {
    clearTimeout(h);
    h = window.setTimeout(() => fn(...a), ms);
  };
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function questionById(id: string): Question | undefined {
  return state.questions.find((q) => q.id === id);
}
