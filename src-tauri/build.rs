fn main() {
    // The icon goes into the program as a Windows resource at build time.
    // Without these lines cargo does not know it changed and quietly keeps the
    // old one.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    /* **The manifest goes into every program cargo links, tests included.**
    Tauri puts its manifest — the one line asking Windows for Common Controls
    6 — into the application's programs only. A test program without it still
    starts as long as nothing in it reaches the window; on 2026-10-03 a test
    of the transcription queue began to, through `Report::Window`, and the
    library's tests stopped with STATUS_ENTRYPOINT_NOT_FOUND before running:
    `comctl32.dll` 5, which a program without the manifest gets, has no
    `TaskDialogIndirect`. So Tauri's own manifest is switched off and the same
    file, unchanged (`windows-app-manifest.xml`, copied from tauri-build
    2.6.3), is given to the linker for everything, as Tauri's documentation
    suggests for tests. The programs carry exactly what they carried before. */
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if !windows_msvc {
        tauri_build::build();
        return;
    }
    let manifest = std::env::current_dir()
        .expect("the build script runs in the package")
        .join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("the Tauri build step failed");
}
