// QR rendering (crisp, mixed-mode segments) and camera scanning.
// iOS has no BarcodeDetector, so jsQR is the fallback (plan §9-1). It is ~130KB, so it is
// its own chunk, fetched only when a scanner actually needs it (not at startup).
import qrcode from 'qrcode-generator';
import { h } from './ui';

type JsQr = typeof import('jsqr').default;
let jsQrLoad: Promise<JsQr | null> | null = null;
/** The decoder, or null if it could not be fetched (retried on the next scan). */
const loadJsQr = (): Promise<JsQr | null> =>
  (jsQrLoad ??= import('jsqr').then(
    (m) => m.default,
    () => {
      jsQrLoad = null;
      return null;
    },
  ));

/** Render `prefix` (byte mode) + `code` (alphanumeric mode) to a canvas. */
export function renderQr(code: string, prefix = ''): HTMLCanvasElement {
  const qr = qrcode(0, 'L');
  if (prefix) qr.addData(prefix, 'Byte');
  qr.addData(code, 'Alphanumeric');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  const scale = Math.max(4, Math.floor(720 / (n + quiet * 2)));
  const size = (n + quiet * 2) * scale;
  const c = h('canvas', { width: String(size), height: String(size) }) as HTMLCanvasElement;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#05070d';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect((col + quiet) * scale, (r + quiet) * scale, scale, scale);
  return c;
}

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export class QrScanner {
  el: HTMLElement;
  private video: HTMLVideoElement;
  private status: HTMLElement;
  private canvas = document.createElement('canvas');
  private timer = 0;
  private stopped = false;
  private detector: Detector | null = null;
  private busy = false;

  constructor(private stream: MediaStream, private onResult: (text: string) => boolean | Promise<boolean>) {
    this.video = h('video', { playsinline: true, muted: true, autoplay: true }) as HTMLVideoElement;
    this.video.muted = true;
    this.video.setAttribute('playsinline', '');
    this.video.srcObject = stream;
    this.status = h('div', { class: 'status' }, 'QRを枠に合わせてください');
    this.el = h('div', { class: 'scanner' }, this.video, h('div', { class: 'frame' }), h('div', { class: 'laser' }), this.status);
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    if (BD) {
      try {
        this.detector = new BD({ formats: ['qr_code'] });
      } catch {
        this.detector = null;
      }
    }
    if (!this.detector) void loadJsQr(); // start fetching while the camera warms up
    void this.video.play().catch(() => undefined);
    this.timer = window.setInterval(() => void this.scan(), 120);
  }

  setStatus(t: string): void {
    this.status.textContent = t;
  }

  private async scan(): Promise<void> {
    if (this.stopped || this.busy || this.video.readyState < 2) return;
    this.busy = true;
    try {
      let text: string | null = null;
      if (this.detector) {
        try {
          const r = await this.detector.detect(this.video);
          if (r.length) text = r[0].rawValue;
        } catch {
          this.detector = null;
        }
      }
      const jsQR = text ? null : await loadJsQr();
      if (jsQR) {
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        const k = Math.min(1, 720 / Math.max(vw, vh));
        const w = Math.round(vw * k);
        const hh = Math.round(vh * k);
        if (this.canvas.width !== w) {
          this.canvas.width = w;
          this.canvas.height = hh;
        }
        const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(this.video, 0, 0, w, hh);
        const img = ctx.getImageData(0, 0, w, hh);
        const r = jsQR(img.data, w, hh, { inversionAttempts: 'dontInvert' });
        if (r?.data) text = r.data;
      }
      if (text && !this.stopped) {
        const ok = await this.onResult(text);
        if (ok) this.stop(false);
      }
    } finally {
      this.busy = false;
    }
  }

  stop(stopStream = true): void {
    this.stopped = true;
    clearInterval(this.timer);
    if (stopStream) this.stream.getTracks().forEach((t) => t.stop());
  }
}
