/**
 * Device capabilities + templates.
 *
 * Capabilities vary by grill MODEL, not just control board — a chamber-only grill,
 * a pellet grill with an add-on smoker box, and a vertical smoker differ in probe
 * count and features. The firmware exposes the control board (protocol), but probe
 * count / features are model-level, so they're chosen when a device is added
 * (template pick + optional override), then stored per device.
 */

export interface Capabilities {
  /** number of meat-probe ports (0 = chamber sensor only) */
  meatProbes: number;
  /** pellet grill fitted with an add-on smoker box */
  smokerBox: boolean;
  /** has a cabinet/grill light that can be toggled */
  lights: boolean;
  /** temperature limits and step, in °F */
  minTemp: number;
  maxTemp: number;
  tempStep: number;
}

export interface DeviceTemplate {
  id: string;
  label: string;
  description: string;
  /** control-board family hint (from firmware Sys.GetInfo / device id prefix) */
  controlBoardHint?: string;
  capabilities: Capabilities;
}

const base = { lights: true, minTemp: 180, maxTemp: 500, tempStep: 5 };

export const TEMPLATES: DeviceTemplate[] = [
  {
    id: "pellet-grill",
    label: "Pellet Grill",
    description: "Standard pellet grill with meat probes.",
    capabilities: { ...base, meatProbes: 2, smokerBox: false },
  },
  {
    id: "pellet-grill-chamber-only",
    label: "Pellet Grill (chamber only)",
    description: "Grill with a chamber sensor and no meat-probe ports.",
    capabilities: { ...base, meatProbes: 0, smokerBox: false },
  },
  {
    id: "pellet-grill-smoker-box",
    label: "Pellet Grill + Smoker Box",
    description: "Pellet grill fitted with an add-on smoker box.",
    capabilities: { ...base, meatProbes: 2, smokerBox: true },
  },
  {
    id: "vertical-smoker",
    label: "Vertical Smoker",
    description: "Vertical pellet smoker (typically up to 3 meat probes).",
    controlBoardHint: "PBV",
    capabilities: { ...base, meatProbes: 3, smokerBox: false },
  },
];

export function templateById(id: string): DeviceTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function defaultCapabilities(): Capabilities {
  return { ...base, meatProbes: 2, smokerBox: false };
}

/** Best-effort template suggestion from a firmware control-board / device-id prefix. */
export function suggestTemplate(controlBoardOrPrefix?: string): DeviceTemplate {
  const s = (controlBoardOrPrefix ?? "").toUpperCase();
  if (s.startsWith("PBV")) return templateById("vertical-smoker")!;
  return templateById("pellet-grill")!;
}
