/**
 * F72.2 · PISTAS VISUALES — resolvedor de assets, FLEX, identidad canónica de equipo, inventario de assets y pruebas
 * NEGATIVAS de fuga en PvE y PvP (vistas reales, proyectadas como en servidor).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HINT_ICONS_AVAILABLE, VALORANT_ROLE_OF, VCT_LEAGUE_OF, hintArt, teamLogoSlugFor, visualHintValue } from "./hintVisuals";
import { hintForCard, rivalHintsFor, rivalUnplayedCards, fnv1a32, HINT_TYPES } from "@/domain/cardgame/hints";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { qaRegistry, qaSimulate, qaSnapshot, qaView } from "./qaSimulation";
import { canonicalTeam } from "@/data/teamIdentities";
import { HINT_TEAM_LOGOS } from "@/data/teamLogos";
import type { DuelMatch } from "@/domain/cardgame/match";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const countryOf = (pid: string) => qaRegistry.player(pid)?.country ?? "";
const VOCAB: Record<string, RegExp> = {
  COUNTRY: /^[A-Z]{2}$/, ROLE: /^(DUELIST|CONTROLLER|INITIATOR|SENTINEL)$/, REGION: /^(AMERICAS|EMEA|PACIFIC|CHINA)$/, TEAM: /^[a-z0-9-]{1,48}$/,
};

test("V1 · roles: los cuatro oficiales de VALORANT; Flex no tiene equivalente y NUNCA es pista de rol", () => {
  assert.deepEqual(VALORANT_ROLE_OF, { Duelista: "DUELIST", Controlador: "CONTROLLER", Iniciador: "INITIATOR", Centinela: "SENTINEL", Flex: null });
  assert.equal(visualHintValue("ROLE", "Flex"), null);
  // La fuente canónica lo justifica: todos los jugadores Flex tienen empate de roles en sus agentes.
  const raw = JSON.parse(read("src/data/vlr/players-vct-2026.json")) as { role: string; roleSource: string; roleConfidence: string }[];
  const flex = raw.filter((p) => p.role === "Flex");
  assert.ok(flex.length > 0 && flex.every((p) => p.roleSource === "agents" && p.roleConfidence === "tie"));
});

test("V2 · país: ISO real con nombre conocido Y bandera LOCAL → bandera; nada de códigos inventados (F72.3: sin flagcdn)", () => {
  assert.equal(visualHintValue("COUNTRY", "fr"), "FR");
  assert.equal(visualHintValue("COUNTRY", "ES"), null, "país real pero sin bandera local (ningún jugador de las 331): sin pista");
  assert.equal(visualHintValue("COUNTRY", "UN"), null, "UN no es una nacionalidad");
  assert.equal(visualHintValue("COUNTRY", "ZZ"), null);
  assert.equal(visualHintValue("COUNTRY", "Spain"), null);
  assert.deepEqual(hintArt({ type: "COUNTRY", value: "FR" })?.shape, "flag");
  assert.equal(hintArt({ type: "COUNTRY", value: "FR" })?.src, "/flags/fr.svg");
  assert.equal(hintArt({ type: "COUNTRY", value: "UN" }), null);
});

test("V3 · liga y rol sin icono en el repositorio → no hay pista de ese tipo (se salta); ligas mapeadas a las cuatro VCT", () => {
  assert.deepEqual(VCT_LEAGUE_OF, { Americas: "AMERICAS", EMEA: "EMEA", Pacific: "PACIFIC", China: "CHINA" });
  for (const r of ["Duelista", "Controlador", "Iniciador", "Centinela"]) assert.equal(visualHintValue("ROLE", r) !== null, HINT_ICONS_AVAILABLE.has(`roles/${VALORANT_ROLE_OF[r as "Duelista"]!.toLowerCase()}`));
  for (const g of ["Americas", "EMEA", "Pacific", "China"]) assert.equal(visualHintValue("REGION", g) !== null, HINT_ICONS_AVAILABLE.has(`regions/${VCT_LEAGUE_OF[g as "EMEA"].toLowerCase()}`));
});

test("V4 · equipo: por IDENTIDAD canónica (TH ≡ Team Heretics), solo con logo real; sin logo → sin pista de equipo", () => {
  assert.equal(canonicalTeam("TH").key, canonicalTeam("Team Heretics").key);
  assert.equal(teamLogoSlugFor("TH"), teamLogoSlugFor("Team Heretics"));
  for (const t of ["TH", "Fnatic", "DRG", "AG", "Sentinels", "G2"]) {
    const slug = teamLogoSlugFor(t);
    assert.ok(slug === null || HINT_TEAM_LOGOS.has(slug), t);
  }
  assert.equal(hintArt({ type: "TEAM", value: "fnatic" }) !== null, HINT_TEAM_LOGOS.has("fnatic"));
});

test("V5 · inventario: los iconos declarados son EXACTAMENTE los ficheros de public/hints (y nada más)", () => {
  const dir = join(ROOT, "public", "hints");
  const onDisk = new Set<string>();
  for (const kind of ["roles", "regions"]) {
    const d = join(dir, kind);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith(".svg")) onDisk.add(`${kind}/${f.replace(/\.svg$/, "")}`);
  }
  assert.deepEqual([...HINT_ICONS_AVAILABLE].sort(), [...onDisk].sort());
});

test("V6 · el algoritmo no cambia: mismo hash de inicio, mismo orden cíclico; un tipo sin asset se salta como un campo vacío", () => {
  const card = { uid: "u-1", playerId: "p", team: "TH", region: "EMEA" as const, role: "Flex" as const };
  const start = fnv1a32("m-1:u-1") % HINT_TYPES.length;
  const h = hintForCard("m-1", card, () => "ES", visualHintValue);
  const expected = [...HINT_TYPES.slice(start), ...HINT_TYPES.slice(0, start)].find((t) => visualHintValue(t, t === "COUNTRY" ? "ES" : t === "TEAM" ? "TH" : t === "REGION" ? "EMEA" : "Flex") !== null);
  assert.equal(h?.type, expected);
  // Sin ningún asset posible (sin país, Flex, liga/equipo sin icono): sin pista (dorso normal).
  if (!HINT_ICONS_AVAILABLE.size) assert.equal(hintForCard("m-1", { ...card, team: "GEN" }, () => "", visualHintValue), null);
});

function match(): DuelMatch {
  const m = qaSimulate(qaSnapshot(0, "qa-a", "QA A"), qaSnapshot(1, "qa-b", "QA B"), 3, "A", 11, false);
  assert.ok(m.status === "IN_PROGRESS" && rivalUnplayedCards(m, "A").length >= 6 && rivalUnplayedCards(m, "B").length >= 6, "partida de QA en curso");
  return m;
}

/** Lo oculto del rival no viaja. Excepción legítima: el MISMO jugador/carta en el mazo propio (el uid, nunca). */
function assertNoLeak(json: string, hidden: ReturnType<typeof rivalUnplayedCards>, own: readonly { cardId: string; playerId: string }[], label: string) {
  const mine = new Set(own.flatMap((c) => [c.cardId, c.playerId, qaRegistry.player(c.playerId)?.nick ?? ""]));
  for (const c of hidden) {
    const p = qaRegistry.player(c.playerId);
    assert.ok(!json.includes(`"${c.uid}"`), `${label}: uid ${c.uid}`);
    for (const secret of [c.cardId, c.playerId, p?.nick ?? ""]) if (secret && !mine.has(secret)) assert.ok(!json.includes(`"${secret}"`), `${label}: ${secret}`);
  }
}

