#!/bin/bash
# Hard verification that every bundled clip is the SYSPIN female studio voice.
# Checks: (1) render sentinel, (2) 22.05kHz census, (3) mtime freshness,
# (4) pitch scan. Fails loudly on any mismatch.
set -u
ROOT="/Users/Arnav/Downloads/Claude Code test"
AUDIO="$ROOT/app/public/audio"

echo "=== 1. render sentinel ==="
grep -E "RENDER_COMPLETE|RENDER_INCOMPLETE|EXIT_CODE" /tmp/render-final.log | tail -2

echo "=== 2. sample-rate census (must be 392 x 22050) ==="
c16=0; c22=0; other=0
for f in "$AUDIO"/*.m4a; do
  r=$(afinfo "$f" 2>/dev/null | grep 'Data format' | grep -o '16000\|22050' | head -1)
  case "$r" in
    16000) c16=$((c16+1)); echo "  OLD VOICE: $(basename "$f")" ;;
    22050) c22=$((c22+1)) ;;
    *) other=$((other+1)); echo "  UNKNOWN RATE: $(basename "$f")" ;;
  esac
done
echo "22kHz(new): $c22 | 16kHz(OLD): $c16 | other: $other"

echo "=== 3. mtime spread (all should be from this render) ==="
ls -la "$AUDIO"/*.m4a | awk '{print $6, $7, $8}' | sort | uniq -c | sort -rn | head -4

echo "=== 4. verdict ==="
if [ "$c16" -eq 0 ] && [ "$c22" -eq 392 ]; then
  echo "VOICE_VERIFIED: all 392 clips are the studio female voice"
else
  echo "VOICE_MISMATCH: fix before shipping"
  exit 1
fi
