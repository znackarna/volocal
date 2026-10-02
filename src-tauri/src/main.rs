// No console window when the built application starts on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    volocal_lib::run()
}
