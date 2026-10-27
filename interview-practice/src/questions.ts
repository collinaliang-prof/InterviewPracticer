// Questions view: paste/edit/reorder questions and set up a practice session.
import { hasActiveSession, startSession } from './practice';
import { announce, debounce, esc, persistQuestions, rerender, state, updateSettings } from './state';
import { fmt } from './timer';
import { uid } from './types';

const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 600];
let editingId: string | null = null;

export function parseQuestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function setupHTML(): string {
  const s = state.settings;
  const included = state.questions.filter((q) => !state.excluded.has(q.id)).length;
  const durations = DURATIONS.includes(s.durationSec) ? DURATIONS : [...DURATIONS, s.durationSec].sort((a, b) => a - b);
  return `
    <section class="panel setup" aria-labelledby="setup-h">
      <h2 id="setup-h">Practice setup</h2>
      <div class="setup-grid">
        <fieldset>
          <legend>Recording</legend>
          ${(['audio', 'video', 'none'] as const)
            .map(
              (m) => `<label class="radio"><input type="radio" name="recordMode" value="${m}" ${s.recordMode === m ? 'checked' : ''}/> ${
                m === 'audio' ? 'Audio (microphone)' : m === 'video' ? 'Video (camera + mic)' : 'No recording'
              }</label>`,
            )
            .join('')}
        </fieldset>
        <fieldset>
          <legend>Response time</legend>
          <label class="radio"><input type="radio" name="timed" value="1" ${s.timed ? 'checked' : ''}/> Timed</label>
          <label class="radio"><input type="radio" name="timed" value="0" ${!s.timed ? 'checked' : ''}/> Untimed (stop when done)</label>
          <label class="field ${s.timed ? '' : 'disabled'}">
            <span>Time limit</span>
            <select name="duration" ${s.timed ? '' : 'disabled'}>
              ${durations.map((d) => `<option value="${d}" ${d === s.durationSec ? 'selected' : ''}>${fmt(d * 1000)}</option>`).join('')}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Mock interview</legend>
          <label class="check-inline"><input type="checkbox" name="shuffle" ${s.shuffle ? 'checked' : ''}/> Shuffle question order</label>
          <p class="muted small">Your list order is never changed — shuffling only affects the session.</p>
          <button type="button" class="btn primary" data-q="mock" ${included ? '' : 'disabled'}>
            Start mock interview (${included} ${included === 1 ? 'question' : 'questions'})
          </button>
        </fieldset>
      </div>
      ${hasActiveSession() ? '<p class="banner info">A session is in progress. Starting a new one will end it. <button type="button" class="link" data-q="resume">Return to it</button></p>' : ''}
    </section>`;
}

function itemHTML(q: (typeof state.questions)[number], i: number, n: number): string {
  const included = !state.excluded.has(q.id);
  const body =
    editingId === q.id
      ? `<div class="edit">
           <label class="sr-only" for="edit-${q.id}">Edit question</label>
           <textarea id="edit-${q.id}" rows="3" data-edit>${esc(q.text)}</textarea>
           <div class="row">
             <button type="button" class="btn primary small" data-q="save" data-id="${q.id}">Save</button>
             <button type="button" class="btn small" data-q="cancel">Cancel</button>
           </div>
         </div>`
      : `<p class="q-item-text">${esc(q.text)}</p>`;
  return `
    <li class="q-item ${included ? '' : 'excluded'}">
      <label class="q-include" title="Include in mock interview">
        <input type="checkbox" data-q="include" data-id="${q.id}" ${included ? 'checked' : ''} aria-label="Include question ${i + 1} in mock interview" />
      </label>
      <div class="q-main">
        <span class="q-num" aria-hidden="true">${i + 1}</span>
        ${body}
        <details class="q-notes" ${q.notes ? 'open' : ''}>
          <summary>Notes${q.notes ? '' : ' (none)'}</summary>
          <label class="sr-only" for="qn-${q.id}">Notes for question ${i + 1}</label>
          <textarea id="qn-${q.id}" rows="3" data-qnotes="${q.id}" placeholder="Key points, stories to use, reminders…">${esc(q.notes)}</textarea>
        </details>
      </div>
      <div class="q-actions">
        <button type="button" class="btn primary small" data-q="practice" data-id="${q.id}">Practice</button>
        <button type="button" class="btn icon" data-q="up" data-id="${q.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move question ${i + 1} up">↑</button>
        <button type="button" class="btn icon" data-q="down" data-id="${q.id}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move question ${i + 1} down">↓</button>
        <button type="button" class="btn icon" data-q="edit" data-id="${q.id}" aria-label="Edit question ${i + 1}">✎</button>
        <button type="button" class="btn icon danger" data-q="delete" data-id="${q.id}" aria-label="Delete question ${i + 1}">✕</button>
      </div>
    </li>`;
}

