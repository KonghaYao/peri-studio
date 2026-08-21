//! server token 管理命令。

use std::path::Path;
use std::time::Instant;

use peri_studio_server::auth::audit::audit;
use peri_studio_server::auth::{TokenStore, TOKENS_FILE};
use peri_studio_server::config::Config;

use crate::cli::{TokenArgs, TokenCommand};

pub fn run(config_file: Option<&Path>, json_log: bool, args: TokenArgs) -> anyhow::Result<()> {
    let config = Config::load(&args.overrides, config_file)?;
    peri_studio_server::config::init_tracing(&config.log_level, json_log)?;
    config.ensure_dirs()?;
    let mut store = TokenStore::load(&config.config_dir.join(TOKENS_FILE))?;
    match args.command {
        TokenCommand::List => {
            for info in store.list() {
                println!("{info}");
            }
        }
        TokenCommand::Generate {
            name,
            role,
            output_file,
        } => {
            let started = Instant::now();
            let record = if let Some(path) = output_file.as_deref() {
                let record = store.generate_to_file(role, &name, path)?;
                println!("created {} at {}", record.id, path.display());
                record
            } else {
                let record = store.generate(role, &name)?;
                println!("{}", record.token);
                record
            };
            audit(
                "token.generate",
                None,
                Some(&record.id),
                "ok",
                started.elapsed(),
                None,
            );
        }
        TokenCommand::Revoke { token_id } => {
            let started = Instant::now();
            let result = store.revoke(&token_id)?;
            let outcome = if let Some(record) = result {
                println!("revoked {}", record.id);
                "ok"
            } else {
                println!("token {token_id} is missing or already revoked");
                "not_found"
            };
            audit(
                "token.revoke",
                None,
                Some(&token_id),
                outcome,
                started.elapsed(),
                None,
            );
        }
    }
    Ok(())
}
