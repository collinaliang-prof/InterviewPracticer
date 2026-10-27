import './style.css';
import { openDB } from './db';
import { renderHistory } from './history';
import { hasActiveSession, hasUnsavedWork, leavePractice, renderPractice } from './practice';
import { renderQuestions } from './questions';
import { renderSettings } from './settings';
import { onVoicesChanged } from './speech';
import { esc, loadRecords, revokeURLs, setRenderer, state, View } from './state';

const app = document.getElementById('app')!;
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tab')];
let lastView: View | null = null;

function render(): void {
  revokeURLs();
  const viewChanged = lastView !== state.view;
  lastView = state.view;

  tabs.forEach((t) => {
    const active = t.dataset.view === state.view;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
    if (t.dataset.view === 'practice') t.classList.toggle('live', hasActiveSession());
  });

  const notices = state.notices.splice(0).map((n) => `<div class="banner ${n.kind}" role="${n.kind === 'error' ? 'alert' : 'status'}">${esc(n.text)}</div>`).join('');
  const view = document.createElement('div');
  view.className = `view view-${state.view}`;
  ({ questions: renderQuestions, practice: renderPractice, history: renderHistory, settings: renderSettings })[state.view](view);
  app.replaceChildren();
  if (notices) app.insertAdjacentHTML('afterbegin', notices);
  app.appendChild(view);

  // Move focus to the most useful control so keyboard and screen-reader users follow transitions.
  const target = app.querySelector<HTMLElement>('[data-autofocus]');
  if (target) target.focus({ preventScroll: !viewChanged });
  else if (viewChanged) app.focus({ preventScroll: true });
  if (viewChanged) window.scrollTo(0, 0);
}

setRenderer(render);

tabs.forEach((t) =>
  t.addEventListener('click', async () => {
    const next = t.dataset.view as View;
    if (next === state.view) {
      if (next === 'history' && state.openTakeId) {
        state.openTakeId = null;
        render();
      }
      return;
    }
    if (state.view === 'practice') await leavePractice();
    state.view = next;
    render();
  }),
);

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedWork()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

onVoicesChanged(() => state.view === 'settings' && render());

render();
void openDB()
  .then(loadRecords)
  .then(() => {
    if (state.view === 'history') render();
  });
