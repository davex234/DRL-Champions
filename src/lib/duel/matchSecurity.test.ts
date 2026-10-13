/**
 * FASE 45 · AUTORIDAD DEL SERVIDOR E IDEMPOTENCIA DE LA PARTIDA.
 *
 * La experiencia de partida cambió; la autoridad NO. Estas pruebas leen el código que habla con el servidor y el de la
 * arena, y comprueban que el cliente no puede decidir —ni enviar— nada de lo que decide el juego: ganador, marcador,
 * recompensa, XP, créditos, rating, la jugada del bot, el cierre de un nodo de campaña o el final de una partida.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { canConfirm, INITIAL_SESSION, matchSessionReducer, type MatchEvent } from "./matchSession";

const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
/** Código sin comentarios: lo que se afirma es lo que se EJECUTA, no lo que se documenta. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const CLIENT = code(read("src", "lib", "duel", "client.ts"));
const TRANSPORT = code(read("src", "lib", "duel", "pvpTransport.ts"));
const CAMPAIGN_CLIENT = code(read("src", "lib", "campaign", "client.ts"));
const DRAFT_CLIENT = code(read("src", "lib", "draft", "client.ts"));
const DUEL_ROUTE = code(read("src", "app", "api", "game", "duel", "route.ts"));
const PVP_ROUTE = code(read("src", "app", "api", "game", "duel", "pvp", "route.ts"));
const CAMPAIGN_ROUTE = code(read("src", "app", "api", "game", "campaign", "route.ts"));
const DRAFT_ROUTE_SRC = code(read("src", "app", "api", "game", "draft-gauntlet", "route.ts"));
const COMPETITIVE_ROUTE = code(read("src", "app", "api", "game", "competitive", "route.ts"));
const BOARD = code(read("src", "components", "duel", "MatchBoard.tsx"));
const COMPLETE = code(read("src", "components", "duel", "MatchComplete.tsx"));
const RESULT = code(read("src", "components", "duel", "ResultScreen.tsx"));
const ARENA = code(read("src", "app", "duelos", "jugar", "page.tsx"));
const SESSION = code(read("src", "lib", "duel", "matchSession.ts"));

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) out.push(p);
  }
  return out;
}
const DUEL_UI = walk(join(ROOT, "src", "components", "duel")).map((p) => ({ p: p.replace(/\\/g, "/"), s: code(readFileSync(p, "utf8")) }));

/* ═══════════ lo que el cliente NO puede mandar ═══════════ */

const FORBIDDEN_FIELDS = ["winner", "scoreYou", "scoreRival", "award", "credits", "xp", "rating", "delta", "firstClear", "outcome", "result"];

for (const field of FORBIDDEN_FIELDS) {
  test(`AUTORIDAD · el cliente nunca envía «${field}» al servidor`, () => {
    for (const [name, src] of [["duel/client", CLIENT], ["pvpTransport", TRANSPORT], ["campaign/client", CAMPAIGN_CLIENT], ["draft/client", DRAFT_CLIENT]] as const) {
      const bodies = [...src.matchAll(/body:\s*JSON\.stringify\(([\s\S]{0,260}?)\)/g)].map((m) => m[1]);
      for (const b of bodies) assert.ok(!new RegExp(`\\b${field}\\b`).test(b), `${name} envía ${field}: ${b.slice(0, 80)}`);
    }
  });
}

test("AUTORIDAD · la jugada solo lleva partida, carta y (si atacas) eje", () => {
  const play = CLIENT.match(/playDuelTurn[\s\S]{0,200}?post<[^>]*>\([^,]+,\s*(\{[\s\S]{0,160}?\})\)/);
  assert.ok(play, "playDuelTurn envía un cuerpo");
  const body = play![1];
  for (const k of ["winner", "value", "points", "score", "award"]) assert.ok(!body.includes(k), `${k} en ${body}`);
  assert.ok(body.includes("cardUid") && body.includes("matchId"));
});

