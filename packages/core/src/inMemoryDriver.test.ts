import { describe, expect, it } from "vitest";
import { InMemoryDriver } from "./inMemoryDriver";

describe("InMemoryDriver read-only contract", () => {
  it("allows reads and rejects write statements in a read-only session", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "preview",
      database: "preview",
      readOnly: true,
    });

    expect(driver.isReadOnly()).toBe(true);
    expect(driver.capabilities().has("editing")).toBe(false);
    await expect(driver.execute("SELECT 1")).resolves.toBeDefined();
    await expect(
      driver.execute("UPDATE orders SET status = 'blocked'"),
    ).rejects.toThrow("read-only connection rejected");
  });

  it("rejects staged edit batches in a read-only session", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "preview",
      database: "preview",
      readOnly: true,
    });

    await expect(
      driver.executeBatch(["UPDATE orders SET status = 'blocked'"], 1),
    ).rejects.toThrow("read-only connection rejected");
  });
});
