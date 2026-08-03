import { describe, expect, it } from "vitest";
import { inspectQuerySafety, InMemoryDriver } from "./index";

describe("inspectQuerySafety", () => {
  it("flags UPDATE statements without a WHERE clause", () => {
    expect(inspectQuerySafety("UPDATE users SET status = 'Y';")).toMatchObject({
      isDangerous: true,
      operation: "UPDATE",
      reason: "No WHERE clause detected",
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
    expect(result.warnings).toEqual(["No WHERE clause detected"]);
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
