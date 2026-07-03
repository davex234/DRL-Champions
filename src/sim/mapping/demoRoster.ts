/**
 * DEMO ROSTER PROVIDER — SOLO para tests, scripts de validación e informes.
 *
 * ⚠️ NO usar en el juego real. En producción los rosters nacen SIEMPRE de la
 * colección del usuario vía el Player Mapper (`src/lib/match/playerMapper.ts`).
 * El motor cae a estos equipos solo si `createRound` se llama sin `rosters`
 * (lo que únicamente ocurre en los scripts `npx tsx scripts/*-report.ts` y tests).
 *
 * Antes vivían en `attributes.ts` como TEAM_HOME/TEAM_AWAY; se aislaron aquí para
 * que ningún jugador ficticio pueda colarse en la experiencia real.
 */
import type { RosterEntry } from "../attributes";
import { PROFILES } from "../identity/profiles";

/** Equipo de demostración A (estrella + IGL sólido). */
export const DEMO_HOME: RosterEntry[] = [
  { name: "AXIS", role: "entry", attrs: { aim: 88, gameSense: 74, utility: 60, leadership: 40 }, identity: PROFILES["aggressive-duelist"] },
  { name: "NOVA", role: "igl", attrs: { aim: 70, gameSense: 86, utility: 72, leadership: 90 }, identity: PROFILES["cerebral-igl"] },
  { name: "KItU", role: "lurk", attrs: { aim: 80, gameSense: 82, utility: 55, leadership: 50 }, identity: PROFILES["flank-lurker"] },
  { name: "VELO", role: "support", attrs: { aim: 68, gameSense: 76, utility: 88, leadership: 55 }, identity: PROFILES["utility-support"] },
  { name: "ZephR", role: "anchor", attrs: { aim: 78, gameSense: 80, utility: 70, leadership: 60 }, identity: PROFILES["patient-anchor"] },
];

/** Equipo de demostración B (rival, más mecánico, una estrella errática). */
export const DEMO_AWAY: RosterEntry[] = [
  { name: "drako", role: "entry", attrs: { aim: 90, gameSense: 70, utility: 58, leadership: 38 }, identity: PROFILES["explosive-star"] },
  { name: "sable", role: "igl", attrs: { aim: 72, gameSense: 80, utility: 70, leadership: 74 }, identity: PROFILES["cerebral-igl"] },
  { name: "py0", role: "lurk", attrs: { aim: 83, gameSense: 78, utility: 52, leadership: 45 }, identity: PROFILES["flank-lurker"] },
  { name: "mira", role: "support", attrs: { aim: 66, gameSense: 74, utility: 85, leadership: 52 }, identity: PROFILES["utility-support"] },
  { name: "tomb", role: "anchor", attrs: { aim: 79, gameSense: 79, utility: 68, leadership: 58 }, identity: PROFILES["patient-anchor"] },
];
