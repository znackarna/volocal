// No console window when the built application starts on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_edit;
mod commands;
mod db;
mod diagnostics;
mod download;
mod export;
mod online_import;
mod tools;
mod transcription;
mod user_message;
mod voiceprint;

use anyhow::Result;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use user_message::UserMessage;

// ---------------------------------------------------------------- stav aplikace

pub(crate) struct AppState {
    pub(crate) db: Mutex<Connection>,
    pub(crate) db_path: PathBuf,
    /// Flag used to interrupt a download in progress
    pub(crate) download_cancellation: Arc<AtomicBool>,
    /// Transcriptions in flight, so they can be cancelled
    pub(crate) bezici: transcription::TranscriptionTask,
    /// Optional language-document generation, independent of transcription.
    pub(crate) ai_edit: ai_edit::AiEditTask,
    /// At most one cancellable online media import at a time.
    pub(crate) online_import: online_import::OnlineImportTask,
}

/// Recordings whose waveform is being computed in the background. Without
/// this, every open of the detail screen would start another ffmpeg over the
/// same file.
///
/// A global rather than a field on the app state: the worker thread needs to
/// reach the list too, and it outlives the state.
static WAVEFORM_JOBS: std::sync::OnceLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::OnceLock::new();

pub(crate) fn waveform_jobs() -> &'static Mutex<std::collections::HashSet<String>> {
    WAVEFORM_JOBS.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

/// Holds one recording's place in that list and gives it back on `Drop`.
///
/// The removal used to be the last line of the worker closure. A panic inside
/// ffmpeg handling therefore skipped it, and the id stayed in the list for the
/// lifetime of the process — after which opening that recording's detail
/// reported a waveform that was for ever "being computed" and never started
/// another attempt. Same shape as `INSTALLING` in `download.rs`: the flag comes
/// down through a guard, not through a line at the end.
pub(crate) struct WaveformJob(String);

impl WaveformJob {
    /// `None` when somebody else already holds this recording.
    pub(crate) fn claim(id: &str) -> Option<Self> {
        let mut running = waveform_jobs().lock().unwrap();
        if !running.insert(id.to_string()) {
            return None;
        }
        Some(Self(id.to_string()))
    }
}

impl Drop for WaveformJob {
    fn drop(&mut self) {
        // `lock()` on a mutex poisoned by an earlier panic still hands the data
        // back, and leaving the id behind is the very thing being fixed.
        match waveform_jobs().lock() {
            Ok(mut running) => {
                running.remove(&self.0);
            }
            Err(poisoned) => {
                poisoned.into_inner().remove(&self.0);
            }
        }
    }
}

/// Result of a command whose failure is shown in the window.
pub(crate) type Reported<T> = std::result::Result<T, UserMessage>;

/// Failures from anyhow travel to the window as a message it can look up.
/// Most of them have no code of their own yet, so the window prints the
/// technical text they carry rather than nothing at all.
pub(crate) fn reported<T>(v: Result<T>) -> Reported<T> {
    v.map_err(UserMessage::from)
}

// ---------------------------------------------------------------- start

/// Answers WebView2's microphone permission request without asking again.
///
/// WebView2 treats the application as a web page and prompts in the name of the
/// origin it is served from, which on Windows is `tauri.localhost`. That name
/// cannot be changed — a page that could choose how it is announced would make
/// the prompt worthless — so the only way to stop a person being asked by a
/// stranger is not to raise the prompt at all.
///
/// The consent is not skipped, it is moved to where it means something: the
/// recorder is opened deliberately, and its own dialog says the microphone is
/// being opened and that not a word leaves the computer. The system prompt only
/// repeated that question in a name nobody recognises.
///
/// Only `MICROPHONE` is answered. Every other kind — camera, location,
/// notifications, clipboard — is left untouched and still prompts. This webview
/// loads nothing but the bundled interface, so there is no third-party page
/// that could be the one asking.
#[cfg(windows)]
fn allow_microphone(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    let registered = window.with_webview(|webview| {
        let core = match unsafe { webview.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => {
                crate::note!("microphone: WebView2 unreachable, prompt stays: {error}");
                return;
            }
        };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
            unsafe { args.PermissionKind(&mut kind)? };
            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                unsafe { args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)? };
            }
            Ok(())
        }));
        // The token is only needed to unsubscribe, and this handler lives as
        // long as the window does.
        let mut token = 0i64;
        if let Err(error) = unsafe { core.add_PermissionRequested(&handler, &mut token) } {
            crate::note!("microphone: handler not registered, prompt stays: {error}");
        }
    });
    if let Err(error) = registered {
        crate::note!("microphone: no webview to attach to, prompt stays: {error}");
    }
}

