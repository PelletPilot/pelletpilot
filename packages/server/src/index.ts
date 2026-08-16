/**
 * PelletPilot self-host server (open-source, no auth).
 * Device registry + capability templates + cook-history recording, over the LAN.
 */
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { openDb } from "./db.js";
import { Poller } from "./poller.js";
import { registerRoutes } from "./routes.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const DB_FILE = process.env.DB_FILE ?? "./data/pelletpilot.db";
const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 10_000);
const STATIC_DIR = process.env.STATIC_DIR ?? "/app/public";

async function main() {
  mkdirSync(dirname(DB_FILE), { recursive: true });
  const store = openDb(DB_FILE);
  const poller = new Poller(store, POLL_MS);
  poller.start();

  const app = Fastify({ logger: true });
  await app.register(websocket);
  await app.register(async (a) => registerRoutes(a, store, poller));

  // serve the web app (if bundled) at /, with SPA fallback for non-/api routes
  if (existsSync(STATIC_DIR)) {
    await app.register(fastifyStatic, { root: STATIC_DIR });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) return reply.code(404).send({ error: "Not Found" });
      return reply.sendFile("index.html");
    });
  }

  await app.listen({ port: PORT, host: HOST });
  app.log.warn("PelletPilot server has NO authentication — run it only on a trusted LAN.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
