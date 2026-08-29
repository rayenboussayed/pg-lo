import { Client } from "pg";

/**
 * Get a configured pg Client for e2e tests.
 * Uses DATABASE_URL env or defaults to postgres://postgres:postgres@localhost:5432/db
 * (matches Makefile docker-run-postgres).
 */
export function createTestClient(): Client {
  const connectionString =
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/db";
  return new Client({ connectionString });
}

/**
 * Check if PG is reachable. Returns true if connected successfully.
 */
export async function canConnect(client: Client): Promise<boolean> {
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {}
  }
}
