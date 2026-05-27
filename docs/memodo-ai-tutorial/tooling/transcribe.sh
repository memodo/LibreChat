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
# Transcribe the FINAL VIDEO (../MemodoAI intro.mpg), not a separate audio export,
# so timestamps are aligned to the cut the chapters reference.
#
# Usage:
#   bash transcribe.sh                          # defaults: ../MemodoAI intro.mpg -> ../transcript/transcript.en
#   bash transcribe.sh "input.mpg"              # custom input
#   bash transcribe.sh "input.mpg" out-base     # custom input + output basename (no extension)
#
# Override the model with WHISPER_MODEL=/path/to/ggml-*.bin
#
# Anti-loop hardening (learned the hard way): once the edited video has silent
# title-card gaps, plain whisper.cpp falls into a repetition loop that can swallow
# the entire back half of the transcript. Two settings prevent it:
#   1. VAD (voice activity detection) — skips silent gaps so they are never fed to
#      the decoder, while keeping timestamps on the original video timeline. Needs a
#      Silero VAD ggml model; auto-enabled when one is found (see VAD_MODEL below).
#        Download once: a Silero model from https://huggingface.co/ggml-org/whisper-vad
#        e.g. ggml-silero-v6.2.0.bin into ~/.local/share/whisper-cpp/models/
#   2. --max-context 0 — stop conditioning each window on previously decoded text,
#      so a stray repeat cannot become self-sustaining.
#
# Requires: ffmpeg, whisper-cli (brew install whisper-cpp), and a ggml model.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)" # docs/memodo-ai-tutorial

INPUT="${1:-$TUT_DIR/MemodoAI intro.mpg}"
OUTBASE="${2:-$TUT_DIR/transcript/transcript.en}"

# Prefer an explicit model, else the whisper-cpp default location, else a known fallback.
DEFAULT_MODEL="$HOME/.local/share/whisper-cpp/models/ggml-large-v3.bin"
MODEL="${WHISPER_MODEL:-$DEFAULT_MODEL}"

# VAD model: explicit VAD_MODEL wins, else first ggml-silero-*.bin in the models dir.
MODELS_DIR="$(dirname "$MODEL")"
VAD_MODEL="${VAD_MODEL:-$(ls "$MODELS_DIR"/ggml-silero-*.bin 2>/dev/null | head -n1)}"

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

VAD_ARGS=()
if [ -n "$VAD_MODEL" ] && [ -f "$VAD_MODEL" ]; then
  VAD_ARGS=(--vad --vad-model "$VAD_MODEL")
  echo ">> VAD enabled (skips silent title-card gaps): $VAD_MODEL"
else
  echo ">> WARNING: no Silero VAD model found in $MODELS_DIR." >&2
  echo "   Without VAD, silent title-card gaps can trigger a whisper.cpp repetition loop." >&2
  echo "   Download one from https://huggingface.co/ggml-org/whisper-vad (e.g. ggml-silero-v6.2.0.bin)." >&2
fi

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
  --max-context 0 \
  "${VAD_ARGS[@]}" \
  --output-srt \
  --output-vtt \
  --output-txt \
  --output-json-full \
  --output-file "$OUTBASE"

echo ">> Done."