/// Turns off the browser WebView2 still is underneath.
///
/// Two things reach the reader otherwise, both drawn by Windows and neither
/// belonging to this application: the find bar Ctrl+F opens, and the
/// right-click menu with Reload, Print, View source and Inspect. The find bar
/// is the visible one — a strip in the title area, in the system's own style,
/// searching the DOM rather than the transcript.
///
/// `AreBrowserAcceleratorKeysEnabled` covers the keys that reach browser
/// features: Ctrl+F, Ctrl+P, Ctrl+R, F5, F7, Alt+Left. Clipboard keys are a
/// separate setting and keep working, and a key WebView2 no longer handles
/// falls through to the page — which is what lets our own Ctrl+F and F3 work
/// at last instead of racing it.
///
/// Cost, stated because it is real: with the default context menu gone there
/// is no right-click paste in a text field. Ctrl+V still pastes.
#[cfg(windows)]
fn quiet_the_browser(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    let applied = window.with_webview(|webview| {
        let settings = match unsafe { webview.controller().CoreWebView2() }
            .and_then(|core| unsafe { core.Settings() })
        {
            Ok(settings) => settings,
            Err(error) => {
                crate::note!("webview: settings unreachable, defaults stay: {error}");
                return;
            }
        };
        if let Err(error) = unsafe { settings.SetAreDefaultContextMenusEnabled(false) } {
            crate::note!("webview: default context menu stays: {error}");
        }
        match settings.cast::<ICoreWebView2Settings3>() {
            Ok(keys) => {
                if let Err(error) = unsafe { keys.SetAreBrowserAcceleratorKeysEnabled(false) } {
                    crate::note!("webview: accelerator keys stay: {error}");
                }
            }
            Err(error) => crate::note!("webview: runtime too old for key settings: {error}"),
        }
    });
    if let Err(error) = applied {
        crate::note!("webview: no webview to configure: {error}");
    }
}

/// Everything this application starts dies with it.
///
/// `TranscriptionTask::kill_all` reaches the children a run registered, and
/// that is the ordinary path. It cannot reach the ones no run owns — the two
/// ffmpeg passes that draw the waveform, the one that prepares seekable
/// playback, the duration probe — it cannot reach a grandchild at all, and it
/// does not run if the process is killed rather than closed. What was left
/// behind is not small: ffmpeg over a whole recording, or `llama-server` with
/// seven gigabytes of model in memory.
///
/// A job object closes the class rather than the cases. A process assigned to
/// one puts its children in it too, and `KILL_ON_JOB_CLOSE` fires when the
/// last handle to the job is gone — which happens when this process ends,
/// however it ends.
///
/// The handle is deliberately never closed. `HANDLE` is a plain `Copy` value
/// with no destructor, so letting it go out of scope leaks nothing and closes
/// nothing; calling `CloseHandle` here would fire the limit at once and kill
/// the application it is protecting. Windows reclaims it when the process
/// ends, which is exactly the moment it is meant to fire.
///
/// Nested jobs have been allowed since Windows 8, so already being inside
/// somebody else's job — a debugger, a test runner — is not a reason to fail.
/// Every step is silent on failure: a machine where the job cannot be created
/// must still start the application, and `kill_all` is still there.
#[cfg(windows)]
fn die_with_this_process() {
    use windows::core::PCWSTR;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::GetCurrentProcess;

    unsafe {
        // Unnamed on purpose: a name would be shared with any other copy of
        // the application, and two windows would then be in one job.
        let Ok(job) = CreateJobObjectW(None, PCWSTR::null()) else {
            crate::note!("job object: not created, children may outlive the window");
            return;
        };
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let sized = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        if let Err(error) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const core::ffi::c_void,
            sized,
        ) {
            // Without the limit the job would hold the children and kill
            // nothing, so joining it would buy nothing either.
            crate::note!("job object: limit not set, children may outlive the window: {error}");
            return;
        }
        if let Err(error) = AssignProcessToJobObject(job, GetCurrentProcess()) {
            crate::note!("job object: not joined, children may outlive the window: {error}");
            return;
        }
        // Kept so the one process that must outlive us can be let out. See
        // `let_the_installer_out`.
        let _ = JOB.set(job.0 as isize);
    }
}

