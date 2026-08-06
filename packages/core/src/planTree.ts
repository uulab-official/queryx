import type { QueryResult } from "@queryx/shared";

export interface PlanCost {
  startup: number;
  total: number;
}

export interface PlanTime {
  startup: number;
  total: number;
}

export interface ExplainPlanNode {
  id: string;
  parentId: string | null;
  depth: number;
  label: string;
  details: string[];
  estimatedCost?: PlanCost;
  estimatedRows?: number;
  actualTimeMs?: PlanTime;
  actualRows?: number;
  loops?: number;
}

export interface ExplainPlan {
  column: string;
  nodes: ExplainPlanNode[];
}

const planColumnPattern = /^(query plan|explain|plan)$/i;
const fallbackPlanColumnPattern = /(?:query\s*plan|explain|plan)/i;
const detailPattern =
  /^(?:sort key|filter|output|index cond|join filter|hash cond|merge cond|recheck cond|planning time|execution time)\s*:/i;
const metricPattern = /\b(?:cost|actual\s+time|rows)\s*=/i;

export function parseExplainPlan(
  result: Pick<QueryResult, "columns" | "rows">,
): ExplainPlan | null {
  const column =
    result.columns.find((candidate) =>
      planColumnPattern.test(candidate.name),
    ) ??
    result.columns.find((candidate) =>
      fallbackPlanColumnPattern.test(candidate.name),
    );
  if (!column) return null;

  const lines = result.rows.flatMap((row) => {
    const value = row[column.name];
    return typeof value === "string" ? value.split(/\r?\n/) : [];
  });
  const nodes: ExplainPlanNode[] = [];
  const stack: Array<ExplainPlanNode | undefined> = [];
  let current: ExplainPlanNode | undefined;

  for (const line of lines) {
    const parsed = parsePlanNodeLine(line);
    if (!parsed) {
      const detail = line.trim();
      if (detail && current && detailPattern.test(detail)) {
        current.details.push(detail);
      }
      continue;
    }

    const parent = findParent(stack, parsed.depth);
    const node: ExplainPlanNode = {
      id: `plan-node-${nodes.length + 1}`,
      parentId: parent?.id ?? null,
      depth: parsed.depth,
      label: parsed.label,
      details: [],
      ...(parsed.estimatedCost ? { estimatedCost: parsed.estimatedCost } : {}),
      ...(parsed.estimatedRows === undefined
        ? {}
        : { estimatedRows: parsed.estimatedRows }),
      ...(parsed.actualTimeMs ? { actualTimeMs: parsed.actualTimeMs } : {}),
      ...(parsed.actualRows === undefined
        ? {}
        : { actualRows: parsed.actualRows }),
      ...(parsed.loops === undefined ? {} : { loops: parsed.loops }),
    };
    nodes.push(node);
    stack.length = parsed.depth;
    stack.push(node);
    current = node;
  }

  return nodes.length > 0 ? { column: column.name, nodes } : null;
}

interface ParsedPlanNode {
  depth: number;
  label: string;
  estimatedCost?: PlanCost;
  estimatedRows?: number;
  actualTimeMs?: PlanTime;
  actualRows?: number;
  loops?: number;
}

function parsePlanNodeLine(line: string): ParsedPlanNode | null {
  const trimmed = line.trim();
  if (!trimmed || (detailPattern.test(trimmed) && !trimmed.startsWith("->"))) {
    return null;
  }
  const arrow = /^->\s*/.test(trimmed);
  if (!arrow && !metricPattern.test(trimmed)) return null;

  const leadingSpaces = line.match(/^\s*/)?.[0].length ?? 0;
  const depth = Math.floor(leadingSpaces / 2);
  const withoutArrow = trimmed.replace(/^->\s*/, "");
  const metricStart = withoutArrow.search(
    /\s+\((?=[^)]*\b(?:cost|actual\s+time|rows)\s*=)/i,
  );
  const label = (
    metricStart === -1 ? withoutArrow : withoutArrow.slice(0, metricStart)
  ).trim();
  if (!label) return null;

  const costMatch = withoutArrow.match(
    /\bcost\s*=\s*([\d.e+-]+)\s*\.\.\s*([\d.e+-]+)/i,
  );
  const actualTimeMatch = withoutArrow.match(
    /\bactual\s+time\s*=\s*([\d.e+-]+)\s*\.\.\s*([\d.e+-]+)/i,
  );
  const actualSegment =
    actualTimeMatch?.index === undefined
      ? ""
      : withoutArrow.slice(actualTimeMatch.index);
  const estimatedRows = readNumber(
    actualTimeMatch?.index === undefined
      ? withoutArrow
      : withoutArrow.slice(0, actualTimeMatch.index),
    /\brows\s*=\s*([\d.e+-]+)/i,
  );
  const actualRows = readNumber(
    actualSegment || withoutArrow,
    actualSegment
      ? /\brows\s*=\s*([\d.e+-]+)/i
      : /\bactual\s+(?:rows|row)\s*=\s*([\d.e+-]+)/i,
  );
  const loops = readNumber(withoutArrow, /\bloops\s*=\s*([\d.e+-]+)/i);

  return {
    depth,
    label,
    ...(costMatch
      ? {
          estimatedCost: {
            startup: Number(costMatch[1]),
            total: Number(costMatch[2]),
          },
        }
      : {}),
    ...(estimatedRows === undefined ? {} : { estimatedRows }),
    ...(actualTimeMatch
      ? {
          actualTimeMs: {
            startup: Number(actualTimeMatch[1]),
            total: Number(actualTimeMatch[2]),
          },
        }
      : {}),
    ...(actualRows === undefined ? {} : { actualRows }),
    ...(loops === undefined ? {} : { loops }),
  };
}

function findParent(
  stack: readonly (ExplainPlanNode | undefined)[],
  depth: number,
): ExplainPlanNode | undefined {
  for (let index = depth - 1; index >= 0; index -= 1) {
    const node = stack[index];
    if (node) return node;
  }
  return undefined;
}

function readNumber(value: string, pattern: RegExp): number | undefined {
  const match = value.match(pattern);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isFinite(number) ? number : undefined;
}
