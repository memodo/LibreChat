#!/usr/bin/env bash
#
# transcribe.sh — transcribe the tutorial audio to timestamped subtitles
#                 using whisper.cpp (whisper-cli) locally. No API key needed.
#
# Produces, next to the tutorial dir, under transcript/:
#   transcript.en.srt   segment-grouped subtitles (sidecar, not burned in)
#   transcript.en.vtt   WebVTT subtitles
#   transcript.en.txt   plain reading copy
#   transcript.en.json  full result incl. token-level timing
#
# Usage:
#   bash transcribe.sh                      # defaults: ../MemodoAI intro.mp3 -> ../transcript/transcript.en
#   bash transcribe.sh "input.mp3"          # custom input
#   bash transcribe.sh "input.mp3" out-base # custom input + output basename (no extension)
#
# Override the model with WHISPER_MODEL=/path/to/ggml-*.bin
#
# Requires: ffmpeg, whisper-cli (brew install whisper-cpp), and a ggml model.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)" # docs/memodo-ai-tutorial

INPUT="${1:-$TUT_DIR/MemodoAI intro.mp3}"
OUTBASE="${2:-$TUT_DIR/transcript/transcript.en}"

# Prefer an explicit model, else the whisper-cpp default location, else a known fallback.
DEFAULT_MODEL="$HOME/.local/share/whisper-cpp/models/ggml-large-v3.bin"
MODEL="${WHISPER_MODEL:-$DEFAULT_MODEL}"

if [ ! -f "$INPUT" ]; then
  echo "Input audio not found: $INPUT" >&2
  exit 1
fi
if [ ! -f "$MODEL" ]; then
  echo "Whisper model not found: $MODEL" >&2
  echo "Set WHISPER_MODEL=/path/to/ggml-*.bin (e.g. ggml-large-v3.bin)." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUTBASE")"

WAV="$(mktemp -t whisper-XXXXXX).wav"
trap 'rm -f "$WAV"' EXIT

echo ">> Converting to 16 kHz mono WAV (whisper.cpp requirement)..."
ffmpeg -nostdin -loglevel error -y -i "$INPUT" -ar 16000 -ac 1 -c:a pcm_s16le "$WAV"

echo ">> Transcribing with whisper.cpp"
echo "   model:  $MODEL"
echo "   input:  $INPUT"
echo "   output: $OUTBASE.{srt,vtt,txt,json}"
whisper-cli \
  -m "$MODEL" \
  -f "$WAV" \
  -l en \
  --max-len 84 \
  --split-on-word \
  --output-srt \
  --output-vtt \
  --output-txt \
  --output-json-full \
  --output-file "$OUTBASE"

echo ">> Done."
