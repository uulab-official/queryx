import type {
  DatabaseDriver,
  DatabaseMetadata,
  DriverCapability,
  DriverConfig,
  QueryResult,
} from "@queryx/shared";
import { inspectQuerySafety } from "./querySafety";

const revenueRows = [
  { day: "2024-03-30", orders: 1284, revenue: "$186,942.00" },
  { day: "2024-03-29", orders: 1192, revenue: "$172,580.40" },
  { day: "2024-03-28", orders: 1348, revenue: "$201,320.00" },
  { day: "2024-03-27", orders: 1109, revenue: "$164,050.20" },
  { day: "2024-03-26", orders: 1241, revenue: "$182,735.00" },
  { day: "2024-03-25", orders: 1008, revenue: "$149,220.80" },
  { day: "2024-03-24", orders: 982, revenue: "$138,611.50" },
  { day: "2024-03-23", orders: 1064, revenue: "$158,940.00" },
  { day: "2024-03-22", orders: 1312, revenue: "$193,281.25" },
  { day: "2024-03-21", orders: 1179, revenue: "$176,450.00" },
];

const metadata: DatabaseMetadata = {
  databases: ["production"],
  schemas: ["public"],
  tables: [
    {
      schema: "public",
      name: "orders",
      rowCount: 1_248_521,
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "customer_id", type: "uuid", nullable: false },
        { name: "status", type: "varchar(24)", nullable: false },
        { name: "total_amount", type: "numeric(12,2)", nullable: false },
        { name: "created_at", type: "timestamptz", nullable: false },
        { name: "updated_at", type: "timestamptz", nullable: false },
      ],
      indexes: [
        {
          name: "orders_pkey",
          columns: ["id"],
          unique: true,
          primary: true,
          type: "btree",
        },
        {
          name: "idx_orders_status_created_at",
          columns: ["status", "created_at"],
          unique: false,
          primary: false,
          type: "btree",
        },
      ],
      foreignKeys: [
        {
          id: "demo:public:orders:customers",
          name: "orders_customer_id_fkey",
          columns: [
            {
              ordinal: 1,
              sourceColumn: "customer_id",
              referencedColumn: "id",
            },
          ],
          referencedRelation: { schema: "public", name: "customers" },
          onUpdate: "NO ACTION",
          onDelete: "RESTRICT",
          match: "SIMPLE",
          deferrable: false,
          initiallyDeferred: false,
        },
      ],
    },
    {
      schema: "public",
      name: "customers",
      rowCount: 28_412,
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "email", type: "varchar(255)", nullable: false },
        { name: "name", type: "varchar(120)", nullable: false },
        { name: "plan", type: "varchar(32)", nullable: false },
      ],
      indexes: [],
      foreignKeys: [],
    },
    {
      schema: "public",
      name: "products",
      rowCount: 238,
      columns: [
        { name: "id", type: "uuid", nullable: false, primaryKey: true },
        { name: "sku", type: "varchar(48)", nullable: false },
        { name: "name", type: "varchar(180)", nullable: false },
        { name: "price", type: "numeric(10,2)", nullable: false },
      ],
      indexes: [],
      foreignKeys: [],
    },
  ],
  views: [
    {
      schema: "public",
      name: "paid_orders",
      columns: [
        { name: "id", type: "uuid", nullable: true },
        { name: "customer_id", type: "uuid", nullable: true },
        { name: "total_amount", type: "numeric(12,2)", nullable: true },
      ],
      definition:
        "SELECT id, customer_id, total_amount FROM orders WHERE status = 'paid'",
    },
  ],
  routines: [
    {
      id: "demo:public:daily_revenue:date",
      schema: "public",
      name: "daily_revenue",
      kind: "function",
      identityArguments: "start_date date",
      returnType: "TABLE(day date, orders bigint, revenue numeric)",
      language: "sql",
      definition: `CREATE OR REPLACE FUNCTION public.daily_revenue(start_date date)
RETURNS TABLE(day date, orders bigint, revenue numeric)
LANGUAGE sql
STABLE
AS $function$
  SELECT created_at::date, COUNT(*), SUM(total_amount)
  FROM public.orders
  WHERE created_at >= start_date AND status = 'paid'
  GROUP BY created_at::date
  ORDER BY created_at::date DESC;
$function$`,
    },
    {
      id: "demo:public:audit_order",
      schema: "public",
      name: "audit_order",
      kind: "function",
      identityArguments: "",
      returnType: "trigger",
      language: "plpgsql",
      definition:
        "CREATE OR REPLACE FUNCTION public.audit_order() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$",
    },
    {
      id: "demo:public:enforce_schema_policy",
      schema: "public",
      name: "enforce_schema_policy",
      kind: "function",
      identityArguments: "",
      returnType: "event_trigger",
      language: "plpgsql",
      definition:
        "CREATE OR REPLACE FUNCTION public.enforce_schema_policy() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN NULL; END $$",
    },
    {
      id: "demo:public:total_numeric",
      schema: "public",
      name: "total_numeric",
      kind: "aggregate",
      identityArguments: "numeric",
      returnType: "numeric",
      language: "internal",
      aggregate: { kind: "normal", directArgumentCount: 0 },
      definition: null,
    },
    {
      id: "demo:public:rank",
      schema: "public",
      name: "rank",
      kind: "window",
      identityArguments: "",
      returnType: "bigint",
      language: "internal",
      definition: null,
    },
  ],
  triggers: [
    {
      id: "demo:trigger:orders_audit",
      schema: "public",
      name: "orders_audit",
      relation: { schema: "public", name: "orders", kind: "table" },
      timing: "after",
      events: ["insert", "update"],
      updateColumns: null,
      orientation: "row",
      status: "origin",
      condition: "NEW.status = 'paid'",
      definition:
        "CREATE TRIGGER orders_audit AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW WHEN (NEW.status = 'paid') EXECUTE FUNCTION public.audit_order()",
    },
  ],
  eventTriggers: [
    {
      id: "demo:event-trigger:schema_guard",
      name: "schema_guard",
      event: "ddlCommandEnd",
      status: "origin",
      tags: ["ALTER TABLE", "DROP TABLE"],
      function: {
        kind: "routine",
        id: "demo:public:enforce_schema_policy",
        schema: "public",
        name: "enforce_schema_policy",
        identityArguments: "",
      },
      definition:
        "CREATE EVENT TRIGGER schema_guard ON ddl_command_end WHEN TAG IN ('ALTER TABLE', 'DROP TABLE') EXECUTE FUNCTION public.enforce_schema_policy();",
    },
  ],
  dependencies: [
    {
      id: "demo:dependency:orders-customers",
      kind: "foreignKey",
      dependent: {
        kind: "table",
        id: null,
        schema: "public",
        name: "orders",
        identityArguments: null,
      },
      referenced: {
        kind: "table",
        id: null,
        schema: "public",
        name: "customers",
        identityArguments: null,
      },
    },
    {
      id: "demo:dependency:paid-orders-orders",
      kind: "viewReference",
      dependent: {
        kind: "view",
        id: null,
        schema: "public",
        name: "paid_orders",
        identityArguments: null,
      },
      referenced: {
        kind: "table",
        id: null,
        schema: "public",
        name: "orders",
        identityArguments: null,
      },
    },
    {
      id: "demo:dependency:orders-audit-owner",
      kind: "triggerOwner",
      dependent: {
        kind: "trigger",
        id: "demo:trigger:orders_audit",
        schema: "public",
        name: "orders_audit",
        identityArguments: null,
      },
      referenced: {
        kind: "table",
        id: null,
        schema: "public",
        name: "orders",
        identityArguments: null,
      },
    },
    {
      id: "demo:dependency:orders-audit-function",
      kind: "triggerFunction",
      dependent: {
        kind: "trigger",
        id: "demo:trigger:orders_audit",
        schema: "public",
        name: "orders_audit",
        identityArguments: null,
      },
      referenced: {
        kind: "routine",
        id: "demo:public:audit_order",
        schema: "public",
        name: "audit_order",
        identityArguments: "",
      },
    },
    {
      id: "demo:dependency:schema-guard-function",
      kind: "eventTriggerFunction",
      dependent: {
        kind: "eventTrigger",
        id: "demo:event-trigger:schema_guard",
        schema: null,
        name: "schema_guard",
        identityArguments: null,
      },
      referenced: {
        kind: "routine",
        id: "demo:public:enforce_schema_policy",
        schema: "public",
        name: "enforce_schema_policy",
        identityArguments: "",
      },
    },
  ],
};

