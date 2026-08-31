//! fake OpenSSH 脚本契约测试（ssh-machine-mount §14.1）。

use std::fs;
use std::process::Command as StdCommand;

use tempfile::tempdir;

use crate::ssh_argv::{
    build_keyscan_argv, build_tunnel_argv, known_hosts_path, SshConnectOptions,
};
use crate::ssh_backend::{SshBackend, SshBackendConfig};

fn write_fake_ssh(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("fake-ssh");
    let script = r#"#!/bin/sh
echo "fake-ssh argv: $*" >&2
while [ "$1" != "" ]; do
  if [ "$1" = "--" ]; then
    shift
    break
  fi
  shift
done
if [ "$1" = "true" ]; then
  exit 0
fi
if echo "$*" | grep -q "127.0.0.1:0:127.0.0.1:"; then
  echo "Allocated port 43210 for remote forward to 127.0.0.1:8456" >&2
  sleep 60
fi
exit 0
"#;
    fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

fn write_fake_keyscan(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("fake-keyscan");
    let script = r#"#!/bin/sh
echo "host.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHRlc3Qta2V5LWZvci1mYWtlLXNzaA=="
"#;
    fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

#[test]
fn fake_ssh_tunnel_argv_contains_required_invariants() {
    let dir = tempdir().unwrap();
    let config_dir = dir.path().join("config");
    fs::create_dir_all(&config_dir).unwrap();
    let fake_ssh = write_fake_ssh(dir.path());
    let opts = SshConnectOptions {
        data_dir: dir.path(),
        config_dir: &config_dir,
        destination: "user@example.com",
        port: Some(2222),
        identity_file: Some("/home/me/.ssh/id_ed25519"),
    };
    let argv = build_tunnel_argv(&opts, 8456).unwrap();

    assert!(argv.windows(2).any(|pair| pair == ["-o", "BatchMode=yes"]));
    assert!(argv.windows(2).any(|pair| pair == ["-o", "ControlMaster=no"]));
    assert!(argv.iter().any(|arg| arg.starts_with("UserKnownHostsFile=")));
    assert!(argv.contains(&"-N".to_string()));
    assert!(argv.contains(&"127.0.0.1:0:127.0.0.1:8456".to_string()));
    let separator = argv.iter().position(|arg| arg == "--").unwrap();
    assert_eq!(argv[separator + 1], "user@example.com");

    let output = StdCommand::new(&fake_ssh)
        .args(&argv)
        .output()
        .expect("fake ssh should run");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("BatchMode=yes"));
    assert!(stderr.contains("ControlMaster=no"));
    assert!(stderr.contains("UserKnownHostsFile="));
    assert!(stderr.contains("127.0.0.1:0:127.0.0.1:8456"));
    assert!(stderr.contains("user@example.com"));
}

#[test]
fn fake_keyscan_emits_parseable_line() {
    let dir = tempdir().unwrap();
    let fake_keyscan = write_fake_keyscan(dir.path());
    let argv = build_keyscan_argv("user@example.com", Some(22)).unwrap();
    let output = StdCommand::new(&fake_keyscan)
        .args(&argv)
        .output()
        .expect("fake keyscan should run");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("ssh-ed25519"));
}

#[test]
fn ssh_backend_resolves_fake_program_paths_from_env() {
    std::env::set_var("SSH_BACKEND_SSH", "/tmp/fake-ssh");
    let dir = tempdir().unwrap();
    let backend = SshBackend::new(SshBackendConfig {
        data_dir: dir.path().to_path_buf(),
        config_dir: dir.path().join("config"),
        current_exe: std::env::current_exe().unwrap(),
        listen_port: 8456,
    });
    assert_eq!(
        backend.programs().ssh,
        std::path::PathBuf::from("/tmp/fake-ssh")
    );
    std::env::remove_var("SSH_BACKEND_SSH");
}

#[test]
fn known_hosts_path_is_under_data_dir() {
    let dir = tempdir().unwrap();
    let path = known_hosts_path(dir.path());
    assert_eq!(path, dir.path().join("ssh").join("known_hosts"));
}

#[tokio::test]
async fn append_known_hosts_writes_line() {
    let dir = tempdir().unwrap();
    let backend = SshBackend::new(SshBackendConfig {
        data_dir: dir.path().to_path_buf(),
        config_dir: dir.path().join("config"),
        current_exe: std::env::current_exe().unwrap(),
        listen_port: 8456,
    });
    backend
        .append_known_hosts_line(
            "ssh_test",
            "host.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHRlc3Q=",
        )
        .await
        .unwrap();
    let content = fs::read_to_string(known_hosts_path(dir.path())).unwrap();
    assert!(content.contains("host.example ssh-ed25519"));
}
