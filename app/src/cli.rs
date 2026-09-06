//! 单一产品二进制的 CLI 契约。

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};
use peri_studio_server::auth::TokenRole;
use peri_studio_server::config::CliOverrides;

#[derive(Debug, Parser)]
#[command(
    name = "peri-studio",
    about = "Run Peri Studio locally, serve the control plane, or connect an instance",
    version,
    subcommand_required = false
)]
pub struct Cli {
    /// Server configuration file.
    #[arg(long, global = true)]
    pub config: Option<PathBuf>,
    /// Emit structured JSON logs.
    #[arg(long, global = true)]
    pub json_log: bool,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Start a local server and a managed local instance.
    Local(ServerArgs),
    /// Start the central server, optionally with a managed local instance.
    Serve(ServeArgs),
    /// Connect this machine's instance role to a server.
    Connect(ConnectArgs),
    /// Manage authentication tokens.
    Token(TokenArgs),
    /// Query server health.
    Status(StatusArgs),
    /// Hidden: print wire protocol version for remote SSH probe.
    #[command(hide = true)]
    ProtocolVersion,
    /// Hidden: authenticated owner shutdown for SSH stop agents.
    #[command(hide = true)]
    OwnerShutdown {
        #[arg(long)]
        data_dir: PathBuf,
        #[arg(long)]
        token_file: PathBuf,
    },
}

#[derive(Debug, Clone, Args)]
pub struct ServerArgs {
    #[command(flatten)]
    pub overrides: CliOverrides,
}

#[derive(Debug, Clone, Args)]
pub struct ServeArgs {
    #[command(flatten)]
    pub overrides: CliOverrides,
    /// Start and supervise a local instance that connects back to this server.
    #[arg(long)]
    pub local: bool,
}

#[derive(Debug, Clone, Args)]
pub struct ConnectArgs {
    /// Server base URL or /instance WebSocket URL.
    pub server: String,
    /// File containing an instance-role token.
    #[arg(long, env = "PERI_STUDIO_TOKEN_FILE")]
    pub token_file: PathBuf,
    /// Per-connection watermark and buffer directory.
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
    /// Permit plaintext ws:// to a non-loopback host.
    #[arg(long)]
    pub allow_insecure: bool,
    /// Log filter used when RUST_LOG is not set.
    #[arg(long, default_value = "info")]
    pub log_level: String,
    /// Internal ownership identity used only by the local supervisor.
    #[arg(long, hide = true)]
    pub managed_local_id: Option<String>,
}

#[derive(Debug, Args)]
pub struct TokenArgs {
    #[command(flatten)]
    pub overrides: CliOverrides,
    #[command(subcommand)]
    pub command: TokenCommand,
}

#[derive(Debug, Subcommand)]
pub enum TokenCommand {
    /// List token metadata without revealing token values.
    List,
    /// Generate a token.
    Generate {
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "full")]
        role: TokenRole,
        /// Write the token to a new private file instead of stdout.
        #[arg(long)]
        output_file: Option<PathBuf>,
    },
    /// Revoke a token by id.
    Revoke { token_id: String },
}

#[derive(Debug, Args)]
pub struct StatusArgs {
    #[command(flatten)]
    pub overrides: CliOverrides,
    /// Exit non-zero unless ready=true.
    #[arg(long)]
    pub ready: bool,
    /// Print the health payload as JSON.
    #[arg(long)]
    pub json: bool,
}

#[cfg(test)]
mod tests {
    use clap::Parser as _;

    use super::{Cli, Command};

    #[test]
    fn parses_all_product_roles() {
        let local = Cli::try_parse_from(["peri-studio", "local", "--listen-port", "9456"]).unwrap();
        assert!(matches!(local.command, Some(Command::Local(_))));

        let serve = Cli::try_parse_from(["peri-studio", "serve", "--local"]).unwrap();
        assert!(matches!(serve.command, Some(Command::Serve(args)) if args.local));

        let connect = Cli::try_parse_from([
            "peri-studio",
            "connect",
            "https://peri.example",
            "--token-file",
            "/tmp/peri-token",
        ])
        .unwrap();
        assert!(matches!(connect.command, Some(Command::Connect(_))));
    }
}
