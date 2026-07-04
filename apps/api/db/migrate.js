const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

function loadEnvironment() {
  const loadEnvFile = process.loadEnvFile;
  if (typeof loadEnvFile !== "function") {
    return;
  }

  const envFiles = [
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../../.env"),
  ];

  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      loadEnvFile(envFile);
    }
  }
}

function summarizeConnectionTarget(connectionString) {
  try {
    const url = new URL(connectionString);
    const protocol = url.protocol.replace(":", "");
    const host = url.hostname || "localhost";
    const port = url.port || "5432";
    const database = url.pathname.replace(/^\//, "") || "postgres";
    return `${protocol}://${host}:${port}/${database}`;
  } catch {
    return "invalid DATABASE_URL";
  }
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(pool, connectionString) {
  const maxAttempts = Number(process.env.DB_CONNECT_MAX_ATTEMPTS ?? 20);
  const retryDelayMs = Number(process.env.DB_CONNECT_RETRY_DELAY_MS ?? 1000);
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await pool.connect();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await wait(retryDelayMs);
      }
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  const target = summarizeConnectionTarget(connectionString);
  throw new Error(`Failed to connect to ${target}: ${message}`);
}

async function run() {
  loadEnvironment();

  const connectionString =
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/mergesafe";
  const pool = new Pool({ connectionString });
  const client = await connectWithRetry(pool, connectionString);

  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, "migrations");
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [filename],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf-8");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename],
      );
      console.log(`Applied migration ${filename}`);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
