#!/bin/bash
# M0 spike part A: whisper.cpp toolchain + Telugu ASR models.
set -uxo pipefail
ROOT="/Users/Arnav/Downloads/Claude Code test"
MODELS="$ROOT/desktop/resources/models"
VENDOR="$ROOT/vendor"
mkdir -p "$MODELS" "$VENDOR"
export PATH="$HOME/Library/Python/3.9/bin:$PATH"

echo "=== [1/7] cmake via pip ==="
if ! command -v cmake >/dev/null; then
  python3 -m pip install --user --quiet cmake || exit 1
fi
cmake --version || exit 1

echo "=== [2/7] clone whisper.cpp ==="
cd "$VENDOR"
if [ ! -d whisper.cpp ]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp || exit 1
fi

echo "=== [3/7] build whisper-cli + quantize (Metal) ==="
cd "$VENDOR/whisper.cpp"
cmake -B build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON > build-configure.log 2>&1 || { tail -20 build-configure.log; exit 1; }
cmake --build build -j 8 > build-compile.log 2>&1 || { tail -30 build-compile.log; exit 1; }
ls -la build/bin/ | head -20

echo "=== [4/7] baseline model: large-v3-turbo-q5_0 (direct download) ==="
if [ ! -f "$MODELS/ggml-large-v3-turbo-q5_0.bin" ]; then
  curl -sL --retry 3 -o "$MODELS/ggml-large-v3-turbo-q5_0.bin" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin" || exit 1
fi
ls -la "$MODELS"

echo "=== [5/7] python venv with torch+transformers (for fine-tune conversion) ==="
cd "$VENDOR"
if [ ! -d convert-venv ]; then
  python3 -m venv convert-venv || exit 1
fi
./convert-venv/bin/pip install --quiet --upgrade pip
./convert-venv/bin/pip install --quiet "torch==2.5.1" "transformers==4.46.3" "numpy<2" || exit 1

echo "=== [6/7] download vasista22/whisper-telugu-medium checkpoint ==="
mkdir -p "$VENDOR/hf-telugu-medium"
cd "$VENDOR/hf-telugu-medium"
for f in config.json generation_config.json preprocessor_config.json tokenizer_config.json vocab.json merges.txt normalizer.json added_tokens.json special_tokens_map.json; do
  [ -f "$f" ] || curl -sL --retry 3 -O "https://huggingface.co/vasista22/whisper-telugu-medium/resolve/main/$f"
done
if [ ! -f pytorch_model.bin ] && [ ! -f model.safetensors ]; then
  # prefer safetensors if present, else pytorch_model.bin
  curl -sL --retry 3 -f -O "https://huggingface.co/vasista22/whisper-telugu-medium/resolve/main/model.safetensors" \
    || curl -sL --retry 3 -f -O "https://huggingface.co/vasista22/whisper-telugu-medium/resolve/main/pytorch_model.bin" || exit 1
fi
ls -la

echo "=== [7/7] convert to GGML f16 then quantize q5_0 ==="
cd "$VENDOR"
if [ ! -d whisper-assets ]; then
  # conversion script needs openai/whisper repo assets (mel filters, multilingual tokenizer)
  git clone --depth 1 https://github.com/openai/whisper whisper-assets || exit 1
fi
mkdir -p "$VENDOR/ggml-out"
./convert-venv/bin/python whisper.cpp/models/convert-h5-to-ggml.py "$VENDOR/hf-telugu-medium" "$VENDOR/whisper-assets" "$VENDOR/ggml-out" || exit 1
ls -la "$VENDOR/ggml-out"
GGML_F32="$VENDOR/ggml-out/ggml-model.bin"
if [ -f "$GGML_F32" ]; then
  ./whisper.cpp/build/bin/quantize "$GGML_F32" "$MODELS/ggml-telugu-medium-q5_0.bin" q5_0 || exit 1
fi
ls -la "$MODELS"
echo "=== DONE setup-asr ==="
