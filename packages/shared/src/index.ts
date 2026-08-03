export type DriverKind = "postgres" | "mysql" | "sqlite";

export type DriverCapability =
  | "transactions"
  | "explain"
  | "cancel"
  | "streaming"
  | "editing";

export interface QueryColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface QueryResult {
  columns: QueryColumn[];
  rows: Array<Record<string, unknown>>;
  executionTime: number;
  affectedRows: number;
  warnings: string[];
  error?: { code: string; message: string };
}

export interface ColumnMetadata {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey?: boolean;
}

export interface IndexMetadata {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  type: string;
  definition?: string;
}

export interface RelationRef {
  schema: string;
  name: string;
}

export interface ForeignKeyColumnPair {
  ordinal: number;
  sourceColumn: string;
  referencedColumn: string | null;
}

export interface ForeignKeyMetadata {
  id: string;
  name: string | null;
  columns: ForeignKeyColumnPair[];
  referencedRelation: RelationRef;
  onUpdate: string;
  onDelete: string;
  match: string | null;
  deferrable: boolean | null;
  initiallyDeferred: boolean | null;
}

export interface TableMetadata {
  schema: string;
  name: string;
  rowCount: number;
  columns: ColumnMetadata[];
  indexes: IndexMetadata[];
  foreignKeys: ForeignKeyMetadata[];
}

export interface ViewMetadata {
  schema: string;
  name: string;
  columns: ColumnMetadata[];
  definition?: string;
}

export type RoutineKind = "function" | "procedure";

export interface RoutineMetadata {
  id: string;
  schema: string;
  name: string;
  kind: RoutineKind;
  identityArguments: string;
  returnType: string | null;
  language: string;
  definition: string | null;
}

export interface DatabaseMetadata {
  databases: string[];
  schemas: string[];
  tables: TableMetadata[];
  views: ViewMetadata[];
  routines: RoutineMetadata[];
}

export interface DriverConfig {
  kind: DriverKind;
  name: string;
  database: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  sslMode?: "disable" | "prefer" | "require";
}

export interface DatabaseDriver {
  readonly kind: DriverKind;
  connect(config: DriverConfig): Promise<void>;
  execute(sql: string, signal?: AbortSignal): Promise<QueryResult>;
  metadata(): Promise<DatabaseMetadata>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  disconnect(): Promise<void>;
  capabilities(): ReadonlySet<DriverCapability>;
}
