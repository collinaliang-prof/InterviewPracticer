// Settings view: speech, prep time, coaching options, browser support and data management.
import { recognitionSupported } from './coaching';
import * as db from './db';
import { clearLocal, localAvailable } from './local';
import { discardSession } from './practice';
import { mediaSupport, pickMimeType } from './recorder';
import { announce, esc, objectURL, rerender, state, updateSettings } from './state';
import { cancelSpeech, getVoices, speak, speechSupported } from './speech';
import { DEFAULT_FILLERS, DEFAULT_SETTINGS, DATA_VERSION } from './types';

let storageInfo = '';
let idbOk: boolean | null = null;

function yes(ok: boolean, text: string, fallback: string): string {
  return `<li><span class="badge ${ok ? 'ok' : 'no'}">${ok ? 'Available' : 'Unavailable'}</span> <span>${text}${ok ? '' : ` — <span class="muted">${fallback}</span>`}</span></li>`;
}

function supportHTML(): string {
  const m = mediaSupport();
  const audioType = pickMimeType('audio');
  const videoType = pickMimeType('video');
  return `
    <ul class="support" role="list">
      ${yes(m.secure, 'Secure context (HTTPS)', 'camera and microphone need HTTPS')}
      ${yes(speechSupported() && getVoices().length > 0, 'Read questions aloud', 'questions are shown on screen; start manually')}
      ${yes(m.getUserMedia && m.recorder, `Recording${m.recorder ? ` <span class="muted small">(${esc(audioType || 'default')} / ${esc(videoType || 'default')})</span>` : ''}`, 'you can still practice with the timer')}
      ${yes(idbOk !== false, 'Recording storage (IndexedDB)', 'recordings last only until you leave the page')}
      ${yes(localAvailable(), 'Settings storage (localStorage)', 'settings and questions last only for this tab')}
      ${yes(recognitionSupported(), 'Speech recognition (optional)', 'paste a transcript instead')}
    </ul>`;
}

