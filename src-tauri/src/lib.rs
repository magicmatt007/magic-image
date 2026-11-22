//! Native side of the magic-image desktop app.
//!
//! The web frontend (shared with the browser version) talks to the file system
//! only through these few commands, via `src/platform/tauri.ts`. Nothing here
//! is limited by browser policies, so files can be overwritten in place.

use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::{
    fs, io,
    path::Path,
    time::UNIX_EPOCH,
};
use tauri::ipc::{InvokeBody, Request, Response};

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];

fn is_image(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn modified_of(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize, Debug)]
pub struct DirEntry {
    name: String,
    path: String,
    modified_ms: u64,
}

/// Image files directly inside `dir` (no sub-folders).
pub fn list_images(dir: &Path) -> io::Result<Vec<DirEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || !is_image(&path) {
            continue;
        }
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            modified_ms: modified_of(&meta),
        });
    }
    Ok(out)
}

/// Write through a temporary file in the same folder and then rename it over
/// the target, so an interrupted save never leaves a half-written image.
pub fn write_atomic(path: &Path, data: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no folder"))?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no file name"))?;
    let tmp = dir.join(format!(".{}.magic-image-tmp", name.to_string_lossy()));
    fs::write(&tmp, data)?;
    // On Windows, rename replaces an existing file (MoveFileEx with REPLACE_EXISTING).
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    list_images(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
fn modified_ms(path: String) -> Result<u64, String> {
    fs::metadata(&path).map(|m| modified_of(&m)).map_err(|e| e.to_string())
}

/// Raw request body = the encoded image; header `path` = URL-encoded target.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected the image as raw bytes".into());
    };
    let encoded = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing path")?;
    let path = percent_decode_str(encoded)
        .decode_utf8()
        .map_err(|e| e.to_string())?
        .into_owned();
    let path = Path::new(&path);
    // The app only ever saves images; refuse anything else.
    if !is_image(path) {
        return Err(format!("not an image file name: {}", path.display()));
    }
    write_atomic(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn path_kind(path: String) -> &'static str {
    let p = Path::new(&path);
    if p.is_dir() {
        "dir"
    } else if p.is_file() {
        "file"
    } else {
        "missing"
    }
}

/// File or folder passed on the command line ("Open with", file association).
#[tauri::command]
fn startup_path() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(|a| a.to_string_lossy().into_owned())
        .find(|a| !a.starts_with('-'))
}

/// True for the installed app (the installer puts an uninstaller next to it),
/// false for the portable exe and development builds. Only the installed app
/// updates itself: the update is a new installer.
#[tauri::command]
fn is_installed() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.join("uninstall.exe").is_file()))
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            read_file,
            modified_ms,
            write_file,
            path_kind,
            startup_path,
            is_installed
        ])
        .run(tauri::generate_context!())
        .expect("error while running magic-image");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_only_images_in_the_folder_itself() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.png"), b"x").unwrap();
        fs::write(dir.path().join("B.JPG"), b"x").unwrap();
        fs::write(dir.path().join("notes.txt"), b"x").unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(dir.path().join("sub").join("c.png"), b"x").unwrap();
        let mut names: Vec<_> = list_images(dir.path()).unwrap().into_iter().map(|e| e.name).collect();
        names.sort();
        assert_eq!(names, vec!["B.JPG", "a.png"]);
    }

    #[test]
    fn write_atomic_replaces_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("shot.png");
        fs::write(&target, b"old").unwrap();
        write_atomic(&target, b"new contents").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new contents");
        let left: Vec<_> = fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(left.len(), 1, "temp file left behind: {left:?}");
    }

    #[test]
    fn only_image_names_count_as_images() {
        assert!(is_image(Path::new("/x/Shot 1.PNG")));
        assert!(!is_image(Path::new("/x/evil.exe")));
        assert!(!is_image(Path::new("/x/noext")));
    }
}