export class InMemoryDriver implements DatabaseDriver {
  readonly kind = "postgres" as const;
  capabilities(): ReadonlySet<DriverCapability> {
    return new Set(["transactions", "explain", "cancel", "editing"]);
  }
  private connected = false;

  async connect(_config: DriverConfig): Promise<void> {
    this.connected = true;
  }

  async execute(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    if (!this.connected) {
      throw new Error("Driver is not connected");
    }
    if (signal?.aborted) {
      throw new DOMException("Query cancelled", "AbortError");
    }
    const delay = /\bpg_sleep\s*\(/i.test(sql) ? 30_000 : 120;
    await new Promise<void>((resolve, reject) => {
      const complete = () => {
        signal?.removeEventListener("abort", cancel);
        resolve();
      };
      const timeout = setTimeout(complete, delay);
      const cancel = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancel);
        reject(new DOMException("Query cancelled", "AbortError"));
      };
      signal?.addEventListener("abort", cancel, { once: true });
    });
    if (/^\s*EXPLAIN\b/i.test(sql)) {
      return {
        columns: [{ name: "QUERY PLAN", type: "text", nullable: false }],
        rows: [
          { "QUERY PLAN": "Seq Scan on orders  (cost=0.00..24.80 rows=10)" },
          { "QUERY PLAN": "  Filter: (status = 'paid')" },
        ],
        executionTime: 12,
        affectedRows: 0,
        warnings: ["Estimated plan only; the statement was not executed"],
      };
    }
    const safety = inspectQuerySafety(sql);
    return {
      columns: [
        { name: "day", type: "date", nullable: false },
        { name: "orders", type: "integer", nullable: false },
        { name: "revenue", type: "numeric", nullable: false },
      ],
      rows: revenueRows,
      executionTime: 182,
      affectedRows: safety.isDangerous ? 1_248_521 : 0,
      warnings: safety.isDangerous ? [safety.reason] : [],
    };
  }

  async metadata(): Promise<DatabaseMetadata> {
    return metadata;
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
