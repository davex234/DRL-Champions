/**
 * BRACKET ENGINE — single/double elim, swiss, round robin, groups (Online Fase 6/7).
 *
 * Construye los fixtures + el cableado de avance; `advanceFixture` propaga INCREMENTALMENTE (sin
 * recalcular el torneo). SEGURIDAD: sin equipos duplicados en un fixture, sin avanzar eliminados,
 * sin partidos imposibles. PURO. DETERMINISTA.
 */
import type { Team, Bracket, Fixture, FixtureStage, SeriesFormat } from "./types";
import { newSeries } from "./series";
import { bracketSeedOrder } from "./seed";

const nextPow2 = (n: number): number => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)));

function blank(id: string, stage: FixtureStage, round: number, format: SeriesFormat, label: string): Fixture {
  return { id, stage, round, group: null, slotA: null, slotB: null, series: newSeries(format), winner: null, loser: null, status: "pending", winnerTo: null, loserTo: null, label };
}

function setSlot(b: Bracket, fixtureId: string, slot: "A" | "B", teamId: string): void {
  const f = b.fixtures[fixtureId]; if (!f) return;
  if (slot === "A") f.slotA = teamId; else f.slotB = teamId;
  if (f.slotA && f.slotB && f.status === "pending") f.status = "ready";
}

/** Byes de la primera ronda: si un fixture inicial tiene un solo equipo, ese equipo avanza. */
function resolveByes(b: Bracket): void {
  let changed = true, guard = 0;
  while (changed && guard++ < 100) {
    changed = false;
    for (const f of Object.values(b.fixtures)) {
      if (f.status !== "pending" || f.round !== 1) continue;
      const hasA = !!f.slotA, hasB = !!f.slotB;
      if (hasA !== hasB) { // exactamente uno
        f.winner = (f.slotA ?? f.slotB)!; f.status = "bye";
        if (f.winnerTo) setSlot(b, f.winnerTo.fixtureId, f.winnerTo.slot, f.winner);
        changed = true;
      }
    }
  }
}
function markReady(b: Bracket): void { for (const f of Object.values(b.fixtures)) if (f.status === "pending" && f.slotA && f.slotB) f.status = "ready"; }

// ───────────────────────────── Single elimination ─────────────────────────────
export function buildSingleElim(teams: Team[], format: SeriesFormat, bronze = true): Bracket {
  const size = nextPow2(teams.length);
  const rounds = Math.max(1, Math.log2(size));
  const seededPositions = bracketSeedOrder(size);
  const seeds = seededPositions.map((p) => teams[p - 1]?.id ?? null);
  const b: Bracket = { format: "single_elim", fixtures: {}, order: [], rounds, groups: {}, finalId: null };
  const grid: string[][] = [];
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    const ids: string[] = [];
    for (let i = 0; i < count; i++) { const id = `se-r${r}-${i}`; const stage: FixtureStage = r === rounds ? "final" : r === rounds - 1 ? "semifinal" : "playoff"; b.fixtures[id] = blank(id, stage, r, format, `Ronda ${r} #${i + 1}`); b.order.push(id); ids.push(id); }
    grid.push(ids);
  }
  for (let i = 0; i < size / 2; i++) { setSlot(b, grid[0][i], "A", seeds[i * 2] ?? ""); setSlot(b, grid[0][i], "B", seeds[i * 2 + 1] ?? ""); if (!seeds[i * 2]) b.fixtures[grid[0][i]].slotA = null; if (!seeds[i * 2 + 1]) b.fixtures[grid[0][i]].slotB = null; }
  for (let r = 0; r < rounds - 1; r++) for (let i = 0; i < grid[r].length; i++) b.fixtures[grid[r][i]].winnerTo = { fixtureId: grid[r + 1][Math.floor(i / 2)], slot: i % 2 === 0 ? "A" : "B" };
  b.finalId = grid[rounds - 1][0];
  if (bronze && rounds >= 2) { const bid = "se-bronze"; b.fixtures[bid] = blank(bid, "bronze", rounds, format, "Bronce"); b.order.push(bid); b.fixtures[grid[rounds - 2][0]].loserTo = { fixtureId: bid, slot: "A" }; b.fixtures[grid[rounds - 2][1]].loserTo = { fixtureId: bid, slot: "B" }; }
  resolveByes(b); markReady(b);
  return b;
}

