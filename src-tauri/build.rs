fn main() {
    // Ikona se do programu vkládá jako windowsový prostředek při překladu.
    // Bez těchto řádků cargo netuší, že se změnila, a mlčky použije starou.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::build()
}
