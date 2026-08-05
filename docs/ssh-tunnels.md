# SSH Tunnels

QueryX can connect to PostgreSQL and MySQL/MariaDB through a local OpenSSH port forward. This covers the common bastion workflow used when the database is reachable only from a private network.

## Configure a tunnel

In the native desktop connection dialog:

1. Enter the database **Host** and **Port** as they are reachable from the SSH host. For a database on the bastion itself, use `localhost`.
2. Enable **Connect through SSH tunnel**.
3. Enter the SSH host, SSH port, and SSH username.
4. Optionally enter a private key path, a known-hosts file path, and a local port. An empty local port is assigned automatically.
5. Test the connection before saving or connecting.

The saved profile contains only the tunnel endpoints and file paths. It does not contain an SSH password, key contents, or passphrase.

## Security boundary

QueryX launches the platform `ssh` executable with argument arrays, never a shell command string. The tunnel uses:

- `BatchMode=yes` so the desktop app cannot hang on an interactive password prompt;
- `StrictHostKeyChecking=yes` and the configured `UserKnownHostsFile` when supplied;
- `ExitOnForwardFailure=yes` so a failed forward cannot look like a successful connection;
- `ServerAliveInterval=30` and `ServerAliveCountMax=3` to detect a dead bastion;
- `IdentitiesOnly=yes` when a private key path is supplied.

Use an SSH agent or a platform-managed key that can authenticate without an interactive passphrase prompt. QueryX intentionally does not add `sshpass`, accept host keys automatically, or store SSH credentials in the OS keychain connection-password entry.

## Lifecycle

The tunnel starts before the database driver opens its pool. QueryX waits for the loopback listener, then connects the database driver to `127.0.0.1:<local-port>`. Disconnecting the database removes the driver and terminates the SSH child process. If database connection or metadata loading fails, the temporary tunnel is also terminated.

## Limitations

- One local forward per connection profile is supported.
- Jump-host chains, SOCKS proxies, agent forwarding, and GUI key/passphrase prompts are not supported yet.
- The native desktop runtime is required; browser preview cannot start an OS process.
- The database host and port must be reachable from the SSH host. They are not interpreted from the local machine's network namespace.

## Troubleshooting

- Run `ssh -v -N -L <local-port>:<database-host>:<database-port> <user>@<ssh-host>` manually with the same identity and known-hosts files to inspect authentication and routing.
- An “unknown host key” error means the bastion is not trusted by the configured or default `known_hosts` file. Add it through your normal SSH administration process; QueryX will not accept it automatically.
- A tunnel can be listening while the destination database is unreachable. The final driver connection still validates the destination and reports the database error.
