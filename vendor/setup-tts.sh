#!/bin/bash
# M0 spike part B: sherpa-onnx-node + MMS Telugu VITS voice.
set -uxo pipefail
ROOT="/Users/Arnav/Downloads/Claude Code test"
VENDOR="$ROOT/vendor"
MODELS="$ROOT/desktop/resources/models"
mkdir -p "$VENDOR/tts-spike" "$MODELS"

echo "=== [1/3] npm install sherpa-onnx-node ==="
cd "$VENDOR/tts-spike"
[ -f package.json ] || npm init -y > /dev/null
npm install sherpa-onnx-node > npm-install.log 2>&1 || { tail -20 npm-install.log; exit 1; }
ls node_modules | grep -i sherpa

echo "=== [2/3] download vits-mms-tel model ==="
cd "$VENDOR/tts-spike"
if [ ! -d vits-mms-tel ]; then
  curl -sL --retry 3 -f -O "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-mms-tel.tar.bz2" || exit 1
  tar xjf vits-mms-tel.tar.bz2 || exit 1
fi
ls -la vits-mms-tel/

echo "=== [3/3] copy model into desktop resources ==="
rsync -a vits-mms-tel "$MODELS/" --exclude='*.tar.bz2'
ls -la "$MODELS/vits-mms-tel/"
echo "=== DONE setup-tts ==="
