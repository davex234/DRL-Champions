/**
 * F87 · DESCRIPTOR DE FORMATO — fixtures aislados de los seis formatos exigidos, propiedades del grafo
 * (sin ciclos, huecos resolubles, un camino de ganador, perdedores válidos, ningún equipo en dos huecos
 * simultáneos, final alcanzable) y validación contra el evento REAL de Champions 2026 (snapshot).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalDescriptor, deriveFormat, descendantsOf, detectFormat, hasBlockingIssues, slotSources, topoOrder, validateFormat,
  type FormatDescriptor, type RealMatchRow, type StageRow,
} from "./format";
import { fillBracket, predictedParticipants, realStateOf } from "./prediction";
import { de8, gsl1, gsl2Playoffs, rrPlayoffs, se4, se8, type Fixture } from "./testing/formatFixtures";
import snapshot from "./fixtures/vlr-2766-champions-2026.snapshot.json";

const derive = (f: Fixture, eventId = "evt-test") => deriveFormat({ eventId, stages: f.stages, matches: f.matches, adminEdges: f.adminEdges });
const errors = (r: ReturnType<typeof derive>) => r.issues.filter((i) => i.severity === "ERROR");

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Propiedades que todo descriptor publicable debe cumplir, comprobadas con N cuadros completos aleatorios. */
function assertGraphProperties(d: FormatDescriptor, real: RealMatchRow[], runs = 300) {
  const order = topoOrder(d);
  assert.ok(order, "sin ciclos");
  // Un camino de ganador y como mucho uno de perdedor por partido.
  for (const n of d.nodes) {
    assert.ok(d.edges.filter((e) => e.from === n.matchId && e.source === "WINNER").length <= 1, `un camino de ganador (${n.matchId})`);
    assert.ok(d.edges.filter((e) => e.from === n.matchId && e.source === "LOSER").length <= 1, `un camino de perdedor (${n.matchId})`);
  }
  const ctx = { descriptor: d, real: realStateOf(real) };
  for (let s = 0; s < runs; s++) {
    const r = rng(1000 + s);
    const picks = fillBracket(ctx, (_id, pair) => (r() < 0.5 ? pair[0].id : pair[1].id));
    const pairs = predictedParticipants(ctx, picks);
    // Todos los huecos se resuelven y todos los partidos quedan predichos.
    for (const n of d.nodes) {
      const p = pairs.get(n.matchId)!;
      assert.ok(p[0] && p[1], `huecos resueltos en ${n.matchId}`);
      assert.notEqual(p[0]!.id, p[1]!.id, `dos equipos distintos en ${n.matchId}`);
      assert.ok(picks[n.matchId], `pick en ${n.matchId}`);
    }
    // Ningún equipo en dos partidos de la misma columna de la misma sección (huecos simultáneos).
    // En todos contra todos no hay columnas: cada partido es independiente.
    const seen = new Map<string, string>();
    if (d.kind !== "ROUND_ROBIN") for (const n of d.nodes) for (const t of pairs.get(n.matchId)!) {
      const k = `${n.section}#${n.column}#${n.role === "ELIMINATION" ? "e" : ""}:${t!.id}`;
      assert.ok(!seen.has(k), `${t!.id} en dos huecos simultáneos (${seen.get(k)} y ${n.matchId})`);
      seen.set(k, n.matchId);
    }
    // Cada equipo pierde como mucho: 1 vez (simple), 2 veces (doble/GSL). Ganador efectivo = el real si
    // ya lo hay (el cuadro se cura con la realidad), si no el pick.
    const losses = new Map<string, number>();
    if (d.kind !== "ROUND_ROBIN") for (const n of d.nodes) {
      const p = pairs.get(n.matchId)!; const w = ctx.real.get(n.matchId)?.final ? ctx.real.get(n.matchId)!.winnerId! : picks[n.matchId];
      const loser = p[0]!.id === w ? p[1]!.id : p[0]!.id;
      losses.set(loser, (losses.get(loser) ?? 0) + 1);
    }
    const cap = d.kind === "SINGLE_ELIMINATION" ? 1 : 2;
    for (const [t, l] of losses) assert.ok(l <= cap, `${t} pierde ${l} veces`);
  }
}

