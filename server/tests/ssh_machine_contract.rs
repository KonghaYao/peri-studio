//! ssh-machine-mount §14.6：真 sshd 契约测（add → hello → disconnect → connect）。
//!
//! 默认 `#[ignore]`，避免无 sshd 的 CI 失败。手工验收示例：
//!
//! ```bash
//! SSH_MACHINE_CONTRACT=1 \
//!   SSH_CONTRACT_DESTINATION=user@gpu.example \
//!   SSH_CONTRACT_IDENTITY_FILE=$HOME/.ssh/id_ed25519 \
//!   cargo test -p peri-studio-server ssh_machine_add_hello_disconnect_connect -- --ignored
//! ```

mod common;

use std::fs;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use peri_studio_proto::ack::AckStatus;
use peri_studio_proto::action::{
    ActionEnvelope, MachineAddPayload, MachineInstancePayload, MachineTrustHostPayload,
};
use peri_studio_proto::Frame;
use yrs::{Map, ReadTxn, Transact};

use common::{
    fetch_registry_snapshot, product_bin, wait_terminal, TestEnv, WsClient, RECV_TIMEOUT,
};

const PIPELINE_BUDGET: Duration = Duration::from_secs(180);

fn contract_enabled() -> bool {
    std::env::var("SSH_MACHINE_CONTRACT").as_deref() == Ok("1")
}

fn required_env(key: &str) -> Result<String, String> {
    std::env::var(key).map_err(|_| format!("missing env {key}"))
}

fn machine_phase(doc: &yrs::Doc, instance_id: &str) -> Option<String> {
    let txn = doc.transact();
    let root = txn.get_map("root")?;
    let machines = root.get(&txn, "machines")?.cast::<yrs::MapRef>().ok()?;
    let entry = machines
        .get(&txn, instance_id)?
        .cast::<yrs::MapRef>()
        .ok()?;
    entry
        .get(&txn, "phase")
        .and_then(|value| value.cast::<String>().ok())
}

fn machine_host_key(doc: &yrs::Doc, instance_id: &str) -> Option<String> {
    let txn = doc.transact();
    let root = txn.get_map("root")?;
    let machines = root.get(&txn, "machines")?.cast::<yrs::MapRef>().ok()?;
    let entry = machines
        .get(&txn, instance_id)?
        .cast::<yrs::MapRef>()
        .ok()?;
    entry
        .get(&txn, "hostKeySha256")
        .and_then(|value| value.cast::<String>().ok())
}

struct LocalAppProc {
    child: Option<Child>,
    pub port: u16,
    stderr_log: std::path::PathBuf,
}

impl LocalAppProc {
    fn start(env: &TestEnv) -> Self {
        let stderr_log = env.tmp.path().join("local.stderr.log");
        let path = format!(
            "{}:{}",
            env.fake_bin_dir.display(),
            std::env::var("PATH").unwrap_or_default()
        );
        let mut cmd = Command::new(product_bin());
        cmd.args([
            "local",
            "--listen",
            "127.0.0.1",
            "--listen-port",
            &env.port.to_string(),
            "--data-dir",
        ])
        .arg(&env.data_dir)
        .args(["--config-dir"])
        .arg(&env.config_dir)
        .args(["--log-level", "debug"])
        .env("PATH", path)
        .env_remove("RUST_LOG")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(
            fs::File::create(&stderr_log).expect("create local stderr log"),
        ));
        let child = cmd.spawn().expect("spawn peri-studio local");
        LocalAppProc {
            child: Some(child),
            port: env.port,
            stderr_log,
        }
    }

    fn wait_ready(&self) -> Result<(), String> {
        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while std::time::Instant::now() < deadline {
            if std::net::TcpStream::connect(("127.0.0.1", self.port)).is_ok() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let log = fs::read_to_string(&self.stderr_log).unwrap_or_default();
        Err(format!(
            "peri-studio local did not listen on 127.0.0.1:{}; stderr tail:\n{log}",
            self.port
        ))
    }
}