/// The job the window and its children belong to, as a plain number because a
/// raw handle is not `Send`. Only `let_the_installer_out` reads it.
#[cfg(windows)]
static JOB: std::sync::OnceLock<isize> = std::sync::OnceLock::new();

/// Lets processes started from now on stay out of the job.
///
/// The job exists so that whisper, ffmpeg and llama-server cannot outlive the
/// window — it kills everything inside it the moment the last handle closes.
/// The updater's installer is started by this process and would join the job
/// like anything else, and then the plugin calls `exit(0)` immediately after
/// starting it. Windows closes the job, and the installer dies before it has
/// unpacked anything.
///
/// Which is exactly what it looked like from outside: the download finishes,
/// the window disappears, nothing is installed and nothing comes back.
///
/// `SILENT_BREAKAWAY_OK` is added rather than the kill flag removed, so
/// everything already running still dies with the window. Only what starts
/// after this call — the installer — is left out of the job.
pub(crate) fn let_the_installer_out() -> Reported<()> {
    breakaway()
}

/// Everything platform-specific, kept out of the command itself so that the
/// command exists once and reads the same on every system.
#[cfg(windows)]
fn breakaway() -> Reported<()> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
    };

    let Some(job) = JOB.get() else {
        // No job means nothing to escape from, which is the same outcome.
        return Ok(());
    };
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK;
    let sized = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
    unsafe {
        SetInformationJobObject(
            HANDLE(*job as *mut core::ffi::c_void),
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const core::ffi::c_void,
            sized,
        )
    }
    .map_err(|error| {
        crate::note!("job object: the installer could not be let out: {error}");
        UserMessage::new("update.install_failed").detail(error)
    })?;
    crate::note!("job object: the installer may now outlive the window");
    Ok(())
}

/// Nothing to escape on a system without job objects.
#[cfg(not(windows))]
fn breakaway() -> Reported<()> {
    Ok(())
}

