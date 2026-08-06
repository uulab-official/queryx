import { describe, expect, it } from "vitest";
import { inspectQuerySafety, InMemoryDriver } from "./index";

describe("inspectQuerySafety", () => {
  it("flags UPDATE statements without a WHERE clause", () => {
    expect(inspectQuerySafety("UPDATE users SET status = 'Y';")).toMatchObject({
      isDangerous: true,
      operation: "UPDATE",
      reason: "No top-level WHERE clause detected",
    });
  });

  it("flags DELETE statements after removing comments", () => {
    expect(
      inspectQuerySafety("-- review first\nDELETE FROM users;").isDangerous,
    ).toBe(true);
  });

  it("allows destructive statements with a WHERE clause", () => {
    expect(
      inspectQuerySafety("DELETE FROM users WHERE id = 1").isDangerous,
    ).toBe(false);
  });

  it("does not treat WHERE inside a string as a row guard", () => {
    expect(
      inspectQuerySafety("UPDATE users SET note = 'WHERE id = 1'").isDangerous,
    ).toBe(true);
  });

  it("does not treat a nested subquery WHERE as the outer row guard", () => {
    expect(
      inspectQuerySafety(
        "UPDATE users SET status = (SELECT status FROM states WHERE code = 'active')",
      ),
    ).toMatchObject({
      isDangerous: true,
      operation: "UPDATE",
      reason: "No top-level WHERE clause detected",
    });
  });

  it("finds the outer WHERE after a CTE", () => {
    expect(
      inspectQuerySafety(
        "WITH candidates AS (SELECT id FROM users WHERE enabled = true) UPDATE users SET status = 'Y' WHERE users.id IN (SELECT id FROM candidates)",
      ),
    ).toMatchObject({
      isDangerous: false,
      operation: "UPDATE",
      reason: "Top-level WHERE clause detected",
    });
  });

  it("ignores keywords in dollar-quoted PostgreSQL strings and comments", () => {
    expect(
      inspectQuerySafety(
        "DELETE FROM users /* WHERE id = 1 */ WHERE note = $$DELETE FROM users$$",
      ),
    ).toMatchObject({
      isDangerous: false,
      operation: "DELETE",
      reason: "Top-level WHERE clause detected",
    });
  });

  it("does not classify column or CTE names named update as DML", () => {
    expect(
      inspectQuerySafety(
        "WITH update AS (SELECT id FROM users) SELECT update.id FROM update",
      ).isDangerous,
    ).toBe(false);
    expect(inspectQuerySafety("SELECT update FROM users").isDangerous).toBe(
      false,
    );
  });

  it("checks every statement in a multi-statement document", () => {
    expect(
      inspectQuerySafety(
        "UPDATE users SET status = 'Y' WHERE id = 1; DELETE FROM users",
      ),
    ).toMatchObject({
      isDangerous: true,
      operation: "DELETE",
      reason: "No top-level WHERE clause detected",
    });
  });

  it("warns for high-risk DDL without confusing it with a row predicate", () => {
    expect(inspectQuerySafety("TRUNCATE TABLE users")).toMatchObject({
      isDangerous: true,
      operation: "TRUNCATE",
      reason: "High-risk schema operation detected",
    });
    expect(inspectQuerySafety("DROP TABLE users")).toMatchObject({
      isDangerous: true,
      operation: "DROP",
      reason: "High-risk schema operation detected",
    });
    expect(
      inspectQuerySafety("ALTER TABLE users DROP COLUMN secret"),
    ).toMatchObject({
      isDangerous: true,
      operation: "ALTER",
      reason: "High-risk schema operation detected",
    });
  });

  it("does not classify DDL words inside a query result as schema changes", () => {
    expect(
      inspectQuerySafety("SELECT 'DROP TABLE users' AS preview").isDangerous,
    ).toBe(false);
  });

  it("does not flag SELECT statements", () => {
    expect(inspectQuerySafety("SELECT * FROM users").isDangerous).toBe(false);
  });
});

describe("InMemoryDriver", () => {
  it("normalizes a query result and exposes metadata", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    const result = await driver.execute("SELECT * FROM orders");
    const database = await driver.metadata();

    expect(result.columns.map((column) => column.name)).toEqual([
      "day",
      "orders",
      "revenue",
    ]);
    expect(result.rows).toHaveLength(10);
    expect(result.warnings).toEqual([]);
    expect(database.tables.map((table) => table.name)).toContain("orders");
    expect(
      database.tables
        .find((table) => table.name === "orders")
        ?.indexes.map((index) => index.name),
    ).toContain("idx_orders_status_created_at");
    expect(database.views.map((view) => view.name)).toContain("paid_orders");
    expect(
      database.tables
        .find((table) => table.name === "orders")
        ?.foreignKeys.map((foreignKey) => foreignKey.name),
    ).toContain("orders_customer_id_fkey");
    expect(driver.capabilities().has("transactions")).toBe(true);
  });

  it("returns a warning and affected rows for a dangerous query", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    const result = await driver.execute("UPDATE users SET status = 'Y'");

    expect(result.affectedRows).toBe(1_248_521);
    expect(result.warnings).toEqual(["No top-level WHERE clause detected"]);
  });

  it("returns a deterministic non-executing plan", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });

    const result = await driver.execute("EXPLAIN SELECT * FROM orders");

    expect(result.columns[0]?.name).toBe("QUERY PLAN");
    expect(result.rows[0]?.["QUERY PLAN"]).toContain("Seq Scan");
    expect(result.affectedRows).toBe(0);
    expect(result.warnings).toEqual([
      "Estimated plan only; the statement was not executed",
    ]);
  });

  it("honors an already-aborted signal", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      driver.execute("SELECT 1", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels an in-flight query", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    const controller = new AbortController();
    const execution = driver.execute("SELECT pg_sleep(10)", controller.signal);

    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
  });
});
