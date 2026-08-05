use std::process::Stdio;

use tokio::{
    io::AsyncReadExt,
    net::{TcpListener, TcpStream},
    process::{Child, Command},
    time::{sleep, timeout, Duration},
};

use crate::{
    error::AppError,
    models::{ConnectionConfig, DriverKind, SshTunnelConfig},
};

const DEFAULT_SSH_PORT: u16 = 22;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

struct SshForward<'a> {
    ssh_host: &'a str,
    ssh_port: u16,
    ssh_username: &'a str,
    private_key_path: Option<&'a str>,
    known_hosts_path: Option<&'a str>,
    local_port: u16,
    remote_host: &'a str,
    remote_port: u16,
}

pub struct SshTunnel {
    child: Child,
    local_port: u16,
}

impl SshTunnel {
    pub async fn start(config: &ConnectionConfig) -> Result<Option<Self>, AppError> {
        let Some(tunnel) = config.ssh_tunnel.as_ref() else {
            return Ok(None);
        };
        if config.kind == DriverKind::Sqlite {
            return Err(AppError::SshTunnel(
                "SSH tunnels require a network database driver".into(),
            ));
        }

        validate_config(tunnel)?;
        let remote_host = non_empty(
            config.host.as_deref().unwrap_or("localhost"),
            "database host",
        )?;
        let remote_port = config.port.unwrap_or(match config.kind {
            DriverKind::Postgres => 5432,
            DriverKind::Mysql => 3306,
            DriverKind::Sqlite => unreachable!(),
        });
        if remote_port == 0 {
            return Err(AppError::SshTunnel(
                "database port must be between 1 and 65535".into(),
            ));
        }
        let local_port = match tunnel.local_port {
            Some(port) if port > 0 => port,
            Some(_) => {
                return Err(AppError::SshTunnel(
                    "local port must be between 1 and 65535".into(),
                ));
            }
            None => reserve_local_port().await?,
        };
        let args = build_ssh_args(&SshForward {
            ssh_host: &tunnel.ssh_host,
            ssh_port: tunnel.ssh_port.unwrap_or(DEFAULT_SSH_PORT),
            ssh_username: &tunnel.ssh_username,
            private_key_path: tunnel.private_key_path.as_deref(),
            known_hosts_path: tunnel.known_hosts_path.as_deref(),
            local_port,
            remote_host,
            remote_port,
        });
        let mut child = Command::new("ssh")
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| AppError::SshTunnel(format!("could not start ssh: {error}")))?;

        if let Err(error) = wait_until_ready(&mut child, local_port).await {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(error);
        }

        Ok(Some(Self { child, local_port }))
    }

    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    pub async fn stop(mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

fn validate_config(config: &SshTunnelConfig) -> Result<(), AppError> {
    non_empty(&config.ssh_host, "SSH host")?;
    non_empty(&config.ssh_username, "SSH username")?;
    if matches!(config.ssh_port, Some(0)) {
        return Err(AppError::SshTunnel(
            "SSH port must be between 1 and 65535".into(),
        ));
    }
    if matches!(config.local_port, Some(0)) {
        return Err(AppError::SshTunnel(
            "local port must be between 1 and 65535".into(),
        ));
    }
    for (label, value) in [
        ("private key path", config.private_key_path.as_deref()),
        ("known hosts path", config.known_hosts_path.as_deref()),
    ] {
        if value.is_some_and(|path| path.trim().is_empty()) {
            return Err(AppError::SshTunnel(format!("{label} cannot be blank")));
        }
    }
    Ok(())
}

fn non_empty<'a>(value: &'a str, label: &str) -> Result<&'a str, AppError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(AppError::SshTunnel(format!("{label} cannot be blank")));
    }
    Ok(trimmed)
}

async fn reserve_local_port() -> Result<u16, AppError> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|error| AppError::SshTunnel(format!("could not reserve a local port: {error}")))?;
    let port = listener
        .local_addr()
        .map_err(|error| AppError::SshTunnel(format!("could not inspect local port: {error}")))?
        .port();
    drop(listener);
    Ok(port)
}

async fn wait_until_ready(child: &mut Child, local_port: u16) -> Result<(), AppError> {
    timeout(STARTUP_TIMEOUT, async {
        loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|error| AppError::SshTunnel(format!("could not inspect ssh: {error}")))?
            {
                let detail = read_stderr(child).await;
                return Err(AppError::SshTunnel(format!(
                    "ssh exited with {status}: {detail}"
                )));
            }
            if timeout(
                CONNECT_TIMEOUT,
                TcpStream::connect(("127.0.0.1", local_port)),
            )
            .await
            .is_ok_and(|result| result.is_ok())
            {
                return Ok(());
            }
            sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .map_err(|_| AppError::SshTunnel("timed out waiting for the SSH local forward".into()))?
}

async fn read_stderr(child: &mut Child) -> String {
    let Some(mut stderr) = child.stderr.take() else {
        return "no ssh diagnostics".into();
    };
    let mut bytes = Vec::new();
    if stderr.read_to_end(&mut bytes).await.is_err() {
        return "unable to read ssh diagnostics".into();
    }
    String::from_utf8_lossy(&bytes).trim().to_string()
}

fn build_ssh_args(forward: &SshForward<'_>) -> Vec<String> {
    let mut args = vec![
        "-N".into(),
        "-L".into(),
        format!(
            "127.0.0.1:{}:{}:{}",
            forward.local_port, forward.remote_host, forward.remote_port
        ),
        "-p".into(),
        forward.ssh_port.to_string(),
    ];
    if let Some(path) = forward.private_key_path {
        args.extend([
            "-i".into(),
            path.into(),
            "-o".into(),
            "IdentitiesOnly=yes".into(),
        ]);
    }
    if let Some(path) = forward.known_hosts_path {
        args.extend(["-o".into(), format!("UserKnownHostsFile={path}")]);
    }
    args.extend([
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        "ConnectTimeout=10".into(),
        "-o".into(),
        "ServerAliveInterval=30".into(),
        "-o".into(),
        "ServerAliveCountMax=3".into(),
        format!("{}@{}", forward.ssh_username, forward.ssh_host),
    ]);
    args
}

#[cfg(test)]
mod tests {
    use super::{build_ssh_args, SshForward};

    #[test]
    fn builds_non_interactive_forwarding_args_without_secret_material() {
        let args = build_ssh_args(&SshForward {
            ssh_host: "bastion.internal",
            ssh_port: 2222,
            ssh_username: "deploy",
            private_key_path: Some("/keys/queryx_ed25519"),
            known_hosts_path: Some("/keys/known_hosts"),
            local_port: 15432,
            remote_host: "db.internal",
            remote_port: 5432,
        });

        assert_eq!(
            args,
            vec![
                "-N",
                "-L",
                "127.0.0.1:15432:db.internal:5432",
                "-p",
                "2222",
                "-i",
                "/keys/queryx_ed25519",
                "-o",
                "IdentitiesOnly=yes",
                "-o",
                "UserKnownHostsFile=/keys/known_hosts",
                "-o",
                "StrictHostKeyChecking=yes",
                "-o",
                "BatchMode=yes",
                "-o",
                "ExitOnForwardFailure=yes",
                "-o",
                "ConnectTimeout=10",
                "-o",
                "ServerAliveInterval=30",
                "-o",
                "ServerAliveCountMax=3",
                "deploy@bastion.internal",
            ]
        );
        assert!(!args.iter().any(|arg| arg.contains("passphrase")));
    }
}