test("detecta los formatos por fases y rondas reales (nunca por el nombre del torneo)", () => {
  assert.equal(detectFormat(se4().stages, se4().matches), "SINGLE_ELIMINATION");
  assert.equal(detectFormat(se8().stages, se8().matches), "SINGLE_ELIMINATION");
  assert.equal(detectFormat(de8().stages, de8().matches), "DOUBLE_ELIMINATION");
  assert.equal(detectFormat(gsl1().stages, gsl1().matches), "GSL_GROUPS");
  assert.equal(detectFormat(rrPlayoffs().groups.stages, rrPlayoffs().groups.matches), "ROUND_ROBIN");
  assert.equal(detectFormat([{ id: "s", name: "Swiss", kind: "swiss" }], se4().matches), "SWISS");
});

test("SWISS no se soporta: error de formato, sin descriptor (no se finge)", () => {
  const r = deriveFormat({ eventId: "e", stages: [{ id: "s", name: "Swiss", kind: "swiss" }], matches: se4().matches });
  assert.equal(r.descriptor, null);
  assert.ok(r.issues.some((i) => i.code === "FORMAT_UNSUPPORTED"));
});

test("eliminación simple a 4: final derivada única, puntos 1/3, sin perdedores", () => {
  const r = derive(se4());
  assert.deepEqual(errors(r), []);
  const d = r.descriptor!;
  assert.equal(d.kind, "SINGLE_ELIMINATION");
  assert.equal(d.edges.length, 2);
  assert.ok(d.edges.every((e) => e.source === "WINNER" && e.origin === "SOURCE"));
  assert.deepEqual(d.nodes.map((n) => n.points), [1, 1, 3]);
  assertGraphProperties(d, se4().matches);
});

test("eliminación simple a 8: 7 partidos; la final se deriva (única) donde la fuente calla", () => {
  const r = derive(se8());
  assert.deepEqual(errors(r), []);
  const d = r.descriptor!;
  assert.equal(d.nodes.length, 7);
  assert.equal(d.edges.filter((e) => e.origin === "FORMAT_DERIVED").length, 2);
  assert.deepEqual(d.nodes.map((n) => n.points), [1, 1, 1, 1, 2, 2, 4]);
  assertGraphProperties(d, se8().matches);
});

test("doble a 8: sin los cruces de perdedores NO se puede publicar (ambiguo → admin)", () => {
  const r = derive(de8(false));
  const codes = errors(r).map((e) => e.code);
  assert.ok(codes.includes("LOSER_MISSING"), "faltan perdedores del cuadro alto");
  assert.ok(codes.includes("SLOT_UNKNOWN"), "huecos del cuadro bajo sin origen");
  // Lo único que el formato determina sí se deriva: GF ← UF y LF; LF ← perdedor de UF.
  const derived = r.descriptor!.edges.filter((e) => e.origin === "FORMAT_DERIVED").map((e) => `${e.from}>${e.to}:${e.source}`).sort();
  assert.deepEqual(derived, ["de-lf>de-gf:WINNER", "de-uf>de-gf:WINNER", "de-uf>de-lf:LOSER"]);
});

test("doble a 8 con aristas de admin: publicable, propiedades del grafo, puntos 1..5", () => {
  const r = derive(de8());
  assert.deepEqual(errors(r), []);
  const d = r.descriptor!;
  assert.equal(d.nodes.length, 14);
  assert.equal(d.edges.filter((e) => e.origin === "ADMIN").length, 6);
  const pts = Object.fromEntries(d.nodes.map((n) => [n.matchId, n.points]));
  assert.deepEqual([pts["de-uqf1"], pts["de-usf1"], pts["de-uf"], pts["de-lr1a"], pts["de-lr2a"], pts["de-lr3"], pts["de-lf"], pts["de-gf"]], [1, 2, 3, 1, 2, 2, 3, 5]);
  assert.equal(d.nodes.reduce((s, n) => s + n.points, 0), 27);
  assertGraphProperties(d, de8().matches);
});

test("el admin no puede contradecir a la fuente", () => {
  const f = de8();
  f.adminEdges = [...f.adminEdges!, { from: "de-uqf1", to: "de-usf2", source: "WINNER", slot: 1 }];
  assert.ok(errors(derive(f)).some((e) => e.code === "ADMIN_CONTRADICTS_SOURCE"));
});