// ───────────────────────────── Double elimination (potencia de 2) ─────────────────────────────
export function buildDoubleElim(teams: Team[], format: SeriesFormat): Bracket {
  const size = nextPow2(teams.length);
  const k = Math.max(1, Math.log2(size));
  const seeds = bracketSeedOrder(size).map((p) => teams[p - 1]?.id ?? null);
  const b: Bracket = { format: "double_elim", fixtures: {}, order: [], rounds: k, groups: {}, finalId: null };
  const ub: string[][] = [];
  for (let r = 0; r < k; r++) { const cnt = size / 2 ** (r + 1); const ids: string[] = []; for (let i = 0; i < cnt; i++) { const id = `ub-r${r + 1}-${i}`; b.fixtures[id] = blank(id, "upper", r + 1, format, `Upper R${r + 1} #${i + 1}`); b.order.push(id); ids.push(id); } ub.push(ids); }
  for (let i = 0; i < size / 2; i++) { setSlot(b, ub[0][i], "A", seeds[i * 2] ?? ""); setSlot(b, ub[0][i], "B", seeds[i * 2 + 1] ?? ""); }
  for (let r = 0; r < k - 1; r++) for (let i = 0; i < ub[r].length; i++) b.fixtures[ub[r][i]].winnerTo = { fixtureId: ub[r + 1][Math.floor(i / 2)], slot: i % 2 === 0 ? "A" : "B" };
  // Lower bracket.
  let lbRound = 0;
  const mk = (cnt: number): string[] => { lbRound++; const ids: string[] = []; for (let i = 0; i < cnt; i++) { const id = `lb-r${lbRound}-${i}`; b.fixtures[id] = blank(id, "lower", lbRound, format, `Lower R${lbRound} #${i + 1}`); b.order.push(id); ids.push(id); } return ids; };
  let lbPrev: string[] = [];
  if (k >= 2) {
    lbPrev = mk(size / 4);
    for (let i = 0; i < ub[0].length; i++) b.fixtures[ub[0][i]].loserTo = { fixtureId: lbPrev[Math.floor(i / 2)], slot: i % 2 === 0 ? "A" : "B" };
    for (let r = 1; r < k; r++) {
      const major = mk(ub[r].length);
      for (let i = 0; i < ub[r].length; i++) { b.fixtures[lbPrev[i]].winnerTo = { fixtureId: major[i], slot: "A" }; b.fixtures[ub[r][i]].loserTo = { fixtureId: major[i], slot: "B" }; }
      if (major.length > 1) { const minor = mk(major.length / 2); for (let i = 0; i < major.length; i++) b.fixtures[major[i]].winnerTo = { fixtureId: minor[Math.floor(i / 2)], slot: i % 2 === 0 ? "A" : "B" }; lbPrev = minor; }
      else lbPrev = major;
    }
  }
  const gf = "de-gf"; b.fixtures[gf] = blank(gf, "grandfinal", k + 1, format, "Gran Final"); b.order.push(gf);
  b.fixtures[ub[k - 1][0]].winnerTo = { fixtureId: gf, slot: "A" };
  if (lbPrev.length) b.fixtures[lbPrev[0]].winnerTo = { fixtureId: gf, slot: "B" };
  b.finalId = gf;
  markReady(b);
  return b;
}

// ───────────────────────────── Round robin ─────────────────────────────
export function buildRoundRobin(teams: Team[], format: SeriesFormat): Bracket {
  const b: Bracket = { format: "round_robin", fixtures: {}, order: [], rounds: 1, groups: {}, finalId: null };
  let idx = 0;
  for (let i = 0; i < teams.length; i++) for (let j = i + 1; j < teams.length; j++) { const id = `rr-${idx++}`; const f = blank(id, "rr", 1, format, `${teams[i].name} vs ${teams[j].name}`); f.slotA = teams[i].id; f.slotB = teams[j].id; f.status = "ready"; b.fixtures[id] = f; b.order.push(id); }
  return b;
}

