# video/ — screen recordings + final cut (regenerable, gitignored)

Holds the raw OBS documentary track, the edited cut, and the web transcode for the July 2026 update
video. Recorded/assembled per [`../recording-script.md`](../recording-script.md) and the pipeline in
[`../README.md`](../README.md).

Expected files (naming convention):

- `MemodoAI-updates-july-2026.mpg` — edited cut (source for transcript + transcode)
- `MemodoAI-updates-july-2026.mp4` — web-playable transcode (H.264/AAC, faststart) served at `/guide`

**Not committed** — large and regenerable from the shot list + narration. Only this `README.md` is
tracked.
