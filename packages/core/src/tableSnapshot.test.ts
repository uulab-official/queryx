import { describe, expect, it } from "vitest";
import { serializeTableSnapshot } from "./index";

describe("serializeTableSnapshot", () => {
  it("creates a reviewable table-and-data SQL snapshot with partial coverage", () => {
    const snapshot = serializeTableSnapshot(
      {
        schema: "public",
        name: "orders",
        columns: [
          { name: "id", type: "integer", nullable: false, primaryKey: true },
          { name: "status", type: "text", nullable: true },
        ],
      },
      [{ id: 7, status: "paid" }],
      { dialect: "postgres", reportedRowCount: 10 },
    );

    expect(snapshot).toContain("-- Rows: 1 of 10 (partial)");
    expect(snapshot).toContain('CREATE TABLE "public"."orders"');
    expect(snapshot).toContain('"id" integer NOT NULL');
    expect(snapshot).toContain('PRIMARY KEY ("id")');
    expect(snapshot).toContain(
      'INSERT INTO "public"."orders" ("id", "status") VALUES (7, \'paid\');',
    );
    expect(snapshot).toContain("BEGIN;");
    expect(snapshot).toContain("COMMIT;");
  });

  it("uses SQL Server identifiers and marks a complete snapshot", () => {
    const snapshot = serializeTableSnapshot(
      {
        schema: "dbo",
        name: "users",
        columns: [{ name: "id", type: "int", nullable: false }],
      },
      [],
      { dialect: "sqlserver", reportedRowCount: 0 },
    );

    expect(snapshot).toContain("-- Rows: 0 of 0 (complete)");
    expect(snapshot).toContain("CREATE TABLE [dbo].[users]");
    expect(snapshot).toContain("[id] int NOT NULL");
    expect(snapshot).not.toContain("INSERT INTO");
  });

  it("omits untrusted type labels instead of embedding them in DDL", () => {
    const snapshot = serializeTableSnapshot(
      {
        schema: "public",
        name: "events",
        columns: [
          {
            name: "payload",
            type: "text); DROP TABLE events; --",
            nullable: true,
          },
        ],
      },
      [],
      { dialect: "postgres", reportedRowCount: 0 },
    );

    expect(snapshot).toContain(
      "-- CREATE TABLE omitted because one or more database type labels require manual review.",
    );
    expect(snapshot).not.toContain("DROP TABLE events");
  });
});