// ───────────────────────────── Swiss (incremental) ─────────────────────────────
export function buildSwissRound1(teams: Team[], totalRounds: number, format: SeriesFormat): Bracket {
  const b: Bracket = { format: "swiss", fixtures: {}, order: [], rounds: totalRounds, groups: {}, finalId: null };
  const s = [...teams].sort((a, x) => a.seed - x.seed);
  const half = Math.floor(s.length / 2);
  for (let i = 0; i < half; i++) { const id = `sw-r1-${i}`; const f = blank(id, "swiss", 1, format, `Swiss R1 #${i + 1}`); f.slotA = s[i].id; f.slotB = s[i + half].id; f.status = "ready"; b.fixtures[id] = f; b.order.push(id); }
  return b;
}
/** Genera la siguiente ronda suiza emparejando por puntuación y evitando revanchas. Determinista. */
export function nextSwissRound(b: Bracket, teams: Team[], round: number): Fixture[] {
  const score = new Map<string, number>(); const played = new Set<string>();
  for (const t of teams) score.set(t.id, 0);
  for (const f of Object.values(b.fixtures)) if (f.status === "done" || f.status === "bye") { if (f.winner) score.set(f.winner, (score.get(f.winner) ?? 0) + 1); if (f.slotA && f.slotB) played.add([f.slotA, f.slotB].sort().join("|")); }
  const pool = [...teams].sort((a, x) => (score.get(x.id) ?? 0) - (score.get(a.id) ?? 0) || a.seed - x.seed).map((t) => t.id);
  const used = new Set<string>(); const created: Fixture[] = []; let i = 0, idx = 0;
  while (i < pool.length) {
    const a = pool[i]; if (used.has(a)) { i++; continue; }
    let partner: string | null = null;
    for (let j = i + 1; j < pool.length; j++) { const cand = pool[j]; if (used.has(cand)) continue; if (played.has([a, cand].sort().join("|"))) continue; partner = cand; break; }
    if (!partner) for (let j = i + 1; j < pool.length; j++) { if (!used.has(pool[j])) { partner = pool[j]; break; } } // fallback: permite revancha si no hay otra
    if (!partner) break;
    const id = `sw-r${round}-${idx++}`; const f = blank(id, "swiss", round, b.fixtures[Object.keys(b.fixtures)[0]]?.series.format ?? "bo1", `Swiss R${round} #${idx}`);
    f.slotA = a; f.slotB = partner; f.status = "ready"; b.fixtures[id] = f; b.order.push(id); created.push(f);
    used.add(a); used.add(partner); i++;
  }
  return created;
}

// ───────────────────────────── Groups → playoffs ─────────────────────────────
export function buildGroupStage(teams: Team[], groupCount: number, format: SeriesFormat): Bracket {
  const b: Bracket = { format: "groups", fixtures: {}, order: [], rounds: 1, groups: {}, finalId: null };
  const seeded = [...teams].sort((a, x) => a.seed - x.seed);
  const groups: Record<string, string[]> = {};
  seeded.forEach((t, i) => { const g = `G${(i % groupCount) + 1}`; (groups[g] ??= []).push(t.id); }); // snake por semilla
  b.groups = groups;
  let idx = 0;
  for (const [g, ids] of Object.entries(groups)) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const id = `grp-${idx++}`; const f = blank(id, "group", 1, format, `${g}`); f.group = g; f.slotA = ids[i]; f.slotB = ids[j]; f.status = "ready"; b.fixtures[id] = f; b.order.push(id); }
  return b;
}

// ───────────────────────────── Avance + consultas ─────────────────────────────
export function advanceFixture(b: Bracket, fixtureId: string, winner: string, loser: string): { ok: boolean; error?: string } {
  const f = b.fixtures[fixtureId]; if (!f) return { ok: false, error: "no-fixture" };
  if (f.status === "done" || f.status === "bye") return { ok: false, error: "already-resolved" };
  if (winner !== f.slotA && winner !== f.slotB) return { ok: false, error: "invalid-winner" };   // SEGURIDAD: solo un participante gana
  f.winner = winner; f.loser = loser; f.status = "done";
  if (f.winnerTo) setSlot(b, f.winnerTo.fixtureId, f.winnerTo.slot, winner);
  if (f.loserTo) setSlot(b, f.loserTo.fixtureId, f.loserTo.slot, loser);
  return { ok: true };
}
export function readyFixtures(b: Bracket): Fixture[] { return Object.values(b.fixtures).filter((f) => f.status === "ready"); }
export function pendingCount(b: Bracket): number { return Object.values(b.fixtures).filter((f) => f.status === "pending" || f.status === "ready").length; }
