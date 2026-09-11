// WCH_CubeMX desktop shell (Tauri 2).
//
// The web app in dist/index.html is the whole UI and must keep working in a plain
// browser, so nothing here is required for it to run: the shell only ADDS things a
// browser cannot do - reading the MCU folder from disk, native file dialogs, and a
// watcher that hot-reloads a YAML while you edit it.
//
// The bridge that hooks these commands into the page is injected at window creation
// (see desktop.js), so app/template.html needs no Tauri-specific code.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// One MCU definition found on disk.
#[derive(Serialize, Clone, Debug)]
struct McuFile {
    /// `mcu.name` from the YAML, or the file stem if it cannot be read.
    name: String,
    path: String,
    /// "bundled" (shipped with the app) or "user" (~/.wch_cubemx/mcus).
    source: String,
    yaml: String,
}

/// Where MCU YAML lives: the bundled resource folder, then the user override folder.
/// A user file with the same name wins, which is what makes local edits possible
/// without touching the installation.
fn mcu_dirs(app: &AppHandle) -> Vec<(PathBuf, &'static str)> {
    let mut dirs = Vec::new();

    if let Ok(resource) = app.path().resource_dir() {
        let bundled = resource.join("data").join("mcus");
        if bundled.is_dir() {
            dirs.push((bundled, "bundled"));
        }
    }
    // Running from a dev checkout: ../data/mcus next to src-tauri.
    if let Ok(cwd) = std::env::current_dir() {
        for candidate in [cwd.join("data").join("mcus"), cwd.join("..").join("data").join("mcus")] {
            if candidate.is_dir() && !dirs.iter().any(|(p, _)| p == &candidate) {
                dirs.push((candidate, "bundled"));
            }
        }
    }
    if let Some(user) = user_mcu_dir() {
        if user.is_dir() {
            dirs.push((user, "user"));
        }
    }
    dirs
}

/// ~/.wch_cubemx/mcus - user overrides and hand-written parts.
fn user_mcu_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".wch_cubemx").join("mcus"))
}

/// Pull `mcu.name` out of the YAML without a YAML parser: it is the first
/// `name:` line inside the `mcu:` block, which every file starts with.
fn mcu_name_of(yaml: &str, fallback: &str) -> String {
    let mut in_mcu = false;
    for line in yaml.lines() {
        let trimmed = line.trim_end();
        if trimmed.starts_with("mcu:") {
            in_mcu = true;
            continue;
        }
        if in_mcu {
            // a new top-level key ends the mcu block
            if !trimmed.starts_with(' ') && !trimmed.trim().is_empty() && !trimmed.starts_with('#') {
                break;
            }
            let t = trimmed.trim();
            if let Some(rest) = t.strip_prefix("name:") {
                let value = rest.trim().trim_matches(['"', '\''].as_ref()).trim();
                if !value.is_empty() {
                    return value.to_string();
                }
            }
        }
    }
    fallback.to_string()
}

fn read_dir_mcus(dir: &Path, source: &'static str, out: &mut Vec<McuFile>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
            continue;
        }
        let yaml = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unnamed").to_string();
        let name = mcu_name_of(&yaml, &stem);
        // a user file replaces a bundled one with the same MCU name
        if let Some(existing) = out.iter_mut().find(|m| m.name == name) {
            *existing = McuFile { name, path: path.to_string_lossy().into(), source: source.into(), yaml };
        } else {
            out.push(McuFile { name, path: path.to_string_lossy().into(), source: source.into(), yaml });
        }
    }
}

/// Every MCU YAML the app can offer, bundled first, user overrides last.
#[tauri::command]
fn list_mcus(app: AppHandle) -> Vec<McuFile> {
    let mut out = Vec::new();
    for (dir, source) in mcu_dirs(&app) {
        read_dir_mcus(&dir, source, &mut out);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Read one MCU YAML by absolute path (what the watcher hands back, or a file the
/// user picked). Returns the text so the page can call its own loader.
#[tauri::command]
fn read_mcu(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// Native "open MCU file..." - returns the YAML text, or None if cancelled.
#[tauri::command]
fn open_mcu(app: AppHandle) -> Result<Option<McuFile>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open MCU file")
        .add_filter("MCU definition", &["yaml", "yml"])
        .blocking_pick_file();

    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|e| e.to_string())?;
    let yaml = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unnamed").to_string();
    Ok(Some(McuFile {
        name: mcu_name_of(&yaml, &stem),
        path: path.to_string_lossy().into(),
        source: "user".into(),
        yaml,
    }))
}

/// Native "save project as..." - writes the .wchproj YAML the page serialises.
/// Returns the path written, or None if the user cancelled.
#[tauri::command]
fn save_project(app: AppHandle, name: String, yaml: String) -> Result<Option<String>, String> {
    let suggested = if name.trim().is_empty() { "Untitled".to_string() } else { name };
    let picked = app
        .dialog()
        .file()
        .set_title("Save project")
        .set_file_name(format!("{suggested}.wchproj"))
        .add_filter("WCHCube project", &["wchproj"])
        .blocking_save_file();

    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|e| e.to_string())?;
    fs::write(&path, yaml).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().into()))
}