fn main() {
    // Before anything is started, so that everything started after it is
    // covered — including whatever a failure below might spawn.
    #[cfg(windows)]
    die_with_this_process();
    // Must happen before Tauri creates the window.
    tools::set_webview2();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        /* Registering it does not make the application talk to anybody. The
        updater only ever acts when the window calls it, and the only thing
        that calls it is the button on the About page. Nothing here runs on
        start, on a timer, or in the background — see README's promise about
        what leaves the computer, which this was written to keep. */
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // The failure is reported and the process ended from inside
            // `report_unusable_archive`, not returned from here: an error out of
            // `setup` reaches `.expect()` below, which in a released build
            // panics into a console that does not exist.
            let archive = archive_path(app);
            let opened = match archive.as_ref() {
                Ok(path) => connect_database(app, path.clone()),
                Err(error) => Err(anyhow::anyhow!("{error:#}")),
            };
            if let Err(error) = opened {
                report_unusable_archive(app, archive.as_deref().ok(), &error);
                return Ok(());
            }
            // The title is a constant now that the version is out of it, so it
            // lives in tauri.conf.json and nothing sets it at runtime.
            #[cfg(windows)]
            if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
                allow_microphone(&window);
                quiet_the_browser(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::updates::let_the_installer_out,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::check_tools,
            commands::settings::diagnostic_report,
            commands::library::list_recordings,
            commands::library::add_recording,
            commands::library::scan_watch_folder,
            commands::library::import_watch_folder_files,
            commands::library::ignore_watch_folder_files,
            commands::library::save_microphone_recording,
            commands::library::import_online_recording,
            commands::library::cancel_online_import,
            commands::folders::delete_recording,
            commands::folders::export_audio,
            commands::folders::folders,
            commands::folders::create_folder,
            commands::folders::rename_folder,
            commands::folders::move_to_folder,
            commands::folders::delete_folder,
            commands::folders::start_transcription,
            commands::folders::transcribe_in_language,
            commands::folders::cancel_transcription,
            commands::folders::delete_transcription,
            commands::folders::rename_recording,
            commands::folders::diarize_speakers,
            commands::detail::detail,
            commands::detail::add_recording_note,
            commands::detail::update_recording_note,
            commands::detail::delete_recording_note,
            commands::detail::update_segment,
            commands::detail::file_exists,
            commands::detail::playback_source,
            commands::detail::change_recording_path,
            commands::backups::recording_waveform,
            commands::backups::apply_dictionary,
            commands::backups::mark_verified,
            commands::backups::set_segment_speaker,
            commands::backups::rename_speaker,
            commands::backups::add_speaker,
            commands::backups::delete_speaker,
            commands::backups::merge_speakers,
            commands::dictionary::dictionary,
            commands::dictionary::add_dictionary_entry,
            commands::dictionary::update_dictionary_entry,
            commands::dictionary::delete_dictionary_entry,
            commands::dictionary::search,
            commands::exports::export_preview,
            commands::exports::save_export,
            commands::exports::suggested_name,
            commands::ai::ai_edit_status,
            commands::ai::start_ai_edit,
            commands::ai::start_ai_output,
            commands::ai::cancel_ai_edit,
            commands::ai::delete_ai_document,
            commands::ai::save_ai_document,
            commands::ai::save_ai_output,
            commands::ai::suggested_ai_name,
            commands::ai::suggested_ai_output_name,
            commands::benchmark::benchmark_compute,
            commands::benchmark::name_machine,
            commands::downloads::catalog,
            commands::downloads::download,
            commands::downloads::cancel_download,
            commands::downloads::create_portable_copy,
            commands::backups::backup_status,
            commands::backups::back_up_now,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start the application")
        .run(|app, event| {
            // Closing the window must take the programs with it.
            //
            // `std::process::Child` does not kill on `Drop`, the worker
            // threads are detached, and nothing here used to ask them to stop
            // — so closing the window mid-transcription left `whisper-cli` or
            // `sherpa-onnx` running, and `llama-server` resident with a seven
            // gigabyte model. They held the graphics card and went on writing
            // into a temporary directory the next start deletes underneath
            // them.
            //
            // `ExitRequested` rather than `Exit`: it arrives while the state
            // is still there to be read. `Exit` is kept as the net for the
            // paths that never raise the request.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                // `try_state`, because a start that never got as far as opening
                // the archive manages no state — and a panic here would replace
                // the message that start is trying to show.
                let Some(state) = app.try_state::<AppState>() else {
                    return;
                };
                let killed = state.bezici.kill_all();
                let server = state.ai_edit.kill_server();
                if killed > 0 || server {
                    crate::note!(
                        "closing: stopped {killed} transcription program(s){}",
                        if server {
                            " and the language server"
                        } else {
                            ""
                        }
                    );
                }
            }
        });
}

/// Which archive to open, given where this mode says it belongs and the only
/// other place one can be.
///
/// An empty folder is indistinguishable from a first run: `db::open` creates
/// the whole schema in it and the Archive comes up blank and plausible. So
/// before starting a new archive, look at the other candidate. If a real one
/// is sitting there, open that instead. Losing sight of a year of transcripts
/// must take more than a folder appearing beside the executable.
fn archive_to_open(chosen: &std::path::Path, other: &std::path::Path) -> std::path::PathBuf {
    let preferred = chosen.join("whisp.db");
    if preferred.is_file() {
        return preferred;
    }
    let alternative = other.join("whisp.db");
    if alternative.is_file() {
        crate::note!(
            "opening the existing archive at {} instead of starting an empty one at {}",
            alternative.display(),
            preferred.display()
        );
        return alternative;
    }
    preferred
}

