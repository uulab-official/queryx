export type DriverKind = 'postgres' | 'mysql' | 'sqlite';

export type DriverCapability =
  | 'transactions'
  | 'explain'
  | 'cancel'
  | 'streaming'
  | 'editing';

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

export interface TableMetadata {
  schema: string;
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; nullable: boolean; primaryKey?: boolean }>;
}

export interface DatabaseMetadata {
  databases: string[];
  schemas: string[];
  tables: TableMetadata[];
}

export interface DriverConfig {
  kind: DriverKind;
  name: string;
  database?: string;
  host?: string;
  port?: number;
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