test("GSL de un grupo: perdedores de Apertura → Eliminación y de Ganadores → Decisivo derivados; 2 plazas", () => {
  const r = derive(gsl1());
  assert.deepEqual(errors(r), []);
  const d = r.descriptor!;
  assert.equal(d.kind, "GSL_GROUPS");
  assert.deepEqual(d.nodes.map((n) => n.role), ["OPENING", "OPENING", "WINNERS", "ELIMINATION", "DECIDER"]);
  assert.equal(d.edges.filter((e) => e.origin === "FORMAT_DERIVED").length, 3);
  assert.equal(d.qualifications.length, 2);
  assert.deepEqual(d.nodes.map((n) => n.points), [1, 1, 2, 1, 2]);
  assertGraphProperties(d, gsl1().matches);
});

test("dos grupos GSL → playoffs: dos ámbitos; el playoff publicable con semillas por definir (aviso, no error)", () => {
  const f = gsl2Playoffs();
  const g = derive(f.groups);
  assert.deepEqual(errors(g), []);
  assert.equal(g.descriptor!.sections.map((s) => s.label).join(","), "Grupo A,Grupo B");
  assertGraphProperties(g.descriptor!, f.groups.matches);
  const p = derive(f.playoffs);
  assert.deepEqual(errors(p), []);
  assert.equal(p.issues.filter((i) => i.code === "SEED_PENDING").length, 2);
  // Ningún grupo alimenta a otro.
  for (const e of g.descriptor!.edges) {
    const a = g.descriptor!.nodes.find((n) => n.matchId === e.from)!, b = g.descriptor!.nodes.find((n) => n.matchId === e.to)!;
    assert.equal(a.section, b.section);
  }
});

test("todos contra todos → playoffs: partidos independientes, 1 punto, sin aristas", () => {
  const f = rrPlayoffs();
  const r = derive(f.groups);
  assert.deepEqual(errors(r), []);
  assert.equal(r.descriptor!.kind, "ROUND_ROBIN");
  assert.equal(r.descriptor!.edges.length, 0);
  assert.ok(r.descriptor!.nodes.every((n) => n.points === 1));
  assertGraphProperties(r.descriptor!, f.groups.matches);
  assert.deepEqual(errors(derive(f.playoffs)), []);
});

test("validador: ciclo, duplicado, hueco doble, partido inexistente, fecha al revés, sin fecha", () => {
  const d = derive(de8()).descriptor!;
  const real = de8().matches;
  const codes = (x: FormatDescriptor, r: RealMatchRow[] = real) => validateFormat(x, r).filter((i) => i.severity === "ERROR").map((i) => i.code);
  assert.ok(codes({ ...d, edges: [...d.edges, { from: "de-gf", to: "de-uqf1", source: "WINNER", slot: 1, origin: "ADMIN" }] }).includes("CYCLE"));
  assert.ok(codes({ ...d, nodes: [...d.nodes, d.nodes[0]] }).includes("DUPLICATE_MATCH"));
  assert.ok(codes({ ...d, edges: [...d.edges, { from: "de-lr1a", to: "de-usf1", source: "LOSER", slot: 1, origin: "ADMIN" }] }).includes("SLOT_TAKEN"));
  assert.ok(codes(d, real.filter((m) => m.id !== "de-gf")).includes("MATCH_MISSING"));
  assert.ok(codes(d, real.map((m) => (m.id === "de-gf" ? { ...m, start_time: "2029-01-01T00:00:00Z" } : m))).includes("DATE_ORDER"));
  assert.ok(codes(d, real.map((m) => (m.id === "de-gf" ? { ...m, start_time: null } : m))).includes("DATE_MISSING"));
  assert.ok(!hasBlockingIssues(validateFormat(d, real)));
});

test("el descriptor es determinista (misma entrada → misma huella)", () => {
  const a = canonicalDescriptor(derive(de8()).descriptor!);
  const f = de8(); f.matches = [...f.matches].reverse();
  assert.equal(canonicalDescriptor(derive(f).descriptor!), a);
});

test("descendientes: solo la rama dependiente", () => {
  const d = derive(de8()).descriptor!;
  const desc = descendantsOf(d, "de-uqf1");
  assert.ok(desc.has("de-usf1") && desc.has("de-lr1a") && desc.has("de-gf"));
  assert.ok(!desc.has("de-uqf2") && !desc.has("de-uqf3"));
  const slots = slotSources(d);
  assert.deepEqual(slots.get("de-uqf1"), [{ kind: "SEED", index: 1 }, { kind: "SEED", index: 2 }]);
});