/// Where the archive is, worked out before anything is opened.
///
/// Separate from `connect_database` so that a failure to open it can still name
/// the file in the message it shows. A person told only that the archive is
/// broken cannot act on it; one told which file it is, and where the copies of
/// it are, can.
/// What the profile folder was called before the application was renamed.
///
/// The folder is named after the Tauri identifier, so changing the name
/// changed the folder — and everything an installed copy owns is inside it:
/// the archive, its backups, the playback cache, the log.
const PROFILE_FOLDER_BEFORE_THE_RENAME: &str = "cz.znackarna.whisp";

/// Moves the profile folder over from the name the application used to have.
///
/// Returns the folder to actually use. Without this the first Volocal build
/// would open an empty archive beside a full one and look, to somebody with a
/// year of transcripts, exactly like an application that had lost them.
///
/// `rename` rather than a copy: both paths are siblings under `%APPDATA%`, so
/// it is one atomic operation on the same volume — there is no window in which
/// the data exists twice or half. And if it fails for any reason, the old
/// folder is left untouched and opened where it stands. A rename that cannot
/// happen must not cost anybody their work; the worst case is a folder with
/// the old name, which nobody but this function ever looks at.
///
/// What it did is remembered here rather than written down on the spot: the
/// log file lives inside the folder being moved, so it is not armed until
/// `connect_database` knows where the archive ended up. The first run after a
/// rename is exactly the run somebody would want a record of, and it was going
/// only to a stderr nobody sees in a released build.
static PROFILE_MOVE: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn profile_folder(profile: PathBuf) -> PathBuf {
    let Some(old) = profile
        .parent()
        .map(|p| p.join(PROFILE_FOLDER_BEFORE_THE_RENAME))
    else {
        return profile;
    };
    // Nothing to bring over, or this copy has already been through here.
    if !old.join("whisp.db").is_file() || profile.join("whisp.db").is_file() {
        return profile;
    }
    /* Tauri may have created the new folder already. An empty one is in the
    way of the rename and nothing else, so it goes; one with anything in it is
    not ours to remove. */
    if profile.is_dir() {
        let _ = std::fs::remove_dir(&profile);
    }
    match std::fs::rename(&old, &profile) {
        Ok(()) => {
            let _ = PROFILE_MOVE.set(format!(
                "moved the archive from {} to {} after the rename",
                old.display(),
                profile.display()
            ));
            profile
        }
        Err(error) => {
            let _ = PROFILE_MOVE.set(format!(
                "could not move {} to {} ({error}); opening it where it is",
                old.display(),
                profile.display()
            ));
            old
        }
    }
}

fn archive_path(app: &tauri::App) -> Result<PathBuf> {
    // Portable mode: the archive sits beside the program, and nothing is
    // written into the user profile of somebody else's computer.
    let profile = profile_folder(app.path().app_data_dir()?);
    let directory = tools::data_directory(profile.clone());
    let other = if directory == profile {
        tools::app_directory().join("data")
    } else {
        profile
    };
    Ok(archive_to_open(&directory, &other))
}

