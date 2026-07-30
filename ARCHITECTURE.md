# Whisper Studio architecture

Whisper Studio is a Tauri desktop application with a React/TypeScript frontend
and a Rust backend.

## Source layout

- `src/` contains the React UI, shared TypeScript types, playback code, and the
  typed Tauri API wrapper.
- `src-tauri/src/main.rs` exposes Tauri commands and owns application state.
- `src-tauri/src/transcription.rs` runs the ffmpeg, whisper.cpp, and
  sherpa-onnx pipeline.
- `src-tauri/src/db.rs` owns SQLite persistence.
- `src-tauri/src/download.rs` installs tools and models.
- `src-tauri/src/tools.rs` resolves paths and external programs.
- `src-tauri/src/export.rs` produces TXT, Markdown, SRT, VTT, and JSON exports.

## Naming conventions

New filenames, modules, identifiers, command names, event names, payload
fields, and transient state values must use standard English.

The React-to-Rust bridge is centralized in `src/api.ts`. Tauri command
arguments use camelCase in TypeScript and snake_case in Rust; Tauri performs
that conversion automatically.

## Compatibility boundaries

The visible interface remains Czech. User-facing copy is not part of the
technical naming convention.

The SQLite schema and persisted recording statuses still use their original
Czech values. Renaming them directly would make existing libraries unreadable.
Rust exposes English structs and functions over this legacy schema. Settings
fields include serde aliases so configuration written by older versions still
loads.

Some existing CSS selectors remain Czech because they are stable presentation
hooks shared by the current markup and stylesheet. New selectors should use
English. Rename old selectors only as a dedicated, visually tested migration.

