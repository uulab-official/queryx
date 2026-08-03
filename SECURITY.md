# Security Policy

QueryX handles database credentials and can execute destructive SQL, so security issues deserve a private, reproducible response path.

## Supported versions

QueryX is currently alpha. Security fixes are applied to the latest commit on `main`; there is not yet a maintained stable release branch.

## Report a vulnerability

Do not open a public issue. Email [uulab.official@gmail.com](mailto:uulab.official@gmail.com) with the subject `QueryX security report` and:

- the affected commit or version and operating system;
- a concise description of impact and the trust boundary crossed;
- reproducible steps or a minimal proof of concept using synthetic data;
- whether credentials, arbitrary files, database contents, or query execution are exposed;
- any known workaround.

Do not include real credentials, production data, or destructive payloads against systems you do not own. We will acknowledge a report as soon as practical, investigate it privately, and coordinate disclosure after a fix or mitigation is available.

## Security boundaries

- The Tauri process connects directly to databases; QueryX has no connection relay.
- Passwords are currently session-only and are not intentionally persisted.
- Filesystem access must use narrow Tauri capabilities and an explicit user-selected path.
- CSV exports protect spreadsheet formula prefixes by default.
- Query safety warnings reduce accidental risk but are not a database authorization control. Use least-privilege and read-only accounts.

The following are generally not vulnerabilities by themselves: a database account performing actions it is authorized to perform, an exported file written to a path explicitly selected by the user, or denial of service caused by an intentionally expensive query. Boundary bypasses, secret persistence, arbitrary file access, unsafe deep links, injection in privileged native commands, and safety-control bypasses are in scope.