/// Shows what went wrong and ends the process, rather than disappearing.
///
/// A broken archive used to take the application down without a word: the
/// failure travelled out of `setup`, `build()` returned it, `.expect()` panicked
/// — and with no console in a released build the panic was written nowhere. The
/// window flashed and was gone, and the backups sitting one folder away might
/// as well not have existed.
///
/// This is the one place where text a person reads is written in Rust. The
/// dictionary lives in the window, which does not exist yet, and the language
/// they chose lives in the archive, which is the thing that cannot be read. So
/// it is Czech, the source language of the interface.
fn report_unusable_archive(
    app: &tauri::App,
    archive: Option<&std::path::Path>,
    error: &anyhow::Error,
) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

    crate::note!("the archive could not be opened: {error:#}");

    let unknown = "nepodařilo se zjistit".to_string();
    let archive_text = archive
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| unknown.clone());
    let backups_text = archive
        .map(|path| db::backup_directory(path).display().to_string())
        .unwrap_or(unknown);

    // Nothing behind the dialog is usable — no state was managed, so every
    // command would fail — and a window that looks like the application is
    // running is worse than none.
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
        let _ = window.hide();
    }

    // Two different things go wrong here and they ask for opposite actions.
    // A damaged archive wants a backup copied over it. An archive written by a
    // newer Volocal wants nothing done to it at all — it is in perfect order,
    // and telling its owner to start copying files over it would be the one
    // instruction that could actually lose the work this dialog exists to save.
    let message = if let Some(future) = error.downcast_ref::<db::ArchiveFromTheFuture>() {
        format!(
            "Tenhle archiv napsala novější verze Volocalu, než je ta spuštěná.\n\n\
             Archiv:\n{archive_text}\n\n\
             Aktualizujte Volocal na nejnovější verzi a spusťte ho znovu. \
             S archivem nic nedělejte — je v pořádku a nic v něm nechybí.\n\n\
             Podrobnost: schéma {}, tahle verze umí {}",
            future.found, future.known
        )
    } else {
        format!(
            "Volocal nemůže otevřít svůj archiv, a proto se nespustí.\n\n\
             Archiv:\n{archive_text}\n\n\
             Zálohy:\n{backups_text}\n\n\
             Poškozený soubor archivu si uložte stranou a na jeho místo zkopírujte \
             nejnovější zálohu z uvedené složky. Zkopírovaný soubor přejmenujte tak, \
             aby se jmenoval stejně jako archiv. Potom Volocal spusťte znovu.\n\n\
             Podrobnost: {error:#}"
        )
    };

    let handle = app.handle().clone();
    // `blocking_show` waits for a closure that the event loop has yet to run,
    // so on the main thread it would wait for ever — and `setup` is the main
    // thread. Hence a thread of its own, and hence this function returning
    // normally: the loop has to start for the dialog to appear at all.
    std::thread::spawn(move || {
        handle
            .dialog()
            .message(message)
            .kind(MessageDialogKind::Error)
            .title("Volocal")
            .blocking_show();
        std::process::exit(1);
    });
}