export function renderQuestions(root: HTMLElement): void {
  const n = state.questions.length;
  root.innerHTML = `
    ${setupHTML()}
    <section class="panel" aria-labelledby="add-h">
      <h2 id="add-h">Add questions</h2>
      <label for="paste" class="muted small">Paste one or more questions — one per line. Blank lines are ignored.</label>
      <textarea id="paste" rows="5" placeholder="Tell me about yourself.&#10;Describe a time you disagreed with a teammate.&#10;Why do you want this role?"></textarea>
      <div class="row">
        <button type="button" class="btn primary" data-q="add">Add to list</button>
      </div>
    </section>
    <section class="panel" aria-labelledby="list-h">
      <div class="row between">
        <h2 id="list-h">Your questions <span class="muted">(${n})</span></h2>
        ${
          n
            ? `<div class="row">
                 <button type="button" class="btn small ghost" data-q="all">Include all</button>
                 <button type="button" class="btn small ghost" data-q="none">Include none</button>
               </div>`
            : ''
        }
      </div>
      ${
        n
          ? `<ol class="q-list" role="list">${state.questions.map((q, i) => itemHTML(q, i, n)).join('')}</ol>`
          : '<p class="muted">No questions yet. Paste some above to get started.</p>'
      }
    </section>`;
  bind(root);
}

const saveNotes = debounce(() => persistQuestions(), 500);

function bind(root: HTMLElement): void {
  root.querySelectorAll<HTMLInputElement>('input[name="recordMode"]').forEach((r) =>
    r.addEventListener('change', () => updateSettings({ recordMode: r.value as 'audio' | 'video' | 'none' })),
  );
  root.querySelectorAll<HTMLInputElement>('input[name="timed"]').forEach((r) =>
    r.addEventListener('change', () => {
      updateSettings({ timed: r.value === '1' });
      rerender();
    }),
  );
  root.querySelector<HTMLSelectElement>('select[name="duration"]')?.addEventListener('change', (e) =>
    updateSettings({ durationSec: Number((e.target as HTMLSelectElement).value) }),
  );
  root.querySelector<HTMLInputElement>('input[name="shuffle"]')?.addEventListener('change', (e) =>
    updateSettings({ shuffle: (e.target as HTMLInputElement).checked }),
  );
  root.querySelectorAll<HTMLTextAreaElement>('[data-qnotes]').forEach((ta) =>
    ta.addEventListener('input', () => {
      const q = state.questions.find((x) => x.id === ta.dataset.qnotes);
      if (q) q.notes = ta.value;
      saveNotes();
    }),
  );

  const editBox = root.querySelector<HTMLTextAreaElement>('[data-edit]');
  if (editBox) {
    editBox.focus();
    editBox.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        editingId = null;
        rerender();
      }
    });
  }

  root.querySelectorAll<HTMLElement>('[data-q]').forEach((el) => {
    const action = el.dataset.q!;
    const id = el.dataset.id ?? '';
    if (action === 'include') {
      el.addEventListener('change', () => {
        if ((el as HTMLInputElement).checked) state.excluded.delete(id);
        else state.excluded.add(id);
        rerender();
      });
      return;
    }
    el.addEventListener('click', () => handle(action, id, root));
  });
}

function handle(action: string, id: string, root: HTMLElement): void {
  const qs = state.questions;
  const i = qs.findIndex((q) => q.id === id);
  switch (action) {
    case 'add': {
      const ta = root.querySelector<HTMLTextAreaElement>('#paste')!;
      const lines = parseQuestions(ta.value);
      if (!lines.length) {
        announce('Nothing to add — paste at least one question.');
        ta.focus();
        return;
      }
      lines.forEach((text) => qs.push({ id: uid(), text, notes: '', createdAt: Date.now() }));
      persistQuestions();
      announce(`Added ${lines.length} ${lines.length === 1 ? 'question' : 'questions'}`);
      rerender();
      return;
    }
    case 'practice':
      return startSession('single', [id]);
    case 'mock':
      return startSession(
        'mock',
        qs.filter((q) => !state.excluded.has(q.id)).map((q) => q.id),
      );
    case 'resume':
      state.view = 'practice';
      return rerender();
    case 'up':
    case 'down': {
      const j = action === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= qs.length) return;
      [qs[i], qs[j]] = [qs[j], qs[i]];
      persistQuestions();
      rerender();
      document.querySelector<HTMLElement>(`[data-q="${action}"][data-id="${id}"]:not([disabled])`)?.focus();
      announce(`Moved to position ${j + 1}`);
      return;
    }
    case 'edit':
      editingId = id;
      return rerender();
    case 'cancel':
      editingId = null;
      return rerender();
    case 'save': {
      const text = root.querySelector<HTMLTextAreaElement>('[data-edit]')!.value.trim();
      if (!text) {
        announce('A question can’t be empty. Delete it instead if you no longer need it.');
        return;
      }
      if (i >= 0) qs[i].text = text;
      editingId = null;
      persistQuestions();
      return rerender();
    }
    case 'delete':
      if (i < 0 || !confirm('Delete this question? Past takes of it stay in History.')) return;
      qs.splice(i, 1);
      state.excluded.delete(id);
      persistQuestions();
      announce('Question deleted');
      return rerender();
    case 'all':
      state.excluded.clear();
      return rerender();
    case 'none':
      qs.forEach((q) => state.excluded.add(q.id));
      return rerender();
  }
}
