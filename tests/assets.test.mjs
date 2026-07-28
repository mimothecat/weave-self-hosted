import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const testDirectory = resolve("data/test-assets");
const port = 33219;
const baseUrl = `http://127.0.0.1:${port}`;

test("image assets are stored outside the workspace database and served back", async (context) => {
  await rm(testDirectory, { recursive: true, force: true });
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: resolve("."),
    env: {
      ...process.env,
      DATABASE_PATH: resolve(testDirectory, "weave.test.db"),
      HOST: "127.0.0.1",
      PORT: String(port),
      WEAVE_DATA_DIR: testDirectory,
    },
    stdio: "ignore",
  });

  context.after(async () => {
    child.kill();
    await rm(testDirectory, { recursive: true, force: true });
  });

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const health = await fetch(`${baseUrl}/api/health`);
      if (health.ok) break;
    } catch {
      if (attempt === 49) throw new Error("test server did not start");
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
  }

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const upload = await fetch(`${baseUrl}/api/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: png, name: "pixel.png", type: "image/png" }),
  });
  assert.equal(upload.status, 200);
  const asset = await upload.json();
  assert.match(asset.url, /^\/assets\/[0-9a-f-]+\.png$/);

  const downloaded = await fetch(`${baseUrl}${asset.url}`);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get("content-type"), "image/png");
  assert.ok((await downloaded.arrayBuffer()).byteLength > 0);
});
