import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { InMemoryDriver } from "@queryx/core";
import type {
  DatabaseLock,
  DatabaseDriver,
  DatabaseMetadata,
  DatabaseSession,
  DriverCapability,
  DriverConfig,
  DriverKind,
  QueryChunk,
  QueryResult,
} from "@queryx/shared";

interface ConnectionSummary {
  id: string;
  name: string;
  driver: DriverKind;
  database: string;
  readOnly: boolean;
  capabilities: DriverCapability[];
}

export class TauriDatabaseDriver implements DatabaseDriver {
  readonly kind: DriverKind;
  private connectionId: string | null = null;
  private transactionMode = false;
  private readOnly = false;
  private driverCapabilities = new Set<DriverCapability>();

  constructor(kind: DriverKind) {
    this.kind = kind;
  }

  async connect(config: DriverConfig): Promise<void> {
    const connection = await invoke<ConnectionSummary>("connect_database", {
      config: {
        kind: this.kind,
        name: config.name,
        database: config.database,
        readOnly: config.readOnly === true,
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        sslMode: config.sslMode,
        sslRootCert: config.sslRootCert,
        sslClientCert: config.sslClientCert,
        sslClientKey: config.sslClientKey,
        sshTunnel: config.sshTunnel,
      },
    });
    this.connectionId = connection.id;
    this.readOnly = connection.readOnly;
    this.driverCapabilities = new Set(connection.capabilities);
  }

  async execute(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    if (signal?.aborted)
      throw new DOMException("Query cancelled", "AbortError");
    const connectionId = this.requireConnection();
    const queryId = crypto.randomUUID();
    const canCancel = this.driverCapabilities.has("cancel");
    const command = this.transactionMode
      ? "execute_query_transaction"
      : "execute_query";
    if (canCancel) {
      await invoke("prepare_query", { connectionId, queryId });
      if (signal?.aborted) {
        const cancelled = await invoke<boolean>("cancel_query", {
          connectionId,
          queryId,
        });
        if (cancelled) throw new DOMException("Query cancelled", "AbortError");
        throw new Error("Database did not confirm query cancellation");
      }
    }

    let cancellation: Promise<boolean> | null = null;
    const cancel = () => {
      cancellation ??= invoke<boolean>("cancel_query", {
        connectionId,
        queryId,
      });
    };
    if (canCancel) signal?.addEventListener("abort", cancel, { once: true });

    try {
      const result = await invoke<QueryResult>(command, {
        connectionId,
        queryId,
        sql,
      });
      if (canCancel && signal?.aborted) {
        const cancelled = await cancellation;
        if (cancelled) throw new DOMException("Query cancelled", "AbortError");
      }
      return result;
    } catch (error) {
      if (canCancel && signal?.aborted) {
        let cancelled: boolean;
        try {
          cancelled = (await cancellation) ?? false;
        } catch (cancellationError) {
          const message =
            cancellationError instanceof Error
              ? cancellationError.message
              : String(cancellationError);
          throw new Error(`Query cancellation failed: ${message}`);
        }
        if (cancelled) throw new DOMException("Query cancelled", "AbortError");
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  async executeStream(
    sql: string,
    onChunk: (chunk: QueryChunk) => void,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    if (!this.driverCapabilities.has("streaming")) {
      const result = await this.execute(sql, signal);
      onChunk({
        rowOffset: 0,
        columns: result.columns,
        rows: result.rows,
        warnings: result.warnings,
      });
      return { ...result, rows: [] };
    }

    if (signal?.aborted) {
      throw new DOMException("Query cancelled", "AbortError");
    }
    const connectionId = this.requireConnection();
    const queryId = crypto.randomUUID();
    const eventName = `queryx:query-chunk:${queryId}`;
    const stopListening = await listen<{
      queryId: string;
      rowOffset: number;
      columns: QueryChunk["columns"];
      rows: QueryChunk["rows"];
      warnings: string[];
    }>(eventName, (event) => {
      onChunk({
        rowOffset: event.payload.rowOffset,
        columns: event.payload.columns,
        rows: event.payload.rows,
        warnings: event.payload.warnings,
      });
    });
    const canCancel = this.driverCapabilities.has("cancel");
    let cancellation: Promise<boolean> | null = null;
    const cancel = () => {
      cancellation ??= invoke<boolean>("cancel_query", {
        connectionId,
        queryId,
      });
    };
    try {
      if (canCancel) {
        await invoke("prepare_query", { connectionId, queryId });
      }
      signal?.addEventListener("abort", cancel, { once: true });
      const result = await invoke<QueryResult>("execute_query_stream", {
        connectionId,
        queryId,
        sql,
      });
      if (canCancel && signal?.aborted) {
        const cancelled = await cancellation;
        if (cancelled) throw new DOMException("Query cancelled", "AbortError");
      }
      return result;
    } catch (error) {
      if (canCancel && signal?.aborted) {
        const cancelled = (await cancellation) ?? false;
        if (cancelled) throw new DOMException("Query cancelled", "AbortError");
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
      await stopListening();
    }
  }

  async executeBatch(
    statements: readonly string[],
    expectedRows: number,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    if (signal?.aborted)
      throw new DOMException("Query cancelled", "AbortError");
    const result = await invoke<QueryResult>("execute_edit_batch", {
      connectionId: this.requireConnection(),
      queryId: crypto.randomUUID(),
      statements,
      expectedRows,
    });
    if (signal?.aborted)
      throw new DOMException("Query cancelled", "AbortError");
    return result;
  }

  async beginTransaction(): Promise<void> {
    await invoke("begin_transaction", {
      connectionId: this.requireConnection(),
    });
  }

  async commitTransaction(): Promise<void> {
    await invoke("commit_transaction", {
      connectionId: this.requireConnection(),
    });
  }

  async rollbackTransaction(): Promise<void> {
    await invoke("rollback_transaction", {
      connectionId: this.requireConnection(),
    });
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
    this.driverCapabilities.clear();
    this.readOnly = false;
  }

  async sessions(): Promise<DatabaseSession[]> {
    if (!this.connectionId)
      throw new Error(`${this.kind} driver is not connected`);
    return invoke<DatabaseSession[]>("database_sessions", {
      connectionId: this.connectionId,
    });
  }

  async cancelSession(sessionId: string): Promise<void> {
    if (!this.connectionId)
      throw new Error(`${this.kind} driver is not connected`);
    await invoke("cancel_database_session", {
      connectionId: this.connectionId,
      sessionId,
    });
  }

  async locks(): Promise<DatabaseLock[]> {
    if (!this.connectionId)
      throw new Error(`${this.kind} driver is not connected`);
    return invoke<DatabaseLock[]>("database_locks", {
      connectionId: this.connectionId,
    });
  }

  capabilities(): ReadonlySet<DriverCapability> {
    return new Set(this.driverCapabilities);
  }

  isReadOnly(): boolean {
    return this.readOnly;
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
