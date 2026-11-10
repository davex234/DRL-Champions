/**
 * RESULTADO ÚNICO · lo que el resultado del duelo dejó de enseñar, recuperado en el centro Competitivo:
 *   · la CEREMONIA de rango de la última clasificatoria (del asiento del servidor; una vez por partida);
 *   · el CAMBIO DE PUESTO («Subes 5 puestos en el Top (#9)») que la página PvP deja en la sesión del navegador.
 * Sin DOM de pruebas en el proyecto: la decisión «una vez» se prueba con la lógica pura y un almacenamiento simulado, y el
 * montaje con contratos sobre el código.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { rankMovement, type RankMovement } from "@/domain/ranked/standing";
import { RankChange, markRankCeremonySeen, rankCeremonySeen } from "./RankChange";
import { LAST_RANKED_MAX_AGE_MS, LastRankedResult, shouldShowLastRanked } from "./LastRankedResult";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const S1 = { placementGames: 5, rankConfigVersion: "rank-v1" };
const M = (oldRating: number, newRating: number, n: number | null, season: typeof S1 | null = S1): RankMovement => rankMovement({ oldRating, newRating, seasonMatchNumber: n }, season);
const ID = "11111111-2222-4333-8444-555555555555";
const UA = "aaaaaaaa-0000-4000-8000-000000000001";
const UB = "bbbbbbbb-0000-4000-8000-000000000002";
const NOW = 1_800_000_000_000;

/** `window.localStorage` simulado para un test; se retira al terminar. */
function withStorage<T>(fn: () => T): T {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, String(v)), removeItem: (k: string) => void store.delete(k) };
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g; const prev = g.window;
  g.window = { localStorage: ls };
  try { return fn(); } finally { if (had) g.window = prev; else delete g.window; }
}

/* ───────────── decisión «una vez» ───────────── */

test("LR-1 · se enseña la última ceremonia SOLO si existe, no está vista, no es vieja y tiene algo que contar", () => {
  const last = { matchId: ID, at: NOW - 60_000, movement: M(1030, 1052, 8) };
  const never = () => false, always = () => true;
  assert.equal(shouldShowLastRanked(last, NOW, never), true);
  assert.equal(shouldShowLastRanked(last, NOW, always), false, "ya vista");
  assert.equal(shouldShowLastRanked({ ...last, at: NOW - LAST_RANKED_MAX_AGE_MS - 1 }, NOW, never), false, "demasiado vieja");
  assert.equal(shouldShowLastRanked({ ...last, movement: M(1000, 1020, null, null) }, NOW, never), false, "sin temporada: nada que celebrar");
  assert.equal(shouldShowLastRanked(null, NOW, never), false);
  assert.equal(shouldShowLastRanked(undefined, NOW, never), false, "snapshot anterior sin el campo");
});

test("LR-2 · ceremonia una sola vez por cuenta y partida: una vez marcada, ya no se enseña; la siguiente partida sí", () => {
  withStorage(() => {
    const last = { matchId: ID, at: NOW, movement: M(1030, 1052, 8) };
    const seenA = (m: string) => rankCeremonySeen(UA, m);
    assert.equal(shouldShowLastRanked(last, NOW, seenA), true);
    markRankCeremonySeen(UA, ID);
    assert.equal((globalThis as unknown as { window: { localStorage: { getItem: (k: string) => string | null } } }).window.localStorage.getItem(`drl:rank-ceremony:${UA}:${ID}`), "1");
    assert.equal(rankCeremonySeen(UA, ID), true);
    assert.equal(shouldShowLastRanked(last, NOW, seenA), false);
    assert.equal(shouldShowLastRanked({ ...last, matchId: "99999999-2222-4333-8444-555555555555" }, NOW, seenA), true, "otra partida posterior sí es nueva");
  });
  assert.equal(rankCeremonySeen(UA, ID), false, "sin navegador no hay marca");
});

test("LR-2b · AISLAMIENTO: dos cuentas que se enfrentaron (misma partida) en el mismo navegador ven cada una SU ceremonia", () => {
  withStorage(() => {
    markRankCeremonySeen(UA, ID);
    assert.equal(rankCeremonySeen(UA, ID), true);
    assert.equal(rankCeremonySeen(UB, ID), false, "A no le oculta la ceremonia a B");
    assert.equal(shouldShowLastRanked({ matchId: ID, at: NOW, movement: M(952, 940, 9) }, NOW, (m) => rankCeremonySeen(UB, m)), true);
  });
});

test("LR-2c · sin cuenta conocida no se enseña ni se marca nada", () => {
  withStorage(() => {
    assert.equal(rankCeremonySeen(null, ID), true, "sin cuenta se da por vista");
    markRankCeremonySeen(null, ID);
    assert.equal((globalThis as unknown as { window: { localStorage: { getItem: (k: string) => string | null } } }).window.localStorage.getItem(`drl:rank-ceremony:null:${ID}`), null);
  });
});

test("LR-3 · el componente decide y marca con la cuenta de la sesión, al enseñarla (también con movimiento reducido)", () => {
  const src = code(read("src", "components", "competitive", "ranked", "LastRankedResult.tsx"));
  assert.ok(src.includes("shouldShowLastRanked(last, serverNow, (m) => rankCeremonySeen(userKey, m))"));
  assert.ok(src.includes("readPositionDelta(userKey, last.matchId)"), "el cambio de puesto también es de esta cuenta");
  assert.ok(src.includes("useEffect(() => { if (shown) markRankCeremonySeen(shown.userKey, shown.matchId); }, [shown]);"));
  assert.ok(src.includes("if (!shown || !last || shown.userKey !== userKey || last.matchId !== shown.matchId) return null;"), "al cambiar de cuenta no se queda la de la anterior");
  assert.ok(read("src", "app", "competitivo", "page.tsx").includes("userKey={uid}"));
});

