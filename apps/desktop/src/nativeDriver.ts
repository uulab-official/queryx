import { invoke, isTauri } from "@tauri-apps/api/core";
import { InMemoryDriver } from "@queryx/core";
import type {
  DatabaseDriver,
  DatabaseMetadata,
  DriverCapability,
  DriverConfig,
  DriverKind,
  QueryResult,
} from "@queryx/shared";

interface ConnectionSummary {
  id: string;
  name: string;
  driver: DriverKind;
  database: string;
  capabilities: DriverCapability[];
}

export class TauriDatabaseDriver implements DatabaseDriver {
  readonly kind: DriverKind;
  private connectionId: string | null = null;
  private transactionMode = false;

  constructor(kind: DriverKind) {
    this.kind = kind;
  }

  async connect(config: DriverConfig): Promise<void> {
    const connection = await invoke<ConnectionSummary>("connect_database", {
      config: {
        kind: this.kind,
        name: config.name,
        database: config.database,
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        sslMode: config.sslMode,
      },
    });
    this.connectionId = connection.id;
  }

  async execute(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    if (signal?.aborted)
      throw new DOMException("Query cancelled", "AbortError");
    const connectionId = this.requireConnection();
    const command = this.transactionMode
      ? "execute_query_transaction"
      : "execute_query";
    return invoke<QueryResult>(command, { connectionId, sql });
  }

  async metadata(): Promise<DatabaseMetadata> {
    return invoke<DatabaseMetadata>("database_metadata", {
      connectionId: this.requireConnection(),
    });
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.transactionMode = true;
    try {
      return await work();
    } finally {
      this.transactionMode = false;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connectionId) return;
    await invoke("disconnect_database", { connectionId: this.connectionId });
    this.connectionId = null;
  }

  capabilities(): ReadonlySet<DriverCapability> {
    return new Set(["transactions", "explain"]);
  }

  private requireConnection(): string {
    if (!this.connectionId)
      throw new Error(`${this.kind} driver is not connected`);
    return this.connectionId;
  }
}

export function createRuntimeDriver(
  kind: DriverKind = "sqlite",
): DatabaseDriver {
  if (!isTauri()) return new InMemoryDriver();
  return new TauriDatabaseDriver(kind);
}