impl Drop for LocalAppProc {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

async fn send_machine_add(env: &TestEnv) -> Result<(WsClient, String), String> {
    let mut client =
        WsClient::connect_client(env.port, &env.client_token, &["hub:registry"]).await?;
    let command_id = uuid::Uuid::new_v4().to_string();
    let mut payload = MachineAddPayload {
        destination: required_env("SSH_CONTRACT_DESTINATION")?,
        display_name: std::env::var("SSH_CONTRACT_DISPLAY_NAME").ok(),
        port: std::env::var("SSH_CONTRACT_PORT")
            .ok()
            .and_then(|value| value.parse().ok()),
        identity_file: std::env::var("SSH_CONTRACT_IDENTITY_FILE").ok(),
    };
    if payload.display_name.is_none() {
        payload.display_name = Some("SSH contract host".into());
    }
    client
        .send(&Frame::Action(ActionEnvelope::MachineAdd {
            command_id: command_id.clone(),
            payload,
        }))
        .await?;
    let frame = wait_terminal(&mut client, RECV_TIMEOUT).await?;
    let instance_id = match frame {
        Frame::ActionAck(ack) if ack.status == AckStatus::Committed => ack
            .instance_id
            .ok_or_else(|| "machine/add committed without instanceId".to_string())?,
        Frame::ActionAck(ack) => {
            return Err(format!("machine/add unexpected ack: {:?}", ack.status));
        }
        Frame::ActionError(error) => {
            return Err(format!("machine/add failed: {:?}", error.code));
        }
        other => return Err(format!("machine/add unexpected frame: {other:?}")),
    };
    Ok((client, instance_id))
}

async fn trust_host_if_needed(
    env: &TestEnv,
    client: &mut WsClient,
    instance_id: &str,
) -> Result<(), String> {
    let doc = fetch_registry_snapshot(env.port, &env.client_token).await?;
    if machine_phase(&doc, instance_id).as_deref() != Some("awaiting_host_key") {
        return Ok(());
    }
    let fingerprint = machine_host_key(&doc, instance_id)
        .or_else(|| std::env::var("SSH_CONTRACT_HOST_KEY_FINGERPRINT").ok());
    let fingerprint = fingerprint
        .ok_or_else(|| "host awaiting trust but no hostKeySha256 in registry".to_string())?;
    let command_id = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::MachineTrustHost {
            command_id,
            payload: MachineTrustHostPayload {
                instance_id: instance_id.to_string(),
                fingerprint,
            },
        }))
        .await?;
    match wait_terminal(client, RECV_TIMEOUT).await? {
        Frame::ActionAck(ack)
            if matches!(ack.status, AckStatus::Committed | AckStatus::Duplicate) =>
        {
            Ok(())
        }
        Frame::ActionError(error) => Err(format!("machine/trust-host failed: {:?}", error.code)),
        other => Err(format!("machine/trust-host unexpected frame: {other:?}")),
    }
}

async fn wait_machine_phase(
    env: &TestEnv,
    instance_id: &str,
    phase: &str,
    timeout: Duration,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        let doc = fetch_registry_snapshot(env.port, &env.client_token).await?;
        if machine_phase(&doc, instance_id).as_deref() == Some(phase) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    Err(format!(
        "timed out waiting for machine {instance_id} phase={phase}"
    ))
}

async fn send_machine_disconnect(env: &TestEnv, instance_id: &str) -> Result<(), String> {
    let mut client =
        WsClient::connect_client(env.port, &env.client_token, &["hub:registry"]).await?;
    let command_id = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::MachineDisconnect {
            command_id,
            payload: MachineInstancePayload {
                instance_id: instance_id.to_string(),
            },
        }))
        .await?;
    match wait_terminal(&mut client, RECV_TIMEOUT).await? {
        Frame::ActionAck(ack)
            if matches!(ack.status, AckStatus::Committed | AckStatus::Duplicate) =>
        {
            Ok(())
        }
        Frame::ActionError(error) => Err(format!("machine/disconnect failed: {:?}", error.code)),
        other => Err(format!("machine/disconnect unexpected frame: {other:?}")),
    }
}

async fn send_machine_connect(env: &TestEnv, instance_id: &str) -> Result<(), String> {
    let mut client =
        WsClient::connect_client(env.port, &env.client_token, &["hub:registry"]).await?;
    let command_id = uuid::Uuid::new_v4().to_string();
    client
        .send(&Frame::Action(ActionEnvelope::MachineConnect {
            command_id,
            payload: MachineInstancePayload {
                instance_id: instance_id.to_string(),
            },
        }))
        .await?;
    match wait_terminal(&mut client, RECV_TIMEOUT).await? {
        Frame::ActionAck(ack)
            if matches!(ack.status, AckStatus::Committed | AckStatus::Duplicate) =>
        {
            Ok(())
        }
        Frame::ActionError(error) => Err(format!("machine/connect failed: {:?}", error.code)),
        other => Err(format!("machine/connect unexpected frame: {other:?}")),
    }
}

#[tokio::test]
#[ignore = "requires real sshd; set SSH_MACHINE_CONTRACT=1 and SSH_CONTRACT_DESTINATION"]
async fn ssh_machine_add_hello_disconnect_connect() {
    if !contract_enabled() {
        eprintln!("skip: SSH_MACHINE_CONTRACT is not set to 1");
        return;
    }

    let env = TestEnv::new();
    let _app = LocalAppProc::start(&env);
    _app.wait_ready().expect("local app ready");

    let (mut client, instance_id) = send_machine_add(&env).await.expect("machine/add committed");
    trust_host_if_needed(&env, &mut client, &instance_id)
        .await
        .expect("trust host when required");

    wait_machine_phase(&env, &instance_id, "online", PIPELINE_BUDGET)
        .await
        .expect("pipeline reached online (hello)");

    send_machine_disconnect(&env, &instance_id)
        .await
        .expect("disconnect tunnel");
    wait_machine_phase(&env, &instance_id, "offline", Duration::from_secs(30))
        .await
        .expect("machine offline after disconnect");

    send_machine_connect(&env, &instance_id)
        .await
        .expect("reconnect tunnel");
    wait_machine_phase(&env, &instance_id, "online", PIPELINE_BUDGET)
        .await
        .expect("machine online after reconnect");
}
