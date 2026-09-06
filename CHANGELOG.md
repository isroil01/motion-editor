# Changelog

Newest first. Each entry is what a person opening the app after an update
would want to know; the engine-level detail is in `ROADMAP.md`.

## 0.7.0 — 2026-09-06

- **Effects run on the GPU**: 177 of 183 effects now render as shaders — every
  keyer, distortion, transition, blur, noise, stylize, interior layer style,
  particle generator and the auto colour corrections. Video with effects or
  motion tracks plays at full speed instead of dropping to a per-frame CPU
  bake, and a "cpu fx" row in the viewport HUD shows the six that still bake
  (Vegas, Numbers, Timecode, Audio Spectrum, Audio Waveform, Lightning).
  Noise- and particle-based effects keep their controls and density but land
  in a different random arrangement than before.
- **Camera verbs** (Layer ▸ Camera): Create Orbit Null, Set / Link Focus
  Distance to a layer or to the point of interest, and Look at Selected / All
  under View ▸ Viewport ▸ 3D View. New lights bring an Ambient Fill so the
  unlit side of a 3D object is no longer black.
- **Layer ▸ Time**: reverse, freeze frame, time-remap enable, and stretch
  commands on the selected layers.
- **Smoother 3D handling**: dragging a 3D object, camera or light no longer
  shows the gizmo moving ahead of the object; the 3D Rotation and Orientation
  rows all edit their values.
- **Puppet**: tighter outline meshes on character cut-outs, bend pins that keep
  a rigid core and let the mesh solve the transition, and pins placed on a
  posed character land where you clicked.
- **Bug batch**: tracker overlay no longer reads as broken video, Character
  panel typography (case, small caps, super/subscript, scale, baseline,
  stroke) renders, one-sided keyframe navigators on every property row,
  Library duplicates removed, Media Browser file picking, channel views
  (R / G / B / Alpha) and the frame cache now agree, Lottie trim paths and
  animated SVG first frames import correctly, Preview panel controls work.
- **UX batch** (from `docs/UX_UI_IMPROVEMENT_PLAN.md`): design tokens with a
  density tier and high-contrast theme, native menus generated from one model,
  a docked Export panel, progress toasts with a job tray, mixed-value
  multi-select editing in the inspector, camera bookmarks, snapshot / wipe
  compare, timeline auto-follow, markers, lift / extract / ripple, and a
  faster playhead clock.

## 0.6.0 — 2026-09-03

- **Dialogs that get out of the way**: Composition Settings, Keyframe Velocity,
  the Smoother, the Wiggler and Interpret Footage are now floating tool windows —
  drag them by the title, keep working behind them, and they come back where you
  left them. Enter confirms any dialog.
- **Export as a panel**: Window ▸ Export docks the export form beside the
  inspector so you can queue renders without leaving the timeline.
- **Progress you can see**: renders, cache passes, transcription and model
  downloads show a progress toast and sit in the status-bar job tray, with
  "Reveal file" when a render lands.
- **Autosave settings** (Preferences ▸ Files): interval, how many snapshots to
  keep, an optional folder, and the last autosave time in the status bar.
- **Start screen**: search, sort by recent or name, pin projects, a Templates
  row, and Open folder… on the desktop.
- **Power-user tour** (Help ▸ Power-user tour): JKL, U / UU, `;` to fit, quick
  apply with `+`, and the command palette.
- **Help everywhere**: a `?` on every panel header opens the matching section of
  the docs; error screens and failed exports link to what to try next.
- **Version compare**: in Version History, "Compare with current" wipes between
  a saved version and the live composition at the playhead.

## 2026-09-02

- Source Monitor with in/out points, JKL shuttle and Insert / Overwrite / Add to
  end / New comp from range.
- Timeline edit tools as visible modes — Selection, Razor, Slip, Slide, Roll —
  with clip-edge snapping and Fit Composition / Fit Work Area.
- Per-cut transitions, Assemble from Footage, a Scopes panel, a Transcript panel
  with text-based editing, silence removal and ducking, chapters from markers.
- One graph editor with parametric stagger, modifier stacks, audio-reactive
  drivers, bake dynamics, the Smoother and the Wiggler as real dialogs.
- 3D: image skies and reflections, the full glTF PBR map set, curved primitives,
  a material editor, Composition Settings ▸ World, 3D IK.
- A knife tool, on-canvas gradient editor, smart guides, project swatches, an
  interactive onboarding tour, and Window ▸ Workspace.

## 2026-08-30

- A headless CLI (`premation render`) over the same deterministic pipeline.
- Data-driven batch rendering from CSV; captions in and out (`.srt` / `.vtt`)
  and generated from the composition's own audio.
- Auto-reframe to another aspect ratio; the pick-whip for parenting and
  expressions; a download-on-demand Object Matte model; idle caching of the
  whole work area.

## 2026-08-18

- The frame cache is keyed on scene content and survives undo and restart.
- Output-module templates; cloner cascade, push and path modes; physics rotation.

## 2026-08-17

- A named ease-curve library, a disk tier under the frame cache, onion skinning,
  text and colour Essential Properties, cloners with effectors, 2D rigid-body
  physics.
