// Media capture: getUserMedia + MediaRecorder, with runtime MIME selection
// and guaranteed track release.

export type MediaKind = 'audio' | 'video';

const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function mediaSupport(): { getUserMedia: boolean; recorder: boolean; secure: boolean } {
  return {
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    recorder: typeof MediaRecorder !== 'undefined',
    secure: window.isSecureContext,
  };
}

export function pickMimeType(kind: MediaKind): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return (kind === 'video' ? VIDEO_TYPES : AUDIO_TYPES).find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

/** Plain-language explanation of a getUserMedia failure. */
export function describeMediaError(e: unknown, kind: MediaKind): string {
  const name = (e as DOMException)?.name ?? '';
  const dev = kind === 'video' ? 'camera and microphone' : 'microphone';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Access to your ${dev} was blocked. Allow it in your browser's site settings (usually the icon in the address bar), then retry.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${dev} was found. Connect a device and retry.`;
    case 'NotReadableError':
    case 'AbortError':
      return `Your ${dev} seems to be in use by another app or tab. Close it there and retry.`;
    default:
      return `Couldn't start your ${dev}. You can retry or practice without recording.`;
  }
}

export class Recorder {
  stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  mimeType = '';

  constructor(readonly kind: MediaKind) {}

  async acquire(): Promise<MediaStream> {
    if (this.stream) return this.stream;
    this.stream = await navigator.mediaDevices.getUserMedia(
      this.kind === 'video' ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } } : { audio: true },
    );
    return this.stream;
  }

  start(): void {
    if (!this.stream) throw new Error('No media stream');
    const type = pickMimeType(this.kind);
    this.chunks = [];
    this.rec = type ? new MediaRecorder(this.stream, { mimeType: type }) : new MediaRecorder(this.stream);
    this.mimeType = this.rec.mimeType || type || (this.kind === 'video' ? 'video/webm' : 'audio/webm');
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(1000);
  }

  get recording(): boolean {
    return this.rec?.state === 'recording' || this.rec?.state === 'paused';
  }

  pause(): void {
    if (this.rec?.state === 'recording') this.rec.pause();
  }

  resume(): void {
    if (this.rec?.state === 'paused') this.rec.resume();
  }

  /** Stops recording and resolves with the captured blob (may be empty). */
  stop(): Promise<Blob> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') return Promise.resolve(new Blob(this.chunks, { type: this.mimeType }));
    return new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(this.chunks, { type: this.mimeType }));
      try {
        rec.stop();
      } catch {
        resolve(new Blob(this.chunks, { type: this.mimeType }));
      }
    });
  }

  /** Release camera/microphone. Safe to call repeatedly. */
  release(): void {
    try {
      if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    } catch {
      /* ignore */
    }
    this.rec = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

export function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return mime.startsWith('audio') ? 'm4a' : 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}
