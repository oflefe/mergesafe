import { Pool, type QueryResult, type QueryResultRow } from 'pg';

export const DATABASE_POOL = Symbol('DATABASE_POOL');

export interface DatabasePool {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export function createDatabasePool(): DatabasePool {
  const connectionString = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/mergesafe';
  return new Pool({ connectionString });
}