/// Native "open project..." - returns the file's text, or None if cancelled.
#[tauri::command]
fn open_project(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Open project")
        .add_filter("WCHCube project", &["wchproj"])
        .add_filter("All files", &["*"])
        .blocking_pick_file();

    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|e| e.to_string())?;
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// One file of a generated project: a path RELATIVE to the project root, and its text.
///
/// The page decides the layout (`src/main.c`, `lib/wchcube_generated/src/…`); the
/// shell only decides where the root goes and refuses to write outside it.
#[derive(serde::Deserialize, Clone, Debug)]
struct GeneratedFile {
    path: String,
    text: String,
}

/// What `write_project` did, so the page can report it rather than guess.
#[derive(Serialize, Clone, Debug)]
struct WriteResult {
    root: String,
    written: Vec<String>,
}

/// Reject a relative path that could escape the project root, or is not relative.
///
/// The page is trusted, but "the page is trusted" is exactly the assumption that
/// makes a path-traversal bug possible later, and this command writes whole trees
/// to a folder the user picked. Belt and braces: no absolute paths, no `..`, no
/// Windows drive prefixes or UNC, no leading separator.
fn safe_relative(rel: &str) -> Result<PathBuf, String> {
    if rel.trim().is_empty() {
        return Err("a generated file has an empty path".into());
    }
    let normalised = rel.replace('\\', "/");
    if normalised.starts_with('/') || normalised.contains(':') {
        return Err(format!("{rel}: generated paths must be relative to the project folder"));
    }
    let mut out = PathBuf::new();
    for part in normalised.split('/') {
        match part {
            "" | "." => continue,
            ".." => return Err(format!("{rel}: generated paths may not contain `..`")),
            p => out.push(p),
        }
    }
    if out.as_os_str().is_empty() {
        return Err(format!("{rel}: not a usable file path"));
    }
    Ok(out)
}

/// Native "Generate PlatformIO project" — pick a folder, write a whole project tree.
///
/// `files` are paths relative to the project root plus their text; `name` is the
/// suggested folder name. The user picks a PARENT directory and the project is
/// written to `<parent>/<name>`.
///
/// Three refusals, all deliberate and all reported by name rather than silently
/// worked around:
///   * a path that is not relative, or contains `..` — nothing is written at all,
///     and the check runs over EVERY file before the first one is created, so a
///     bad entry cannot leave a half-written tree;
///   * an existing non-empty target directory, unless `overwrite` is true;
///   * an existing file that is not one this generator is about to write — the
///     caller's file list is the whitelist, so a user's own `notes.md` beside the
///     generated code survives regeneration.
///
/// Returns the root and the relative paths written, or None if the user cancelled.
#[tauri::command]
fn write_project(
    app: AppHandle,
    name: String,
    files: Vec<GeneratedFile>,
    overwrite: bool,
) -> Result<Option<WriteResult>, String> {
    if files.is_empty() {
        return Err("nothing to write: the generator produced no files".into());
    }
    // Validate every path BEFORE creating anything.
    let mut planned: Vec<(PathBuf, &GeneratedFile)> = Vec::with_capacity(files.len());
    for f in &files {
        planned.push((safe_relative(&f.path)?, f));
    }

    let folder = if name.trim().is_empty() { "WCHCubeProject".to_string() } else { name.trim().to_string() };
    let picked = app
        .dialog()
        .file()
        .set_title("Generate PlatformIO project into...")
        .blocking_pick_folder();

    let Some(parent) = picked else { return Ok(None) };
    let parent = parent.into_path().map_err(|e| e.to_string())?;
    let root = parent.join(&folder);

    if root.exists() {
        let mut entries = fs::read_dir(&root).map_err(|e| format!("{}: {e}", root.display()))?;
        if entries.next().is_some() && !overwrite {
            return Err(format!(
                "{} already exists and is not empty. Generating would overwrite files in it; \
                 choose another folder, or confirm the overwrite.",
                root.display()
            ));
        }
    }

    let mut written = Vec::with_capacity(planned.len());
    for (rel, f) in &planned {
        let dest = root.join(rel);
        if let Some(dir) = dest.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        fs::write(&dest, &f.text).map_err(|e| format!("{}: {e}", dest.display()))?;
        written.push(rel.to_string_lossy().replace('\\', "/"));
    }
    Ok(Some(WriteResult { root: root.to_string_lossy().into(), written }))
}

