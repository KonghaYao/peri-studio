//! 本机文件夹选择（loopback Web 面板专用）。
//!
//! 浏览器无法获得绝对路径，因此在 server 进程侧唤起原生目录选择器。
//! 仅由 `/api/local/pick-directory` 在已认证 loopback 会话下调用。

use std::path::PathBuf;
use std::process::Command;

/// 唤起本机目录选择器。用户取消时返回 `None`。
pub fn pick_directory(prompt: &str) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return pick_directory_macos(prompt);
    }
    #[cfg(target_os = "linux")]
    {
        return pick_directory_linux(prompt);
    }
    #[cfg(target_os = "windows")]
    {
        return pick_directory_windows(prompt);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = prompt;
        None
    }
}

#[cfg(target_os = "macos")]
fn pick_directory_macos(prompt: &str) -> Option<PathBuf> {
    let escaped = prompt.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("POSIX path of (choose folder with prompt \"{escaped}\")");
    let output = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

#[cfg(target_os = "linux")]
fn pick_directory_linux(prompt: &str) -> Option<PathBuf> {
    if let Some(path) = run_directory_picker(
        Command::new("zenity").args([
            "--file-selection",
            "--directory",
            "--title",
            prompt,
        ]),
    ) {
        return Some(path);
    }
    run_directory_picker(
        Command::new("kdialog").args(["--getexistingdirectory", ".", "--title", prompt]),
    )
}

#[cfg(target_os = "windows")]
fn pick_directory_windows(prompt: &str) -> Option<PathBuf> {
    let escaped = prompt.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; \
         $dialog.Description = '{escaped}'; \
         if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ \
           Write-Output $dialog.SelectedPath \
         }}"
    );
    run_directory_picker(Command::new("powershell").args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &script,
    ]))
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
fn run_directory_picker(command: &mut Command) -> Option<PathBuf> {
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

#[cfg(test)]
#[path = "local_dialog_test.rs"]
mod tests;
