// Turns Playwright screencast frames (JPEG, emitted only when pixels change)
// into constant-frame-rate H.264 streams whose length equals recording time.
// Recording time excludes paused spans, which is how idle time gets trimmed.
// One recorder can feed several sinks (one per app/page) off the same clock, so
// their frame counts stay identical and the streams line up when composited.
import { spawn } from 'node:child_process';

export class Recorder {
  constructor({ file, width, height, fps = 30, quality = 90, sinks }) {
    this.fps = fps; this.quality = quality;
    this.sinks = (sinks || [{ name: 'main', file, width, height }]).map(s => ({ ...s, last: null, written: 0, page: null }));
    this.pausedAt = null; this.pausedTotal = 0; this.t0 = null;
  }
  get file() { return this.sinks[0].file; }
  sink(name) { return name == null ? this.sinks[0] : this.sinks.find(s => s.name === name); }
  // pages: a Page (single sink) or {name: Page}.
  async start(pages) {
    for (const s of this.sinks) {
      s.ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(this.fps), '-i', '-',
        '-vf', 'scale=' + s.width + ':' + s.height + ':flags=lanczos,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(this.fps), '-movflags', '+faststart', s.file], { stdio: ['pipe', 'ignore', 'pipe'] });
      s.err = ''; s.ff.stderr.on('data', d => (s.err += d));
      s.done = new Promise((res, rej) => s.ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg recorder exited ' + c + ': ' + s.err.slice(-500))))));
      s.ff.stdin.on('error', () => {});
    }
    this.t0 = performance.now();
    if (pages && typeof pages.screencast === 'object') await this.attach(pages);
    else for (const [name, p] of Object.entries(pages || {})) await this.attach(p, name);
    this.started = true;
    this.timer = setInterval(() => this.pump(), Math.max(5, 500 / this.fps));
  }
  async attach(page, name) {
    const s = this.sink(name); if (!s) return;
    if (s.page && s.page !== page) { try { await s.page.screencast.stop(); } catch {} }
    s.page = page;
    await page.screencast.start({ size: { width: s.width, height: s.height }, quality: this.quality, onFrame: f => { s.last = f.data; } });
  }
  // Milliseconds of recorded (non-paused) time.
  time() { if (this.t0 == null) return 0; return (this.pausedAt ?? performance.now()) - this.t0 - this.pausedTotal; }
  get paused() { return this.pausedAt != null; }
  pump() {
    if (this.pausedAt != null) return;
    const due = Math.floor(this.time() * this.fps / 1000);
    for (const s of this.sinks) { if (!s.last) continue; while (s.written < due) { s.ff.stdin.write(s.last); s.written++; } }
  }
  pause() { if (this.pausedAt != null) return; this.pump(); this.pausedAt = performance.now(); }
  resume() { if (this.pausedAt == null) return; this.pausedTotal += performance.now() - this.pausedAt; this.pausedAt = null; }
  async stop() {
    this.pump(); clearInterval(this.timer);
    for (const s of this.sinks) { try { await s.page?.screencast.stop(); } catch {} s.ff.stdin.end(); }
    await Promise.all(this.sinks.map(s => s.done));
    const ms = Math.round(Math.max(...this.sinks.map(s => s.written)) * 1000 / this.fps);
    return { file: this.file, files: Object.fromEntries(this.sinks.map(s => [s.name, s.file])), ms };
  }
}
