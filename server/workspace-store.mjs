import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(
  resolve(serverDirectory, "migrations/001_workspace.sql"),
  "utf8",
);

export function isWorkspace(value) {
  return (
    value &&
    typeof value === "object" &&
    value.version === 1 &&
    Array.isArray(value.boards) &&
    Array.isArray(value.cards) &&
    Array.isArray(value.places) &&
    Array.isArray(value.links) &&
    typeof value.activeBoardId === "string"
  );
}

export function createWorkspaceStore(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec(migrationSql);

  const readStatement = database.prepare(
    "SELECT payload, revision, updated_at FROM workspace_state WHERE id = 1",
  );
  const insertStatement = database.prepare(`
    INSERT INTO workspace_state (id, payload, revision, updated_at)
    VALUES (1, @payload, 1, @updatedAt)
  `);
  const updateStatement = database.prepare(`
    UPDATE workspace_state
    SET payload = @payload, revision = @revision, updated_at = @updatedAt
    WHERE id = 1
  `);

  const read = () => {
    const row = readStatement.get();
    if (!row) {
      return { workspace: null, revision: 0, updatedAt: null };
    }

    return {
      workspace: JSON.parse(row.payload),
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  };

  const write = (workspace, baseRevision) => {
    if (!isWorkspace(workspace)) {
      return { ok: false, reason: "invalid" };
    }

    database.exec("BEGIN IMMEDIATE");
    try {
      const current = readStatement.get();
      const currentRevision = current?.revision ?? 0;
      if (baseRevision !== currentRevision) {
        database.exec("ROLLBACK");
        return {
          ok: false,
          reason: "conflict",
          current: read(),
        };
      }

      const updatedAt = new Date().toISOString();
      const payload = JSON.stringify(workspace);
      if (!current) {
        insertStatement.run({ payload, updatedAt });
      } else {
        updateStatement.run({
          payload,
          revision: currentRevision + 1,
          updatedAt,
        });
      }
      database.exec("COMMIT");
      return { ok: true, value: read() };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    read,
    write,
    close: () => database.close(),
  };
}