fn connect_database(app: &tauri::App, db_path: PathBuf) -> Result<()> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // As early as the location is known: most of the lines below are the only
    // record that anything happened to somebody's archive.
    diagnostics::set_file(&db_path);
    // Written now rather than when it happened, because the file to write it
    // into was still being moved at the time.
    if let Some(moved) = PROFILE_MOVE.get() {
        crate::note!("{moved}");
    }
    let mut connection = db::open(&db_path)?;

    // Anything still marked as running belongs to a session that never
    // finished. Without this the recording would sit there for ever showing a
    // progress bar that goes nowhere, with no way to start over.
    match db::recover_interrupted(&connection) {
        Ok(0) => {}
        Ok(n) => crate::note!("recovered {n} interrupted transcription(s)"),
        Err(e) => crate::note!("could not recover interrupted transcriptions: {e:#}"),
    }

    // Measured, not guessed — see the change log. Changing the default alone
    // would only reach new installations, and an existing one would keep
    // finding sixteen speakers in a conversation between two people.
    match db::raise_cluster_threshold_once(&connection) {
        Ok(true) => crate::note!("raised speaker clustering threshold to the new default"),
        Ok(false) => {}
        Err(e) => crate::note!("could not raise the clustering threshold: {e:#}"),
    }

    // Sentence blocks are derived from preserved word timestamps, so layout
    // improvements can be applied to existing transcripts without running
    // Whisper again. Back up an archive with existing transcripts first; the
    // rebuild itself is one transaction and leaves edited or verified blocks
    // untouched.
    if transcription::sentence_layout_upgrade_needed(&connection)? {
        let has_existing_transcripts =
            !db::completed_recording_ids_with_segments(&connection)?.is_empty();
        let backup_ready = !has_existing_transcripts
            || match db::back_up_and_rotate(&connection, &db_path) {
                Ok(path) => {
                    crate::note!(
                        "backed up archive before sentence layout upgrade: {}",
                        path.display()
                    );
                    true
                }
                Err(error) => {
                    crate::note!(
                        "sentence layout upgrade skipped because backup failed: {error:#}"
                    );
                    false
                }
            };
        if backup_ready {
            match transcription::upgrade_sentence_layout(&mut connection) {
                Ok(0) => {}
                Ok(count) => crate::note!("upgraded sentence layout in {count} recording(s)"),
                Err(error) => crate::note!("sentence layout upgrade failed: {error:#}"),
            }
        }
    }

    // The same crash also leaves the converted audio in the temp folder —
    // roughly 115 MB per hour of recording. Nothing can be using those folders
    // at this point, so clearing them is safe.
    let reclaimed = tools::clear_leftover_temporary();
    if reclaimed > 0 {
        crate::note!(
            "reclaimed {} MB of leftover temporary files",
            reclaimed / 1_000_000
        );
    }

    // The default paths are relative ("bin", "models") and are resolved
    // against the tools root: next to the executable in portable mode,
    // otherwise the app's own folder in the user profile. Anyone who keeps
    // their tools elsewhere sets an absolute path in the settings.
    let mut settings = db::load_settings(&connection)?;
    let mut changed = false;
    if settings.bin_directory.is_empty() {
        settings.bin_directory = "bin".into();
        changed = true;
    }
    if settings.models_directory.is_empty() {
        settings.models_directory = "models".into();
        changed = true;
    }
    if changed {
        db::save_settings(&connection, &settings)?;
    }

    // A backup on every application start, made on a thread of its own.
    //
    // The archive is a single SQLite file; if it breaks, everything ever
    // transcribed is gone. Backing up on startup rather than on a timer is
    // deliberate: the app is opened far more often than it is left running,
    // and a copy from every session is more useful than a precise schedule.
    // On a large archive this takes seconds, hence the thread and its own
    // connection — the window must not wait for it.
    let path = db_path.clone();
    std::thread::spawn(move || match db::open(&path) {
        Ok(own) => {
            if let Err(e) = db::back_up_and_rotate(&own, &path) {
                crate::note!("backup failed: {e:#}");
            }
        }
        Err(e) => crate::note!("backup could not open the database: {e:#}"),
    });

    app.manage(AppState {
        db: Mutex::new(connection),
        db_path,
        download_cancellation: Arc::new(AtomicBool::new(false)),
        bezici: transcription::TranscriptionTask::default(),
        ai_edit: ai_edit::AiEditTask::default(),
        online_import: online_import::OnlineImportTask::default(),
    });
    Ok(())
}

#[cfg(test)]
mod archive_location_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn scratch(name: &str) -> std::path::PathBuf {
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("whisp-archive-test-{id}-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn archive(dir: &std::path::Path) {
        std::fs::write(dir.join("whisp.db"), b"not really sqlite").unwrap();
    }

    #[test]
    fn the_place_for_this_mode_wins_when_it_holds_an_archive() {
        let chosen = scratch("chosen");
        let other = scratch("other");
        archive(&chosen);
        archive(&other);
        assert_eq!(archive_to_open(&chosen, &other), chosen.join("whisp.db"));
    }

    /// The defect this exists for: portability flipped, and the archive was
    /// suddenly somewhere else and empty.
    #[test]
    fn an_existing_archive_elsewhere_is_opened_rather_than_a_new_empty_one() {
        let chosen = scratch("empty");
        let other = scratch("has-the-archive");
        archive(&other);
        assert_eq!(archive_to_open(&chosen, &other), other.join("whisp.db"));
    }

    #[test]
    fn a_genuine_first_run_still_starts_where_it_belongs() {
        let chosen = scratch("first-run");
        let other = scratch("also-empty");
        assert_eq!(archive_to_open(&chosen, &other), chosen.join("whisp.db"));
    }

    /// The rename moved the profile folder, and these say what that must never
    /// do: lose an archive, and open an empty one while a full one sits beside
    /// it under the old name.
    mod after_the_rename {
        use super::*;

        /// A parent standing in for `%APPDATA%`, with both folder names under it.
        fn profiles(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
            let parent = scratch(name);
            (
                parent.join(PROFILE_FOLDER_BEFORE_THE_RENAME),
                parent.join("cz.znackarna.volocal"),
            )
        }

