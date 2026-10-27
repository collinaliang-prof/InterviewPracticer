# Interview Practice

A private, browser-only interview practice app. Paste questions, have them read aloud, record an audio or video answer, then review it with notes, a structure self-check, and transcript-based filler-word counts.

No account, server, database, API key, analytics, or uploads. Everything lives in this browser profile.

## Run locally

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL. `localhost` counts as a secure context, so camera/microphone work.

## Deploy to Netlify

`netlify.toml` sets the build (`npm run build`) and publish directory (`dist`), plus security headers (CSP allowing only same-origin resources and `blob:` media, and a Permissions-Policy limiting camera/mic to this origin). Connect the repo in Netlify, or deploy the built folder:

```bash
npm run build && npx netlify deploy --prod --dir=dist
```

No functions or redirects are needed — the app has no client-side routes. Netlify serves over HTTPS, which the media APIs require.

## Structure

| File | Responsibility |
|---|---|
| `src/types.ts` | Data shapes, defaults, `DATA_VERSION` |
| `src/local.ts` | localStorage for questions/settings, with in-memory fallback and versioned envelope |
| `src/db.ts` | IndexedDB for takes, sessions and media blobs; skips corrupt records; in-memory fallback |
| `src/speech.ts` | `SpeechSynthesis` wrapper with watchdog so a silent engine can't stall a session |
| `src/recorder.ts` | `getUserMedia` + `MediaRecorder`, runtime MIME selection, track release, error messages |
| `src/timer.ts` | Pausable countdown / elapsed timer |
| `src/coaching.ts` | Filler counting, structure checklist, optional `SpeechRecognition` live transcript |
| `src/practice.ts` | Session state machine: ready → speak → prep → record → save → review → next/summary |
| `src/questions.ts`, `src/history.ts`, `src/settings.ts`, `src/review.ts` | Views |

## Behaviour notes

- Media is requested only after **Ready** is pressed, and tracks are stopped after each answer, on session end, and when leaving the Practice tab (an in-progress answer is stopped and saved).
- If saving a recording fails (quota, private mode), the take is still shown with in-page playback and a **Download** link, and the page warns before unload.
- Filler counts run only on a transcript you paste (or an optional live browser transcript, off by default — Chrome's recognition is server-side, which the Settings page explains).
- **Settings → Your data** shows a storage estimate, can request persistent storage, downloads a JSON backup of metadata (no recordings), and deletes everything.

## Test on target devices

Check on each real browser you care about: permission prompts, `MediaRecorder` MIME types (Safari records MP4, Chrome/Firefox WebM — shown on the Settings page), available voices, and IndexedDB behaviour in private windows.