test("LR-4 · en servidor (sin navegador) no pinta nada: ni destello ni desajuste de hidratación", () => {
  const h = renderToStaticMarkup(<LastRankedResult last={{ matchId: ID, at: NOW, movement: M(1030, 1052, 8) }} serverNow={NOW} userKey={UA} />);
  assert.equal(h, "");
});

test("LR-4b · límite de 48 h: justo dentro se enseña, justo fuera no; una fecha futura imposible tampoco", () => {
  const mv = M(1030, 1052, 8), never = () => false;
  assert.equal(shouldShowLastRanked({ matchId: ID, at: NOW - LAST_RANKED_MAX_AGE_MS, movement: mv }, NOW, never), true);
  assert.equal(shouldShowLastRanked({ matchId: ID, at: NOW - LAST_RANKED_MAX_AGE_MS - 1, movement: mv }, NOW, never), false);
  assert.equal(shouldShowLastRanked({ matchId: ID, at: Number.NaN, movement: mv }, NOW, never), false);
  assert.equal(shouldShowLastRanked({ matchId: ID, at: NOW + 3_600_000, movement: mv }, NOW, never), false);
  assert.equal(LAST_RANKED_MAX_AGE_MS, 48 * 60 * 60 * 1000);
});

/* ───────────── colocación, ascenso, descenso (del asiento) ───────────── */

test("LR-5 · la ceremonia distingue colocación en curso, rango obtenido, ascenso, descenso y misma división", () => {
  const kinds: [RankMovement, string, RegExp][] = [
    [M(1000, 1020, 3), "PLACEMENT_PROGRESS", /Colocación/],
    [M(1060, 1080, 5), "PLACEMENT_COMPLETE", /Veterano II/],
    [M(1030, 1052, 8), "PROMOTION", /Ascenso/],
    [M(952, 940, 9), "DEMOTION", /Descenso/],
    [M(1001, 1009, 9), "SAME", /Titular II/],
  ];
  for (const [m, kind, re] of kinds) {
    assert.equal(m.kind, kind);
    const h = renderToStaticMarkup(<RankChange movement={m} matchId={ID} />);
    assert.ok(h.includes(`data-kind="${kind}"`), kind);
    assert.match(text(h), re, kind);
  }
});

/* ───────────── cambio de puesto ───────────── */

test("LR-6 · el cambio de puesto se dice con el dato de la sesión; sin dato no se inventa", () => {
  const promo = M(1030, 1052, 8);
  const say = (positions: number | null, position: number | null) => text(renderToStaticMarkup(<RankChange movement={promo} matchId={ID} positions={positions} position={position} />));
  assert.match(say(5, 9), /Subes 5 puestos en el Top \(#9\)/);
  assert.match(say(1, 9), /Subes 1 puesto en el Top \(#9\)/);
  assert.match(say(-3, 12), /Bajas 3 puestos en el Top \(#12\)/);
  assert.match(say(0, 9), /Mantienes el #9 del Top/);
  assert.ok(!/puesto|Mantienes/.test(say(null, null)), "sin las dos fotos no hay línea de puestos");
  assert.ok(!/puesto|Mantienes/.test(say(5, null)));
});

/* ───────────── contratos: solo lectura y montaje ───────────── */

test("LR-7 · el centro Competitivo monta la ceremonia con el dato del servidor", () => {
  assert.ok(read("src", "components", "competitive", "ranked", "RankedCenter.tsx").includes("<LastRankedResult last={snap.lastRanked} serverNow={snap.serverNow} userKey={userKey} />"));
  const comp = read("src", "server", "services", "competitive.ts");
  assert.ok(comp.includes("getLatestRankMovement(sb, userId).catch(() => null)"), "si la lectura falla, no hay ceremonia (nunca se inventa)");
  assert.ok(/lastRanked,\n\s*\}\);/.test(comp));
});

test("LR-8 · el servidor solo LEE el último asiento y usa la misma función pura que la ruta PvP (no calcula ni toca el rating)", () => {
  const svc = read("src", "server", "services", "duelsRating.ts");
  const latest = svc.slice(svc.indexOf("export async function getLatestRankMovement"), svc.indexOf("export async function getMatchRatingOutcome"));
  assert.ok(latest.includes('.from("duel_pvp_rating_events")') && latest.includes(".select(") && latest.includes('.order("created_at", { ascending: false }).limit(1)'));
  for (const w of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) assert.ok(!latest.includes(w), `sin ${w}`);
  const helper = svc.slice(svc.indexOf("async function rankMovementOfEvent"), svc.indexOf("export async function getLatestRankMovement"));
  for (const w of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc("]) assert.ok(!helper.includes(w), `sin ${w}`);
  assert.equal((svc.match(/rankMovement\(\{/g) ?? []).length, 1, "un solo sitio deriva el movimiento del asiento");
  const outcome = svc.slice(svc.indexOf("export async function getMatchRatingOutcome"));
  assert.ok(outcome.includes("const rank = await rankMovementOfEvent(sb, r);"), "la ruta PvP usa el mismo cálculo");
});
