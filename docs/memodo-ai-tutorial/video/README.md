# video/ — screen recordings (generated, not committed)

This directory holds the raw and edited video for the tutorial — the documentary screen-capture track, any branded intro/outro clips, and the final edit.

Typical contents:

```
memodo-tutorial-full.mov              Raw OBS screen recording of the full walkthrough
memodo-tutorial-full.timestamps.log   Section markers (offsets) for editing
intro.mov / outro.mov                 Branded title cards
memodo-tutorial-final.mp4             The edited, narrated, captioned final cut
```

**These files are gitignored** (everything here except this README). Raw screen recordings run 100 MB to 500 MB+; they're regenerable and have no business in git history. Track the *script* and *narration*, not the rendered video.

## How to (re)produce

The documentary track is captured by recording the MemodoAI browser session while driving through the steps:

1. Follow the shot list in [`../recording-script.md`](../recording-script.md), section by section.
2. Recording mechanics + the OBS WebSocket helper: [`../obs-recording.md`](../obs-recording.md).
3. Stitch the documentary track + the TTS audio from [`../audio/`](../audio/) + intro/outro, per the Stage 1 workflow in [`../video-pipeline.md`](../video-pipeline.md).

The section-offset timestamps log (written during recording) lines up chapter cuts with the narration.

> If this directory is empty on a fresh clone, that's expected — re-record per the script above.
