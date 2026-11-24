---
name: demo-video
description: Produce narrated, annotated product demos of a web app with the demo-studio CLI — the agent drives a real browser, adds presenter-style annotations (animated cursor, spotlight, callouts, highlights, zoom, title cards, chapters, captions) and a TTS voice-over. Two modes - live demo (visible browser + narration on the speakers, for presenting to a customer in real time) and video record (headless, outputs a shareable mp4 + srt). Use when the user asks to record/quay a demo video, make a walkthrough/tutorial/hướng dẫn video of a web app, present/live-demo an app with voice, or re-record a demo after UI changes.
---

# demo-video (demo-studio)

CLI: `demo-studio` (on PATH while the demo-studio plugin is enabled; Playwright + Chrome + ffmpeg).
Full reference: ${CLAUDE_PLUGIN_ROOT}/README.md · runnable samples: ${CLAUDE_PLUGIN_ROOT}/examples/.

Prerequisites (the plugin's SessionStart hook reports what is missing): `ffmpeg` on PATH, and for headless
recordings Chrome for Testing (`demo-studio install`, once). Live demos use the system Chrome.

## Pick the mode

| Need | Command |
|---|---|
| Live demo / present to a customer | `demo-studio serve --live --url <url>` → headed Chrome, voice on speakers; then `do` one beat at a time, improvised from the screen (see below). **No YAML, no dry run.** |
| Live and keep a copy | same, plus `--record` |
| Shareable video (default) | `demo-studio run demo.yaml` → headless, 1920x1080 mp4 + srt + chapters |
| Check a video script quickly | `demo-studio run demo.yaml --dry` (no TTS, no video, ~5 s) |

Scripts (demo.yaml, `--dry`, `run`) are for **recorded videos** only. `run demo.yaml --live` replays a
rehearsed script on screen; use it only when the user hands you a script and asks for exactly that.
Headless is the right default for recordings: fixed viewport, no window chrome, runs in the
background without touching the user's screen. Use headed only for live presenting.

## Look: the theme comes from the codebase being demoed

Videos and live demos take their colours, font, logo and wallpaper from the product's own codebase,
not from demo-studio defaults. The theme is a file in that repo, `.demo-studio/theme.yaml`, found by
walking up from the demo script (then the cwd); `run`/`serve` print `theme: <path>` or `theme: none`.

Before the first recording or live demo of a codebase:

1. `demo-studio theme show` (from the repo). If it prints a file, use it as is.
2. Otherwise create it: `demo-studio theme init --url <app url> [--dir <repo root>] [--storage auth.json]`.
   It reads the code first (CSS custom properties such as `--primary`/`--brand`, Tailwind `primary`,
   `next/font`, DESIGN.md, `*logo*.svg` or `brand/` files), then the running app (most used colour on
   buttons/links, body font, logo element, favicon), and prints the sources plus two PNGs.
3. Read the PNGs (`preview`: the theme on the app, framed; `title`: the title card). If the accent is not
   the brand colour (e.g. a dark nav colour), or the logo is wrong, fix the yaml by hand from what the
   code/brand files say, then `demo-studio theme preview --url <app url>` again.
4. Tell the user the file was added to their repo; committing it is their call.

Keys: `accent` (cursor halo, rings, chapter badge, slide bullets) · `onAccent` · `surface`/`onSurface`
(captions, callouts, title cards, dark slides) · `ink` (hand-drawn marks) · `font` · `radius` · `logo`
(title cards; `logoBg: none` removes the white chip) · `frame` (wallpaper + rounded window; also the
multi-app stage). A script's own `theme:`/`frame:` keys override single values; `theme: false` ignores the
project theme, `frame: false` records full-bleed.

## Live demo (improvise — like browser-use)

A live demo is a presenter at the keyboard, not a script being played. You already have the overview
(what the product does, the story the user asked for, from the conversation and the codebase); the
screen tells you the rest. So, for "live demo":

- **Do not** write a demo.yaml / live.yaml / steps file, do not `run --dry`, do not explore in a headless
  session first. Saving a file and then running it is the recording workflow, not a live demo.
- **Do** open the visible browser at once with `serve --live`, read the observation, and send one `do`
  per beat: say what is on screen, act, look at the result, decide the next beat from what actually
  appeared (real names, real numbers, the AI's real answer). If the UI differs from what you expected,
  adapt on the spot (narrate it, take the other path) instead of stopping to rewrite anything.
- Narration is written as you go, short and spoken (see Narration below), about what the audience sees now.
- Everything comes from flags: `--storage auth.json` (logged-in state), `--provider vieneu|edge|say`,
  `--voice NAME`, `--rate +8%`. The project theme is picked up from the cwd. `--config file.yaml` is only for
  settings flags cannot express (several `apps:`, permissions); it holds settings, never steps.
- If there is no login state, log in on screen as part of the demo (type into the form; the audience sees it).

```
demo-studio serve --live --url <url> [--storage auth.json] --port 7791   # await with .timeout(15000); prints the first observation
demo-studio do --port 7791 '{say: "…", click: e4}'                    # returns as soon as the actions finish + the new observation
demo-studio look --port 7791                                           # observation only
demo-studio peek --port 7791                                           # screenshot path (Read it) when layout matters
demo-studio stop --port 7791
```

The observation lists visible, uncovered controls `[e7] button "Tạo đơn"` and text `[t12] "Minh An Foods"`
in reading order. **Target by id** (`click: e7`, `type: {node: e3, text: …}`, `circle: t12`):
no selector guessing, no duplicate-text or hidden-element mistakes. Ids come from the latest
observation; after the page changes, use the ids from the response you just got.

Keep it smooth:
- Speech is asynchronous: `do` returns once the actions are done while the sentence keeps playing,
  so think about the next beat during it. A beat with its own `say` starts after the previous
  sentence ends; a silent beat continues the current one.
- One `do` per beat with 1–3 steps; batch only what needs no new observation (ids for a dialog that
  is not open yet do not exist).
- Waiting on the app (AI reply, save): `{wait: {change: true, timeout: 30000, quiet: 800}}`, which
  also catches changes made during the previous action. Otherwise steps settle when the DOM goes quiet.
- `scroll: {y: 600}` wheels at the cursor (or `within: e5`), so dialogs and side panels scroll correctly.
- Slow TTS never blocks: past `voice.budgetMs` (1500 ms live) a sentence uses the local macOS voice
  (`voice.fallbackVoice`, default Linh); actions start at most `leadMax` (1.6 s) after the sentence.
- Logins/onboarding: `permissions: [notifications]` in the config, `storageState` from a
  `{saveState: file.json}` step taken once in a dry session.

## Several apps at once (driver phone + dispatcher, customer + back office…)

Declare `apps` and switch between them with `on:` (a step key, or `do --port … '{on: dispatcher}'`).
Each app is its own browser context: separate login, permissions, device.

```yaml
apps:
  driver:    { label: "App tài xế", device: phone, url: https://…/trips, storageState: auth-driver.json, permissions: [notifications, geolocation] }
  dispatcher: { label: "App điều hành", device: phone, url: https://…, storageState: auth-dispatcher.json }
geolocation: { latitude: 10.97, longitude: 106.49 }   # apps that insist on location
layout: { mode: split }        # split (side by side, inactive app dimmed) | focus (active app large, others as corner tiles)
frame: { background: aurora }  # stage wallpaper
steps:
  - on: driver
    say: "Tài xế gửi chi phí."
    click: e7
  - on: dispatcher
    say: "Điều hành thấy thông báo ngay."
    wait: { role: button, name: "Thông báo, 2 chưa đọc", timeout: 30000 }
```

- `device: phone|tablet|desktop` (phones get mobile emulation and a touch-dot cursor); `viewport` overrides.
- Apps with a `url` open at start. `serve` prints one observation per app; `look --app NAME|all`, `peek --app NAME`.
  Ids are per app: use the ids from that app's observation (the response is tagged `[driver, active]`).
- Live: one Chrome window per app, tiled side by side on the screen. Record (or one phone app): every app is
  captured at its panel size and composed onto one 1080p stage (bezels, labels, dimming); captions follow the active app.
- Waiting for something another app caused (a notification, a status): wait for a target with a timeout
  (`wait: {text: "…", timeout}` / `{role, name}`); `wait: {change}` only compares against the last action in the same app.
- Business routing decides who gets the alert: check who the approver/recipient is before scripting the second app.

## Workflow (scripted video — preferred for recordings)

1. **Explore the app** to learn real labels/selectors. Start a dry session and read the
   accessibility tree:
   ```
   demo-studio serve --dry --url http://localhost:3000 --port 7788   # await with .timeout(8000) so it backgrounds
   demo-studio snap            # aria tree with [ref=eN]
   demo-studio do '{click: {role: link, name: "Đơn hàng"}}'
   demo-studio peek            # screenshot path → Read it
   demo-studio stop
   ```
   Login: `storageState: auth.json` (user runs `! demo-studio auth <url> --save auth.json` once),
   or put login steps at the top wrapped in `record: off` … `record: on`.
2. **Write `demo.yaml`** — one narration beat per step, annotations on the same step as the
   sentence that talks about them. Prefer role/label/placeholder/text targets over CSS.
3. **`demo-studio run demo.yaml --dry`** until every step passes. A failure prints the step
   index and an error screenshot.
4. **Record**: `demo-studio run demo.yaml` (prints JSON with video/srt/contact paths).
5. **QA before delivering**: Read `contact.jpg` (12-frame sheet). For details, pull frames at
   narration times from `timeline.json`: `ffmpeg -ss <sec> -i demo.mp4 -frames:v 1 f.jpg`.
   Check: annotation on the right element, nothing covers the subject, captions readable, no
   long dead frames. Fix the YAML and re-run (TTS is cached, so reruns are cheap).
6. Report the mp4 path (+ chapters.txt for the message to the customer).

## Workflow (interactive, agent-driven recording)

`demo-studio serve --url <url> --name <n>` (record mode). Then send steps with
`demo-studio do '<yaml>'` one beat at a time. Recording **pauses between commands**, so
thinking time never reaches the video; a step that fails is **cut automatically**;
`demo-studio undo` cuts the last successful step. `demo-studio stop` finalizes and writes
`script.yaml` — a replayable script of what was done (re-render later with `run`).
(For live presenting use `serve --live`, see "Live demo": the voice keeps talking while you pick the next beat.)

## demo.yaml

```yaml
name: tao-don-ai
baseURL: http://localhost:3110          # goto paths are relative to this
viewport: [1440, 810]                  # CSS px; rendered to output 1920x1080
voice: { provider: edge, name: vi-VN-HoaiMyNeural, rate: "+8%" }   # male: vi-VN-NamMinhNeural; normalize: false reads text verbatim
voices: { khach: { name: vi-VN-NamMinhNeural, label: "Anh Minh" } }   # optional extra voices for role-play lines (as: khach)
pronounce: { LSP: "lờ ét pê" }         # extra readings; codebase-wide ones live in .demo-studio/pronounce.yaml
theme: { cursor: halo }                # overrides on top of .demo-studio/theme.yaml; cursor: halo|arrow|dot; chapterSticky: true
autoZoom: true                         # Screen Studio-style: zoom in on clicks/typing, out on overview beats (or a scale, e.g. 1.6)
frame: { padding: 72, radius: 20 }     # default from the project theme; background: aurora|midnight|sunset|mist|ocean|#hex|linear:#a,#b|image.jpg; false = full-bleed
storageState: auth.json
music: { file: bgm.mp3, volume: 0.1 }  # optional, auto-ducked under the voice
steps:
  - title: { kicker: "Acme · Demo", text: "Tạo đơn bằng AI", sub: "Acme TMS" }
    say: "Xin chào anh chị, ..."
  - slide: { kicker: "Hôm nay", title: "Ba điểm chính", bullets: ["…", "…", "…"] }   # bullets reveal across the narration
    say: "Hôm nay mình đi qua ba điểm: …"
  - goto: /orders
  - chapter: "Tạo đơn"
    say: "Bấm Tạo đơn để bắt đầu."
    click: { role: button, name: "Tạo đơn" }
  - say: "Nhập tên khách hàng."
    type: { placeholder: "Tên khách hàng", text: "Minh An Foods" }
    callout: { label: "Kho nhận", title: "Mẹo", text: "AI tự gợi ý kho gần nhất" }
  - say: "Tỷ lệ đúng giờ tuần này là chín mươi tư phần trăm."
    arrow: { sel: "#kpi", text: "Cập nhật mỗi giờ" }
    underline: "text=Đúng giờ tuần này"
  - whiteboard: { title: "Luồng xử lý đơn", html: "<svg …>…</svg>" }   # agent-drawn diagram on a dotted board
    say: "Mỗi đơn đi qua ba bước …"
    draw: { points: [[640,640],[700,600],[760,640]] }
```

Step keys (several per step run in written order; `say` starts first and the step ends when
both speech and actions finish):

- Narration: `say` (also shown as caption) · `as: name` (line spoken by one of `voices:`, caption prefixed with its label) · `async: true` (don't wait for speech) · `lead: ms` · `hold: ms` · `keep: true` (don't auto-clear previous annotations)
- Browser: `goto` · `click` · `dblclick` · `hover` · `type {…target, text, enter?, fast?}` · `fill` · `select {…target, value|label}` · `check` · `upload {…target, files}` · `press: "Control+K"` (shows key chips) · `scroll {to: target} | {y: 600} | {within: target, y}` · `wait: ms | target | {url} | {gone: target} | {idle: true}` · `eval: js`
- Annotations: `spotlight` · `highlight` · `callout {…target, text, title?, placement?}` · `zoom: target | {…, scale} | out` · `caption: text|null` · `clear: true` · value `off` removes one kind
- Hand-drawn ink (draw-on animation, tracks the element): `circle` · `box` · `underline` · `arrow {…target, text?, from?: top-left|bottom-right|left…, length?}` — all accept `color`, `width`, `ttl` (auto-erase ms) · `draw: {points: [[x,y]…], color?, ms?, ttl?}` freehand in visible-screen px (also on slides)
- Slides: `slide: {kicker, title, bullets[], html, theme: dark|light|board, keep?}` · `whiteboard: {…}` (= slide on a dotted board) · `slide: off` — bullets reveal progressively over the step's narration; slide hides when the step ends unless `keep: true`
- Session: `grant: [notifications]` · `geolocation: {latitude, longitude}` · `saveState: auth.json` · `wait: {change: true}` / `wait: {stable: 600}` · `on: appName` (multi-app)
- Structure: `title: {kicker, text, sub, ms}` (full-screen card) · `chapter: "Name"` (pill + mp4 chapter) · `record: off|on` (hide a segment) · `cursor: hide` · `screenshot: file.png`

Targets: an observation id (`e7`, `t12`, `{node: e7}`) in serve sessions, a Playwright selector string (`"#id"`, `"text=Lưu"`, `"role=button[name=\"Lưu\"]"`) or an
object: `{role, name}`, `{label}`, `{placeholder}`, `{text}`, `{testId}`, `{sel}`, `{ref: e12}` (serve
only), plus `nth`, `exact`, `within`.

## Timing: voice, actions and annotations stay together

Each step's actions are timed against its sentence. The clip's pauses come from the audio, and words
are placed by syllables of what the voice actually reads. An action whose target is mentioned in
the sentence lands on those words: the click on "Tạo đơn" lands as the voice says "Tạo đơn", and the
circle around "94%" appears on "chín mươi tư phần trăm". To make this work:

- Name the thing you act on in the sentence, using its on-screen label. "Anh chị bấm Tạo đơn" anchors
  `click: e7` automatically, because the label is read from the element. Otherwise anchor it with
  `at: "cụm từ"` on the target (`circle: {text: "94%", at: "đúng giờ"}`), on the step for its first
  action, or as ms (`at: 2500`) or `at: end`.
- Unanchored actions: the first follows the voice by `lead` (450 ms), and later ones keep `beatMs`
  (500) apart while the sentence runs. An annotation stays at least `minAnnotMs` (1400) before the next
  sentence clears it, and there is a `voice.gap` (300 ms) breath between sentences.
- One sentence per beat; do not describe three actions in one sentence and then act silently.
- After a recording, `sync` in the result (full log in `sync.json`) lists actions that finished long
  after their sentence, long-sentence annotations that were not anchored, and silent actions fired back
  to back. Fix those steps and re-record.
- Slide bullets also appear as the voice reaches each bullet's words.

## Slides: one outline, up front

An agenda/outline slide goes **once, at the start** (and optionally a summary at the end). Do not
return to the outline or put slides between app actions: switching between slide and app is jarring.
Chapters carry the structure: the chapter pill shows "2/4" automatically. Use a whiteboard mid-video
only to explain a concept the app cannot show. `lint` and `run --dry` flag repeated outlines and
mid-demo slides.

## Narration (spoken Vietnamese)

Read ${CLAUDE_PLUGIN_ROOT}/skills/demo-video/NARRATION.md before writing a script: structure, forms of
address, sentence patterns and pace, taken from professional Vietnamese vendor tutorials. The short version:

- Open with a greeting, a hook (pain, stakes or a question), the goal and a roadmap of 2–5 steps. Close with
  a recap, a wish and the next step.
- One way of addressing the audience for the whole video (anh chị / quý khách / bạn); never "người dùng".
- One idea per sentence, 8–25 syllables. Say the location before the action ("Tại màn hình Đơn hàng,
  anh chị bấm Tạo đơn"), then the result and why it matters.
- Talk about the benefit, not the click. Show something on screen that matches every few sentences.
- Write numbers, money, dates, codes and acronyms as they appear on screen: captions keep them, and the voice
  reads the spoken form ("230.000đ" is read "hai trăm ba mươi nghìn đồng", "DH-1021" "đê hát, một không hai một").
  Product names go in the codebase's `.demo-studio/pronounce.yaml`.
- Check with `demo-studio lint script.yaml --spoken` (also printed by `run --dry`): long sentences, written-style
  wording, mixed forms of address, acronyms with no known reading, and what the voice will actually say.
- Role-play scenes: `voices: {khach: {name: "Hải Đăng", label: "Anh Minh"}}` plus `as: khach` on a step.

## Gotchas

- Zoom uses Chrome pinch-zoom. Pointer actions work while zoomed (page.mouse with zoom-aware coordinates); zoom resets only when the next target is off-screen, on goto/title/slide, or (autoZoom) on a beat with no pointer action.
- Headless runs use "Chrome for Testing" from the Playwright cache: branded Chrome 158+ quits headless sessions after ~30 s. If missing, run `demo-studio install`. Headed (live) uses system Chrome.
- Ink colour defaults to `theme.ink`; keep 1–2 ink marks per beat — they auto-clear at the next `say` step.
- Annotations auto-clear at each new `say` step (unless `keep: true`).
- `goto` page loads are trimmed from the video when nobody is speaking.
- New tabs/popups are followed automatically.
- Edge TTS needs internet; offline fallback `voice: {provider: say, name: Linh}`.
- Local Vietnamese voice: `voice: {provider: vieneu, name: "Mai Anh", rate: "+5%"}` (VieNeu-TTS v3 Turbo, CPU/ONNX,
  ~1–3 s per sentence on a laptop, no network after the first run). Needs `uv` (or `DEMO_TTS_VIENEU_PYTHON` = a Python
  with `pip install vieneu`); first use downloads ~0.6 GB to the Hugging Face cache. Voices: `demo-studio voices vieneu`
  (e.g. Mai Anh, Trúc Ly, Thùy Dung, Ngọc Huyền, Minh Triết, Hải Đăng). Options: `precision: int8`, `temperature: 0.8`.
  `provider: openai` (any OpenAI-compatible /audio/speech, DEMO_TTS_BASE_URL/DEMO_TTS_API_KEY)
  and `provider: gemini` (DEMO_TTS_GEMINI_KEY) are supported too.
- Outputs go to `demo-out/<name>-<timestamp>/` under the cwd unless `--out`.
