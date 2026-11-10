/**
 * ACADEMIA — los equipos generan ROOKIES. Con potencial, personalidad, ADN, estilo,
 * región e historia. Nadie nace igual: el innato (Player Development Engine) es
 * determinista por id, pero la academia fuerza juventud + potencial alto y variado. PURO.
 */
import type { Region, RoleId } from "@/domain/cards/types";
import type { WorldPlayer, WorldState } from "./types";
import type { Rng } from "./rng";
import { deriveInnate, freshDevState } from "@/development";
import { playerValue } from "./market";

const ROLES: RoleId[] = ["Duelista", "Iniciador", "Centinela", "Controlador", "Flex"];
const SYL_A = ["zy", "ax", "ne", "vi", "kr", "lo", "ta", "qu", "ze", "mi", "ra", "su", "no", "ka", "fy", "ji"];
const SYL_B = ["ro", "ex", "us", "ko", "an", "il", "ow", "en", "ar", "ix", "om", "yn", "el", "ur", "ai", "ov"];

function genNick(rng: Rng): string {
  const n = SYL_A[rng.int(SYL_A.length)] + SYL_B[rng.int(SYL_B.length)];
  return n.charAt(0).toUpperCase() + n.slice(1) + (rng.chance(0.4) ? String(rng.int(99)) : "");
}

/** Genera un rookie (agente libre por defecto) con potencial juvenil. */
export function generateRookie(world: WorldState, rng: Rng, region: Region, role?: RoleId): WorldPlayer {
  const id = `acad-${world.season}-${world.nextId++}`;
  const innate = deriveInnate(id);
  // Juventud + potencial alto y VARIADO (algunos wonderkids, otros proyectos discretos).
  innate.startAge = 16 + rng.int(3);                 // 16..18
  innate.potential = 62 + rng.int(37);                // 62..98
  innate.growthRate = Math.round((0.8 + rng.next() * 0.7) * 100) / 100;
  innate.peakAge = 23 + rng.int(4);
  innate.declineAge = innate.peakAge + 4 + rng.int(3);
  const dev = freshDevState(innate);
  const p: WorldPlayer = {
    id, nick: genNick(rng), region, role: role ?? ROLES[rng.int(ROLES.length)],
    teamId: null, innate, dev, contract: null, status: "active",
    value: 0, titles: 0, mvps: 0, origin: "academy", prevValue: 0,
  };
  p.value = playerValue(p);
  p.prevValue = p.value;
  return p;
}
