#!/bin/sh
# SessionStart: make sure demo-studio can run. Prints nothing when everything is in place;
# otherwise one line per missing piece (shown to Claude as session context).
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Marketplace installs get npm dependencies automatically; a plugin loaded in place
# (local directory marketplace, --plugin-dir) may not have them yet.
if [ ! -d "$ROOT/node_modules/playwright-core" ] && command -v npm >/dev/null 2>&1; then
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund --loglevel=error >/dev/null 2>&1) \
    || echo "demo-studio: npm install failed in $ROOT — run it by hand before using demo-studio."
fi

command -v ffmpeg >/dev/null 2>&1 || echo "demo-studio: ffmpeg is missing (needed for recordings): brew install ffmpeg"

case "$(uname)" in Darwin) PW="$HOME/Library/Caches/ms-playwright" ;; *) PW="$HOME/.cache/ms-playwright" ;; esac
ls -d "${PLAYWRIGHT_BROWSERS_PATH:-$PW}"/chromium-* >/dev/null 2>&1 \
  || echo "demo-studio: Chrome for Testing not installed (headless recordings need it): run 'demo-studio install' once."
exit 0
