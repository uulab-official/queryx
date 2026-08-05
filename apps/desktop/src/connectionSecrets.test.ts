import { describe, expect, it } from "vitest";
import {
  deleteConnectionPassword,
  loadConnectionPassword,
  saveConnectionPassword,
} from "./connectionSecrets";

describe("connection secrets", () => {
  it("does not persist or expose passwords in browser preview mode", async () => {
    expect(await loadConnectionPassword("profile-1")).toBeNull();
    expect(await saveConnectionPassword("profile-1", "secret")).toBe(false);
    expect(await deleteConnectionPassword("profile-1")).toBe(false);
  });
});
