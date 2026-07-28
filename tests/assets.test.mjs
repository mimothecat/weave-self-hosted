import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const testDirectory = resolve("data", `test-assets-${process.pid}-${Date.now()}`);
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
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
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

  const entry = await fetch(`${baseUrl}/`);
  assert.equal(entry.status, 200);
  assert.equal(entry.headers.get("cache-control"), "no-store");

  const staleScript = await fetch(`${baseUrl}/assets/index-stale.js`, {
    redirect: "manual",
  });
  assert.equal(staleScript.status, 302);
  assert.match(
    staleScript.headers.get("location"),
    /^\/static\/index-[^/]+\.js$/,
  );
  const currentScript = await fetch(
    `${baseUrl}${staleScript.headers.get("location")}`,
  );
  assert.equal(currentScript.status, 200);
  assert.match(currentScript.headers.get("content-type"), /javascript/);

  const staleStylesheet = await fetch(`${baseUrl}/assets/index-stale.css`, {
    redirect: "manual",
  });
  assert.equal(staleStylesheet.status, 302);
  assert.match(
    staleStylesheet.headers.get("location"),
    /^\/static\/index-[^/]+\.css$/,
  );
  const currentStylesheet = await fetch(
    `${baseUrl}${staleStylesheet.headers.get("location")}`,
  );
  assert.equal(currentStylesheet.status, 200);
  assert.match(currentStylesheet.headers.get("content-type"), /text\/css/);

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