test("AUTORIDAD · el defensor no manda su eje: lo impone el servidor", () => {
  assert.ok(BOARD.includes("onPlay(chosen.uid, attacking ? stat ?? undefined : undefined);"));
});

test("AUTORIDAD · la ruta de duelo solo acepta acciones conocidas y valida uuid y eje", () => {
  assert.ok(DUEL_ROUTE.includes('const STATS = new Set(["stronghold", "gamesense", "entryfrag"]);'));
  assert.ok(DUEL_ROUTE.includes("UUID.test(body.cardUid)"));
  assert.ok(!/body\.(winner|score|award|xp|credits|rating)/.test(DUEL_ROUTE));
});

test("AUTORIDAD · la ruta de duelo no sabe nada de campaña (el contexto va por su propia ruta)", () => {
  assert.ok(!/campaign|nodeId/.test(DUEL_ROUTE));
});

test("AUTORIDAD · competitivo es de SOLO LECTURA: no hay POST que mueva rating", () => {
  assert.ok(!/export async function POST/.test(COMPETITIVE_ROUTE));
  assert.ok(/export async function GET/.test(COMPETITIVE_ROUTE));
});

test("AUTORIDAD · el rating no viaja nunca en el cuerpo de una petición del cliente", () => {
  for (const src of [CLIENT, TRANSPORT]) assert.ok(!/rating/i.test(src.replace(/ratingEvent|outcome=1/g, "")));
});

test("AUTORIDAD · la campaña no acepta «completado» desde el cliente", () => {
  assert.ok(!/body\.(firstClear|completed|credits|reward)/.test(CAMPAIGN_ROUTE));
  assert.ok(CAMPAIGN_ROUTE.includes('case "start"'));
});

test("AUTORIDAD · el draft tampoco acepta resultados ni recompensas", () => {
  assert.ok(!/body\.(reward|credits|xp|winner)/.test(DRAFT_ROUTE_SRC));
});

test("AUTORIDAD · el bot decide en el servidor: la interfaz no lo crea ni lo avanza", () => {
  for (const { p, s } of DUEL_UI) {
    for (const f of ["createDuelBot", "advanceBots", "resolveCombat", "confirmTurn", "createRng"]) {
      assert.ok(!s.includes(f), `${p} llama a ${f}`);
    }
  }
});

