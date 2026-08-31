//! Peri Studio 单一产品二进制。

use std::path::PathBuf;

mod cli;
mod connect;
mod connection;
mod machine_ports;
mod private_file;
mod server;
mod signal;
mod ssh_argv;
mod ssh_backend;
mod ssh_release_checksums;
#[cfg(test)]
#[path = "ssh_backend_fake_test.rs"]
mod ssh_backend_fake_test;
mod ssh_backend_pipeline;
mod status;
mod telemetry;
mod token;

use clap::{FromArgMatches as _, Parser as _};
use peri_studio_server::config::{CliOverrides, Config};
use tokio_util::sync::CancellationToken;

use anyhow::Context as _;

use crate::cli::{Cli, Command, ServerArgs};

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Token(args)) => token::run(cli.config.as_deref(), cli.json_log, args),
        Some(Command::Status(args)) => status::run(cli.config.as_deref(), args),
        Some(Command::ProtocolVersion) => {
            println!("{}", peri_studio_proto::version::PROTOCOL_VERSION);
            Ok(())
        }
        command => {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()?;
            runtime.block_on(run_async(cli.config, cli.json_log, command))
        }
    }
}

async fn run_async(
    config_file: Option<std::path::PathBuf>,
    json_log: bool,
    command: Option<Command>,
) -> anyhow::Result<()> {
    match command {
        None => {
            run_server(
                config_file.as_deref(),
                json_log,
                ServerArgs {
                    overrides: default_server_overrides()?,
                },
                true,
            )
            .await
        }
        Some(Command::Local(args)) => {
            run_server(config_file.as_deref(), json_log, args, true).await
        }
        Some(Command::Serve(args)) => {
            run_server(
                config_file.as_deref(),
                json_log,
                ServerArgs {
                    overrides: args.overrides,
                },
                args.local,
            )
            .await
        }
        Some(Command::Connect(args)) => {
            telemetry::init_instance(&args.log_level, json_log)?;
            let shutdown = CancellationToken::new();
            run_with_shutdown_signal(
                shutdown.clone(),
                connect::run(
                    connect::ConnectOptions {
                        server: args.server,
                        token_file: args.token_file,
                        data_dir: args.data_dir,
                        allow_insecure: args.allow_insecure,
                        managed_local_id: args.managed_local_id,
                    },
                    shutdown,
                ),
            )
            .await
        }
        Some(Command::OwnerShutdown { data_dir, token_file }) => {
            run_owner_shutdown(data_dir, token_file).await
        }
        Some(Command::Token(_)) | Some(Command::Status(_)) | Some(Command::ProtocolVersion) => {
            unreachable!("handled before runtime")
        }
    }
}

async fn run_server(
    config_file: Option<&std::path::Path>,
    json_log: bool,
    args: ServerArgs,
    managed_local: bool,
) -> anyhow::Result<()> {
    let config = Config::load(&args.overrides, config_file)?;
    peri_studio_server::config::init_tracing(&config.log_level, json_log)?;
    let shutdown = CancellationToken::new();
    run_with_shutdown_signal(
        shutdown.clone(),
        server::run(config, managed_local, json_log, shutdown),
    )
    .await
}

async fn run_with_shutdown_signal<F>(shutdown: CancellationToken, work: F) -> anyhow::Result<()>
where
    F: std::future::Future<Output = anyhow::Result<()>>,
{
    let signal = signal::forward_shutdown_signal(shutdown);
    tokio::pin!(signal);
    tokio::pin!(work);
    tokio::select! {
        result = &mut work => result,
        signal_result = &mut signal => {
            signal_result?;
            work.await
        }
    }
}

fn default_server_overrides() -> anyhow::Result<CliOverrides> {
    let command = <CliOverrides as clap::Args>::augment_args(clap::Command::new("peri-studio"));
    CliOverrides::from_arg_matches(&command.get_matches_from([""]))
        .map_err(|error| anyhow::anyhow!("failed to read default server options: {error}"))
}

async fn run_owner_shutdown(data_dir: PathBuf, token_file: PathBuf) -> anyhow::Result<()> {
    let owner = peri_instance::hub::owner_identity(&data_dir)?
        .ok_or_else(|| anyhow::anyhow!("no running instance owner in {}", data_dir.display()))?;
    let token = private_file::read_private_text(&token_file, "instance credential")?;
    peri_instance::hub::request_owner_shutdown(&data_dir, &owner, &token)
        .await
        .context("owner shutdown request failed")
}
