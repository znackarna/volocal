//! The local language model: improving a transcript, summarising, translating.
//!
//! Lifted out of main.rs unchanged when that file had grown to 2 421 lines.
//! Every command keeps the name, the arguments and the return type the window
//! already calls it by; nothing here is a rename.

use crate::user_message::UserMessage;
use crate::{ai_edit, db, tools};
use crate::{reported, AppState, Reported};
use serde::Serialize;
use tauri::State;
// ---------------------------------------------------------- language editing

#[derive(Serialize)]
pub(crate) struct AiEditStatus {
    document: Option<db::AiDocument>,
    outputs: Vec<db::AiOutput>,
    running: bool,
    progress: Option<ai_edit::AiEditProgress>,
}

#[tauri::command]
pub fn ai_edit_status(app: State<'_, AppState>, id: String) -> Reported<AiEditStatus> {
    let db = app.db.lock().unwrap();
    let mut document = reported(db::ai_document(&db, &id))?;
    let mut outputs = reported(db::ai_outputs(&db, &id))?;
    if let Some(document) = document.as_mut() {
        let source = reported(ai_edit::transcript_source(&db, &id))?;
        let settings = reported(db::load_settings(&db))?;
        let recording = reported(db::recording(&db, &id))?;
        let source_language = ai_edit::effective_language(&recording);
        let resolved_model = tools::resolve_editor_model(&settings).map(|(id, _)| id);
        document.stale = document.source_hash != ai_edit::source_hash(&source)
            || resolved_model.is_some_and(|model| document.model != model);
        // Hide summaries produced by the former direct-to-Czech pipeline. The
        // row is overwritten when the user generates that length again.
        outputs.retain(|output| {
            output.source_hash
                == ai_edit::output_source_hash(&document.text, &output.kind, &source_language)
        });
    }
    Ok(AiEditStatus {
        document,
        outputs,
        running: app.ai_edit.is_running(&id),
        progress: app.ai_edit.current_progress(&id),
    })
}

#[tauri::command]
pub fn start_ai_edit(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    mode: String,
) -> Reported<()> {
    if mode != "faithful" && mode != "clean" {
        return Err(UserMessage::new("ai.unknown_mode"));
    }
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    app.ai_edit
        .start(window, app.db_path.clone(), settings, id, mode)
}

#[tauri::command]
pub fn cancel_ai_edit(app: State<'_, AppState>, id: String) {
    app.ai_edit.cancel(&id);
}

#[tauri::command]
pub fn start_ai_output(
    window: tauri::AppHandle,
    app: State<'_, AppState>,
    id: String,
    kind: String,
    variant: String,
) -> Reported<()> {
    let valid = match kind.as_str() {
        "summary" => matches!(variant.as_str(), "short" | "standard" | "detailed"),
        "translation" => matches!(
            variant.as_str(),
            "cs" | "en" | "de" | "sk" | "pl" | "fr" | "es" | "it" | "uk"
        ),
        _ => false,
    };
    if !valid {
        return Err(UserMessage::new("ai.unknown_output"));
    }
    let settings = {
        let db = app.db.lock().unwrap();
        reported(db::load_settings(&db))?
    };
    app.ai_edit
        .start_output(window, app.db_path.clone(), settings, id, kind, variant)
}

#[tauri::command]
pub fn delete_ai_document(app: State<'_, AppState>, id: String) -> Reported<()> {
    let db = app.db.lock().unwrap();
    reported(db::delete_ai_document(&db, &id))
}

#[tauri::command]
pub fn save_ai_document(
    app: State<'_, AppState>,
    id: String,
    format: String,
    path: String,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let document = reported(db::ai_document(&db, &id))?
        .ok_or_else(|| UserMessage::new("ai.document_missing"))?;
    let contents = match format.as_str() {
        "txt" => format!("{}\n", document.text.trim()),
        "md" => format!(
            "# {}\n\n*Text vylepšil místní model {}*\n\n---\n\n{}\n",
            recording.title,
            document.model,
            document.text.trim()
        ),
        _ => return Err(UserMessage::new("ai.unsupported_document_format")),
    };
    std::fs::write(&path, contents)
        .map_err(|error| UserMessage::new("file.write_failed").detail(error))?;
    Ok(path)
}

#[tauri::command]
pub fn save_ai_output(
    app: State<'_, AppState>,
    id: String,
    kind: String,
    variant: String,
    format: String,
    path: String,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let output = reported(db::ai_outputs(&db, &id))?
        .into_iter()
        .find(|output| output.kind == kind && output.variant == variant)
        .ok_or_else(|| UserMessage::new("ai.output_missing"))?;
    let title = if kind == "summary" {
        match variant.as_str() {
            "short" => "Stručné shrnutí".to_string(),
            "detailed" => "Podrobné shrnutí".to_string(),
            _ => "Shrnutí".to_string(),
        }
    } else {
        let language = match variant.as_str() {
            "cs" => "češtiny",
            "en" => "angličtiny",
            "de" => "němčiny",
            "sk" => "slovenštiny",
            "pl" => "polštiny",
            "fr" => "francouzštiny",
            "es" => "španělštiny",
            "it" => "italštiny",
            "uk" => "ukrajinštiny",
            _ => "zvoleného jazyka",
        };
        format!("Překlad do {language}")
    };
    let contents = match format.as_str() {
        "txt" => format!("{}\n", output.text.trim()),
        "md" => format!(
            "# {} – {}\n\n*Vytvořeno místním modelem {}*\n\n---\n\n{}\n",
            recording.title,
            title,
            output.model,
            output.text.trim()
        ),
        _ => return Err(UserMessage::new("ai.unsupported_output_format")),
    };
    std::fs::write(&path, contents)
        .map_err(|error| UserMessage::new("file.write_failed").detail(error))?;
    Ok(path)
}

#[tauri::command]
pub fn suggested_ai_output_name(
    app: State<'_, AppState>,
    id: String,
    kind: String,
    variant: String,
    format: String,
) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let clean: String = recording
        .title
        .chars()
        .map(|character| {
            if r#"\/:*?"<>|"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let suffix = if kind == "summary" {
        match variant.as_str() {
            "short" => "stručné shrnutí".to_string(),
            "detailed" => "podrobné shrnutí".to_string(),
            _ => "shrnutí".to_string(),
        }
    } else {
        match variant.as_str() {
            "cs" => "český překlad",
            "en" => "anglický překlad",
            "de" => "německý překlad",
            "sk" => "slovenský překlad",
            "pl" => "polský překlad",
            "fr" => "francouzský překlad",
            "es" => "španělský překlad",
            "it" => "italský překlad",
            "uk" => "ukrajinský překlad",
            _ => "překlad",
        }
        .to_string()
    };
    let extension = if format == "md" { "md" } else { "txt" };
    Ok(format!("{clean} – {suffix}.{extension}"))
}

#[tauri::command]
pub fn suggested_ai_name(app: State<'_, AppState>, id: String, format: String) -> Reported<String> {
    let db = app.db.lock().unwrap();
    let recording = reported(db::recording(&db, &id))?;
    let clean: String = recording
        .title
        .chars()
        .map(|character| {
            if r#"\/:*?"<>|"#.contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let extension = if format == "md" { "md" } else { "txt" };
    Ok(format!("{clean} – vylepšený.{extension}"))
}
