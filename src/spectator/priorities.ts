/**
 * DRL SPECTATOR — modelo de prioridades (PURO, sin estado, sin foresight).
 *
 * Escanea el estado PÚBLICO de la ronda y propone candidatos de foco con una
 * prioridad 0..100. Solo lee; nunca modifica el estado. Diseño propio de la
 * escala (no copiado): críticas (clutch/plant/defuse) > combate (duelos) >
 * táctico (rotaciones/default/lull).
 */
import { ovr, ZONES, PLANT_ZONE, type RoundState, type SimEvent, type SimPlayer, type ZoneId } from "../sim";
import type { FocusCandidate } from "./types";
import { ns } from "@/i18n/runtime";

const t = ns("spectator");

const TRADE_WINDOW = 30; // ticks (~1.5 s) para considerar un kill "reciente"
const LURK_ISOLATION = 240; // un lurk a esta distancia de sus aliados es "interesante"

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number) => Math.max(0, Math.min(100, n));

function nearestZoneId(pos: { x: number; y: number }): ZoneId {
  let best: ZoneId = "site";
  let bd = Infinity;
  for (const id of Object.keys(ZONES) as ZoneId[]) {
    const z = ZONES[id];
    const d = (z.x - pos.x) ** 2 + (z.y - pos.y) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

const aliveOf = (s: RoundState, side: "ATK" | "DEF") => s.players.filter((p) => p.side === side && p.alive);
const isAlive = (s: RoundState, id: string) => s.players.some((p) => p.id === id && p.alive);
const byId = (s: RoundState, id: string | null) => (id ? s.players.find((p) => p.id === id) ?? null : null);

/** Bonus por "estrella" (jugadores de mayor nivel atraen la cámara). */
const starBonus = (p: SimPlayer) => Math.max(0, Math.min(6, Math.round((ovr(p.attrs) - 70) / 4)));

/** Jugadores con un duelo activo (ven y apuntan a un enemigo vivo). */
function activeDuelers(s: RoundState): SimPlayer[] {
  return s.players.filter(
    (p) => p.alive && p.targetEnemyId != null && isAlive(s, p.targetEnemyId),
  );
}

const recentKill = (events: SimEvent[], tick: number) =>
  events.some((e) => e.type === "kill" && tick - e.tick <= TRADE_WINDOW);
const anyKillYet = (events: SimEvent[]) => events.some((e) => e.type === "kill");

const cand = (c: FocusCandidate): FocusCandidate => ({ ...c, priority: clamp(c.priority) });

/**
 * Devuelve TODOS los candidatos de foco aplicables al estado actual. El Director
 * elegirá el de mayor prioridad (aplicando su memoria). Siempre incluye un
 * candidato de "lull" para garantizar una decisión válida.
 */
export function detectCandidates(s: RoundState, events: SimEvent[]): FocusCandidate[] {
  const tick = s.tick;
  const out: FocusCandidate[] = [];
  const atk = aliveOf(s, "ATK");
  const def = aliveOf(s, "DEF");
  const live = s.phase !== "ENDED";

  // --- CRÍTICAS ---

  // Clutch: un bando con exactamente 1 vivo frente a >=1. Escala con la desventaja.
  if (live) {
    const clutchSide = atk.length === 1 && def.length >= 1 ? "ATK"
      : def.length === 1 && atk.length >= 1 ? "DEF" : null;
    if (clutchSide) {
      const lone = clutchSide === "ATK" ? atk[0] : def[0];
      const x = clutchSide === "ATK" ? def.length : atk.length;
      out.push(cand({
        situation: "clutch", tier: "critical", focusPlayerId: lone.id,
        focusZone: nearestZoneId(lone.pos), camera: "clutch",
        priority: 84 + Math.min(x - 1, 3) * 4, // 1v1:84 · 1v2:88 · 1v3:92 · 1v4+:96
        reason: t("Clutch 1v{x} de {name}", { x, name: lone.name }),
      }));
    }
  }

  // Defuse en curso.
  if (s.spike.planted && s.spike.defuseProgress > 0 && s.spike.pos) {
    const defuser = byId(s, s.spike.defuseBy) ?? def.sort((a, b) => dist(a.pos, s.spike.pos!) - dist(b.pos, s.spike.pos!))[0] ?? null;
    out.push(cand({
      situation: "defuse", tier: "critical", focusPlayerId: defuser?.id ?? null,
      focusZone: nearestZoneId(s.spike.pos), camera: "defuse",
      priority: 90 + Math.round(s.spike.defuseProgress * 5),
      reason: t("Desactivando el spike{v}", { v: defuser ? ` (${defuser.name})` : "" }),
    }));
  }

  // Plant en curso.
  if (!s.spike.planted && s.spike.plantProgress > 0) {
    const planter = atk.slice().sort((a, b) => dist(a.pos, PLANT_ZONE) - dist(b.pos, PLANT_ZONE))[0] ?? null;
    out.push(cand({
      situation: "plant", tier: "critical", focusPlayerId: planter?.id ?? null,
      focusZone: nearestZoneId(PLANT_ZONE), camera: "plant",
      priority: 86 + Math.round(s.spike.plantProgress * 4),
      reason: t("Plantando el spike{v}", { v: planter ? ` (${planter.name})` : "" }),
    }));
  }

  // Retake (postplant, defensa empujando, sin defuse aún).
  if (s.spike.planted && s.phase === "POSTPLANT" && s.spike.defuseProgress === 0 && def.length > 0) {
    const pushing = def.filter((p) => p.intent === "push" || p.intent === "fight");
    if (pushing.length && s.spike.pos) {
      const lead = pushing.sort((a, b) => dist(a.pos, s.spike.pos!) - dist(b.pos, s.spike.pos!))[0];
      out.push(cand({
        situation: "retake", tier: "critical", focusPlayerId: lead.id,
        focusZone: nearestZoneId(s.spike.pos), camera: "retake",
        priority: 76 + Math.min(def.length, 4),
        reason: t("Retake en marcha ({length} def)", { length: pushing.length }),
      }));
    }
  }

  // --- COMBATE ---

  const duelers = activeDuelers(s);
  if (duelers.length) {
    const focus = duelers.slice().sort((a, b) => ovr(b.attrs) - ovr(a.attrs))[0];
    const opening = !anyKillYet(events);
    const trade = !opening && recentKill(events, tick);
    if (opening) {
      out.push(cand({
        situation: "first_duel", tier: "combat", focusPlayerId: focus.id,
        focusZone: nearestZoneId(focus.pos), camera: "player",
        priority: 80 + starBonus(focus), reason: t("Primer duelo ({name})", { name: focus.name }),
      }));
    } else if (trade) {
      out.push(cand({
        situation: "trade", tier: "combat", focusPlayerId: focus.id,
        focusZone: nearestZoneId(focus.pos), camera: "player",
        priority: 74 + starBonus(focus), reason: t("Trade en juego ({name})", { name: focus.name }),
      }));
    } else {
      out.push(cand({
        situation: "duel", tier: "combat", focusPlayerId: focus.id,
        focusZone: nearestZoneId(focus.pos), camera: "player",
        priority: 64 + starBonus(focus), reason: t("Duelo ({name})", { name: focus.name }),
      }));
    }
  }

  // Lurk aislado (flanco interesante).
  if (live) {
    const lurk = s.players.find((p) => {
      if (!p.alive || p.role !== "lurk" || p.targetEnemyId) return false;
      const mates = s.players.filter((q) => q.side === p.side && q.alive && q.id !== p.id);
      if (!mates.length) return false;
      const minMate = Math.min(...mates.map((q) => dist(p.pos, q.pos)));
      return minMate > LURK_ISOLATION;
    });
    if (lurk) {
      out.push(cand({
        situation: "lurk", tier: "combat", focusPlayerId: lurk.id,
        focusZone: nearestZoneId(lurk.pos), camera: "player",
        priority: 56 + starBonus(lurk), reason: t("Lurk de {name} por el flanco", { name: lurk.name }),
      }));
    }
  }

  // --- TÁCTICO ---

  // Rotación / movimiento sin contacto.
  if (live && !duelers.length) {
    const movers = s.players.filter((p) => p.alive && (p.intent === "rotate" || p.intent === "push" || p.intent === "move"));
    if (movers.length >= 2) {
      const focus = movers.sort((a, b) => ovr(b.attrs) - ovr(a.attrs))[0];
      out.push(cand({
        situation: "rotation", tier: "tactical", focusPlayerId: focus.id,
        focusZone: nearestZoneId(focus.pos), camera: "tactical",
        priority: 46, reason: t("Reposicionamiento del equipo"),
      }));
    }
  }

  // Default / setup.
  if (live && (s.phase === "SETUP" || s.phase === "EXECUTE")) {
    out.push(cand({
      situation: "default", tier: "tactical", focusPlayerId: null,
      focusZone: "site", camera: "tactical", priority: 34, reason: t("Fase de control del mapa"),
    }));
  }

  // Lull (garantiza siempre una decisión válida).
  out.push(cand({
    situation: "lull", tier: "tactical", focusPlayerId: null,
    focusZone: "site", camera: "cinematic", priority: 16, reason: t("Sin acción destacada"),
  }));

  return out;
}
