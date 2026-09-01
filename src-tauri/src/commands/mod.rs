//! The Tauri commands, grouped by what they are about.
//!
//! They were all in main.rs. Splitting them changes no name and no signature:
//! generate_handler! in main.rs still lists exactly the same commands, and
//! the window calls them by exactly the same names.

pub mod ai;
pub mod backups;
pub mod benchmark;
pub mod detail;
pub mod dictionary;
pub mod downloads;
pub mod exports;
pub mod folders;
pub mod languages;
pub mod library;
pub mod settings;
pub mod updates;
