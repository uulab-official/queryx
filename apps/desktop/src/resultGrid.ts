export const resultGridRowHeight = 25;
export const resultGridHeaderHeight = 34;
export const resultGridVirtualizationThreshold = 200;
export const resultGridOverscan = 12;

export interface VirtualRowWindow {
  enabled: boolean;
  start: number;
  end: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function getVirtualRowWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
): VirtualRowWindow {
  if (rowCount <= resultGridVirtualizationThreshold) {
    return {
      enabled: false,
      start: 0,
      end: rowCount,
      topSpacerHeight: 0,
      bottomSpacerHeight: 0,
    };
  }

  const contentScrollTop = Math.max(0, scrollTop - resultGridHeaderHeight);
  const safeViewportHeight = Math.max(resultGridRowHeight, viewportHeight);
  const firstVisibleRow = Math.min(
    Math.max(0, rowCount - 1),
    Math.floor(contentScrollTop / resultGridRowHeight),
  );
  const start = Math.max(0, firstVisibleRow - resultGridOverscan);
  const end = Math.min(
    rowCount,
    start +
      Math.ceil(safeViewportHeight / resultGridRowHeight) +
      resultGridOverscan * 2,
  );

  return {
    enabled: true,
    start,
    end,
    topSpacerHeight: start * resultGridRowHeight,
    bottomSpacerHeight: (rowCount - end) * resultGridRowHeight,
  };
}
