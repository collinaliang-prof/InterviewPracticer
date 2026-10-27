// Practice session state machine:
// ready → (permission) → speaking → (prep) → recording → saving → review → next / summary
import { LiveTranscriber, recognitionSupported } from './coaching';
import * as db from './db';
import { describeMediaError, mediaSupport, Recorder } from './recorder';
import { bindReview, reviewHTML } from './review';
import { announce, esc, fmtDate, questionById, rerender, state, storeSession, storeTake } from './state';
import { cancelSpeech, speak, speechSupported } from './speech';
import { fmt, Timer } from './timer';
import { DATA_VERSION, PracticeMode, RecordMode, Session, Take, uid } from './types';

type Phase = 'ready' | 'permission' | 'mediaError' | 'speaking' | 'speechFailed' | 'prep' | 'recording' | 'saving' | 'review' | 'summary';

interface Practice {
  session: Session;
  index: number;
  phase: Phase;
  recordMode: RecordMode;
  timed: boolean;
  durationSec: number;
  recorder: Recorder | null;
  timer: Timer | null;
  prepTimer: Timer | null;
  transcriber: LiveTranscriber | null;
  paused: boolean;
  mediaError: string;
  unsupportedNote: string;
  take: Take | null;
  liveBlob: Blob | null;
  saveError: string;
  sessionTakeIds: string[];
  /** Incremented on every flow start/abort so stale async continuations can bail. */
  run: number;
}

let p: Practice | null = null;

export function hasActiveSession(): boolean {
  return !!p && p.phase !== 'summary';
}

