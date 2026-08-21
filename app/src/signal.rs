//! 进程信号到运行时取消令牌的适配。

use anyhow::Context as _;
use tokio_util::sync::CancellationToken;

/// 等待操作系统终止信号，然后取消调用方持有的运行时。
pub async fn forward_shutdown_signal(shutdown: CancellationToken) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut interrupt =
            signal(SignalKind::interrupt()).context("failed to install SIGINT handler")?;
        let mut terminate =
            signal(SignalKind::terminate()).context("failed to install SIGTERM handler")?;
        tokio::select! {
            _ = interrupt.recv() => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c()
        .await
        .context("failed to listen for Ctrl-C")?;

    tracing::info!("shutdown signal received");
    shutdown.cancel();
    Ok(())
}
