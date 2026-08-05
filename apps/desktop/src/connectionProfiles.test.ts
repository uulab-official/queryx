import { describe, expect, it } from "vitest";
import {
  connectionProfilesStorageKey,
  normalizeConnectionProfiles,
} from "./connectionProfiles";

describe("connection profile persistence boundary", () => {
  it("keeps only reusable non-secret connection fields", () => {
    const profiles = normalizeConnectionProfiles([
      {
        id: "profile-1",
        name: "Analytics",
        kind: "postgres",
        database: "analytics",
        readOnly: true,
        host: "db.internal",
        port: 5432,
        username: "readonly",
        password: "must-not-persist",
        sslMode: "verifyFull",
      },
      { id: "broken", name: "", kind: "postgres", database: "" },
    ]);

    expect(profiles).toEqual([
      {
        id: "profile-1",
        name: "Analytics",
        kind: "postgres",
        database: "analytics",
        readOnly: true,
        host: "db.internal",
        port: 5432,
        username: "readonly",
        sslMode: "verifyFull",
      },
    ]);
    expect(JSON.stringify(profiles)).not.toContain("must-not-persist");
  });

  it("normalizes profile limits and preserves the browser storage contract", () => {
    const profiles = normalizeConnectionProfiles(
      Array.from({ length: 55 }, (_, index) => ({
        id: `profile-${index}`,
        name: ` Profile ${index} `,
        kind: "sqlite",
        database: `file-${index}.db`,
        port: 0.5,
      })),
    );

    expect(profiles).toHaveLength(50);
    expect(profiles[0]?.name).toBe("Profile 0");
    expect(connectionProfilesStorageKey).toBe("queryx:connection-profiles");
    expect(profiles[0]).not.toHaveProperty("port");
  });

  it("preserves MySQL/MariaDB connection fields without secrets", () => {
    const [profile] = normalizeConnectionProfiles([
      {
        id: "mysql-1",
        name: "Reporting MariaDB",
        kind: "mysql",
        database: "reporting",
        host: "127.0.0.1",
        port: 3307,
        username: "report_reader",
        readOnly: true,
        sslMode: "require",
        password: "session-only",
      },
    ]);

    expect(profile).toMatchObject({
      kind: "mysql",
      database: "reporting",
      port: 3307,
      username: "report_reader",
      readOnly: true,
      sslMode: "require",
    });
    expect(profile).not.toHaveProperty("password");
  });

  it("accepts SQL Server profiles for reusable connections", () => {
    const [profile] = normalizeConnectionProfiles([
      {
        id: "sqlserver-1",
        name: "Operations SQL Server",
        kind: "sqlserver",
        database: "master",
        host: "sql.internal",
        port: 1433,
        username: "readonly",
        readOnly: true,
        sslMode: "require",
        password: "session-only",
      },
    ]);

    expect(profile).toMatchObject({
      kind: "sqlserver",
      database: "master",
      host: "sql.internal",
      port: 1433,
      username: "readonly",
      readOnly: true,
      sslMode: "require",
    });
    expect(profile).not.toHaveProperty("password");
  });

  it("accepts Oracle service profiles for reusable connections", () => {
    const [profile] = normalizeConnectionProfiles([
      {
        id: "oracle-1",
        name: "Finance Oracle",
        kind: "oracle",
        database: "FREEPDB1",
        host: "oracle.internal",
        port: 1521,
        username: "app_reader",
        readOnly: true,
        sslMode: "require",
        password: "session-only",
      },
    ]);

    expect(profile).toMatchObject({
      kind: "oracle",
      database: "FREEPDB1",
      host: "oracle.internal",
      port: 1521,
      username: "app_reader",
      readOnly: true,
      sslMode: "require",
    });
    expect(profile).not.toHaveProperty("password");
  });

  it("preserves only the keychain presence marker, never the password", () => {
    const [profile] = normalizeConnectionProfiles([
      {
        id: "secure-1",
        name: "Secure profile",
        kind: "postgres",
        database: "analytics",
        passwordStored: true,
        password: "must-not-persist",
      },
    ]);

    expect(profile?.passwordStored).toBe(true);
    expect(profile).not.toHaveProperty("password");
    expect(JSON.stringify(profile)).not.toContain("must-not-persist");
  });

  it("preserves certificate file paths without treating them as secrets", () => {
    const [profile] = normalizeConnectionProfiles([
      {
        id: "tls-1",
        name: "mTLS production",
        kind: "postgres",
        database: "analytics",
        sslMode: "require",
        sslRootCert: "/certs/ca.pem",
        sslClientCert: "/certs/client.crt",
        sslClientKey: "/certs/client.key",
      },
    ]);

    expect(profile).toMatchObject({
      sslMode: "require",
      sslRootCert: "/certs/ca.pem",
      sslClientCert: "/certs/client.crt",
      sslClientKey: "/certs/client.key",
    });
  });

  it("preserves SSH tunnel settings without persisting tunnel secrets", () => {
    const [profile] = normalizeConnectionProfiles([
      {
        id: "tunnel-1",
        name: "Private production",
        kind: "postgres",
        database: "analytics",
        host: "db.internal",
        port: 5432,
        username: "readonly",
        sshTunnel: {
          sshHost: "bastion.internal",
          sshPort: 2222,
          sshUsername: "deploy",
          localPort: 15432,
          privateKeyPath: "/keys/queryx_ed25519",
          knownHostsPath: "/keys/known_hosts",
        },
      },
    ]);

    expect(profile).toMatchObject({
      sshTunnel: {
        sshHost: "bastion.internal",
        sshPort: 2222,
        sshUsername: "deploy",
        localPort: 15432,
        privateKeyPath: "/keys/queryx_ed25519",
        knownHostsPath: "/keys/known_hosts",
      },
    });
    expect(JSON.stringify(profile)).not.toContain("passphrase");
  });
});
