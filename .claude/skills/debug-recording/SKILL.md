---
name: debug-recording
description: Debug CineScreen capture, cursor, playback, and export issues — logs, recording artifacts on disk, the ffmpeg frame-extraction validation method, and the offline smoother-replay harness. Use when investigating "cursor is off", A/V desync, export problems, or any recording misbehaviour.
---

# Debugging recordings

## Logs

Everything logs through `os.Logger` via `Log.*` (CineScreen/Util/Logger.swift):
subsystems `capture`, `session`, `mouse`, `editor`, `app`. Stream live:

```bash
log stream --predicate 'subsystem == "com.cinescreen.app"' --level debug
```

(Adjust the subsystem string to what Logger.swift declares — check it first.)

## Recording artifacts on disk

Projects live at `~/Documents/CineScreen/Recording YYYY-MM-DD HH-mm-ss/`:

- `recording.mp4` — the capture (H.264, PTS rebased to start at 0)
- `recording.json` — sidecar metadata: cursor keyframes + clicks in
  **video-pixel space, top-left origin**; zoom sections; trim; canvas;
  `webcamOffsetMs` (screenT = webcamT + offset)
- `webcam.mp4` — optional webcam track (its t=0 lags the screen's by
  `webcamOffsetMs` — camera warm-up)
- `project.json` — descriptor (this file is what makes a folder count as a
  project in the library)

Inspect metadata quickly:

```bash
python3 -c "import json;m=json.load(open('recording.json'));print(m['video'],len(m['cursor']['keyframes']),'kf',len(m['clicks']),'clicks')"
```

## "Cursor position is off" — validation method (proven)

The rendered cursor is a **synthetic sprite** (the capture hides the real
one, `showsCursor=false`), positioned from `recording.json` + spring
smoothing. Two distinct root causes exist; identify which before fixing:

1. **Smoothing lag** (display recordings): raw coordinates are correct; the
   sprite trails because of `SmoothPosition2D` glide. Validate: extract the
   frame at a click timestamp and check the raw (x,y) lands on the clicked
   UI element —

   ```bash
   ffmpeg -ss <t_seconds> -i recording.mp4 -frames:v 1 click.png
   ```

   then overlay a crosshair at the click's (x,y) from recording.json.
2. **Capture geometry** (window/region/secondary-display recordings): the
   mapping is `(globalPoint − contentRectPoints.origin) × pixelsPerPoint`
   (MouseTrackingService). If raw coordinates themselves miss the target,
   the geometry (CaptureInfo.contentRectPoints) is wrong for that mode.

## Offline smoother replay (no GUI needed)

To evaluate smoothing changes numerically, write a standalone Swift script
that mirrors `Spring.swift` + the relevant `RenderSnapshot` math, replays
`recording.json` at a 60fps grid, and reports sprite↔raw lag at mouse-downs
plus settle time after moves. This pattern validated the adaptive-smoothing
work (click lag 21–149px → 0.3–1.9px). Keep the script out of the repo
(/tmp) — the real math lives in unit tests (Tests/CineScreenTests).

## Preview vs export divergence

Preview (`MetalRenderer`) and export (`ExportCompositor`) share Shaders.metal
and `RenderSnapshot`, but have **duplicated pipeline setup and uniform struct
definitions** ("must match" comments). If a visual effect differs between
preview and exported file, diff those two files first — and remember the
preview canvas is aspect-locked to the video (EditorView) precisely so
canvas-relative placement matches the export.