test("AUTORIDAD · ninguna pieza de la arena importa el servidor ni el dominio de combate", () => {
  for (const { p, s } of DUEL_UI) {
    assert.ok(!/from "@\/server\//.test(s), `${p} importa @/server`);
    assert.ok(!/from "@\/domain\/cardgame\/(match|combat|opponent)"/.test(s), `${p} importa el motor`);
  }
});

test("AUTORIDAD · el golpe final y el resultado solo PINTAN lo que ya decidió el servidor", () => {
  for (const [name, src] of [["MatchComplete", COMPLETE], ["ResultScreen", RESULT]] as const) {
    assert.ok(!/scoreYou\s*[<>]=?\s*/.test(src), `${name} compara marcadores`);
    assert.ok(!/Math\.(random|max)\(\s*score/.test(src), `${name} calcula marcador`);
  }
});

test("AUTORIDAD · la partida nunca se guarda en el navegador (no hay estado paralelo)", () => {
  for (const { p, s } of DUEL_UI) assert.ok(!/localStorage|sessionStorage/.test(s), p);
  assert.ok(!/localStorage|sessionStorage/.test(ARENA));
});

/* ═══════════ idempotencia y doble clic ═══════════ */

test("IDEMPOTENCIA · PvP manda identificador de acción y versión esperada", () => {
  assert.ok(ARENA.length > 0);
  const pvpPage = code(read("src", "app", "duelos", "pvp", "page.tsx"));
  assert.ok(pvpPage.includes("actionId: crypto.randomUUID()"));
  assert.ok(pvpPage.includes("expectedVersion: state.stateVersion"));
});

test("IDEMPOTENCIA · el servidor exige ese identificador y rechaza versiones viejas", () => {
  assert.ok(PVP_ROUTE.includes("UUID.test(body.actionId)"));
  assert.ok(/expectedVersion/.test(PVP_ROUTE));
});

test("IDEMPOTENCIA · el draft repite el mismo patrón", () => {
  assert.ok(/actionId/.test(DRAFT_ROUTE_SRC) && /expectedVersion/.test(DRAFT_ROUTE_SRC));
});

test("IDEMPOTENCIA · una jugada en vuelo no se envía dos veces (cerrojo de red)", () => {
  assert.ok(ARENA.includes("if (!id || inFlight.current) return;") || ARENA.includes("inFlight.current"));
  assert.ok(ARENA.includes("inFlight.current = true;"));
});

test("IDEMPOTENCIA · el cerrojo de la interfaz apaga mano, ejes y confirmar", () => {
  assert.ok(BOARD.includes("const lock = lockCopy({ busy, waitingRival, attacking, hasCard: Boolean(chosen), hasStat: Boolean(stat) });"));
  assert.ok(BOARD.includes("if (!chosen || busy || lock.locked) return;"));
});

test("IDEMPOTENCIA · la máquina de estados no deja confirmar dos veces", () => {
  const s = ([{ type: "start" }, { type: "introDone" }, { type: "select", uid: "c1" }, { type: "confirm" }, { type: "confirm" }] as MatchEvent[]).reduce(matchSessionReducer, INITIAL_SESSION);
  assert.equal(s.submitted, 1);
  assert.equal(canConfirm(s, false), false);
});

test("IDEMPOTENCIA · tras una jugada aceptada la selección se limpia (no se reenvía sola)", () => {
  const s = ([{ type: "start" }, { type: "introDone" }, { type: "select", uid: "c1" }, { type: "confirm" }, { type: "serverTurn", facts: { resolved: 1, terminal: false } }] as MatchEvent[]).reduce(matchSessionReducer, INITIAL_SESSION);
  assert.equal(s.selectedUid, null);
  assert.equal(s.submitted, 1);
});

test("IDEMPOTENCIA · el resultado no se puede «volver a cobrar» desde la pantalla", () => {
  assert.ok(!/POST|fetch\(/.test(code(read("src", "components", "duel", "ResultScreen.tsx"))));
});

test("IDEMPOTENCIA · la sesión no inventa turnos: los cuenta el servidor", () => {
  assert.ok(SESSION.includes("resolved: e.facts.resolved"));
  assert.ok(!/resolved\s*\+\+|resolved:\s*s\.resolved\s*\+\s*1/.test(SESSION));
});

test("IDEMPOTENCIA · la primera victoria de campaña la liquida el servidor, no la pantalla", () => {
  const banner = code(read("src", "components", "campaign", "CampaignResultBanner.tsx"));
  assert.ok(!/firstClear\s*=\s*true/.test(banner));
  assert.ok(ARENA.includes("campaign.lastAttempt") || ARENA.includes("settled"));
});

test("IDEMPOTENCIA · el draft sigue sin economía: su copy solo puede NEGAR recompensas", () => {
  const copy = code(read("src", "lib", "draft", "presentation.ts"));
  // Cada literal entrecomillado del copy del draft: si menciona economía, tiene que ser para negarla.
  const frases = copy.split(String.fromCharCode(34)).filter((_, i) => i % 2 === 1);
  for (const text of frases) {
    if (!/crédito|sobre|XP/i.test(text)) continue;
    assert.match(text, /[Ss]in recompensas|no da|0 /, `frase del draft que promete economía: ${text}`);
  }
});

test("SEGURIDAD · la simulación de QA no entra en ninguna pantalla de producto", () => {
  for (const { p, s } of DUEL_UI) assert.ok(!s.includes("qaSimulation"), p);
  assert.ok(!ARENA.includes("qaSimulation"));
});

test("SEGURIDAD · el arnés de Fase 45 no llama a ninguna API del juego", () => {
  const harness = code(read("src", "app", "design-system", "fase45", "page.tsx"));
  assert.ok(!/fetch\(|\/api\//.test(harness));
});
