//! ssh_argv 不变量测试（ssh-machine-mount §14.1）。

use tempfile::tempdir;

use super::{
    build_scp_argv, build_ssh_argv, build_tunnel_argv, known_hosts_path, SshConnectOptions,
};

fn sample_options<'a>(
    data_dir: &'a std::path::Path,
    config_dir: &'a std::path::Path,
) -> SshConnectOptions<'a> {
    SshConnectOptions {
        data_dir,
        config_dir,
        destination: "user@example.com",
        port: Some(2222),
        identity_file: Some("/home/me/.ssh/id_ed25519"),
    }
}

fn index_after(argv: &[String], marker: &str) -> usize {
    argv.iter()
        .position(|arg| arg == marker)
        .unwrap_or_else(|| panic!("missing marker {marker} in {argv:?}"))
}

#[test]
fn ssh_argv_contains_batch_mode_and_control_master() {
    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    std::fs::create_dir_all(&config).unwrap();
    let opts = sample_options(dir.path(), &config);
    let argv = build_ssh_argv(&opts, &["uname", "-s"]).unwrap();

    assert!(argv.windows(2).any(|pair| pair == ["-o", "BatchMode=yes"]));
    assert!(argv.windows(2).any(|pair| pair == ["-o", "ControlMaster=no"]));
    assert!(argv.windows(2).any(|pair| {
        pair[0] == "-o" && pair[1].starts_with("UserKnownHostsFile=")
    }));
    let known_hosts = known_hosts_path(dir.path());
    assert!(argv.iter().any(|arg| arg == &format!("UserKnownHostsFile={}", known_hosts.display())));
}

#[test]
fn tunnel_argv_contains_reverse_forward_and_destination_after_separator() {
    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    std::fs::create_dir_all(&config).unwrap();
    let opts = sample_options(dir.path(), &config);
    let argv = build_tunnel_argv(&opts, 8456).unwrap();

    assert!(argv.windows(2).any(|pair| pair == ["-o", "ExitOnForwardFailure=yes"]));
    assert!(argv.contains(&"-N".to_string()));
    assert!(argv.contains(&"-R".to_string()));
    assert!(argv.contains(&"127.0.0.1:0:127.0.0.1:8456".to_string()));

    let separator = index_after(&argv, "--");
    assert_eq!(argv[separator + 1], "user@example.com");
}

#[test]
fn ssh_argv_places_destination_after_separator() {
    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    std::fs::create_dir_all(&config).unwrap();
    let opts = sample_options(dir.path(), &config);
    let argv = build_ssh_argv(&opts, &["echo", "hi"]).unwrap();

    let separator = index_after(&argv, "--");
    assert_eq!(argv[separator + 1], "user@example.com");
    assert_eq!(argv[separator + 2..], ["echo", "hi"]);
}

#[test]
fn scp_argv_places_remote_target_after_separator() {
    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    std::fs::create_dir_all(&config).unwrap();
    let opts = sample_options(dir.path(), &config);
    let remote = "user@example.com:/tmp/peri-studio";
    let argv = build_scp_argv(&opts, &["/tmp/local.bin"], remote).unwrap();

    let separator = index_after(&argv, "--");
    assert_eq!(argv[separator + 1], remote);
    assert_eq!(argv[separator - 1], "/tmp/local.bin");
}

#[test]
fn rejects_destination_with_leading_dash() {
    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    let opts = SshConnectOptions {
        data_dir: dir.path(),
        config_dir: &config,
        destination: "-oProxyCommand=evil",
        port: None,
        identity_file: None,
    };
    assert!(build_ssh_argv(&opts, &[]).is_err());
    assert!(build_tunnel_argv(&opts, 8456).is_err());
}

#[test]
fn rejects_identity_under_data_dir() {
    let dir = tempdir().unwrap();
    let token_path = dir.path().join("instance.token");
    std::fs::write(&token_path, "secret").unwrap();
    let config_dir = dir.path().join("config");
    let opts = SshConnectOptions {
        data_dir: dir.path(),
        config_dir: &config_dir,
        destination: "user@example.com",
        port: None,
        identity_file: Some(token_path.to_str().unwrap()),
    };
    assert!(build_ssh_argv(&opts, &[]).is_err());
}

#[test]
fn rejects_identity_with_leading_dash() {
    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    let opts = SshConnectOptions {
        data_dir: dir.path(),
        config_dir: &config,
        destination: "user@example.com",
        port: None,
        identity_file: Some("-oProxyCommand=evil"),
    };
    assert!(build_tunnel_argv(&opts, 8456).is_err());
}

#[test]
fn port_option_is_emitted_before_ssh_options() {
    let dir = tempdir().unwrap();
    let config = dir.path().join("config");
    let opts = sample_options(dir.path(), &config);
    let argv = build_ssh_argv(&opts, &[]).unwrap();
    let port_index = index_after(&argv, "-p");
    let batch_mode = argv
        .windows(2)
        .position(|pair| pair == ["-o", "BatchMode=yes"])
        .unwrap();
    assert!(port_index < batch_mode);
    assert_eq!(argv[port_index + 1], "2222");
}
