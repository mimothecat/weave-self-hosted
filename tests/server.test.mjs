import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { createWorkspaceStore } from "../server/workspace-store.mjs";

const testDirectory = resolve("data/test");
const databasePath = resolve(testDirectory, "workspace.test.db");

test("workspace is persisted and guarded by a revision", async (context) => {
  await rm(testDirectory, { recursive: true, force: true });
  await mkdir(testDirectory, { recursive: true });

  const store = createWorkspaceStore(databasePath);
  context.after(async () => {
    store.close();
    await rm(testDirectory, { recursive: true, force: true });
  });

  assert.deepEqual(store.read(), {
    workspace: null,
    revision: 0,
    updatedAt: null,
  });

  const workspace = {
    version: 1,
    boards: [{ id: "board", title: "测试", createdAt: 1 }],
    cards: [],
    places: [],
    links: [],
    activeBoardId: "board",
    updatedAt: 1,
  };

  const created = store.write(workspace, 0);
  assert.equal(created.ok, true);
  assert.equal(created.value.revision, 1);
  assert.deepEqual(store.read().workspace, workspace);

  const conflict = store.write(workspace, 0);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, "conflict");
  assert.equal(conflict.current.revision, 1);
});
