//! realtime-voice CLI：文件转写与实时麦克风（typeless WebSocket）。

use std::io::{self, Write};
use std::path::PathBuf;

use anyhow::{Context as AnyhowContext, Result};
use clap::{Parser, Subcommand};
use peri_realtime_voice::{
    default_config_path, load_audio_file, open_default_microphone, VoiceClient, VoiceConfig,
    VoiceEvent,
};

#[derive(Parser)]
#[command(
    name = "realtime-voice",
    about = "Typeless realtime voice client (PCM over WebSocket)",
    version
)]
struct Cli {
    /// Config file (JSON: url / token / headers)
    #[arg(long, global = true, env = "PERI_REALTIME_VOICE_CONFIG")]
    config: Option<PathBuf>,

    /// WebSocket endpoint (ws:// or wss://)
    #[arg(long, global = true, env = "PERI_REALTIME_VOICE_URL")]
    url: Option<String>,

    /// Bearer token
    #[arg(long, global = true, env = "PERI_REALTIME_VOICE_TOKEN")]
    token: Option<String>,

    /// Read token from a file (first line)
    #[arg(long, global = true, env = "PERI_REALTIME_VOICE_TOKEN_FILE")]
    token_file: Option<PathBuf>,

    #[command(subcommand)]
    command: CommandKind,
}

#[derive(Subcommand)]
enum CommandKind {
    /// Transcribe a WAV or raw s16le PCM file
    Transcribe {
        audio: PathBuf,
        /// Print interim events
        #[arg(long)]
        stream: bool,
        /// Pace frames at realtime (20ms)
        #[arg(long)]
        realtime: bool,
    },
    /// Realtime recognition from the default microphone
    Mic,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let config = build_config(&cli)?;

    match cli.command {
        CommandKind::Transcribe {
            audio,
            stream,
            realtime,
        } => {
            let pcm = load_audio_file(&audio, config.sample_rate, config.channels)
                .with_context(|| format!("load audio {}", audio.display()))?;
            let mut client = VoiceClient::new(config);
            if stream {
                client
                    .transcribe_stream(&pcm, realtime, |event| print_event(event, true))
                    .await?;
            } else {
                let text = client.transcribe(&pcm, realtime).await?;
                println!("{text}");
            }
        }
        CommandKind::Mic => {
            run_mic(config).await?;
        }
    }
    Ok(())
}

fn build_config(cli: &Cli) -> Result<VoiceConfig> {
    let path = cli.config.clone().unwrap_or_else(default_config_path);
    let mut config = VoiceConfig::load_file(&path).unwrap_or_default();
    if let Some(url) = &cli.url {
        config.url = Some(url.clone());
    }
    if let Some(token) = &cli.token {
        config.token = Some(token.clone());
    }
    if let Some(token_file) = &cli.token_file {
        let raw = std::fs::read_to_string(token_file)
            .with_context(|| format!("read token file {}", token_file.display()))?;
        let token = raw.lines().next().unwrap_or("").trim();
        if !token.is_empty() {
            config.token = Some(token.to_string());
        }
    }
    Ok(config)
}

fn print_event(event: &VoiceEvent, stream: bool) {
    match event {
        VoiceEvent::SessionStarted => eprintln!("[system] session started"),
        VoiceEvent::SpeechStart => eprintln!("[vad] speech start"),
        VoiceEvent::Partial { text } if stream => {
            eprint!("\r[interim] {text}");
            let _ = io::stderr().flush();
        }
        VoiceEvent::Final { text } => {
            eprintln!("\r[final]   {text}          ");
        }
        VoiceEvent::SessionFinished => eprintln!("[system] session finished"),
        VoiceEvent::Error { message, .. } => eprintln!("[error] {message}"),
        VoiceEvent::Ignored | VoiceEvent::Unknown(_) | VoiceEvent::Partial { .. } => {}
    }
}

async fn run_mic(config: VoiceConfig) -> Result<()> {
    let mic = open_default_microphone().context("open default microphone")?;
    eprintln!(
        "[mic] {} | capture {}Hz {}ch {:?} -> 16000Hz mono 20ms (skip 300ms)",
        mic.device_name, mic.capture_rate, mic.capture_channels, mic.sample_format
    );
    let stop = mic.stopper();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        eprintln!("\n[mic] stopping");
        stop.stop();
    });

    eprintln!("[mic] recording (Ctrl+C to stop); speak after session starts");
    let mut client = VoiceClient::new(config);
    client
        .transcribe_realtime(mic, |event| print_event(event, true))
        .await?;
    Ok(())
}