/* ─────────────────────────── EVENTO REAL: Champions 2026 (vlr-2766) ─────────────────────────── */

const real = snapshot.matches as unknown as RealMatchRow[];
const stages = snapshot.stages as StageRow[];
const groupStage = stages.find((s) => s.kind === "group")!;
const playoffStage = stages.find((s) => s.kind === "playoff")!;

test("REAL · fase de grupos de Champions 2026: GSL de 4 grupos, 20 partidos, aristas derivadas COHERENTES con los resultados reales", () => {
  const ms = real.filter((m) => m.stage_id === groupStage.id);
  assert.equal(ms.length, 20);
  const r = deriveFormat({ eventId: "vlr-2766", stages: [groupStage], matches: ms });
  assert.deepEqual(r.issues.filter((i) => i.severity === "ERROR"), [], JSON.stringify(r.issues));
  const d = r.descriptor!;
  assert.equal(d.kind, "GSL_GROUPS");
  assert.deepEqual(d.sections.map((s) => s.label), ["Grupo A", "Grupo B", "Grupo C", "Grupo D"]);
  assert.equal(d.edges.filter((e) => e.origin === "SOURCE").length, 12, "8 Apertura→Ganadores + 4 Eliminación→Decisivo de la fuente");
  assert.equal(d.edges.filter((e) => e.origin === "FORMAT_DERIVED").length, 12, "8 Apertura→Eliminación + 4 Ganadores→Decisivo derivadas");
  assert.equal(d.qualifications.length, 8);
  // La prueba de fuego: cada arista (de la fuente o derivada) lleva al equipo REAL al partido REAL.
  const rs = realStateOf(ms);
  for (const e of d.edges) {
    const from = rs.get(e.from)!, to = rs.get(e.to)!;
    const team = e.source === "WINNER" ? from.winnerId : from.loserId;
    assert.ok(team && (to.teamA?.id === team || to.teamB?.id === team), `${e.from} ${e.source} → ${e.to}: ${team} no está en ${to.teamA?.name} vs ${to.teamB?.name}`);
  }
  // Y el cuadro predicho «curado» con la realidad reproduce exactamente los cruces reales.
  const pairs = predictedParticipants({ descriptor: d, real: rs }, {});
  for (const n of d.nodes) {
    const p = pairs.get(n.matchId)!, rr = rs.get(n.matchId)!;
    assert.deepEqual(new Set([p[0]?.id, p[1]?.id]), new Set([rr.teamA?.id, rr.teamB?.id]), n.matchId);
  }
  assertGraphProperties(d, ms, 50);
});

test("REAL · playoffs de Champions 2026: doble a 8; la fuente NO publica los perdedores → borrador, no publicable sin admin", () => {
  const ms = real.filter((m) => m.stage_id === playoffStage.id);
  assert.equal(ms.length, 14);
  const r = deriveFormat({ eventId: "vlr-2766", stages: [playoffStage], matches: ms });
  const d = r.descriptor!;
  assert.equal(d.kind, "DOUBLE_ELIMINATION");
  assert.equal(d.edges.filter((e) => e.origin === "SOURCE").length, 11, "4 cuartos→semis, 2 semis→final alta, 2 LR1→LR2, 2 LR2→LR3, LR3→final baja");
  assert.deepEqual(d.edges.filter((e) => e.origin === "FORMAT_DERIVED").map((e) => `${e.from}>${e.to}:${e.source}`).sort(), ["754736>754737:WINNER", "754736>754743:LOSER", "754743>754737:WINNER"]);
  const missingLosers = r.issues.filter((i) => i.code === "LOSER_MISSING").map((i) => i.matchId).sort();
  assert.deepEqual(missingLosers, ["754730", "754731", "754732", "754733", "754734", "754735"], "4 cuartos + 2 semis altas sin destino del perdedor");
  assert.ok(hasBlockingIssues(r.issues));
  // Los cuartos ya tienen equipos reales (semillas) y se pueden predecir.
  const uqf = d.nodes.filter((n) => n.section === "upper" && n.column === 0);
  assert.equal(uqf.length, 4);
  assert.ok(uqf.every((n) => n.seeds?.[0] && n.seeds?.[1]));
});
