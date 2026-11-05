/**
 * FASE 65 · LÍNEA BASE Y REGLAS LEÍDAS DEL CÓDIGO (instrumento `_`, fuera de CI). Sin BD, sin red.
 *   npx tsx scripts/balance/_fase65-baseline.ts
 * Escribe docs/product/qa/fase65-balance/{baseline.json, rules.json}.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { CARDS } from "../../src/data/catalog";
import { COMBAT_MATCHUP } from "../../src/domain/cards/combat";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES, ALLOW_SAME_PLAYER_TWICE } from "../../src/domain/cardgame";
import { TURNS_PER_MATCH, ORCHESTRATOR_VERSION } from "../../src/domain/cardgame/match";
import { CURRENT_COMBAT_RULES, COMBAT_RULESETS } from "../../src/domain/cardgame/combat";
import { DIFFICULTY_PROFILE } from "../../src/domain/cardgame/opponent";
import { GLOBAL_MARKET_ENABLED } from "../../src/config/features";
import { PAYMENTS_ENABLED } from "../../src/config/monetization";
import { TACTICAL_AGENTS } from "../../src/domain/tactics/roster";
import { catalogCards, combatSum } from "../../src/domain/balance/lab";

const OUT = join(process.cwd(), "docs/product/qa/fase65-balance");
mkdirSync(OUT, { recursive: true });
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const sh = (c: string) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return null; } };

const pool = catalogCards();
const golden = read("src/lib/duel/f61.match.test.tsx").match(/ENGINE_DIGEST = "([0-9a-f]{64})"/)?.[1] ?? null;
const migrations = readdirSync(join(process.cwd(), "supabase/migrations")).filter((f) => /^\d{4}_/.test(f)).sort();
const roles: Record<string, number> = {};
for (const c of pool) roles[c.role] = (roles[c.role] ?? 0) + 1;

writeFileSync(join(OUT, "baseline.json"), JSON.stringify({
  measuredAt: new Date().toISOString(), gitHead: sh("git rev-parse HEAD"), branch: sh("git rev-parse --abbrev-ref HEAD"),
  workingTreeDirty: (sh("git status --porcelain")?.split("\n").length ?? 0) > 0,
  testsBeforeF65: { count: 5286, source: "gates de F64 (docs/product/fase-64-game-feel.md)" },
  catalog: { cards: CARDS.length, playableCards: pool.length, players: new Set(pool.map((c) => c.playerId)).size, roles, ovr: [Math.min(...pool.map((c) => c.ovr)), Math.max(...pool.map((c) => c.ovr))], combatSum: [Math.min(...pool.map(combatSum)), Math.max(...pool.map(combatSum))] },
  tacticalAgents: TACTICAL_AGENTS.length,
  migrations: { count: migrations.length, head: migrations.at(-1) },
  flags: { GLOBAL_MARKET_ENABLED, PAYMENTS_ENABLED },
  engine: { orchestrator: ORCHESTRATOR_VERSION, rules: CURRENT_COMBAT_RULES.version, goldenDigestF61: golden, goldenTest: "src/lib/duel/f61.match.test.tsx · F61 MOTOR 01" },
}, null, 2) + "\n");

writeFileSync(join(OUT, "rules.json"), JSON.stringify({
  source: "leído del código (no de documentación)",
  deck: { size: DUEL_DECK_SIZE, composition: DUEL_COMPOSITION, roles: DUEL_ROLES, allowSamePlayerTwice: ALLOW_SAME_PLAYER_TWICE, file: "src/domain/cardgame/deck.ts · validateDuelDeck" },
  match: {
    turns: TURNS_PER_MATCH, orchestrator: ORCHESTRATOR_VERSION,
    attackerAlternates: true, firstAttacker: "crypto.randomInt en el servidor (PvE duels.ts launchPve · PvP duelsPvp.ts)",
    turnOrder: ["atacante elige carta", "atacante elige eje (stronghold|gamesense|entryfrag)", "defensor VE carta, eje y valor del atacante", "defensor elige carta; su eje lo impone la tabla", "se confirma"],
    matchup: COMBAT_MATCHUP, encounter: "gana el valor mayor; igualdad = nadie puntúa (NO_POINT)", cardsSpentOncePerMatch: true,
  },
  result: {
    current: CURRENT_COMBAT_RULES, known: Object.keys(COMBAT_RULESETS),
    ladder: ["marcador de enfrentamientos", "suma de OVR IMPRESO de las 10 cartas (+1 punto al marcador)", "margen de estadística declarada (sin punto)", "DRAW explícito"],
    file: "src/domain/cardgame/combat/resolver.ts · resolveCombat",
  },
  cardPower: { combat: "playerCombatBase(player).combat + statBoost de la edición (hoy 0 en todas las ediciones)", printedOvr: "del manifiesto; distinto por edición", file: "src/data/catalog.ts · cardFromManifest" },
  bots: { profiles: DIFFICULTY_PROFILE, file: "src/domain/cardgame/opponent/bots.ts" },
}, null, 2) + "\n");
console.log("baseline.json + rules.json escritos");
