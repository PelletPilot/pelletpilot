/**
 * REST + WebSocket API. No auth (LAN-trusted, self-host).
 */
import type { FastifyInstance } from "fastify";
import {
  PelletGrill, TEMPLATES, templateById, defaultCapabilities,
  suggestTemplate, setTemperature, type Capabilities,
} from "@pelletpilot/protocol";
import type { Store } from "./db.js";
import type { Poller } from "./poller.js";

interface AddDeviceBody {
  id?: string;
  name: string;
  host: string;
  model?: string;
  templateId?: string;
  capabilities?: Partial<Capabilities>;
}

export function registerRoutes(app: FastifyInstance, store: Store, poller: Poller) {
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/templates", async () => TEMPLATES);

  // --- devices ---
  app.get("/api/devices", async () =>
    store.listDevices().map((d) => ({ ...d, live: poller.getLatest(d.id) ?? null }))
  );

  app.post<{ Body: AddDeviceBody }>("/api/devices", async (req, reply) => {
    const b = req.body;
    if (!b?.name || !b?.host) return reply.code(400).send({ error: "name and host required" });

    // best-effort firmware detection for id + control board
    let id = b.id;
    let controlBoard: string | null = null;
    try {
      const info = (await new PelletGrill(b.host).info()) as any;
      id = id || info?.id;
      controlBoard = (info?.app ?? "").replace(/NEW$/, "") || null; // "PBVNEW" -> "PBV"
    } catch {
      /* offline is fine; user can still add it */
    }
    id = id || slug(b.name);

    const tpl = b.templateId ? templateById(b.templateId) : suggestTemplate(controlBoard ?? id);
    const capabilities: Capabilities = {
      ...(tpl?.capabilities ?? defaultCapabilities()),
      ...(b.capabilities ?? {}),
    };

    const device = store.upsertDevice({
      id, name: b.name, host: b.host, model: b.model ?? tpl?.label ?? null,
      controlBoard, capabilities,
    });
    poller.reload();
    return reply.code(201).send(device);
  });

  app.get<{ Params: { id: string } }>("/api/devices/:id", async (req, reply) => {
    const d = store.getDevice(req.params.id);
    if (!d) return reply.code(404).send({ error: "not found" });
    return { ...d, live: poller.getLatest(d.id) ?? null };
  });

  app.patch<{ Params: { id: string }; Body: Partial<AddDeviceBody> }>("/api/devices/:id", async (req, reply) => {
    const d = store.getDevice(req.params.id);
    if (!d) return reply.code(404).send({ error: "not found" });
    const updated = store.upsertDevice({
      id: d.id,
      name: req.body.name ?? d.name,
      host: req.body.host ?? d.host,
      model: req.body.model ?? d.model,
      controlBoard: d.controlBoard,
      capabilities: { ...d.capabilities, ...(req.body.capabilities ?? {}) },
    });
    poller.reload();
    return updated;
  });

  app.delete<{ Params: { id: string } }>("/api/devices/:id", async (req) => {
    store.deleteDevice(req.params.id);
    poller.reload();
    return { ok: true };
  });

  // --- live state + control ---
  app.get<{ Params: { id: string } }>("/api/devices/:id/state", async (req, reply) => {
    const live = poller.getLatest(req.params.id);
    if (!live) return reply.code(404).send({ error: "no data yet" });
    return live;
  });

  app.post<{ Params: { id: string }; Body: { setTemp?: number; command?: string } }>(
    "/api/devices/:id/command",
    async (req, reply) => {
      const d = store.getDevice(req.params.id);
      if (!d) return reply.code(404).send({ error: "not found" });
      const grill = new PelletGrill(d.host);
      if (typeof req.body.setTemp === "number") {
        const t = clamp(req.body.setTemp, d.capabilities.minTemp, d.capabilities.maxTemp);
        await grill.sendMCU(setTemperature(t));
        return { ok: true, setTemp: t };
      }
      if (req.body.command) {
        await grill.sendMCU(req.body.command);
        return { ok: true };
      }
      return reply.code(400).send({ error: "setTemp or command required" });
    }
  );

  // --- cook history ---
  app.get<{ Params: { id: string } }>("/api/devices/:id/cooks", async (req) =>
    store.listCooks(req.params.id)
  );
  app.get<{ Params: { cookId: string } }>("/api/cooks/:cookId", async (req, reply) => {
    const cook = store.getCook(Number(req.params.cookId));
    if (!cook) return reply.code(404).send({ error: "not found" });
    return { ...cook, events: store.getEvents(cook.id) };
  });
  app.get<{ Params: { cookId: string } }>("/api/cooks/:cookId/samples", async (req) =>
    store.getSamples(Number(req.params.cookId))
  );
  app.post<{ Params: { id: string }; Body: { title?: string } }>(
    "/api/devices/:id/cook/start",
    async (req) => store.activeCook(req.params.id) ?? store.startCook(req.params.id, req.body?.title)
  );
  app.post<{ Params: { cookId: string } }>("/api/cooks/:cookId/stop", async (req) => {
    store.endCook(Number(req.params.cookId));
    return { ok: true };
  });

  // --- live WS push ---
  app.get<{ Params: { id: string } }>("/api/devices/:id/live", { websocket: true }, (socket, req) => {
    const id = req.params.id;
    const send = () => {
      const live = poller.getLatest(id);
      if (live) socket.send(JSON.stringify(live));
    };
    send();
    const iv = setInterval(send, 3000);
    socket.on("close", () => clearInterval(iv));
  });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "device";
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
