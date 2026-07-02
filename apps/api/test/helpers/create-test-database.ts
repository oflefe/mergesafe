import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newDb } from "pg-mem";
import {
  createDatabaseClientFromPool,
  DatabaseClient,
} from "../../src/storage/database.pool";

export function createTestDatabaseClient(): DatabaseClient {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const migration = readFileSync(
    join(process.cwd(), "db/migrations/001_initial.sql"),
    "utf-8",
  );
  db.public.none(migration);
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return createDatabaseClientFromPool(pool);
}
