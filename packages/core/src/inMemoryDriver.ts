import type {
  DatabaseDriver,
  DatabaseMetadata,
  DriverCapability,
  DriverConfig,
  QueryResult,
} from '@queryx/shared';
import { inspectQuerySafety } from './querySafety';

const revenueRows = [
  { day: '2024-03-30', orders: 1284, revenue: '$186,942.00' },
  { day: '2024-03-29', orders: 1192, revenue: '$172,580.40' },
  { day: '2024-03-28', orders: 1348, revenue: '$201,320.00' },
  { day: '2024-03-27', orders: 1109, revenue: '$164,050.20' },
  { day: '2024-03-26', orders: 1241, revenue: '$182,735.00' },
  { day: '2024-03-25', orders: 1008, revenue: '$149,220.80' },
  { day: '2024-03-24', orders: 982, revenue: '$138,611.50' },
  { day: '2024-03-23', orders: 1064, revenue: '$158,940.00' },
  { day: '2024-03-22', orders: 1312, revenue: '$193,281.25' },
  { day: '2024-03-21', orders: 1179, revenue: '$176,450.00' },
];

const metadata: DatabaseMetadata = {
  databases: ['production'],
  schemas: ['public'],
  tables: [
    {
      schema: 'public',
      name: 'orders',
      rowCount: 1_248_521,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
        { name: 'customer_id', type: 'uuid', nullable: false },
        { name: 'status', type: 'varchar(24)', nullable: false },
        { name: 'total_amount', type: 'numeric(12,2)', nullable: false },
        { name: 'created_at', type: 'timestamptz', nullable: false },
        { name: 'updated_at', type: 'timestamptz', nullable: false },
      ],
    },
    {
      schema: 'public',
      name: 'customers',
      rowCount: 28_412,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
        { name: 'email', type: 'varchar(255)', nullable: false },
        { name: 'name', type: 'varchar(120)', nullable: false },
        { name: 'plan', type: 'varchar(32)', nullable: false },
      ],
    },
    {
      schema: 'public',
      name: 'products',
      rowCount: 238,
      columns: [
        { name: 'id', type: 'uuid', nullable: false, primaryKey: true },
        { name: 'sku', type: 'varchar(48)', nullable: false },
        { name: 'name', type: 'varchar(180)', nullable: false },
        { name: 'price', type: 'numeric(10,2)', nullable: false },
      ],
    },
  ],
};

export class InMemoryDriver implements DatabaseDriver {
  readonly kind = 'postgres' as const;
  capabilities(): ReadonlySet<DriverCapability> {
    return new Set(['transactions', 'explain', 'cancel']);
  }
  private connected = false;

  async connect(_config: DriverConfig): Promise<void> {
    this.connected = true;
  }

  async execute(sql: string, signal?: AbortSignal): Promise<QueryResult> {
    if (!this.connected) {
      throw new Error('Driver is not connected');
    }
    if (signal?.aborted) {
      throw new DOMException('Query cancelled', 'AbortError');
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    const safety = inspectQuerySafety(sql);
    return {
      columns: [
        { name: 'day', type: 'date', nullable: false },
        { name: 'orders', type: 'integer', nullable: false },
        { name: 'revenue', type: 'numeric', nullable: false },
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
