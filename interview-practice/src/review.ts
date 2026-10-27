// Review panel for a single take: playback, notes, transcript fillers, structure checklist.
import { countFillers, STRUCTURE_CHECKLIST } from './coaching';
import * as db from './db';
import { extensionFor } from './recorder';
import { announce, debounce, esc, fmtDate, objectURL, state, storeTake } from './state';
import { fmt } from './timer';
import { Take } from './types';

export interface ReviewOptions {
  /** In-memory blob for a take whose media could not be saved. */
  liveBlob?: Blob | null;
  saveError?: string;
  transcriptFromRecognition?: boolean;
  onDeleted?: () => void;
}

export function reviewHTML(t: Take, o: ReviewOptions = {}): string {
  const checklist = STRUCTURE_CHECKLIST.map(
    (c) => `
      <li>
        <label class="check">
          <input type="checkbox" data-check="${c.id}" ${t.checklist[c.id] ? 'checked' : ''} />
          <span><strong>${esc(c.label)}</strong><small>${esc(c.hint)}</small></span>
        </label>
      </li>`,
  ).join('');

  const modeLabel = t.recordMode === 'none' ? 'No recording' : t.recordMode === 'video' ? 'Video' : 'Audio';

  return `
  <article class="review" data-take="${t.id}">
    <header class="review-head">
      <h3 class="review-q">${esc(t.questionText)}</h3>
      <p class="meta">${fmtDate(t.createdAt)} · ${fmt(t.durationMs)} · ${modeLabel}</p>
    </header>

    ${
      o.saveError
        ? `<div class="banner error" role="alert">
            <strong>This recording wasn't saved.</strong> ${esc(o.saveError)}
            It's still available below until you leave or reload this page — download it now if you want to keep it.
          </div>`
        : ''
    }

    <div class="media-slot" aria-live="polite">${t.recordMode === 'none' ? '<p class="muted">No recording for this take.</p>' : '<p class="muted">Loading recording…</p>'}</div>

    <div class="review-grid">
      <section class="panel">
        <h4>Notes on this take</h4>
        <label class="sr-only" for="notes-${t.id}">Notes on this take</label>
        <textarea id="notes-${t.id}" class="take-notes" rows="4" placeholder="What went well? What would you change?">${esc(t.notes)}</textarea>
        <p class="save-state muted" aria-live="polite"></p>
      </section>

      <section class="panel">
        <h4>Structure self-check</h4>
        <p class="muted small">A prompt list for reviewing your own answer — not an automatic evaluation.</p>
        <ul class="checklist" role="list">${checklist}</ul>
      </section>

      <section class="panel span-2">
        <h4>Filler words</h4>
        <p class="muted small">
          Counts are based only on the transcript text below — the audio itself isn't analyzed.
          ${o.transcriptFromRecognition ? 'This transcript came from browser speech recognition and may be inaccurate; edit it before counting.' : 'Paste or type a transcript of your answer.'}
        </p>
        <label class="sr-only" for="tr-${t.id}">Transcript</label>
        <textarea id="tr-${t.id}" class="take-transcript" rows="5" placeholder="Paste a transcript of your answer here…">${esc(t.transcript)}</textarea>
        <div class="row">
          <button type="button" class="btn" data-r="fillers">Count filler words</button>
        </div>
        <div class="filler-out" aria-live="polite"></div>
      </section>
    </div>

    <div class="row end">
      <span class="download-slot"></span>
      <button type="button" class="btn danger ghost" data-r="delete">Delete take</button>
    </div>
  </article>`;
}

function fillerHTML(text: string): string {
  if (!text.trim()) return '<p class="muted">Add a transcript first.</p>';
  const { counts, total, words } = countFillers(text, state.settings.fillers);
  if (!total) return `<p>No listed filler words found in this ${words}-word transcript.</p>`;
  const per100 = words ? ((total / words) * 100).toFixed(1) : '0';
  return `
    <p><strong>${total}</strong> filler ${total === 1 ? 'word' : 'words'} in ${words} words (${per100} per 100 words).</p>
    <table class="fillers">
      <thead><tr><th scope="col">Word / phrase</th><th scope="col">Count</th></tr></thead>
      <tbody>${counts.map((c) => `<tr><td>“${esc(c.word)}”</td><td>${c.count}</td></tr>`).join('')}</tbody>
    </table>
    <p class="muted small">Words like “like” and “actually” are sometimes used meaningfully; treat the count as a prompt to listen back.</p>`;
}

export function bindReview(root: HTMLElement, t: Take, o: ReviewOptions = {}): void {
  const saveState = root.querySelector<HTMLElement>('.save-state')!;
  const save = debounce(async () => {
    const err = await storeTake(t);
    saveState.textContent = err ? `Not saved: ${err}` : 'Saved';
  }, 500);

  root.querySelector<HTMLTextAreaElement>('.take-notes')!.addEventListener('input', (e) => {
    t.notes = (e.target as HTMLTextAreaElement).value;
    saveState.textContent = 'Saving…';
    save();
  });
  root.querySelector<HTMLTextAreaElement>('.take-transcript')!.addEventListener('input', (e) => {
    t.transcript = (e.target as HTMLTextAreaElement).value;
    save();
  });
  root.querySelectorAll<HTMLInputElement>('[data-check]').forEach((cb) =>
    cb.addEventListener('change', () => {
      t.checklist = { ...t.checklist, [cb.dataset.check!]: cb.checked };
      save();
    }),
  );

  const out = root.querySelector<HTMLElement>('.filler-out')!;
  root.querySelector('[data-r="fillers"]')!.addEventListener('click', () => {
    out.innerHTML = fillerHTML(t.transcript);
  });
  if (t.transcript.trim()) out.innerHTML = fillerHTML(t.transcript);

  root.querySelector('[data-r="delete"]')!.addEventListener('click', async () => {
    if (!confirm('Delete this take and its recording from this browser? This cannot be undone.')) return;
    await db.deleteTake(t.id).catch(() => undefined);
    state.takes = state.takes.filter((x) => x.id !== t.id);
    announce('Take deleted');
    o.onDeleted?.();
  });

  if (t.recordMode !== 'none') void loadMedia(root, t, o.liveBlob ?? null);
}

async function loadMedia(root: HTMLElement, t: Take, liveBlob: Blob | null): Promise<void> {
  const slot = root.querySelector<HTMLElement>('.media-slot')!;
  // Views are built off-DOM and attached synchronously; yield so isConnected reflects that.
  await Promise.resolve();
  const blob = liveBlob ?? (t.mediaSaved ? await db.getMedia(t.id) : null);
  if (!root.isConnected) return;
  if (!blob || !blob.size) {
    slot.innerHTML = `<p class="muted">${
      t.mediaSaved ? 'Recording not found. The browser may have cleared stored data for this site.' : 'No recording was captured for this take.'
    }</p>`;
    return;
  }
  const url = objectURL(blob);
  const isVideo = t.recordMode === 'video';
  slot.innerHTML = isVideo
    ? `<video class="playback" controls playsinline preload="metadata" src="${url}" aria-label="Recording of your answer"></video>`
    : `<audio class="playback" controls preload="metadata" src="${url}" aria-label="Recording of your answer"></audio>`;

  const stamp = new Date(t.createdAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  root.querySelector('.download-slot')!.innerHTML = `<a class="btn ghost" href="${url}" download="interview-take-${stamp}.${extensionFor(blob.type || t.mimeType)}">Download recording</a>`;
}
