//! 本机 server 健康检查命令。

use std::io::{Read as _, Write as _};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::time::Duration;

use peri_studio_server::config::Config;
use peri_studio_server::web::HealthSnapshot;

use crate::cli::StatusArgs;

const STATUS_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_STATUS_RESPONSE: u64 = 32 * 1024;

pub fn run(config_file: Option<&Path>, args: StatusArgs) -> anyhow::Result<()> {
    let config = Config::load(&args.overrides, config_file)?;
    let health = query_health(status_target(&config)?)?;
    if args.json {
        println!("{}", serde_json::to_string(&health)?);
    } else {
        println!(
            "{} ready={} protocol={} server={}",
            health.status.as_str(),
            health.ready,
            health.protocol_version,
            health.server_version
        );
    }
    if args.ready && !health.ready {
        anyhow::bail!("server is live but not ready ({})", health.status.as_str());
    }
    Ok(())
}

fn status_target(config: &Config) -> anyhow::Result<SocketAddr> {
    let ip = match config.listen_addr {
        IpAddr::V4(ip) if ip.is_loopback() => IpAddr::V4(ip),
        IpAddr::V6(ip) if ip.is_loopback() => IpAddr::V6(ip),
        IpAddr::V4(ip) if ip.is_unspecified() => IpAddr::V4(Ipv4Addr::LOCALHOST),
        IpAddr::V6(ip) if ip.is_unspecified() => IpAddr::V6(Ipv6Addr::LOCALHOST),
        other => anyhow::bail!("status probe is local-only; configured address is {other}"),
    };
    Ok(SocketAddr::new(ip, config.listen_port))
}

fn query_health(address: SocketAddr) -> anyhow::Result<HealthSnapshot> {
    let mut stream = TcpStream::connect_timeout(&address, STATUS_TIMEOUT)
        .map_err(|error| anyhow::anyhow!("cannot connect to Peri Studio at {address}: {error}"))?;
    stream.set_read_timeout(Some(STATUS_TIMEOUT))?;
    stream.set_write_timeout(Some(STATUS_TIMEOUT))?;
    let host = match address.ip() {
        IpAddr::V4(ip) => format!("{ip}:{}", address.port()),
        IpAddr::V6(ip) => format!("[{ip}]:{}", address.port()),
    };
    write!(
        stream,
        "GET /api/health HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
    )?;
    stream.flush()?;
    let mut bytes = Vec::new();
    (&mut stream)
        .take(MAX_STATUS_RESPONSE + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_STATUS_RESPONSE {
        anyhow::bail!("health response exceeds {MAX_STATUS_RESPONSE} bytes");
    }
    parse_health_response(&bytes)
}

fn parse_health_response(bytes: &[u8]) -> anyhow::Result<HealthSnapshot> {
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| anyhow::anyhow!("malformed health response"))?;
    let header = std::str::from_utf8(&bytes[..split])?;
    let mut lines = header.split("\r\n");
    let status = lines.next().unwrap_or_default();
    if !status.starts_with("HTTP/1.1 200 ") {
        anyhow::bail!("health endpoint returned a non-200 response");
    }
    let mut content_length = None;
    let mut json = false;
    for line in lines {
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| anyhow::anyhow!("malformed health response header"))?;
        if name.eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                anyhow::bail!("duplicate health content-length");
            }
            content_length = Some(value.trim().parse::<usize>()?);
        }
        if name.eq_ignore_ascii_case("content-type") {
            json = value
                .trim()
                .split(';')
                .next()
                .is_some_and(|value| value.eq_ignore_ascii_case("application/json"));
        }
    }
    let body = &bytes[split + 4..];
    if !json || content_length != Some(body.len()) {
        anyhow::bail!("invalid health response headers");
    }
    Ok(serde_json::from_slice(body)?)
}

#[cfg(test)]
mod tests {
    use super::parse_health_response;

    #[test]
    fn parses_bounded_json_health_response() {
        let body =
            r#"{"status":"healthy","ready":true,"protocolVersion":1,"serverVersion":"0.2.0"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        assert!(parse_health_response(response.as_bytes()).unwrap().ready);
    }
}
