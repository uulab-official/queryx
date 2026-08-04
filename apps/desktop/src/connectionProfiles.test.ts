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
        host: "db.internal",
        port: 5432,
        username: "readonly",
        password: "must-not-persist",
        sslMode: "require",
      },
      { id: "broken", name: "", kind: "postgres", database: "" },
    ]);

    expect(profiles).toEqual([
      {
        id: "profile-1",
        name: "Analytics",
        kind: "postgres",
        database: "analytics",
        host: "db.internal",
        port: 5432,
        username: "readonly",
        sslMode: "require",
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
});
