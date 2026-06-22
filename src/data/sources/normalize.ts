import type { Player, PlayerStats, AccoladeId, Region, RoleId } from "@/domain/cards/types";
import { statsFromMetrics } from "@/domain/cards/statsFromMetrics";
import { toIso } from "@/data/countries";
import type { RawPlayer } from "./types";

const clamp99 = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];
const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveRegion(r: string): Region {
  const match = REGIONS.find((x) => x.toLowerCase() === r?.trim().toLowerCase());
  if (match) return match;
  const m = r?.trim().toLowerCase();
  if (m === "na" || m === "americas" || m === "latam" || m === "br") return "Americas";
  if (m === "eu" || m === "emea") return "EMEA";
  if (m === "ap" || m === "apac" || m === "pacific") return "Pacific";
  if (m === "cn" || m === "china") return "China";
  return "EMEA";
}

function resolveRole(r?: string): RoleId {
  if (!r) return "Flex";
  const match = ROLES.find((x) => x.toLowerCase() === r.trim().toLowerCase());
  if (match) return match;
  const m = r.trim().toLowerCase();
  if (m.startsWith("duel")) return "Duelista";
  if (m.startsWith("init") || m.startsWith("inici")) return "Iniciador";
  if (m.startsWith("sent") || m.startsWith("centi")) return "Centinela";
  if (m.startsWith("contr") || m.startsWith("smoke")) return "Controlador";
  return "Flex";
}

const DEFAULT_STATS: PlayerStats = { dmg: 70, scr: 70, com: 70, hs: 60, ast: 65, clu: 65 };

/** Normaliza un `RawPlayer` al modelo `Player` del juego. */
export function normalizeRawPlayer(raw: RawPlayer): Player {
  const stats: PlayerStats = raw.metrics
    ? statsFromMetrics(raw.metrics)
    : {
        dmg: clamp99(raw.stats?.dmg ?? DEFAULT_STATS.dmg),
        scr: clamp99(raw.stats?.scr ?? DEFAULT_STATS.scr),
        com: clamp99(raw.stats?.com ?? DEFAULT_STATS.com),
        hs: clamp99(raw.stats?.hs ?? DEFAULT_STATS.hs),
        ast: clamp99(raw.stats?.ast ?? DEFAULT_STATS.ast),
        clu: clamp99(raw.stats?.clu ?? DEFAULT_STATS.clu),
      };

  return {
    id: raw.id?.trim() || slugify(raw.nick),
    nick: raw.nick.trim(),
    fullName: raw.fullName?.trim() || undefined,
    team: raw.team?.trim() || "Free Agent",
    teamTag: raw.teamTag?.trim() || raw.team?.slice(0, 4).toUpperCase() || "FA",
    region: resolveRegion(raw.region),
    role: resolveRole(raw.role),
    country: toIso(raw.country || ""),
    stats,
    accolades: (raw.accolades ?? []).filter(Boolean) as AccoladeId[],
    image: raw.image?.trim() || undefined,
    status: raw.status === "inactive" ? "inactive" : "active",
    metrics: raw.metrics,
  };
}

export { slugify };
