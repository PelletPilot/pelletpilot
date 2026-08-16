/**
 * Prefixed KSUID identifiers: `<prefix>_<ksuid>` (e.g. cook_2Q8x...).
 * KSUIDs are time-sortable and globally unique — safe for export/import and
 * cloud upload. Short type prefixes make ids self-describing in logs/URLs.
 */
import KSUID from "ksuid";

export const ID_PREFIX = {
  cook: "cook",
  device: "dev",
  user: "usr",
  apiKey: "key",
  bridge: "brg",
} as const;

export type IdType = keyof typeof ID_PREFIX;

export function newId(type: IdType): string {
  return `${ID_PREFIX[type]}_${KSUID.randomSync().string}`;
}