/// Where the user's own MCU files go. Created on demand so the folder exists
/// the first time someone looks for it.
#[tauri::command]
fn user_mcu_folder() -> Result<String, String> {
    let dir = user_mcu_dir().ok_or("no home directory")?;
    fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir.to_string_lossy().into())
}

/// Watch every MCU folder and emit `mcu-changed` with the file's fresh contents,
/// so editing a YAML in another editor reloads the part in place.
fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let dirs = mcu_dirs(&app);
        if dirs.is_empty() {
            return;
        }
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("wch_cubemx: cannot start the MCU folder watcher: {e}");
                return;
            }
        };
        for (dir, _) in &dirs {
            if let Err(e) = watcher.watch(dir, RecursiveMode::NonRecursive) {
                eprintln!("wch_cubemx: not watching {}: {e}", dir.display());
            }
        }

        // Editors write a file in several steps; collapse a burst into one reload.
        let mut pending: Vec<PathBuf> = Vec::new();
        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(Ok(event)) => {
                    for path in event.paths {
                        if path.extension().and_then(|e| e.to_str()) == Some("yaml")
                            && !pending.contains(&path)
                        {
                            pending.push(path);
                        }
                    }
                }
                Ok(Err(e)) => eprintln!("wch_cubemx: watch error: {e}"),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    for path in pending.drain(..) {
                        if let Ok(yaml) = fs::read_to_string(&path) {
                            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("unnamed").to_string();
                            let payload = McuFile {
                                name: mcu_name_of(&yaml, &stem),
                                path: path.to_string_lossy().into(),
                                source: "user".into(),
                                yaml,
                            };
                            let _ = app.emit("mcu-changed", payload);
                        }
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_mcus,
            read_mcu,
            open_mcu,
            save_project,
            open_project,
            write_project,
            user_mcu_folder,
        ])
        .setup(|app| {
            // The window is built here rather than declared in tauri.conf.json so the
            // desktop bridge can be injected before the page's own scripts run.
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("WCH_CubeMX")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .initialization_script(include_str!("../desktop.js"))
                .build()?;
            spawn_watcher(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running WCH_CubeMX");
}

#[cfg(test)]
mod tests {
    use super::mcu_name_of;

    #[test]
    fn reads_the_mcu_name_out_of_a_file() {
        let yaml = "# comment\nmcu:\n  name: CH32V006\n  vendor: WCH\npackages:\n  name: nope\n";
        assert_eq!(mcu_name_of(yaml, "fallback"), "CH32V006");
    }

    #[test]
    fn falls_back_when_there_is_no_name() {
        assert_eq!(mcu_name_of("packages:\n  TSSOP20:\n", "CH32V003"), "CH32V003");
    }

    #[test]
    fn ignores_a_name_outside_the_mcu_block() {
        let yaml = "packages:\n  name: wrong\nmcu:\n  name: RIGHT\n";
        assert_eq!(mcu_name_of(yaml, "fallback"), "RIGHT");
    }

    // ---- safe_relative: the one function here that decides where bytes land.
    //
    // write_project takes a list of paths from the page and writes them under a
    // folder the user picked. The page is ours, so none of the escapes below can
    // happen today — which is exactly why they are tested now, rather than after
    // someone routes a user-supplied project name into a file path.
    use super::safe_relative;
    use std::path::Path;

    #[test]
    fn accepts_the_paths_a_generated_project_actually_uses() {
        for p in [
            "platformio.ini",
            "src/main.c",
            "README.md",
            ".gitignore",
            "lib/wchcube_generated/include/wchcube_init.h",
            "lib/wchcube_generated/src/wchcube_init.c",
        ] {
            assert!(safe_relative(p).is_ok(), "{p} should be accepted");
        }
    }

    #[test]
    fn normalises_windows_separators_and_redundant_parts() {
        let got = safe_relative(r"lib\wchcube_generated\src/./wchcube_init.c").unwrap();
        assert_eq!(got, Path::new("lib").join("wchcube_generated").join("src").join("wchcube_init.c"));
    }

    #[test]
    fn refuses_anything_that_could_escape_the_project_folder() {
        for p in [
            "../outside.c",                            // straight up
            "src/../../outside.c",                     // up after going down
            r"src\..\..\outside.c",                    // the same, Windows-spelled
            "/etc/passwd",                             // absolute, unix
            "C:/Windows/System32/drivers/etc/hosts",   // absolute, Windows
            r"\\server\share\file.c",                  // UNC
            "",                                        // nothing
            "   ",                                     // nothing, with whitespace
            "./",                                      // resolves to no file at all
        ] {
            assert!(safe_relative(p).is_err(), "{p:?} should have been refused");
        }
    }

    #[test]
    fn a_refusal_names_the_path_so_the_user_can_see_which_file() {
        let err = safe_relative("../outside.c").unwrap_err();
        assert!(err.contains("../outside.c"), "unhelpful message: {err}");
    }
}
