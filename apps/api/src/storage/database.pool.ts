import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";

export const DATABASE_CLIENT = Symbol("DATABASE_CLIENT");

export interface DatabaseQueryClient {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface DatabaseTransactionClient extends DatabaseQueryClient {}

export interface DatabaseClient extends DatabaseQueryClient {
  transaction<T>(
    operation: (client: DatabaseTransactionClient) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

export interface DatabasePoolLike extends DatabaseQueryClient {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

class PgTransactionClient implements DatabaseTransactionClient {
  constructor(private readonly client: PoolClient) {}

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.client.query<T>(text, params);
  }
}

class PgDatabaseClient implements DatabaseClient {
  constructor(private readonly pool: DatabasePoolLike) {}

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async transaction<T>(
    operation: (client: DatabaseTransactionClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(new PgTransactionClient(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

export function createDatabaseClientFromPool(pool: DatabasePoolLike): DatabaseClient {
  return new PgDatabaseClient(pool);
}

export function createDatabaseClient(): DatabaseClient {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/mergesafe";
  return createDatabaseClientFromPool(new Pool({ connectionString }));
}
