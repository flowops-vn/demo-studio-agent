# demo-studio

Narrated, annotated browser demos that an AI agent can produce end to end.

- **Live demo** — headed Chrome, animated cursor + presenter annotations, voice on the speakers.
- **Video record** — the same show rendered headless to a 1080p H.264 mp4 with voice-over,
  captions (burned in + .srt), mp4 chapters and a contact sheet for self-review.

Built on Playwright (system Chrome via `channel: chrome`), Playwright's screencast frames,
Chrome pinch-zoom, Microsoft Edge neural TTS (free, good Vietnamese) or local VieNeu-TTS, and ffmpeg.

## Install (Claude Code plugin)

```
/plugin marketplace add flowops-vn/demo-studio-agent
/plugin install demo-studio@demo-studio-agent
```

The plugin adds the `demo-video` skill and puts `demo-studio` on the PATH of Claude's shell (npm
dependencies are installed by Claude Code). Once per machine: `brew install ffmpeg` and
`demo-studio install` (Chrome for Testing, for headless recordings). A SessionStart hook reports
anything missing. Node 20+.

Voices: Edge neural voices by default (online, no key). `provider: vieneu` runs VieNeu-TTS v3 Turbo
locally on the CPU (Vietnamese, 25 preset voices, `demo-studio voices vieneu`); it needs `uv` and downloads
~0.6 GB of model files on first use.

Optional TTS keys (Edge voices need none): `DEMO_TTS_BASE_URL` + `DEMO_TTS_API_KEY` for an
OpenAI-compatible `/audio/speech`, `DEMO_TTS_GEMINI_KEY` for Gemini.

Without the plugin: `npm install` here, link `bin/demo-studio` onto your PATH and
`skills/demo-video` into `~/.claude/skills/`.

## Usage

```
demo-studio run demo.yaml            # record (headless) → demo-out/<name>-<ts>/<name>.mp4
demo-studio run demo.yaml --live     # present live
demo-studio run demo.yaml --dry      # 5-second validation pass
demo-studio serve --url URL          # agent-driven session; do / snap / peek / undo / stop
demo-studio voices vi | say "…" | auth URL --save auth.json
```

The agent-facing guide (workflow, script schema, narration rules) is `skills/demo-video/SKILL.md`
(the plugin's `demo-video` skill). `examples/smoke.yaml` is a runnable sample
against `examples/fixture/index.html`.

## How it works

| Piece | File | Notes |
|---|---|---|
| Overlay | `src/overlay.js` | Injected with `addInitScript` into a shadow root on `<html>`; page-space layer (cursor, spotlight, rings, callouts tracked per frame via `data-ds-target`) and screen-space layer (caption, chapter pill, title card, key chips) counter-scaled against `visualViewport` so it stays fixed during pinch-zoom. |
| Session | `src/session.js` | Steps → Playwright actions with an eased cursor move before every pointer action; follows popups; logs a replayable `script.yaml` (aria refs converted to stable selectors). |
| Recorder | `src/recorder.js` | `page.screencast` JPEG frames → ffmpeg at constant fps keyed to wall-clock; pausable, which is how idle/page-load time is trimmed. |
| Narrator | `src/narrator.js` | TTS clips synthesized up front (cached in `~/.cache/demo-studio/tts`); live mode plays them with `afplay`; logs recording-time offsets; splits captions into chunks. |
| Finalize | `src/finalize.js` | Cuts (failed/undone steps), `adelay`+`amix` voice track, optional ducked music, loudnorm, chapters, SRT, contact sheet. |
| Frame | `src/finalize.js` | Optional wallpaper/gradient background, rounded-corner mask and blurred drop shadow, pre-rendered as stills and composited by ffmpeg. |
| Observe | `src/observe.js` | One in-page pass (after browser-use/jev-ultrafast): visible, uncovered controls + text in reading order tagged `data-ds-id` (`e7`/`t12`); adaptive settle (DOM quiet + no request in flight) and wait-for-change with a page-wide mutation counter. |
| Stage | `src/stage.js` | Multi-app sessions (`apps:` + `on:`): one browser context per app; the recorder feeds one stream per app off a shared clock, then ffmpeg composes them on a Chrome-rendered stage (wallpaper, phone bezels, labels) with the inactive app dimmed (`layout.mode: split`) or as corner tiles (`focus`). Live mode tiles one window per app. |
| Theme | `src/theme.js` | Finds/merges the project's `.demo-studio/theme.yaml`; `theme init` scans the code and the live app (colours normalised to hex by Chrome), derives surfaces and wallpaper from the accent, renders previews. |
| Server | `src/server.js` | Localhost HTTP for step-by-step control; every response carries the new observation; speech is asynchronous (the agent thinks while the sentence plays); recording pauses when idle and while TTS synthesizes. |

## Theme from the product's codebase

Recordings look like the product, not like demo-studio: `demo-studio theme init --url <app url>`
writes `.demo-studio/theme.yaml` into the repo being demoed (accent, surfaces, ink, font, logo, wallpaper),
derived from its CSS variables / Tailwind config / DESIGN.md / logo files and the running app, and prints
preview PNGs. `run` and `serve` pick the file up by walking up from the script (then the cwd); a script's
own `theme:`/`frame:` keys still win. `examples/.demo-studio/theme.yaml` is the sample.

## Output folder

`<name>.mp4`, `<name>.srt`, `chapters.txt`, `contact.jpg`, `timeline.json` (narration/chapter
times), `script.yaml` (what actually ran), `error-*.png` on failures.

## Limits

- Chromium only; one active tab per app is recorded at a time (several apps: see `examples/multi.yaml`).
- Under pinch-zoom, pointer input goes through `page.mouse` (layout px minus visual-viewport offset); if the target is covered it falls back to an unzoomed `locator.click()`.
- Branded Chrome 158+ exits headless sessions after ~30 s; headless uses Chrome for Testing (`demo-studio install`).
- `examples/showcase.yaml` exercises ink, slides, whiteboard, autoZoom and frame.
- Edge TTS is an unofficial endpoint; fall back to `say` (macOS), `openai` or `gemini`.
