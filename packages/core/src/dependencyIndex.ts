import type { DatabaseObjectRef, DependencyMetadata } from "@queryx/shared";

export interface ObjectDependencies {
  dependsOn: DependencyMetadata[];
  usedBy: DependencyMetadata[];
}

export interface DependencyIndex {
  get(object: DatabaseObjectRef): ObjectDependencies;
}

export function databaseObjectRefKey(object: DatabaseObjectRef): string {
  if (
    (object.kind === "routine" ||
      object.kind === "trigger" ||
      object.kind === "eventTrigger") &&
    object.id
  ) {
    return JSON.stringify([object.kind, object.id]);
  }
  return JSON.stringify([object.kind, object.schema, object.name]);
}

export function buildDependencyIndex(
  dependencies: DependencyMetadata[],
): DependencyIndex {
  const byObject = new Map<string, ObjectDependencies>();
  const ensure = (object: DatabaseObjectRef) => {
    const key = databaseObjectRefKey(object);
    const existing = byObject.get(key);
    if (existing) return existing;
    const created = { dependsOn: [], usedBy: [] };
    byObject.set(key, created);
    return created;
  };

  for (const dependency of dependencies) {
    ensure(dependency.dependent).dependsOn.push(dependency);
    ensure(dependency.referenced).usedBy.push(dependency);
  }

  return {
    get(object) {
      return (
        byObject.get(databaseObjectRefKey(object)) ?? {
          dependsOn: [],
          usedBy: [],
        }
      );
    },
  };
}
