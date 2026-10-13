#!/usr/bin/env bash
# =====================================================================
#  Barndo Planner launcher for macOS (double-click) and Linux
#  (bash "Barndo Planner.command"). First run downloads the code and
#  installs dependencies (needs internet). Pass "update" to fetch fresh
#  code, or delete ~/BarndoPlanner.
#
#  When the project moves to its own repository, change REPO/BRANCH and
#  set SUBDIR to empty.
# =====================================================================
set -u
REPO="heehawgmedia/crypto-bot"
BRANCH="ccr-838d8070-g86avi"
SUBDIR="barndo-planner"
BASE="$HOME/BarndoPlanner"
CHECKOUT="$BASE/source"
APP="$CHECKOUT${SUBDIR:+/$SUBDIR}"

echo
echo "  ========================================="
echo "    Barndo Planner"
echo "  ========================================="
echo

pause_exit() {
  echo
  read -r -p "  Press Enter to close this window." _
  exit "${1:-1}"
}

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
  fi
}

# ---- Node.js -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed. It is required to run the app."
  if command -v brew >/dev/null 2>&1; then
    echo "  Installing Node.js with Homebrew..."
    brew install node || pause_exit 1
  elif command -v apt-get >/dev/null 2>&1; then
    echo "  Install it with:  sudo apt-get install -y nodejs npm   (or from https://nodejs.org)"
    pause_exit 1
  else
    echo "  Opening the Node.js download page. Install the LTS version, then run this launcher again."
    open_url "https://nodejs.org/"
    pause_exit 1
  fi
fi
echo "  Node.js $(node --version) found."

# ---- Get the code ------------------------------------------------------
if [ "${1:-}" = "update" ]; then
  echo "  Removing old copy for a fresh download..."
  rm -rf "$BASE"
fi

if [ ! -f "$APP/package.json" ]; then
  echo "  Downloading Barndo Planner ($REPO @ $BRANCH)..."
  mkdir -p "$BASE"
  if command -v git >/dev/null 2>&1; then
    git clone --depth 1 --branch "$BRANCH" "https://github.com/$REPO.git" "$CHECKOUT" || {
      echo "  Could not clone the repository. If it is private, sign in to GitHub first."
      pause_exit 1
    }
  else
    TMP="$(mktemp -d)"
    curl -fL -# "https://github.com/$REPO/archive/refs/heads/$BRANCH.zip" -o "$TMP/app.zip" || {
      echo "  Download failed. If the repository is private, install Git and sign in to GitHub."
      pause_exit 1
    }
    mkdir -p "$TMP/x" && unzip -q "$TMP/app.zip" -d "$TMP/x" || pause_exit 1
    EXTRACTED="$(find "$TMP/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    mkdir -p "$CHECKOUT" && cp -R "$EXTRACTED"/. "$CHECKOUT"/ || pause_exit 1
    rm -rf "$TMP"
  fi
  [ -f "$APP/package.json" ] || { echo "  Download finished but the app folder is missing."; pause_exit 1; }
fi

cd "$APP" || pause_exit 1

# ---- Dependencies ------------------------------------------------------
if [ ! -d node_modules ]; then
  echo "  Installing dependencies (first run only, this takes a minute)..."
  npm install || { echo "  npm install failed. Check your internet connection and try again."; pause_exit 1; }
fi

# ---- Run ---------------------------------------------------------------
echo
echo "  Starting Barndo Planner. Your browser will open at http://localhost:5173"
echo "  Keep this window open while you use the app. Press Ctrl+C or close it to stop."
echo
npm run dev -- --open --port 5173
pause_exit 0
