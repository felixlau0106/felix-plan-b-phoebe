// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_dialog;
use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty, Child};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

pub struct PtyState {
    pub writer: Arc<Mutex<Option<Box<dyn std::io::Write + Send>>>>,
    pub master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    pub child: Arc<Mutex<Option<Box<dyn Child + Send>>>>,
}
// Note for future me:
// writer is the box that hold the terminal input pipe
// master is the pair.endpoint we communicate with the PtyPair (see init_pty if you forget in future)
// Arc<Mutex<... is a thread-safe lock box for React to safely pass typing events wiwhout crashing
// Option means this box can start as None (empty)

#[tauri::command]
fn read_file(path: String) -> String {
    std::fs::read_to_string(path).unwrap()
}

#[tauri::command]
fn write_file(path: String, content: String) {
    std::fs::write(path, content).unwrap()
}

// Note for future me:
// Mutex is like putting a lock around
// Arc is like make that lock safely shareable across background threads
// Return type is Result<(sucess, failure)>

#[tauri::command]
fn write_to_pty(data: String, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    if let Some(writer) = state.writer.lock().unwrap().as_mut() {
        writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// AHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH
// To future me: I FUCKING LEFT THESE NOTES FOR YOU, BE THANKFUL
#[tauri::command]
fn init_pty(app: tauri::AppHandle, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let pty_system = native_pty_system(); // create ConPty or Unix PTY system based on OS, the factory/engine
    let pair = pty_system.openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0, }).map_err(|e| e.to_string())?; // manufactures one pair of master and slave
    // pair now hold master(the side the app talks to) and slave (the side the shell talks to)
    let cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("powershell.exe")
    } else {
        let mut c = CommandBuilder::new("/usr/bin/bash");
        c.arg("-i");
        c
    };
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?; // attach `cmd` to the slave side of the virtual terminal and boots it up
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?; // grab the write handle(stdin) connected to the terminal
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?; // Clone the read handle(stdout) and put it into a `mut`able variable
    *state.master.lock().unwrap() = Some(pair.master);
    *state.child.lock().unwrap() = Some(child);
    *state.writer.lock().unwrap() = Some(writer); // Derefernce. modify value inside lock box instead of box itself. open the lock inside PtyState and replace empty None with Some(writer)
    // now write_to_pty() has Some(writer) to fulfill the if statement so it can now do its job
    std::thread::spawn(move || { // spawn a dedicate OS bg thread so that `reading from terminal` wont block loop just because it waits forever for new data. `move` reader and app into this bg thread, own them
        let mut buffer = [0u8; 1024]; // 1024 unsigned 8-bit int (all zero), this is buffer for catching raw incoming bytes from shell
        while let Ok(n) = reader.read(&mut buffer) { // As long as reader.read ()succeeds, keep looping; Fill buffer with incoming raw bytes and return Ok(n) where n is number of bytes read during this tick
            if n == 0 { break; } // if shell return 0 bytes, it means the shell process exited(user closed it, etc).
            let text = String::from_utf8_lossy(&buffer[..n]).to_string(); // slice the buffer, ignore empty zero slots. Convert raw UTF-8 to string
            let _ = app.emit("pty-output", text); // emit(A, B)...emit custom event A containing B across the Tauri bridge to React FE
            // _ is special name that tells Rust I fucking ignore the `Result`, don't warn me about it abd just throw Result away. 
        }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(PtyState {
            writer: Arc::new(Mutex::new(None)),
            master: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, write_to_pty, init_pty])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
