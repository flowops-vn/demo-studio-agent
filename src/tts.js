// Text-to-speech with a content-addressed cache. Every provider returns
// { file, ms } where file is an audio file ffmpeg can read.
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './proc.js';

export const CACHE = process.env.DEMO_STUDIO_CACHE || join(homedir(), '.cache', 'demo-studio', 'tts');

export const DEFAULT_VOICE = { provider: 'edge', name: 'vi-VN-HoaiMyNeural', rate: '+0%' };

export async function probeMs(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Math.round(parseFloat(out.trim()) * 1000);
}

const inflight = new Map();
// Concurrent requests for the same clip share one synthesis.
export function synth(text, voice = DEFAULT_VOICE) {
  const k = JSON.stringify([voice, text]);
  if (!inflight.has(k)) inflight.set(k, synthOnce(text, voice).finally(() => setTimeout(() => inflight.delete(k), 1000)));
  return inflight.get(k);
}
async function synthOnce(text, voice) {
  voice = { ...DEFAULT_VOICE, ...voice };
  const key = createHash('sha1').update(JSON.stringify([voice.provider, voice.name, voice.rate, voice.pitch, voice.model, voice.style, text])).digest('hex').slice(0, 16);
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, key + '.mp3');
  if (!existsSync(file) || (await stat(file)).size < 200) {
    const p = PROVIDERS[voice.provider];
    if (!p) throw new Error('unknown tts provider ' + voice.provider + ' (edge|say|openai|gemini)');
    let lastErr;
    for (let i = 0; i < 5; i++) {
      try { await p(text, voice, file); lastErr = null; break; }
      catch (e) { lastErr = e; const drop = /Stream closed|turn\.end|ECONNRESET|socket/i.test(e.message); await new Promise(r => setTimeout(r, drop ? 80 : 1000 * (i + 1))); }
    }
    if (lastErr) throw new Error('tts failed (' + voice.provider + '): ' + lastErr.message + (voice.provider === 'edge' ? ' — network/DNS issue? retry, or use voice: {provider: say, name: Linh} offline' : ''));
  }
  return { file, ms: await probeMs(file) };
}

// Synthesize many texts with bounded concurrency; returns Map(text -> {file, ms}).
export async function synthAll(texts, voice, concurrency = 4) {
  const uniq = [...new Set(texts.filter(Boolean))], out = new Map();
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, uniq.length) }, async () => {
    while (i < uniq.length) { const t = uniq[i++]; out.set(t, await synth(t, voice)); }
  }));
  return out;
}

async function toMp3(src, dst) {
  await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ac', '1', '-ar', '24000', '-b:a', '96k', dst + '.tmp.mp3']);
  await rename(dst + '.tmp.mp3', dst);
}

const PROVIDERS = {
  // Microsoft Edge read-aloud voices: free, no key, good Vietnamese (HoaiMy, NamMinh).
  async edge(text, v, file) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS();
    const dir = await mkdtemp(join(tmpdir(), 'ds-edge-'));
    try {
      await tts.setMetadata(v.name, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const prosody = {}; if (v.rate) prosody.rate = v.rate; if (v.pitch) prosody.pitch = v.pitch;
      const r = await tts.toFile(dir, text, prosody);
      await rename(r.audioFilePath, file);
    } finally { tts.close(); await rm(dir, { recursive: true, force: true }); }
  },
  // macOS offline fallback (voice "Linh" for Vietnamese).
  async say(text, v, file) {
    const aiff = file + '.aiff';
    const args = ['-o', aiff]; if (v.name && !v.name.includes('Neural')) args.unshift('-v', v.name); else args.unshift('-v', 'Linh');
    if (v.wpm) args.unshift('-r', String(v.wpm));
    await run('say', [...args, text]);
    await toMp3(aiff, file); await rm(aiff, { force: true });
  },
  // Any OpenAI-compatible /audio/speech endpoint (OpenAI, AI gateway...).
  async openai(text, v, file) {
    const base = (v.baseURL || process.env.DEMO_TTS_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const key = v.apiKey || process.env.DEMO_TTS_API_KEY || process.env.OPENAI_API_KEY;
    const res = await fetch(base + '/audio/speech', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: v.model || 'gpt-4o-mini-tts', voice: v.name?.includes('Neural') ? 'alloy' : (v.name || 'alloy'), input: text, instructions: v.style, response_format: 'mp3' })
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  },
  // Gemini native TTS (24kHz PCM). "style" becomes a natural-language direction.
  async gemini(text, v, file) {
    const key = v.apiKey || process.env.DEMO_TTS_GEMINI_KEY || process.env.GEMINI_API_KEY;
    const model = v.model || 'gemini-2.5-flash-preview-tts';
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: v.style ? v.style + ': ' + text : text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.name?.includes('Neural') ? 'Kore' : (v.name || 'Kore') } } } } })
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
    const j = await res.json();
    const b64 = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
    if (!b64) throw new Error('no audio in gemini response');
    const pcm = file + '.pcm'; await writeFile(pcm, Buffer.from(b64, 'base64'));
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, '-b:a', '96k', file + '.tmp.mp3']);
    await rename(file + '.tmp.mp3', file); await rm(pcm, { force: true });
  }
};

export async function listVoices(lang = 'vi') {
  const { MsEdgeTTS } = await import('msedge-tts');
  const tts = new MsEdgeTTS();
  try { return (await tts.getVoices()).filter(v => !lang || v.Locale.toLowerCase().startsWith(lang.toLowerCase())).map(v => ({ name: v.ShortName, gender: v.Gender, locale: v.Locale })); }
  finally { tts.close(); }
}