test("V7 · PvE: la vista del jugador solo trae { type, value } con valores de asset; ni uid, ni cardId, ni playerId, ni nick de lo oculto", () => {
  const m = match();
  const v = qaView(m, "A", "PVE");
  assert.equal(v.rivalHints.length, v.rivalRemaining);
  for (const h of v.rivalHints) {
    if (h === null) continue; // carta sin pista representable: dorso normal, nada viaja
    assert.deepEqual(Object.keys(h).sort(), ["type", "value"]);
    assert.match(h.value, VOCAB[h.type], `${h.type}:${h.value}`);
    assert.ok(hintArt(h), `${h.type}:${h.value} tiene asset`);
    assert.ok(!/Flex|FLX|Duelista|Iniciador|Controlador|Centinela/.test(h.value));
  }
  assertNoLeak(JSON.stringify(v), rivalUnplayedCards(m, "A"), m.snapshotA.cards, "PvE");
});

test("V8 · PvP: proyección A y B — mismas reglas, sin fugas, y cada lado recibe las pistas de SU rival", () => {
  const m = match();
  for (const side of ["A", "B"] as const) {
    const proj = projectMatchFor(m, side, countryOf, visualHintValue);
    const v = qaView(m, side, "PVP");
    assert.deepEqual(proj.rivalHints, rivalHintsFor(m, side, countryOf, visualHintValue));
    assert.equal(v.rivalHints.length, v.rivalRemaining);
    for (const h of v.rivalHints) { if (!h) continue; assert.deepEqual(Object.keys(h).sort(), ["type", "value"]); assert.match(h.value, VOCAB[h.type]); }
    assertNoLeak(JSON.stringify(v), rivalUnplayedCards(m, side), side === "A" ? m.snapshotA.cards : m.snapshotB.cards, `PvP ${side}`);
  }
});

test("V9 · determinismo: recargar / reconectar (volver a proyectar) da exactamente las mismas pistas", () => {
  const m = match();
  const a = qaView(m, "A", "PVE").rivalHints;
  const b = qaView(JSON.parse(JSON.stringify(m)), "A", "PVE").rivalHints;
  assert.deepEqual(a, b);
  assert.deepEqual(projectMatchFor(m, "B", countryOf, visualHintValue).rivalHints, projectMatchFor(JSON.parse(JSON.stringify(m)), "B", countryOf, visualHintValue).rivalHints);
});

test("V10 · todos los caminos del servidor pintan con el resolvedor visual (PvE, PvP, sincronización, historial ranked)", () => {
  const duels = read("src/server/services/duels.ts");
  assert.equal((duels.match(/rivalHintsFor\(m, HUMAN, countryOf, visualHintValue\)/g) ?? []).length, 2);
  assert.ok(duels.includes("projectMatchFor(m, side, countryOf, visualHintValue)"));
  const pvp = read("src/server/services/duelsPvp.ts");
  assert.equal((pvp.match(/visualHintValue\)/g) ?? []).length, 3);
  assert.ok(read("src/server/services/competitive.ts").includes("visualHintValue);"));
  assert.ok(!/Math\.random/.test(read("src/lib/duel/hintVisuals.ts") + read("src/lib/duel/hintDisplay.ts")));
});
