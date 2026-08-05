export type DriverKind = "postgres" | "mysql" | "sqlite";

export type DriverCapability =
  | "transactions"
  | "explain"
  | "cancel"
  | "streaming"
  | "editing"
  | "sessions"
  | "locks";

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

export type DatabaseSessionState =
  | "active"
  | "idle"
  | "idleInTransaction"
  | "waiting"
  | "unknown";

export interface DatabaseSession {
  id: string;
  user: string | null;
  database: string | null;
  clientAddress: string | null;
  applicationName: string | null;
  state: DatabaseSessionState;
  query: string | null;
  startedAt: string | null;
  durationMs: number | null;
  waitEvent: string | null;
  canCancel: boolean;
}

export interface SessionAuditEntry {
  id: string;
  driver: DriverKind;
  connectionName: string;
  sessionId: string;
  database: string | null;
  observedAt: string;
  state: DatabaseSessionState;
  durationMs: number | null;
  waitEvent: string | null;
  queryPreview: string | null;
  queryFingerprint: string | null;
}

export interface DatabaseLock {
  id: string;
  blockedSessionId: string;
  blockingSessionId: string;
  resource: string;
  lockType: string;
  blockedMode: string | null;
  blockingMode: string | null;
  blockedDurationMs: number | null;
  blockedQuery: string | null;
  blockingQuery: string | null;
  blockingCanCancel: boolean;
}

export interface QueryChunk {
  rowOffset: number;
  columns: QueryColumn[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
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

export type RoutineKind = "function" | "procedure" | "aggregate" | "window";

export type AggregateKind =
  | "normal"
  | "orderedSet"
  | "hypotheticalSet"
  | "unknown";

export interface AggregateMetadata {
  kind: AggregateKind;
  directArgumentCount: number;
}

export interface RoutineMetadata {
  id: string;
  schema: string;
  name: string;
  kind: RoutineKind;
  identityArguments: string;
  returnType: string | null;
  language: string;
  definition: string | null;
  aggregate?: AggregateMetadata;
}

export type TriggerTiming = "before" | "after" | "insteadOf" | "unknown";
export type TriggerEvent =
  | "insert"
  | "update"
  | "delete"
  | "truncate"
  | "unknown";
export type TriggerOrientation = "row" | "statement";
export type TriggerStatus =
  | "enabled"
  | "origin"
  | "replica"
  | "always"
  | "disabled";

export interface TriggerMetadata {
  id: string;
  schema: string;
  name: string;
  relation: RelationRef & { kind: "table" | "view" };
  timing: TriggerTiming;
  events: TriggerEvent[];
  updateColumns: string[] | null;
  orientation: TriggerOrientation;
  status: TriggerStatus;
  condition: string | null;
  definition: string | null;
}

export type DatabaseObjectKind =
  | "table"
  | "view"
  | "routine"
  | "trigger"
  | "eventTrigger";

export interface DatabaseObjectRef {
  kind: DatabaseObjectKind;
  id: string | null;
  schema: string | null;
  name: string;
  identityArguments: string | null;
}

export type DependencyKind =
  | "foreignKey"
  | "viewReference"
  | "triggerFunction"
  | "triggerOwner"
  | "eventTriggerFunction";

export interface DependencyMetadata {
  id: string;
  kind: DependencyKind;
  dependent: DatabaseObjectRef;
  referenced: DatabaseObjectRef;
}

export type EventTriggerEvent =
  | "ddlCommandStart"
  | "ddlCommandEnd"
  | "sqlDrop"
  | "tableRewrite"
  | "unknown";

export interface EventTriggerMetadata {
  id: string;
  name: string;
  event: EventTriggerEvent;
  status: TriggerStatus;
  tags: string[] | null;
  function: DatabaseObjectRef & {
    kind: "routine";
    id: string;
    schema: string;
  };
  definition: string | null;
}

export interface DatabaseMetadata {
  databases: string[];
  schemas: string[];
  tables: TableMetadata[];
  views: ViewMetadata[];
  routines: RoutineMetadata[];
  triggers: TriggerMetadata[];
  eventTriggers: EventTriggerMetadata[];
  dependencies: DependencyMetadata[];
}

export interface SshTunnelConfig {
  sshHost: string;
  sshPort?: number;
  sshUsername: string;
  localPort?: number;
  privateKeyPath?: string;
  knownHostsPath?: string;
}

export interface DriverConfig {
  kind: DriverKind;
  name: string;
  database: string;
  readOnly?: boolean;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  sslMode?: "disable" | "prefer" | "require" | "verifyCa" | "verifyFull";
  sslRootCert?: string;
  sslClientCert?: string;
  sslClientKey?: string;
  sshTunnel?: SshTunnelConfig;
}

/**
 * A reusable connection profile. Secrets are intentionally not part of this
 * contract; `passwordStored` is only a presence marker for a native keychain entry.
 */
export interface ConnectionProfile {
  id: string;
  name: string;
  kind: DriverKind;
  database: string;
  readOnly: boolean;
  host?: string;
  port?: number;
  username?: string;
  sslMode?: "disable" | "prefer" | "require" | "verifyCa" | "verifyFull";
  sslRootCert?: string;
  sslClientCert?: string;
  sslClientKey?: string;
  sshTunnel?: SshTunnelConfig;
  /** Indicates an OS-keychain entry exists; the secret itself is never serialized. */
  passwordStored?: boolean;
}

export interface DatabaseDriver {
  readonly kind: DriverKind;
  connect(config: DriverConfig): Promise<void>;
  execute(sql: string, signal?: AbortSignal): Promise<QueryResult>;
  executeStream(
    sql: string,
    onChunk: (chunk: QueryChunk) => void,
    signal?: AbortSignal,
  ): Promise<QueryResult>;
  executeBatch(
    statements: readonly string[],
    expectedRows: number,
    signal?: AbortSignal,
  ): Promise<QueryResult>;
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
  metadata(): Promise<DatabaseMetadata>;
  sessions(): Promise<DatabaseSession[]>;
  cancelSession(sessionId: string): Promise<void>;
  locks(): Promise<DatabaseLock[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  disconnect(): Promise<void>;
  capabilities(): ReadonlySet<DriverCapability>;
  isReadOnly(): boolean;
}