        #[test]
        fn an_archive_under_the_old_name_is_brought_over() {
            let (old, new) = profiles("upgrade");
            std::fs::create_dir_all(&old).unwrap();
            archive(&old);
            std::fs::write(old.join("volocal-log.txt"), b"a line").unwrap();

            assert_eq!(profile_folder(new.clone()), new);
            assert!(new.join("whisp.db").is_file());
            // Everything in the folder travels, not only the database.
            assert!(new.join("volocal-log.txt").is_file());
            assert!(!old.exists());
        }

        #[test]
        fn a_first_run_finds_nothing_to_bring_and_says_so_by_doing_nothing() {
            let (old, new) = profiles("fresh");
            assert_eq!(profile_folder(new.clone()), new);
            assert!(!old.exists());
            assert!(!new.join("whisp.db").is_file());
        }

        /// Run twice — an upgrade, then any later start. The second must not
        /// touch anything.
        #[test]
        fn an_archive_already_under_the_new_name_is_left_alone() {
            let (old, new) = profiles("already-moved");
            std::fs::create_dir_all(&new).unwrap();
            archive(&new);
            std::fs::create_dir_all(&old).unwrap();
            archive(&old);
            std::fs::write(new.join("whisp.db"), b"the one in use").unwrap();

            assert_eq!(profile_folder(new.clone()), new);
            assert_eq!(
                std::fs::read(new.join("whisp.db")).unwrap(),
                b"the one in use"
            );
            // The old one is not swept away either: it is not ours to delete.
            assert!(old.join("whisp.db").is_file());
        }

        /// The new folder exists but is empty, which is what Tauri leaves
        /// behind. It must not stop the move.
        #[test]
        fn an_empty_new_folder_is_not_in_the_way() {
            let (old, new) = profiles("empty-new");
            std::fs::create_dir_all(&old).unwrap();
            archive(&old);
            std::fs::create_dir_all(&new).unwrap();

            assert_eq!(profile_folder(new.clone()), new);
            assert!(new.join("whisp.db").is_file());
        }

        /// The move cannot happen — here because the new folder holds somebody
        /// else's file. The archive is opened where it stands rather than a new
        /// empty one being started.
        #[test]
        fn a_move_that_cannot_happen_opens_the_old_folder_in_place() {
            let (old, new) = profiles("blocked");
            std::fs::create_dir_all(&old).unwrap();
            archive(&old);
            std::fs::create_dir_all(&new).unwrap();
            std::fs::write(new.join("something-else.txt"), b"not ours").unwrap();

            assert_eq!(profile_folder(new.clone()), old);
            assert!(old.join("whisp.db").is_file());
        }
    }
}

#[cfg(test)]
mod waveform_job_tests {
    use super::*;

    fn is_running(id: &str) -> bool {
        waveform_jobs().lock().unwrap().contains(id)
    }

    #[test]
    fn one_recording_is_claimed_once_and_given_back_when_the_job_ends() {
        let id = "waveform-claim";
        let job = WaveformJob::claim(id).expect("nobody else holds it");
        assert!(is_running(id));
        assert!(
            WaveformJob::claim(id).is_none(),
            "a second ffmpeg must not be started over the same file"
        );
        drop(job);
        assert!(!is_running(id));
    }

    /// The defect this exists for: the removal was the last line of the worker
    /// closure, so a panic on the way there left the id in the list for the
    /// lifetime of the process — after which that recording's waveform was for
    /// ever "being computed" and no further attempt was ever made.
    #[test]
    fn a_panicking_job_still_gives_its_place_back() {
        let id = "waveform-panic";
        let worker = std::thread::spawn(move || {
            let _job = WaveformJob::claim(id).expect("nobody else holds it");
            panic!("ffmpeg handling fell over");
        });
        assert!(worker.join().is_err(), "the worker was supposed to panic");
        assert!(
            !is_running(id),
            "the id outlived the job that was holding it"
        );
        assert!(
            WaveformJob::claim(id).is_some(),
            "the recording can never be measured again"
        );
    }
}
