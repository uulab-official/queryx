import { describe, expect, it } from "vitest";
import {
  getVirtualRowWindow,
  resultGridOverscan,
  resultGridRowHeight,
  resultGridVirtualizationThreshold,
} from "./resultGrid";

describe("getVirtualRowWindow", () => {
  it("keeps small result sets in the normal render path", () => {
    expect(
      getVirtualRowWindow(resultGridVirtualizationThreshold, 400, 480),
    ).toEqual({
      enabled: false,
      start: 0,
      end: resultGridVirtualizationThreshold,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    });
  });

  it("renders a bounded window with spacers for large results", () => {
    const result = getVirtualRowWindow(10_000, 2_534, 480);

    expect(result.enabled).toBe(true);
    expect(result.start).toBe(
      Math.floor((2_534 - 34) / resultGridRowHeight) - resultGridOverscan,
    );
    expect(result.end - result.start).toBeLessThan(80);
    expect(result.topSpacerHeight).toBe(result.start * resultGridRowHeight);
    expect(result.bottomSpacerHeight).toBe(
      (10_000 - result.end) * resultGridRowHeight,
    );
  });

  it("clamps the window at the end of the result set", () => {
    const result = getVirtualRowWindow(1_000, 100_000, 480);

    expect(result.start).toBe(987);
    expect(result.end).toBe(1_000);
    expect(result.bottomSpacerHeight).toBe(0);
  });
});
