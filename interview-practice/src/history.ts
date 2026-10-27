// History view: locally derived progress stats and the list of past takes.
import { bindReview, reviewHTML } from './review';
import { esc, fmtDate, rerender, state } from './state';
import { fmt } from './timer';

const DAY = 86400000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function statsHTML(): string {
  const takes = state.takes;
  const attempted = new Set(takes.map((t) => t.questionId)).size;
  const completed = state.sessions.filter((s) => s.mode === 'mock' && s.endedAt && !s.endedEarly).length;
  const totalMs = takes.reduce((n, t) => n + t.durationMs, 0);

  const today = startOfDay(Date.now());
  const days = Array.from({ length: 14 }, (_, i) => {
    const start = today - (13 - i) * DAY;
    const count = takes.filter((t) => t.createdAt >= start && t.createdAt < start + DAY).length;
    return { start, count };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const bars = days
    .map((d) => {
      const label = new Date(d.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return `<li title="${label}: ${d.count}">
        <span class="bar" style="height:${(d.count / max) * 100}%"></span>
        <span class="bar-n">${d.count || ''}</span>
        <span class="sr-only">${label}: ${d.count} ${d.count === 1 ? 'take' : 'takes'}</span>
      </li>`;
    })
    .join('');

  return `
    <section class="panel" aria-labelledby="prog-h">
      <h2 id="prog-h">Progress</h2>
      <dl class="stats">
        <div><dt>Takes recorded</dt><dd>${takes.length}</dd></div>
        <div><dt>Questions attempted</dt><dd>${attempted}</dd></div>
        <div><dt>Mock interviews completed</dt><dd>${completed}</dd></div>
        <div><dt>Total speaking time</dt><dd>${fmt(totalMs)}</dd></div>
      </dl>
      <h3 class="small-h">Last 14 days</h3>
      <ol class="activity" role="list" aria-label="Takes per day, last 14 days">${bars}</ol>
      <p class="muted small">Calculated from practice stored in this browser only.</p>
    </section>`;
}

export function renderHistory(root: HTMLElement): void {
  const open = state.takes.find((t) => t.id === state.openTakeId);
  if (open) {
    root.innerHTML = `
      <div class="row"><button type="button" class="btn ghost" data-h="back" data-autofocus>← All takes</button></div>
      ${reviewHTML(open)}`;
    root.querySelector('[data-h="back"]')!.addEventListener('click', () => {
      state.openTakeId = null;
      rerender();
    });
    bindReview(root.querySelector<HTMLElement>('.review')!, open, {
      onDeleted: () => {
        state.openTakeId = null;
        rerender();
      },
    });
    return;
  }

  const groups = new Map<string, typeof state.takes>();
  for (const t of state.takes) {
    const key = new Date(t.createdAt).toLocaleDateString(undefined, { dateStyle: 'full' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const list = state.takes.length
    ? [...groups]
        .map(
          ([day, takes]) => `
        <h3 class="small-h">${esc(day)}</h3>
        <ul class="take-list" role="list">
          ${takes
            .map(
              (t) => `
            <li>
              <button type="button" class="take-row" data-open="${t.id}">
                <span class="take-q">${esc(t.questionText)}</span>
                <span class="take-meta">
                  ${new Date(t.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })} · ${fmt(t.durationMs)} ·
                  ${t.recordMode === 'none' ? 'no recording' : t.mediaSaved ? t.recordMode : `${t.recordMode} (not saved)`}
                  ${t.notes ? ' · has notes' : ''}
                </span>
              </button>
            </li>`,
            )
            .join('')}
        </ul>`,
        )
        .join('')
    : '<p class="muted">No takes yet. Finished answers will show up here.</p>';

  root.innerHTML = `
    ${statsHTML()}
    <section class="panel" aria-labelledby="takes-h">
      <h2 id="takes-h">Takes</h2>
      ${list}
    </section>
    ${state.sessions.length ? sessionsHTML() : ''}`;

  root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) =>
    b.addEventListener('click', () => {
      state.openTakeId = b.dataset.open!;
      rerender();
      window.scrollTo(0, 0);
    }),
  );
}

function sessionsHTML(): string {
  const rows = state.sessions
    .slice(0, 10)
    .map((s) => {
      const status = !s.endedAt ? 'not finished' : s.endedEarly ? 'ended early' : 'completed';
      return `<li><span>${fmtDate(s.startedAt)}</span> <span class="muted">${s.mode === 'mock' ? 'Mock interview' : 'Single question'} · ${s.answeredIds.length}/${s.questionIds.length} answered · ${status}</span></li>`;
    })
    .join('');
  return `
    <section class="panel" aria-labelledby="sess-h">
      <h2 id="sess-h">Recent sessions</h2>
      <ul class="session-list" role="list">${rows}</ul>
    </section>`;
}