export function renderSettings(root: HTMLElement): void {
  const s = state.settings;
  const voices = getVoices();
  const voiceOptions = voices
    .map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === s.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})${v.default ? ' — default' : ''}</option>`)
    .join('');

  root.innerHTML = `
    <section class="panel" aria-labelledby="sp-h">
      <h2 id="sp-h">Read-aloud</h2>
      ${
        speechSupported()
          ? `<label class="check-inline"><input type="checkbox" id="speechOn" ${s.speechOn ? 'checked' : ''}/> Read each question aloud after I press Ready</label>
             <div class="setup-grid">
               <label class="field"><span>Voice</span>
                 <select id="voice" ${voices.length ? '' : 'disabled'}>
                   <option value="">System default</option>${voiceOptions}
                 </select>
               </label>
               <label class="field"><span>Speed <output id="rate-out">${s.rate.toFixed(1)}×</output></span>
                 <input type="range" id="rate" min="0.6" max="1.6" step="0.1" value="${s.rate}" />
               </label>
             </div>
             ${voices.length ? '' : '<p class="muted small">No voices reported yet. Some browsers load them after a moment.</p>'}
             <button type="button" class="btn" id="test-voice">Test voice</button>`
          : '<p class="banner warn">This browser doesn’t support read-aloud. Questions will be shown on screen and you can start answering manually.</p>'
      }
    </section>

    <section class="panel" aria-labelledby="pr-h">
      <h2 id="pr-h">Preparation pause</h2>
      <label class="field"><span>Thinking time after the question is read (you can always skip it)</span>
        <select id="prep">
          ${[0, 5, 10, 15, 30, 60].map((n) => `<option value="${n}" ${n === s.prepSec ? 'selected' : ''}>${n ? `${n} seconds` : 'None — start right away'}</option>`).join('')}
        </select>
      </label>
    </section>

    <section class="panel" aria-labelledby="co-h">
      <h2 id="co-h">Coaching</h2>
      <label class="field"><span>Filler words and phrases to count (comma-separated)</span>
        <textarea id="fillers" rows="2">${esc(s.fillers.join(', '))}</textarea>
      </label>
      <button type="button" class="btn small ghost" id="reset-fillers">Reset to defaults</button>
      <hr />
      ${
        recognitionSupported()
          ? `<label class="check-inline"><input type="checkbox" id="liveTranscript" ${s.liveTranscript ? 'checked' : ''}/> Make a live transcript while I answer (optional)</label>
             <p class="banner warn small">Browser speech recognition is often inaccurate, and some browsers (including Chrome) process it on the browser maker’s servers rather than on this device. Leave this off to keep audio fully local — you can always paste a transcript instead.</p>`
          : '<p class="muted">Live transcripts aren’t available in this browser. You can paste a transcript on any take to count filler words.</p>'
      }
    </section>

    <section class="panel" aria-labelledby="su-h">
      <h2 id="su-h">Browser support</h2>
      ${supportHTML()}
    </section>

    <section class="panel" aria-labelledby="da-h">
      <h2 id="da-h">Your data</h2>
      <p>Questions, notes, settings and recordings are stored only in this browser profile on this device. They aren’t backed up or synced.
         Clearing site data, private browsing, or the browser freeing up space can remove them. Download anything you want to keep.</p>
      <p class="muted" id="storage-info">${esc(storageInfo || 'Checking storage use…')}</p>
      <div class="row wrap">
        <button type="button" class="btn" id="persist">Ask browser to keep data</button>
        <button type="button" class="btn" id="export">Download backup (questions, notes, history — no recordings)</button>
        <button type="button" class="btn danger" id="clear">Delete all practice data</button>
      </div>
    </section>`;

  bind(root);
  void refreshStorage(root);
}

async function refreshStorage(root: HTMLElement): Promise<void> {
  const prevIdb = idbOk;
  idbOk = await db.dbAvailable();
  let info = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) {
      const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB';
      info = `Approximate storage used by this site: ${mb(est.usage)}${est.quota ? ` of about ${mb(est.quota)} available` : ''}. This is an estimate, not a guarantee.`;
    }
    const persisted = await navigator.storage?.persisted?.();
    if (persisted) info += ' The browser has agreed to keep this data unless you clear it.';
  } catch {
    /* estimate unsupported */
  }
  storageInfo = info || 'Storage use estimate isn’t available in this browser.';
  const el = root.querySelector('#storage-info');
  if (el) el.textContent = storageInfo;
  if (prevIdb !== idbOk && root.isConnected && state.view === 'settings') rerender();
}

function bind(root: HTMLElement): void {
  const on = <K extends keyof HTMLElementEventMap>(sel: string, ev: K, fn: (el: HTMLElement) => void) => {
    const el = root.querySelector<HTMLElement>(sel);
    el?.addEventListener(ev, () => fn(el));
  };

  on('#speechOn', 'change', (el) => updateSettings({ speechOn: (el as HTMLInputElement).checked }));
  on('#voice', 'change', (el) => updateSettings({ voiceURI: (el as HTMLSelectElement).value }));
  on('#rate', 'input', (el) => {
    const rate = Number((el as HTMLInputElement).value);
    updateSettings({ rate });
    root.querySelector('#rate-out')!.textContent = `${rate.toFixed(1)}×`;
  });
  on('#test-voice', 'click', async () => {
    cancelSpeech();
    const r = await speak('Tell me about a time you solved a difficult problem.', { voiceURI: state.settings.voiceURI, rate: state.settings.rate });
    if (r === 'error') announce('Read-aloud failed on this device.', true);
  });
  on('#prep', 'change', (el) => updateSettings({ prepSec: Number((el as HTMLSelectElement).value) }));
  on('#fillers', 'change', (el) => {
    const list = (el as HTMLTextAreaElement).value
      .split(',')
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean);
    updateSettings({ fillers: list.length ? list : DEFAULT_FILLERS });
    announce('Filler list saved');
  });
  on('#reset-fillers', 'click', () => {
    updateSettings({ fillers: DEFAULT_FILLERS });
    rerender();
  });
  on('#liveTranscript', 'change', (el) => updateSettings({ liveTranscript: (el as HTMLInputElement).checked }));

  on('#persist', 'click', async () => {
    if (!navigator.storage?.persist) {
      announce('This browser doesn’t support persistent storage requests.', true);
      return;
    }
    const ok = await navigator.storage.persist().catch(() => false);
    announce(ok ? 'The browser will try to keep your data. Downloads are still the safest backup.' : 'The browser declined. Your data may be cleared if space runs low.', true);
    void refreshStorage(root);
  });

  on('#export', 'click', () => {
    const data = {
      app: 'interview-practice',
      v: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      questions: state.questions,
      settings: state.settings,
      sessions: state.sessions,
      takes: state.takes, // metadata only; media blobs are not included
    };
    const url = objectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-practice-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  on('#clear', 'click', async () => {
    if (!confirm('Delete all questions, notes, recordings, history and settings stored by this app in this browser? This cannot be undone.')) return;
    try {
      await db.clearAll();
    } catch {
      announce('Some stored recordings could not be deleted. Try clearing site data in your browser settings.', true);
    }
    discardSession();
    clearLocal();
    state.questions = [];
    state.takes = [];
    state.sessions = [];
    state.excluded.clear();
    state.openTakeId = null;
    Object.assign(state.settings, structuredClone(DEFAULT_SETTINGS));
    announce('All practice data deleted');
    rerender();
  });
}
