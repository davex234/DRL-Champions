/**
 * ECOSISTEMA GLOBAL — el orquestador que hace CAMBIAR el universo cada temporada (Fase 6/7).
 *
 * Compone economía + rivalidades + competiciones + redes sociales sobre el `WorldState` ya
 * avanzado, aplica sus efectos EMERGENTES (deltas) y recoge los hitos de legado. Empuja las
 * noticias al buzón ÚNICO (`legacyNews` → useNewsStore, patrón de marketNews/orgNews/worldNews).
 * Determinista. Reutiliza todos los motores; no crea World/Timeline/News/Finance nuevos.
 */
import type { WorldState } from "@/world";
import type { NewsItem, NewsKind } from "@/intel";
import type { LegacyEvent, LegacyEventType } from "./types";
import { globalEconomy, applyEconomy } from "./economy";
import { detectRivalries, applyRivalryEffects } from "./rivalries";
import { runCompetitions } from "./competitions";
import { socialTrends, applySocial } from "./social";

const ev = (type: LegacyEventType, season: number, at: number, subject: string, detail: string, magnitude: number): LegacyEvent =>
  ({ id: `legacy:${season}:${type}:${subject}`.replace(/\s+/g, "_"), type, season, at, subject, detail, magnitude: Math.max(1, Math.min(100, Math.round(magnitude))) });

/**
 * Avanza el ECOSISTEMA una temporada (tras `advanceWorld`). Muta el mundo con efectos acotados
 * y devuelve los eventos de legado. `protectTeamId` blinda el presupuesto del club del usuario.
 */
export function runGlobalEcosystem(world: WorldState, protectTeamId: string | null, at: number): LegacyEvent[] {
  const season = world.season;
  const events: LegacyEvent[] = [];

  // 1) Economía mundial (inflación/boom/crisis) → valores + presupuestos.
  const econ = globalEconomy(world);
  applyEconomy(world, econ, protectTeamId);
  if (econ.phase === "boom") events.push(ev("economic_boom", season, at, "Mercado", econ.note, 72));
  else if (econ.phase === "crisis") events.push(ev("economic_crisis", season, at, "Mercado", econ.note, 78));

  // 2) Rivalidades dinámicas → prestigio/fanbase por la audiencia.
  detectRivalries(world);
  const { born } = applyRivalryEffects(world, protectTeamId);
  for (const r of born.slice(0, 3)) events.push(ev("rivalry_born", season, at, `${r.a} vs ${r.b}`, `Nace una rivalidad en el circuito (intensidad ${r.intensity}).`, 62));

  // 3) Competiciones mundiales (Masters/Invitacional/Worlds) → prestigio/dinero/fanbase.
  const comps = runCompetitions(world, protectTeamId);
  const worlds = comps.find((c) => c.tier === "worlds");
  if (worlds) events.push(ev("world_champion", season, at, worlds.championName, `${worlds.championName} conquista el World Championship (T${season}).`, 96));

  // 4) Redes sociales → fanbase/popularidad.
  const trends = socialTrends(world);
  applySocial(world, trends, protectTeamId);
  const viral = trends.find((t) => t.kind === "viral_player");
  if (viral) events.push(ev("viral", season, at, viral.subject, viral.note, viral.reach));

  // 5) Club del año + récord de fichaje (legado).
  const topTeam = Object.values(world.teams).sort((a, b) => (b.titles * 25 + b.prestige) - (a.titles * 25 + a.prestige))[0];
  if (topTeam) events.push(ev("club_of_year", season, at, topTeam.name, `${topTeam.name} es reconocido como el CLUB DEL AÑO.`, 66));
  const rec = world.history.records["transfer"];
  if (rec && rec.season === season) events.push(ev("transfer_record", season, at, rec.holder, `Récord histórico de fichaje: ${rec.holder} (${rec.value}).`, 88));
  const dyn = world.history.records["dynasty"];
  if (dyn && dyn.value >= 3) events.push(ev("record", season, at, dyn.holder, `${dyn.holder} firma la mayor dinastía (${dyn.value} títulos seguidos).`, 90));

  return events;
}

const KIND: Record<LegacyEventType, NewsKind> = {
  record: "record", dynasty_end: "record", rivalry_born: "event", legend: "special", hall_of_fame: "special",
  economic_boom: "record", economic_crisis: "record", world_champion: "special", club_of_year: "record", transfer_record: "record", viral: "event",
};
const TITLE: Record<LegacyEventType, string> = {
  record: "Récord histórico", dynasty_end: "Fin de una dinastía", rivalry_born: "Nace una rivalidad", legend: "Jugador histórico", hall_of_fame: "Hall of Fame",
  economic_boom: "Boom económico", economic_crisis: "Crisis económica", world_champion: "Campeón del Mundo", club_of_year: "Club del año", transfer_record: "Transferencia histórica", viral: "Viral en redes",
};

/** Eventos de legado → NewsItem (buzón único, ids deterministas). `at` lo inyecta el store. */
export function legacyNews(events: LegacyEvent[]): NewsItem[] {
  return events.map((e) => ({ id: e.id, at: e.at, kind: KIND[e.type], title: TITLE[e.type], body: e.detail, tags: ["mundo", "legacy", e.type] }));
}
