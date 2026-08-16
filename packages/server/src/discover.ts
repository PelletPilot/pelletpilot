/**
 * Network discovery: sweep a /24 for pellet grills already on WiFi by probing
 * each host's Mongoose OS RPC (Sys.GetInfo). No Bluetooth needed. For brand-new
 * grills not yet on WiFi, BLE provisioning is a separate concern (needs a BT radio).
 */
import { suggestTemplate } from "@pelletpilot/protocol";

export interface Found {
  id: string;
  host: string;
  app: string;
  fwVersion?: string;
  controlBoard: string | null;
  templateId: string;
}

export async function scanSubnet(cidr: string, timeoutMs = 1200, concurrency = 48): Promise<Found[]> {
  const hosts = expandCidr24(cidr);
  const found: Found[] = [];
  let i = 0;
  const worker = async () => {
    while (i < hosts.length) {
      const h = hosts[i++]!;
      const f = await probe(h, timeoutMs);
      if (f) found.push(f);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

async function probe(host: string, timeoutMs: number): Promise<Found | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}/rpc/Sys.GetInfo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const info: any = await res.json();
    const id = info?.id;
    const app = info?.app;
    if (!id || !app) return null;
    // pellet grills identify as PB* (id prefix or app name)
    if (!(String(id).startsWith("PB") || String(app).startsWith("PB"))) return null;
    const controlBoard = String(app).replace(/NEW$/, "") || null;
    return {
      id, host, app,
      fwVersion: info.fw_version,
      controlBoard,
      templateId: suggestTemplate(controlBoard || id).id,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function expandCidr24(cidr: string): string[] {
  const base = cidr.split("/")[0] ?? "192.168.0.0";
  const p = base.split(".");
  const pre = `${p[0]}.${p[1]}.${p[2]}`;
  const out: string[] = [];
  for (let n = 1; n <= 254; n++) out.push(`${pre}.${n}`);
  return out;
}
