import { describe, expect, it } from "vitest";
import type { QueryChunk } from "@queryx/shared";
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

  it("fulfills the stream contract with a buffered fallback chunk", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "preview",
      database: "preview",
    });

    const chunks: QueryChunk[] = [];
    const summary = await driver.executeStream("SELECT 1", (chunk) => {
      chunks.push(chunk);
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.rowOffset).toBe(0);
    expect(chunks[0]?.rows.length).toBeGreaterThan(0);
    expect(summary.rows).toEqual([]);
  });
});
