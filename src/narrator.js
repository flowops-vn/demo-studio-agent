// Narration: pre-synthesized clips, played on the speakers in live mode and
// logged with recording-time offsets so finalize() can lay them on the video.
import { spawn } from 'node:child_process';
import { synth, synthAll } from './tts.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Split narration into caption-sized chunks at sentence, then clause, boundaries.
export function chunkText(text, max = 84) {
  const out = [];
  for (const sentence of text.split(/(?<=[.!?…;:])\s+/)) {
    if (sentence.length <= max) { if (sentence.trim()) out.push(sentence.trim()); continue; }
    let buf = '';
    for (const part of sentence.split(/(?<=,)\s+|\s+(?=(?:và|nhưng|rồi|để|khi|sau đó|and|but|then|so)\s)/)) {
      if ((buf + ' ' + part).trim().length > max && buf) { out.push(buf.trim()); buf = part; } else buf = (buf + ' ' + part).trim();
      while (buf.length > max * 1.3) { const cut = buf.lastIndexOf(' ', max); out.push(buf.slice(0, cut).trim()); buf = buf.slice(cut).trim(); }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

function play(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['afplay', [file]] : ['ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file]];
  return new Promise(res => { const p = spawn(cmd, args, { stdio: 'ignore' }); p.on('close', res); p.on('error', res); });
}

export class Narrator {
  constructor({ voice, live, dry, clock, onCaption, captions = true }) {
    Object.assign(this, { voice, live, dry, clock, onCaption, captions });
    this.segments = []; this.pending = Promise.resolve(); this.speaking = false;
  }
  async durationOf(text, voice = this.voice) { return this.dry ? Math.min(400, 30 * text.length) : (await synth(text, voice)).ms; }
  // items: strings (default voice) or {text, voice} (a dialogue line spoken by another voice).
  prepare(items) {
    if (this.dry) return null;
    const groups = new Map();
    for (const it of items) { const v = typeof it === 'string' ? this.voice : it.voice || this.voice, k = JSON.stringify(v); if (!groups.has(k)) groups.set(k, { v, texts: [] }); groups.get(k).texts.push(typeof it === 'string' ? it : it.text); }
    return Promise.all([...groups.values()].map(g => synthAll(g.texts, g.v)));
  }
  // Starts speaking after any earlier narration ends; resolves when this one ends.
  // Returns a promise for the end of speech with .started resolving when audio begins.
  say(text, opts = {}) {
    let markStarted; const started = new Promise(r => (markStarted = r));
    const run = this.pending.then(() => this._say(text, { ...opts, markStarted })).finally(() => markStarted());
    this.pending = run.catch(() => {});
    run.started = started;
    return run;
  }
  // Live sessions cannot wait on a slow TTS service: past the budget, fall back to the local voice.
  async clipFor(text, v = this.voice) {
    if (this.dry) return { file: null, ms: Math.min(400, 30 * text.length) };
    const primary = synth(text, v);
    // Local VieNeu synthesizes a sentence in ~1–3 s on a laptop CPU: give it longer before falling back.
    const budget = v.budgetMs ?? (this.live ? (v.provider === 'vieneu' ? 6000 : 1500) : 0);
    if (!budget || v.provider === 'say' || v.fallback === false) return primary;
    const first = await Promise.race([primary, new Promise(r => setTimeout(() => r(null), budget))]).catch(() => null);
    if (first) return first;
    primary.catch(() => {}); // keep warming the cache for a later recording
    this.fallbacks = (this.fallbacks || 0) + 1;
    return synth(text, { provider: 'say', name: v.fallbackVoice || 'Linh', wpm: v.fallbackWpm });
  }
  async _say(text, { caption = this.captions, markStarted, voice, label } = {}) {
    const v = voice || this.voice;
    const clip = await this.clipFor(text, v);
    // A breath between consecutive sentences, as a presenter takes (voice.gap ms).
    const gap = this.dry ? 0 : v.gap ?? 300;
    if (gap && this.lastEnd) { const w = this.lastEnd + gap - performance.now(); if (w > 0) await sleep(w); }
    this.speaking = true;
    // Steps use this to time their actions against the words (cues.js).
    markStarted?.({ ms: clip.ms, voiced: clip.voiced, wall: performance.now(), text, voice: v });
    const start = this.clock();
    // Dialogue lines carry the speaker's name in the caption ("Chị Lan: …"); the voice does not say it.
    const chunks = chunkText(text).map((c, i) => (label && i === 0 ? label + ': ' + c : c)), total = chunks.reduce((s, c) => s + c.length, 0) || 1;
    let at = 0; const timed = chunks.map(c => { const s = at; at += clip.ms * c.length / total; return { text: c, start: start + s, end: start + at }; });
    const seg = { text, ...(label ? { speaker: label } : {}), start, ms: clip.ms, file: clip.file, chunks: timed };
    this.segments.push(seg);
    const timers = [];
    if (caption) { let acc = 0; for (const c of timed) { const d = acc; timers.push(setTimeout(() => this.onCaption?.(c.text), d)); acc += c.end - c.start; } }
    try {
      await Promise.all([this.live && clip.file ? play(clip.file) : null, sleep(clip.ms)]);
    } finally {
      timers.forEach(clearTimeout); if (caption) this.onCaption?.(null);
      this.speaking = false; this.lastEnd = performance.now();
      this.onEnd?.();
    }
    return seg;
  }
  // Drop narration that falls inside [from, to) recording time (used by cuts).
  dropBetween(from, to) { this.segments = this.segments.filter(s => s.start < from || s.start >= to); }
}
