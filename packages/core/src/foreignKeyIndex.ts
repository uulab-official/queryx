import type {
  ForeignKeyMetadata,
  RelationRef,
  TableMetadata,
} from "@queryx/shared";

export interface IncomingForeignKey {
  sourceRelation: RelationRef;
  foreignKey: ForeignKeyMetadata;
}

export interface ForeignKeyRelations {
  outgoing: ForeignKeyMetadata[];
  incoming: IncomingForeignKey[];
  completeness: "complete" | "partial";
}

export interface ForeignKeyIndex {
  get(relation: RelationRef): ForeignKeyRelations;
}

function relationKey(relation: RelationRef): string {
  return JSON.stringify([relation.schema, relation.name]);
}

export function buildForeignKeyIndex(tables: TableMetadata[]): ForeignKeyIndex {
  const relations = new Map<string, ForeignKeyRelations>();

  for (const table of tables) {
    relations.set(relationKey(table), {
      outgoing: table.foreignKeys,
      incoming: [],
      completeness: "complete",
    });
  }

  for (const table of tables) {
    const sourceRelation = { schema: table.schema, name: table.name };
    for (const foreignKey of table.foreignKeys) {
      const target = relations.get(relationKey(foreignKey.referencedRelation));
      if (target) {
        target.incoming.push({ sourceRelation, foreignKey });
      }
    }
  }

  return {
    get(relation) {
      return (
        relations.get(relationKey(relation)) ?? {
          outgoing: [],
          incoming: [],
          completeness: "partial",
        }
      );
    },
  };
}
