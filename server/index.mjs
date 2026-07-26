import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createWorkspaceStore } from "./workspace-store.mjs";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3210);
const dataDirectory = resolve(process.env.WEAVE_DATA_DIR ?? "data");
const databasePath = resolve(
  process.env.DATABASE_PATH ?? resolve(dataDirectory, "weave.db"),
);
const clientDirectory = resolve("dist/client");

const app = Fastify({
  logger: true,
  bodyLimit: 25 * 1024 * 1024,
  trustProxy: true,
});
const store = createWorkspaceStore(databasePath);

app.addHook("onSend", async (request, reply, payload) => {
  if (request.url.startsWith("/api/")) {
    reply.header("Cache-Control", "no-store");
  }
  return payload;
});

app.get("/api/health", async () => ({
  ok: true,
  service: "weave",
  storage: "sqlite",
  timestamp: new Date().toISOString(),
}));

app.get("/api/workspace", async () => store.read());

app.put("/api/workspace", async (request, reply) => {
  const { workspace, baseRevision } = request.body ?? {};
  if (!Number.isInteger(baseRevision)) {
    return reply.code(400).send({
      message: "baseRevision 必须是整数",
    });
  }

  const result = store.write(workspace, baseRevision);
  if (!result.ok && result.reason === "invalid") {
    return reply.code(400).send({
      message: "Workspace 数据格式不正确",
    });
  }
  if (!result.ok && result.reason === "conflict") {
    return reply.code(409).send({
      message: "服务器数据已被其他页面更新",
      ...result.current,
    });
  }

  return result.value;
});

if (existsSync(clientDirectory)) {
  await app.register(fastifyStatic, {
    root: clientDirectory,
    prefix: "/",
    cacheControl: true,
    maxAge: "1h",
    immutable: false,
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ message: "API not found" });
    }
    return reply.type("text/html").sendFile("index.html");
  });
}

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  store.close();
  process.exit(1);
}
