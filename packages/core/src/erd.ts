import type { DatabaseMetadata } from "@queryx/shared";

export type ErdRelationKind = "table" | "view";

export interface ErdColumn {
  name: string;
  type: string;
  primaryKey: boolean;
}

export interface ErdNode {
  id: string;
  kind: ErdRelationKind;
  schema: string;
  name: string;
  columns: ErdColumn[];
  totalColumns: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ErdEdge {
  id: string;
  kind: "foreignKey" | "viewReference";
  source: string;
  target: string;
  label: string;
}

export interface ErdDiagram {
  nodes: ErdNode[];
  edges: ErdEdge[];
  width: number;
  height: number;
}

export interface ErdLayoutOptions {
  maxNodes?: number;
  columns?: number;
  maxVisibleColumns?: number;
}

export function erdObjectId(
  kind: ErdRelationKind,
  schema: string,
  name: string,
): string {
  return `${kind}:${schema}\u0000${name}`;
}

export function buildErdDiagram(
  metadata: DatabaseMetadata,
  options: ErdLayoutOptions = {},
): ErdDiagram {
  const maxNodes = options.maxNodes ?? 120;
  const gridColumns = options.columns ?? 4;
  const maxVisibleColumns = options.maxVisibleColumns ?? 8;
  const relations = [
    ...metadata.tables.map((table) => ({
      kind: "table" as const,
      schema: table.schema,
      name: table.name,
      columns: table.columns,
    })),
    ...metadata.views.map((view) => ({
      kind: "view" as const,
      schema: view.schema,
      name: view.name,
      columns: view.columns,
    })),
  ]
    .sort(
      (left, right) =>
        left.schema.localeCompare(right.schema) ||
        left.kind.localeCompare(right.kind) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, maxNodes);
  const visibleIds = new Set(
    relations.map((relation) =>
      erdObjectId(relation.kind, relation.schema, relation.name),
    ),
  );
  const nodeWidth = 230;
  const rowHeight = 220;
  const columnGap = 28;
  const rowGap = 26;
  const nodes = relations.map((relation, index): ErdNode => {
    const visibleColumns = relation.columns.slice(0, maxVisibleColumns);
    const row = Math.floor(index / gridColumns);
    const column = index % gridColumns;
    return {
      id: erdObjectId(relation.kind, relation.schema, relation.name),
      kind: relation.kind,
      schema: relation.schema,
      name: relation.name,
      totalColumns: relation.columns.length,
      columns: visibleColumns.map((column) => ({
        name: column.name,
        type: column.type,
        primaryKey: Boolean(column.primaryKey),
      })),
      x: 24 + column * (nodeWidth + columnGap),
      y: 24 + row * (rowHeight + rowGap),
      width: nodeWidth,
      height: 52 + Math.max(1, visibleColumns.length) * 18,
    };
  });
  const edges: ErdEdge[] = [];
  const edgeIds = new Set<string>();
  for (const table of metadata.tables) {
    const source = erdObjectId("table", table.schema, table.name);
    if (!visibleIds.has(source)) continue;
    for (const foreignKey of table.foreignKeys) {
      const target = erdObjectId(
        "table",
        foreignKey.referencedRelation.schema,
        foreignKey.referencedRelation.name,
      );
      if (!visibleIds.has(target)) continue;
      const id = `foreignKey:${source}:${target}:${foreignKey.id}`;
      if (edgeIds.has(id)) continue;
      edgeIds.add(id);
      edges.push({
        id,
        kind: "foreignKey",
        source,
        target,
        label: foreignKey.name ?? foreignKey.id,
      });
    }
  }
  for (const dependency of metadata.dependencies) {
    if (dependency.kind !== "viewReference") continue;
    if (
      (dependency.dependent.kind !== "view" &&
        dependency.dependent.kind !== "table") ||
      (dependency.referenced.kind !== "view" &&
        dependency.referenced.kind !== "table") ||
      dependency.dependent.schema === null ||
      dependency.referenced.schema === null
    ) {
      continue;
    }
    const source = erdObjectId(
      dependency.dependent.kind,
      dependency.dependent.schema,
      dependency.dependent.name,
    );
    const target = erdObjectId(
      dependency.referenced.kind,
      dependency.referenced.schema,
      dependency.referenced.name,
    );
    if (!visibleIds.has(source) || !visibleIds.has(target)) continue;
    const id = `viewReference:${dependency.id}`;
    if (edgeIds.has(id)) continue;
    edgeIds.add(id);
    edges.push({
      id,
      kind: "viewReference",
      source,
      target,
      label: dependency.id,
    });
  }
  const rows = Math.max(1, Math.ceil(nodes.length / gridColumns));
  return {
    nodes,
    edges,
    width: gridColumns * nodeWidth + (gridColumns - 1) * columnGap + 48,
    height: rows * rowHeight + (rows - 1) * rowGap + 48,
  };
}