/** True when leaving the page would lose something. */
export function hasUnsavedWork(): boolean {
  return !!p && (p.phase === 'recording' || p.phase === 'saving' || (!!p.liveBlob && !!p.saveError));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function effectiveRecordMode(wanted: RecordMode): { mode: RecordMode; note: string } {
  if (wanted === 'none') return { mode: 'none', note: '' };
  const s = mediaSupport();
  if (!s.secure) return { mode: 'none', note: 'Recording needs a secure (HTTPS) connection, so this session will run without recording.' };
  if (!s.getUserMedia || !s.recorder) return { mode: 'none', note: "This browser can't record media, so this session will run without recording." };
  return { mode: wanted, note: '' };
}

export function startSession(mode: PracticeMode, questionIds: string[]): void {
  if (!questionIds.length) return;
  teardown();
  const order = mode === 'mock' && state.settings.shuffle ? shuffle(questionIds) : [...questionIds];
  const { mode: recordMode, note } = effectiveRecordMode(state.settings.recordMode);
  p = {
    session: { v: DATA_VERSION, id: uid(), mode, startedAt: Date.now(), endedAt: null, questionIds: order, answeredIds: [], endedEarly: false },
    index: 0,
    phase: 'ready',
    recordMode,
    timed: state.settings.timed,
    durationSec: state.settings.durationSec,
    recorder: null,
    timer: null,
    prepTimer: null,
    transcriber: null,
    paused: false,
    mediaError: '',
    unsupportedNote: note,
    take: null,
    liveBlob: null,
    saveError: '',
    sessionTakeIds: [],
    run: 0,
  };
  void storeSession(p.session);
  state.view = 'practice';
  rerender();
}

function currentQuestionText(): string {
  if (!p) return '';
  const id = p.session.questionIds[p.index];
  return questionById(id)?.text ?? '(This question was deleted from your list.)';
}

function setPhase(phase: Phase): void {
  if (!p) return;
  p.phase = phase;
  rerender();
}

// --- Flow ---

async function onReady(): Promise<void> {
  if (!p) return;
  const run = ++p.run;
  p.take = null;
  p.liveBlob = null;
  p.saveError = '';

  if (p.recordMode !== 'none') {
    setPhase('permission');
    p.recorder = new Recorder(p.recordMode);
    try {
      const stream = await p.recorder.acquire();
      // If a device disappears mid-answer (unplugged, revoked), finish with what we have.
      stream.getTracks().forEach((tr) => tr.addEventListener('ended', () => p?.phase === 'recording' && void finishResponse('Your device stopped sending audio/video, so recording ended early.')));
    } catch (e) {
      if (!p || run !== p.run) return;
      p.recorder.release();
      p.recorder = null;
      p.mediaError = describeMediaError(e, p.recordMode);
      announce(p.mediaError, true);
      setPhase('mediaError');
      return;
    }
    if (!p || run !== p.run) return;
  }

  if (state.settings.speechOn && speechSupported()) {
    setPhase('speaking');
    announce('Reading the question aloud');
    const result = await speak(currentQuestionText(), { voiceURI: state.settings.voiceURI, rate: state.settings.rate });
    if (!p || run !== p.run) return;
    if (result === 'error') {
      setPhase('speechFailed');
      announce("Couldn't read the question aloud. Start when you're ready.");
      return;
    }
  }
  beginPrepOrResponse(run);
}

function beginPrepOrResponse(run: number): void {
  if (!p || run !== p.run) return;
  const prep = state.settings.prepSec;
  if (prep > 0) {
    p.prepTimer = new Timer(
      (ms) => updateClock(prep * 1000 - ms, prep * 1000 - ms, prep * 1000),
      prep * 1000,
      () => p && run === p.run && startResponse(),
    );
    setPhase('prep');
    announce(`Preparation time: ${prep} seconds`);
    p.prepTimer.start();
  } else {
    startResponse();
  }
}

function startResponse(): void {
  if (!p) return;
  p.prepTimer?.stop();
  p.prepTimer = null;
  if (p.recorder) {
    try {
      p.recorder.start();
    } catch {
      p.recorder.release();
      p.recorder = null;
      p.mediaError = "The browser couldn't start recording with this device.";
      setPhase('mediaError');
      return;
    }
  }
  const limit = p.timed ? p.durationSec * 1000 : null;
  let warned30 = false;
  let warned10 = false;
  p.timer = new Timer(
    (ms) => {
      if (!p) return;
      if (limit != null) {
        const left = limit - ms;
        updateClock(left, left, limit);
        if (!warned30 && limit > 45000 && left <= 30000) (warned30 = true), announce('30 seconds left');
        if (!warned10 && left <= 10000) (warned10 = true), announce('10 seconds left');
      } else updateClock(ms, null, null);
    },
    limit,
    () => void finishResponse("Time's up."),
  );
  p.paused = false;
  if (state.settings.liveTranscript && recognitionSupported()) {
    p.transcriber = new LiveTranscriber((text) => {
      const el = document.getElementById('live-transcript');
      if (el) el.textContent = text;
    });
    if (!p.transcriber.start()) p.transcriber = null;
  }
  setPhase('recording');
  p.timer.start();
  announce(p.recorder ? 'Recording started' : 'Answer timer started');
}

function togglePause(): void {
  if (!p || p.phase !== 'recording' || !p.timer) return;
  p.paused = !p.paused;
  if (p.paused) {
    p.timer.pause();
    p.recorder?.pause();
  } else {
    p.timer.start();
    p.recorder?.resume();
  }
  announce(p.paused ? 'Paused' : 'Resumed');
  const btn = document.querySelector<HTMLButtonElement>('[data-p="pause"]');
  if (btn) btn.textContent = p.paused ? 'Resume' : 'Pause';
  const ind = document.querySelector<HTMLElement>('.rec-indicator');
  if (ind) {
    ind.classList.toggle('paused', p.paused);
    ind.querySelector('.rec-label')!.textContent = p.paused ? 'Paused' : p.recorder ? 'Recording' : 'Answering';
  }
}

async function finishResponse(reason = ''): Promise<void> {
  if (!p || p.phase !== 'recording') return;
  const run = ++p.run;
  const durationMs = p.timer?.stop() ?? 0;
  p.timer = null;
  const transcript = p.transcriber?.stop() ?? '';
  p.transcriber = null;
  setPhase('saving');
  if (reason) announce(reason);

  let blob: Blob | null = null;
  let mimeType = '';
  if (p.recorder) {
    blob = await p.recorder.stop();
    mimeType = p.recorder.mimeType;
    p.recorder.release();
    p.recorder = null;
  }
  if (!p || run !== p.run) return;

  const qid = p.session.questionIds[p.index];
  const take: Take = {
    v: DATA_VERSION,
    id: uid(),
    questionId: qid,
    questionText: currentQuestionText(),
    sessionId: p.session.id,
    createdAt: Date.now(),
    durationMs,
    recordMode: blob && blob.size ? p.recordMode : 'none',
    mimeType,
    mediaSaved: false,
    notes: '',
    transcript,
    checklist: {},
  };

  let saveError = '';
  if (blob && blob.size) {
    try {
      await db.saveMedia(take.id, blob);
      take.mediaSaved = true;
    } catch (e) {
      saveError = db.isQuotaError(e) ? 'Browser storage is full — free up space or delete older takes.' : 'This browser blocked saving it (private browsing or storage disabled).';
    }
  }
  const metaErr = await storeTake(take);
  if (metaErr && !saveError) saveError = metaErr;
  if (!p || run !== p.run) return;

  p.take = take;
  p.liveBlob = take.mediaSaved ? null : blob;
  p.saveError = take.recordMode !== 'none' ? saveError : '';
  p.sessionTakeIds.push(take.id);
  if (!p.session.answeredIds.includes(qid)) p.session.answeredIds.push(qid);
  void storeSession(p.session);
  setPhase('review');
  announce(p.saveError ? 'Answer finished, but the recording could not be saved.' : 'Answer finished. Review your take.', !!p.saveError);
}

/** Cancel whatever is in flight and release devices. Recording in progress is discarded. */
function abortFlow(): void {
  if (!p) return;
  p.run++;
  cancelSpeech();
  p.prepTimer?.stop();
  p.prepTimer = null;
  p.timer?.stop();
  p.timer = null;
  p.transcriber?.stop();
  p.transcriber = null;
  p.recorder?.release();
  p.recorder = null;
}

/** Called when navigating away from the Practice view. */
export async function leavePractice(): Promise<void> {
  if (!p) return;
  if (p.phase === 'recording') {
    await finishResponse('Recording stopped because you left the practice screen.');
    return;
  }
  if (['permission', 'speaking', 'speechFailed', 'prep', 'mediaError'].includes(p.phase)) {
    abortFlow();
    p.phase = 'ready';
  }
}

function retake(): void {
  if (!p) return;
  p.take = null;
  p.liveBlob = null;
  p.saveError = '';
  setPhase('ready');
}

function next(): void {
  if (!p) return;
  if (p.index + 1 >= p.session.questionIds.length) return endSession(false);
  p.index++;
  p.take = null;
  p.liveBlob = null;
  p.saveError = '';
  setPhase('ready');
}

async function endSessionAsync(early: boolean): Promise<void> {
  if (!p) return;
  if (p.phase === 'recording') await finishResponse();
  abortFlow();
  p.session.endedAt = Date.now();
  p.session.endedEarly = early && p.session.answeredIds.length < p.session.questionIds.length;
  await storeSession(p.session);
  p.liveBlob = null;
  setPhase('summary');
  announce('Session ended');
}

function endSession(early: boolean): void {
  void endSessionAsync(early);
}

function teardown(): void {
  abortFlow();
  p = null;
}

/** Drop the current session without saving anything further (used by "delete all data"). */
export const discardSession = teardown;

// --- Rendering ---

function updateClock(displayMs: number, remaining: number | null, total: number | null): void {
  const el = document.getElementById('clock');
  if (el) el.textContent = fmt(displayMs);
  const bar = document.getElementById('clock-bar');
  if (bar && remaining != null && total) bar.style.width = `${Math.max(0, Math.min(100, (remaining / total) * 100))}%`;
}

function settingsLine(): string {
  if (!p) return '';
  const rec = p.recordMode === 'none' ? 'No recording' : p.recordMode === 'video' ? 'Video recording' : 'Audio recording';
  const time = p.timed ? `Timed ${fmt(p.durationSec * 1000)}` : 'Untimed';
  const speech = state.settings.speechOn ? (speechSupported() ? 'Question read aloud' : 'Read-aloud unavailable') : 'Read-aloud off';
  const prep = state.settings.prepSec ? ` · ${state.settings.prepSec}s prep` : '';
  return `${rec} · ${time} · ${speech}${prep}`;
}

function questionCard(): string {
  if (!p) return '';
  const total = p.session.questionIds.length;
  const label = p.session.mode === 'mock' ? `Question ${p.index + 1} of ${total}` : 'Single question';
  return `
    <section class="q-card" aria-labelledby="q-text">
      <p class="q-label">${label}</p>
      <h2 id="q-text" class="q-text">${esc(currentQuestionText())}</h2>
    </section>`;
}

function progressBar(): string {
  if (!p || p.session.mode !== 'mock') return '';
  const total = p.session.questionIds.length;
  const done = p.index + (p.phase === 'review' ? 1 : 0);
  return `<div class="progress" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span style="width:${(done / total) * 100}%"></span></div>`;
}

function previewHTML(): string {
  if (!p || p.recordMode !== 'video' || !p.recorder?.stream) return '';
  return `<div class="preview"><video id="preview" autoplay muted playsinline aria-label="Camera preview"></video></div>`;
}

function phaseHTML(): string {
  if (!p) return '';
  const endBtn = `<button type="button" class="btn ghost" data-p="end">End session</button>`;
  switch (p.phase) {
    case 'ready': {
      const needsPermission = p.recordMode !== 'none';
      return `
        ${questionCard()}
        <div class="stage-actions">
          <button type="button" class="btn primary big" data-p="ready" data-autofocus>Ready</button>
          ${endBtn}
        </div>
        <p class="muted center">${settingsLine()}</p>
        ${p.unsupportedNote ? `<p class="banner warn">${esc(p.unsupportedNote)}</p>` : ''}
        ${
          needsPermission
            ? `<p class="banner info">When you press Ready, your browser may ask to use your ${p.recordMode === 'video' ? 'camera and microphone' : 'microphone'}.
               That's only so you can record and replay your answer — the recording is stored in this browser and never uploaded.</p>`
            : ''
        }`;
    }
    case 'permission':
      return `
        ${questionCard()}
        <p class="status-line" role="status">Waiting for ${p.recordMode === 'video' ? 'camera and microphone' : 'microphone'} permission… Check your browser's prompt.</p>
        <div class="stage-actions">${endBtn}</div>`;
    case 'mediaError':
      return `
        ${questionCard()}
        <div class="banner error" role="alert">${esc(p.mediaError)}</div>
        <div class="stage-actions">
          <button type="button" class="btn primary" data-p="retry-media" data-autofocus>Retry</button>
          <button type="button" class="btn" data-p="no-record">Continue without recording</button>
          ${endBtn}
        </div>`;
    case 'speaking':
      return `
        ${questionCard()}
        ${previewHTML()}
        <p class="status-line"><span class="pulse" aria-hidden="true"></span> Reading the question aloud…</p>
        <div class="stage-actions">
          <button type="button" class="btn" data-p="skip-speech" data-autofocus>Skip reading</button>
          ${endBtn}
        </div>`;
    case 'speechFailed':
      return `
        ${questionCard()}
        ${previewHTML()}
        <p class="banner warn">The question couldn't be read aloud on this device. Read it above, then start when you're ready.</p>
        <div class="stage-actions">
          <button type="button" class="btn primary big" data-p="start-now" data-autofocus>Start answering</button>
          ${endBtn}
        </div>`;
    case 'prep':
      return `
        ${questionCard()}
        ${previewHTML()}
        <div class="clock-wrap">
          <p class="clock-label">Preparation</p>
          <p id="clock" class="clock" role="timer" aria-live="off">${fmt(state.settings.prepSec * 1000)}</p>
          <div class="clock-track"><span id="clock-bar"></span></div>
        </div>
        <div class="stage-actions">
          <button type="button" class="btn primary" data-p="start-now" data-autofocus>Start answering now</button>
          ${endBtn}
        </div>`;
    case 'recording': {
      const live = p.transcriber
        ? `<section class="panel"><h4>Live transcript <small class="muted">(browser speech recognition, may be inaccurate)</small></h4><p id="live-transcript" class="live-transcript"></p></section>`
        : '';
      return `
        ${questionCard()}
        <div class="rec-row">
          ${previewHTML()}
          <div class="clock-wrap">
            <p class="rec-indicator"><span class="dot" aria-hidden="true"></span><span class="rec-label">${p.recorder ? 'Recording' : 'Answering'}</span></p>
            <p class="clock-label">${p.timed ? 'Time remaining' : 'Elapsed'}</p>
            <p id="clock" class="clock" role="timer" aria-live="off">${fmt(p.timed ? p.durationSec * 1000 : 0)}</p>
            ${p.timed ? '<div class="clock-track"><span id="clock-bar" style="width:100%"></span></div>' : ''}
          </div>
        </div>
        <div class="stage-actions">
          <button type="button" class="btn primary big" data-p="stop" data-autofocus>Stop</button>
          <button type="button" class="btn" data-p="pause">Pause</button>
          ${endBtn}
        </div>
        ${live}`;
    }
    case 'saving':
      return `${questionCard()}<p class="status-line" role="status">Saving your take…</p>`;
    case 'review': {
      const isLast = p.index + 1 >= p.session.questionIds.length;
      const nav =
        p.session.mode === 'mock'
          ? `<button type="button" class="btn primary" data-p="next" data-autofocus>${isLast ? 'Finish session' : 'Next question'}</button>
             <button type="button" class="btn" data-p="retake">Retake this question</button>
             ${isLast ? '' : endBtn}`
          : `<button type="button" class="btn primary" data-p="retake" data-autofocus>Retake</button>
             <button type="button" class="btn" data-p="done">Done</button>`;
      const prev = state.takes.filter((t) => t.questionId === p!.take?.questionId && t.id !== p!.take?.id).length;
      return `
        ${p.take ? reviewHTML(p.take, { saveError: p.saveError, transcriptFromRecognition: !!p.take.transcript }) : ''}
        ${prev ? `<p class="muted">You have ${prev} earlier ${prev === 1 ? 'take' : 'takes'} of this question in History.</p>` : ''}
        <div class="stage-actions sticky">${nav}</div>`;
    }
    case 'summary':
      return summaryHTML();
  }
}

function summaryHTML(): string {
  if (!p) return '';
  const s = p.session;
  const takes = state.takes.filter((t) => p!.sessionTakeIds.includes(t.id));
  const totalMs = takes.reduce((n, t) => n + t.durationMs, 0);
  const rows = s.questionIds
    .map((qid, i) => {
      const qt = takes.filter((t) => t.questionId === qid);
      const text = qt[0]?.questionText ?? questionById(qid)?.text ?? '(deleted question)';
      return `<li><span class="num">${i + 1}.</span> <span>${esc(text)}</span> <span class="muted">${qt.length ? `${qt.length} ${qt.length === 1 ? 'take' : 'takes'} · ${fmt(qt.reduce((n, t) => n + t.durationMs, 0))}` : 'Skipped'}</span></li>`;
    })
    .join('');
  return `
    <section class="panel summary">
      <h2>${s.mode === 'mock' ? (s.endedEarly ? 'Mock interview ended' : 'Mock interview complete') : 'Practice complete'}</h2>
      <p class="muted">${fmtDate(s.startedAt)}${s.endedEarly ? ' · ended early' : ''}</p>
      <dl class="stats">
        <div><dt>Answered</dt><dd>${s.answeredIds.length} / ${s.questionIds.length}</dd></div>
        <div><dt>Takes</dt><dd>${takes.length}</dd></div>
        <div><dt>Speaking time</dt><dd>${fmt(totalMs)}</dd></div>
      </dl>
      <ol class="summary-list" role="list">${rows}</ol>
      <div class="stage-actions">
        <button type="button" class="btn primary" data-p="to-history" data-autofocus>Review takes in History</button>
        <button type="button" class="btn" data-p="close">Back to questions</button>
      </div>
    </section>`;
}

export function renderPractice(root: HTMLElement): void {
  if (!p) {
    root.innerHTML = `
      <section class="panel empty">
        <h2>No practice session running</h2>
        <p class="muted">Pick a question to practice, or start a mock interview from the Questions tab.</p>
        <button type="button" class="btn primary" data-p="to-questions" data-autofocus>Go to questions</button>
      </section>`;
    bind(root);
    return;
  }
  root.innerHTML = `<div class="stage phase-${p.phase}">${progressBar()}${phaseHTML()}</div>`;
  const preview = root.querySelector<HTMLVideoElement>('#preview');
  if (preview && p.recorder?.stream) preview.srcObject = p.recorder.stream;
  if (p.phase === 'review' && p.take) {
    bindReview(root.querySelector<HTMLElement>('.review')!, p.take, {
      liveBlob: p.liveBlob,
      onDeleted: () => {
        if (!p) return;
        p.sessionTakeIds = p.sessionTakeIds.filter((id) => id !== p!.take?.id);
        retake();
      },
    });
  }
  bind(root);
}

function bind(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) =>
    b.addEventListener('click', () => {
      const a = b.dataset.p;
      switch (a) {
        case 'ready':
        case 'retry-media':
          return void onReady();
        case 'no-record':
          if (p) {
            p.recordMode = 'none';
            p.unsupportedNote = 'Continuing without recording. Your answer will still be timed.';
            return void onReady();
          }
          return;
        case 'skip-speech':
          return cancelSpeech(); // speak() resolves 'cancelled' and the flow continues
        case 'start-now':
          if (!p) return;
          if (p.phase === 'prep') return startResponse();
          return beginPrepOrResponse(p.run);
        case 'stop':
          return void finishResponse();
        case 'pause':
          return togglePause();
        case 'retake':
          return retake();
        case 'next':
          return next();
        case 'end':
          if (p?.phase === 'recording' && !confirm('End the session? Your current answer will be stopped and saved.')) return;
          return endSession(true);
        case 'done':
          return endSession(false);
        case 'to-history':
          teardown();
          state.view = 'history';
          return rerender();
        case 'close':
        case 'to-questions':
          teardown();
          state.view = 'questions';
          return rerender();
      }
    }),
  );
}
