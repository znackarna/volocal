fn main() {
    // The icon goes into the program as a Windows resource at build time.
    // Without these lines cargo does not know it changed and quietly keeps the
    // old one.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::build()
}
