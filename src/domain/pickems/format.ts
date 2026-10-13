/**
 * F87 · PICK'EMS 2.0 — EL DESCRIPTOR DE FORMATO (funciones PURAS).
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * La representación canónica de UN ámbito de predicción (una fase de un evento real): sus
 * partidos REALES (`matches.id`) colocados en secciones (cuadro alto, bajo, gran final, grupo A…),
 * columnas y filas, y las ARISTAS que dicen adónde va el ganador y adónde cae el perdedor de cada
 * uno. Es lo que se CONGELA al publicar: todos los jugadores de un ámbito compiten con el mismo
 * grafo, los mismos puntos y los mismos cierres.
 *
 * No es un segundo modelo de torneos: los nodos son filas de `public.matches` y las aristas de
 * origen son las de la migración 0045 (`winner_to_match_id`/`loser_to_match_id`, solo CONFIRMED).
 * `buildBracketModel` (24.3/24.4) sigue siendo el cuadro REAL; esto es el grafo que necesita la
 * PREDICCIÓN, que tiene que propagar ganadores y perdedores por huecos que aún están «Por definir».
 *
 * ────────────────────────── DE DÓNDE SALE CADA ARISTA ──────────────────────────
 *
 *   SOURCE          la fuente la publica (0045). Manda siempre.
 *   FORMAT_DERIVED  la impone el formato SIN ambigüedad: hay exactamente un candidato y un hueco
 *                   (la Gran Final la juegan el ganador de la Final alta y el de la Final baja; los
 *                   dos perdedores de Apertura de un grupo GSL juegan su único partido de
 *                   Eliminación…). Si hay dos candidatos posibles, NO se deriva.
 *   ADMIN           la define un administrador ANTES de publicar, sobre partidos reales, cuando la
 *                   fuente no la da y el formato no la determina (los cruces de perdedores de un
 *                   cuadro doble). Nunca crea resultados, equipos ni partidos.
 *
 * ────────────────────────── FORMATOS ──────────────────────────
 *
 *   SINGLE_ELIMINATION   ganador avanza, perdedor fuera.
 *   DOUBLE_ELIMINATION   cuadro alto + bajo + gran final; el perdedor de arriba cae abajo.
 *   GSL_GROUPS           grupos de 4 a doble eliminación: Apertura → Ganadores / Eliminación →
 *                        Decisivo; clasifican el ganador de Ganadores y el del Decisivo.
 *   ROUND_ROBIN          partidos independientes (sin grafo de avance). Se predice cada partido.
 *
 * SWISS no se soporta: los cruces de cada ronda dependen del balance de todos y no existen hasta que
 * se publican, así que no hay grafo que propagar. Se dice, no se finge (`UNSUPPORTED_FORMATS`).
 * Tampoco se propaga ENTRE fases (grupos → playoffs): la fuente no publica qué clasificado ocupa qué
 * hueco del playoff; cada fase es su propio ámbito y las semillas del playoff son los equipos reales.
 */
import { parseRound } from "./bracket";
import { isPlaceholderTeamName } from "./questions";

export const PICKEM_FORMAT_VERSION = 1 as const;
export const PICKEM_SCORING_VERSION = "pickem-scoring-v1" as const;

export type PickemFormatKind = "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "GSL_GROUPS" | "ROUND_ROBIN";
export const SUPPORTED_FORMATS: readonly PickemFormatKind[] = ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "GSL_GROUPS", "ROUND_ROBIN"];
export const UNSUPPORTED_FORMATS = ["SWISS"] as const;
export const FORMAT_LABEL: Record<PickemFormatKind, string> = {
  SINGLE_ELIMINATION: "Eliminación simple",
  DOUBLE_ELIMINATION: "Doble eliminación",
  GSL_GROUPS: "Grupos GSL",
  ROUND_ROBIN: "Todos contra todos",
};

export type EdgeOrigin = "SOURCE" | "FORMAT_DERIVED" | "ADMIN";
export type EdgeSource = "WINNER" | "LOSER";
export type Slot = 1 | 2;

export interface FormatEdge {
  from: string;
  to: string;
  source: EdgeSource;
  /** Hueco del destino; `null` = el formato no lo fija (se rellena en orden de alimentadores). */
  slot: Slot | null;
  origin: EdgeOrigin;
}

export interface FormatQualification {
  from: string;
  key: string;
  label: string;
  origin: EdgeOrigin;
}

export interface FormatSection { id: string; label: string; order: number }

export type GslRole = "OPENING" | "WINNERS" | "ELIMINATION" | "DECIDER";

export interface FormatNode {
  matchId: string;
  stageId: string | null;
  section: string;
  /** Solo en GSL: el papel del partido dentro del grupo. */
  role?: GslRole;
  roundLabel: string;
  column: number;
  row: number;
  bestOf: number;
  /** Puntos por acertar el ganador de este partido (congelados al publicar). */
  points: number;
  /** Equipos reales de los huecos de ENTRADA cuando se derivó (para detectar cambios de la fuente). */
  seeds: [string | null, string | null] | null;
}

export interface FormatDescriptor {
  version: typeof PICKEM_FORMAT_VERSION;
  kind: PickemFormatKind;
  eventId: string;
  stageIds: string[];
  sections: FormatSection[];
  nodes: FormatNode[];
  edges: FormatEdge[];
  qualifications: FormatQualification[];
}

/* ═══════════════════════════════ ENTRADA REAL ═══════════════════════════════ */

export interface TeamRef { id: string; name: string }

/** Una fila de `matches` con lo que el formato necesita. Los TBD llegan como `null`. */
export interface RealMatchRow {
  id: string;
  event_id?: string | null;
  stage_id: string | null;
  round: string | null;
  match_order: number | null;
  best_of?: number | null;
  status: string;
  start_time: string | null;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a?: string | null;
  team_b?: string | null;
  winner_team_id: string | null;
  score_a: number | null;
  score_b: number | null;
  winner_to_match_id?: string | null;
  winner_to_slot?: number | null;
  loser_to_match_id?: string | null;
  loser_to_slot?: number | null;
  winner_qualifies?: string | null;
  winner_qualifies_label?: string | null;
  progression_confidence?: string | null;
}

export interface StageRow { id: string; name: string; slug?: string | null; kind: string | null; order_idx?: number | null }

const TBD_ID = /(^|-)tbd$/i;
/** Un hueco sin equipo (TBD/TBA, id `vlr-t-tbd`) NO es un equipo. */
export function teamRef(id: string | null | undefined, name: string | null | undefined): TeamRef | null {
  if (!id || TBD_ID.test(id)) return null;
  if (isPlaceholderTeamName(name ?? id)) return null;
  return { id, name: (name ?? "").trim() || id };
}

/* ═══════════════════════════════ DETECCIÓN ═══════════════════════════════ */

const GSL_LABEL: Record<GslRole, string> = { OPENING: "Apertura", WINNERS: "Ganadores", ELIMINATION: "Eliminación", DECIDER: "Decisivo" };
const GSL_ROUND = /\b(opening|winner'?s?|elimination|decider)\b/i;
const groupOf = (raw: string | null): string | null => {
  const m = /\(([A-Za-z0-9]{1,3})\)\s*$/.exec(raw ?? "") ?? /\bgroup\s+([A-Za-z0-9]{1,3})\b/i.exec(raw ?? "");
  return m ? m[1].toUpperCase() : null;
};

/**
 * Formato de un ámbito según sus fases y rondas REALES. `null` = no se sabe (y no se adivina).
 * `SWISS` se devuelve para decirlo, aunque no se soporte.
 */
export function detectFormat(stages: StageRow[], matches: RealMatchRow[]): PickemFormatKind | "SWISS" | null {
  if (matches.length === 0) return null;
  const kinds = new Set(stages.map((s) => (s.kind ?? "").toLowerCase()));
  if (kinds.has("swiss")) return "SWISS";
  const rounds = matches.map((m) => m.round ?? "");
  if (rounds.every((r) => GSL_ROUND.test(r) && groupOf(r))) return "GSL_GROUPS";
  const infos = rounds.map((r) => parseRound(r));
  if (infos.some((i) => i.side === "lower")) return "DOUBLE_ELIMINATION";
  if (infos.every((i) => i.elimination && i.rank !== null)) return "SINGLE_ELIMINATION";
  if (kinds.size > 0 && [...kinds].every((k) => k === "group")) return "ROUND_ROBIN";
  return null;
}

/** Etiqueta en español de una ronda de eliminatoria (la fuente las publica en inglés). Solo presentación. */
export function elimRoundLabel(side: string, raw: string | null): string {
  const r = (raw ?? "").toLowerCase();
  const of = /round\s*of\s*(\d+)/.exec(r);
  const num = /round\s*(\d+)/.exec(r);
  const base = /grand\s*-?\s*final/.test(r) ? "Gran Final" : /quarter/.test(r) ? "Cuartos" : /semi/.test(r) ? "Semifinales"
    : /\bfinals?\b/.test(r) ? "Final" : of ? `Ronda de ${of[1]}` : num ? `Ronda ${num[1]}` : (raw ?? "Partido");
  if (side === "grand" || base === "Gran Final") return "Gran Final";
  if (side === "lower") return base === "Final" ? "Final baja" : `${base} · baja`;
  if (side === "upper") return base === "Final" ? "Final alta" : `${base} · alta`;
  return base;
}

/* ═══════════════════════════════ PUNTOS ═══════════════════════════════ */

/**
 * Puntos por partido — comprensibles y crecientes con la ronda, sin economía detrás (los puntos no se
 * canjean: solo ordenan y dan la proporción que decide el escalón de recompensa).
 *   eliminación simple: 1 + columna; la final, uno más («campeón»).
 *   doble: alto 1 + columna; bajo 1 + ⌈columna/2⌉; gran final = mejor de arriba + 2.
 *   GSL: Apertura y Eliminación 1; Ganadores y Decisivo 2 (deciden plaza).
 *   todos contra todos: 1.
 */
function pointsFor(kind: PickemFormatKind, section: string, column: number, upperColumns: number, terminal: boolean, role?: GslRole): number {
  switch (kind) {
    case "SINGLE_ELIMINATION": return 1 + column + (terminal ? 1 : 0);
    case "DOUBLE_ELIMINATION":
      if (section === "grand") return upperColumns + 2;
      if (section === "lower") return 1 + Math.ceil(column / 2);
      return 1 + column;
    case "GSL_GROUPS": return role === "WINNERS" || role === "DECIDER" ? 2 : 1;
    case "ROUND_ROBIN": return 1;
  }
}

/* ═══════════════════════════════ DERIVACIÓN ═══════════════════════════════ */

export interface DeriveInput {
  eventId: string;
  kind?: PickemFormatKind | null;
  stages: StageRow[];
  /** Partidos del ÁMBITO (ya filtrados por fase). */
  matches: RealMatchRow[];
  /** Aristas que el administrador definió en el borrador (solo donde la fuente calla). */
  adminEdges?: Omit<FormatEdge, "origin">[];
}

export interface DeriveResult {
  descriptor: FormatDescriptor | null;
  detected: PickemFormatKind | "SWISS" | null;
  issues: FormatIssue[];
}

const byOrder = (a: RealMatchRow, b: RealMatchRow) =>
  (a.match_order ?? 1e9) - (b.match_order ?? 1e9)
  || Date.parse(a.start_time ?? "") - Date.parse(b.start_time ?? "")
  || a.id.localeCompare(b.id);

const slotOf = (s: number | null | undefined): Slot | null => (s === 1 ? 1 : s === 2 ? 2 : null);

/**
 * Del estado real al descriptor. Puro y determinista: los mismos partidos dan el mismo grafo.
 * Nunca inventa partidos, equipos ni resultados; lo que no puede colocar lo devuelve como problema.
 */
export function deriveFormat(input: DeriveInput): DeriveResult {
  const detected = detectFormat(input.stages, input.matches);
  const kind = input.kind ?? (detected && detected !== "SWISS" ? detected : null);
  const issues: FormatIssue[] = [];
  if (detected === "SWISS" || !kind) {
    issues.push({ severity: "ERROR", code: detected === "SWISS" ? "FORMAT_UNSUPPORTED" : "FORMAT_UNKNOWN", message: detected === "SWISS" ? "Formato suizo: los cruces no existen hasta que se publican; no hay cuadro que predecir." : "No se reconoce el formato de estas fases." });
    return { descriptor: null, detected, issues };
  }

  const matches = [...input.matches].sort(byOrder);
  const nodes: FormatNode[] = [];
  const sections = new Map<string, FormatSection>();
  const addSection = (id: string, label: string, order: number) => { if (!sections.has(id)) sections.set(id, { id, label, order }); };

  if (kind === "GSL_GROUPS") {
    for (const m of matches) {
      const g = groupOf(m.round) ?? "?";
      const r = (m.round ?? "").toLowerCase();
      const isOpening = /opening/.test(r), isWinners = /winner/.test(r), isElim = /elimination/.test(r), isDecider = /decider/.test(r);
      const role: GslRole | null = isOpening ? "OPENING" : isWinners ? "WINNERS" : isElim ? "ELIMINATION" : isDecider ? "DECIDER" : null;
      if (!role) { issues.push({ severity: "ERROR", code: "ROUND_UNKNOWN", matchId: m.id, message: `Ronda GSL no reconocida: «${m.round ?? ""}».` }); continue; }
      addSection(`group:${g}`, `Grupo ${g}`, g.charCodeAt(0));
      nodes.push({
        matchId: m.id, stageId: m.stage_id, section: `group:${g}`, role, roundLabel: GSL_LABEL[role],
        column: role === "OPENING" ? 0 : role === "DECIDER" ? 2 : 1, row: 0, bestOf: m.best_of ?? 3, points: 0, seeds: null,
      });
    }
  } else if (kind === "ROUND_ROBIN") {
    for (const m of matches) {
      const g = groupOf(m.round);
      const sec = g ? `group:${g}` : "single";
      addSection(sec, g ? `Grupo ${g}` : "Partidos", g ? g.charCodeAt(0) : 0);
      nodes.push({ matchId: m.id, stageId: m.stage_id, section: sec, roundLabel: m.round ?? "Partido", column: 0, row: 0, bestOf: m.best_of ?? 3, points: 0, seeds: null });
    }
  } else {
    // Eliminatorias: lado y rango salen de la etiqueta real de la ronda.
    const ranks = new Map<string, number[]>();
    const info = new Map(matches.map((m) => [m.id, parseRound(m.round)]));
    for (const m of matches) {
      const i = info.get(m.id)!;
      const side = kind === "SINGLE_ELIMINATION" ? "single" : i.side === "single" ? "upper" : i.side;
      if (i.rank === null) issues.push({ severity: "ERROR", code: "ROUND_UNKNOWN", matchId: m.id, message: `Ronda sin orden reconocible: «${m.round ?? ""}».` });
      const list = ranks.get(side) ?? [];
      if (i.rank !== null && !list.includes(i.rank)) list.push(i.rank);
      ranks.set(side, list);
    }
    for (const list of ranks.values()) list.sort((a, b) => a - b);
    const SECTION_LABEL: Record<string, [string, number]> = { single: ["Cuadro", 0], upper: ["Cuadro alto", 0], lower: ["Cuadro bajo", 1], grand: ["Gran final", 2] };
    for (const m of matches) {
      const i = info.get(m.id)!;
      const side = kind === "SINGLE_ELIMINATION" ? "single" : i.side === "single" ? "upper" : i.side;
      const [label, order] = SECTION_LABEL[side] ?? [side, 9];
      addSection(side, label, order);
      const column = i.rank === null ? 0 : (ranks.get(side) ?? []).indexOf(i.rank);
      nodes.push({ matchId: m.id, stageId: m.stage_id, section: side, roundLabel: elimRoundLabel(side, m.round), column, row: 0, bestOf: m.best_of ?? 3, points: 0, seeds: null });
    }
  }

  // Filas: orden real dentro de cada (sección, columna).
  const rowCounter = new Map<string, number>();
  for (const n of nodes) {
    const k = `${n.section}#${n.column}`;
    n.row = rowCounter.get(k) ?? 0;
    rowCounter.set(k, n.row + 1);
  }
  // En GSL, Ganadores arriba y Eliminación abajo.
  for (const n of nodes) if (n.role === "WINNERS") n.row = 0; else if (n.role === "ELIMINATION") n.row = 1;

  const ids = new Set(nodes.map((n) => n.matchId));
  const edges: FormatEdge[] = [];
  const qualifications: FormatQualification[] = [];

  // ── SOURCE (0045, solo CONFIRMED y dentro del ámbito) ──
  for (const m of matches) {
    if (m.progression_confidence !== "CONFIRMED") continue;
    if (m.winner_to_match_id) {
      if (ids.has(m.winner_to_match_id)) edges.push({ from: m.id, to: m.winner_to_match_id, source: "WINNER", slot: slotOf(m.winner_to_slot), origin: "SOURCE" });
      else issues.push({ severity: "WARNING", code: "EDGE_OUT_OF_SCOPE", matchId: m.id, message: `El ganador va a ${m.winner_to_match_id}, fuera de este ámbito.` });
    }
    if (m.loser_to_match_id) {
      if (ids.has(m.loser_to_match_id)) edges.push({ from: m.id, to: m.loser_to_match_id, source: "LOSER", slot: slotOf(m.loser_to_slot), origin: "SOURCE" });
      else issues.push({ severity: "WARNING", code: "EDGE_OUT_OF_SCOPE", matchId: m.id, message: `El perdedor va a ${m.loser_to_match_id}, fuera de este ámbito.` });
    }
    if (m.winner_qualifies) qualifications.push({ from: m.id, key: m.winner_qualifies, label: m.winner_qualifies_label || "Clasificado", origin: "SOURCE" });
  }

  // ── ADMIN (solo donde la fuente calla; contradecirla es un error, no una sustitución) ──
  for (const a of input.adminEdges ?? []) {
    const clash = edges.find((e) => e.from === a.from && e.source === a.source);
    if (clash) {
      if (clash.to !== a.to) issues.push({ severity: "ERROR", code: "ADMIN_CONTRADICTS_SOURCE", matchId: a.from, message: `La arista de admin (${a.source} → ${a.to}) contradice la de la fuente (→ ${clash.to}).` });
      continue;
    }
    edges.push({ ...a, slot: slotOf(a.slot), origin: "ADMIN" });
  }

  // ── FORMAT_DERIVED (solo con candidato y hueco ÚNICOS) ──
  const incoming = (id: string) => edges.filter((e) => e.to === id);
  const outgoing = (id: string, s: EdgeSource) => edges.find((e) => e.from === id && e.source === s);
  const derive = (from: string, to: string, source: EdgeSource) => {
    if (outgoing(from, source) || incoming(to).length >= 2) return;
    edges.push({ from, to, source, slot: null, origin: "FORMAT_DERIVED" });
  };

  if (kind === "DOUBLE_ELIMINATION") {
    const inSec = (s: string) => nodes.filter((n) => n.section === s);
    const lastCol = (s: string) => Math.max(-1, ...inSec(s).map((n) => n.column));
    const upperFinals = inSec("upper").filter((n) => n.column === lastCol("upper"));
    const lowerFinals = inSec("lower").filter((n) => n.column === lastCol("lower"));
    const grand = inSec("grand");
    if (grand.length === 1 && upperFinals.length === 1 && lowerFinals.length === 1) {
      derive(upperFinals[0].matchId, grand[0].matchId, "WINNER");
      derive(lowerFinals[0].matchId, grand[0].matchId, "WINNER");
      if (incoming(lowerFinals[0].matchId).length === 1) derive(upperFinals[0].matchId, lowerFinals[0].matchId, "LOSER");
    }
  }
  if (kind === "SINGLE_ELIMINATION") {
    // Solo el caso sin ambigüedad: una columna de UN partido alimentada por exactamente dos.
    const cols = [...new Set(nodes.map((n) => n.column))].sort((a, b) => a - b);
    for (let c = 1; c < cols.length; c++) {
      const here = nodes.filter((n) => n.column === cols[c]);
      const prev = nodes.filter((n) => n.column === cols[c - 1]);
      if (here.length === 1 && prev.length === 2) for (const p of prev) derive(p.matchId, here[0].matchId, "WINNER");
    }
  }
  if (kind === "GSL_GROUPS") {
    const groups = [...new Set(nodes.map((n) => n.section.split(":")[1]))];
    for (const g of groups) {
      const of = (r: GslRole) => nodes.filter((n) => n.section === `group:${g}` && n.role === r);
      const opening = of("OPENING"), winners = of("WINNERS"), elim = of("ELIMINATION"), decider = of("DECIDER");
      if (opening.length !== 2 || winners.length !== 1 || elim.length !== 1 || decider.length !== 1) {
        issues.push({ severity: "ERROR", code: "GSL_SHAPE", message: `El grupo ${g} no tiene la forma GSL (2 Apertura, 1 Ganadores, 1 Eliminación, 1 Decisivo).` });
        continue;
      }
      for (const o of opening) { derive(o.matchId, winners[0].matchId, "WINNER"); derive(o.matchId, elim[0].matchId, "LOSER"); }
      derive(elim[0].matchId, decider[0].matchId, "WINNER");
      derive(winners[0].matchId, decider[0].matchId, "LOSER");
      for (const q of [winners[0], decider[0]]) {
        if (!qualifications.some((x) => x.from === q.matchId)) qualifications.push({ from: q.matchId, key: `qualified:group-${g.toLowerCase()}:${q === winners[0] ? "winners" : "decider"}`, label: `Clasificado · Grupo ${g}`, origin: "FORMAT_DERIVED" });
      }
    }
  }

  // ── Puntos y semillas ──
  const upperColumns = Math.max(0, ...nodes.filter((n) => n.section === "upper").map((n) => n.column + 1));
  const realById = new Map(matches.map((m) => [m.id, m]));
  for (const n of nodes) {
    const terminal = !edges.some((e) => e.from === n.matchId && e.source === "WINNER") && !qualifications.some((q) => q.from === n.matchId);
    n.points = pointsFor(kind, n.section, n.column, upperColumns, terminal, n.role);
    if (incoming(n.matchId).length < 2) {
      const r = realById.get(n.matchId)!;
      n.seeds = [teamRef(r.team_a_id, r.team_a)?.id ?? null, teamRef(r.team_b_id, r.team_b)?.id ?? null];
    }
  }

  const descriptor: FormatDescriptor = {
    version: PICKEM_FORMAT_VERSION, kind, eventId: input.eventId,
    stageIds: [...new Set(matches.map((m) => m.stage_id).filter((s): s is string => !!s))].sort(),
    sections: [...sections.values()].sort((a, b) => a.order - b.order),
    nodes: nodes.sort((a, b) => (sections.get(a.section)?.order ?? 0) - (sections.get(b.section)?.order ?? 0) || a.column - b.column || a.row - b.row),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.source.localeCompare(b.source)),
    qualifications: qualifications.sort((a, b) => a.from.localeCompare(b.from)),
  };
  issues.push(...validateFormat(descriptor, input.matches));
  return { descriptor, detected, issues };
}

/* ═══════════════════════════════ GRAFO ═══════════════════════════════ */

export type SlotSource =
  | { kind: "SEED"; index: Slot }
  | { kind: "FROM"; matchId: string; source: EdgeSource };

/**
 * Las dos fuentes de los huecos de un partido. Una arista con hueco ocupa ese; las demás rellenan
 * los libres en orden de alimentador (columna, fila). Sin alimentador, el hueco es una SEMILLA: el
 * equipo real de ese lado del partido.
 */
export function slotSources(d: FormatDescriptor): Map<string, [SlotSource, SlotSource]> {
  const pos = new Map(d.nodes.map((n, i) => [n.matchId, i]));
  const out = new Map<string, [SlotSource, SlotSource]>();
  for (const n of d.nodes) {
    const inc = d.edges.filter((e) => e.to === n.matchId).sort((a, b) => (pos.get(a.from) ?? 0) - (pos.get(b.from) ?? 0));
    const slots: (SlotSource | null)[] = [null, null];
    for (const e of inc) if (e.slot && !slots[e.slot - 1]) slots[e.slot - 1] = { kind: "FROM", matchId: e.from, source: e.source };
    for (const e of inc) {
      if (e.slot && slots[e.slot - 1] && (slots[e.slot - 1] as { matchId?: string }).matchId === e.from) continue;
      const free = slots.findIndex((s) => s === null);
      if (free >= 0) slots[free] = { kind: "FROM", matchId: e.from, source: e.source };
    }
    out.set(n.matchId, [slots[0] ?? { kind: "SEED", index: 1 }, slots[1] ?? { kind: "SEED", index: 2 }]);
  }
  return out;
}

/** Orden topológico (alimentador antes que destino). `null` si hay ciclo. */
export function topoOrder(d: FormatDescriptor): string[] | null {
  const indeg = new Map(d.nodes.map((n) => [n.matchId, 0]));
  for (const e of d.edges) if (indeg.has(e.to)) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const pos = new Map(d.nodes.map((n, i) => [n.matchId, i]));
  const queue = d.nodes.filter((n) => (indeg.get(n.matchId) ?? 0) === 0).map((n) => n.matchId);
  const out: string[] = [];
  while (queue.length) {
    queue.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
    const id = queue.shift()!;
    out.push(id);
    for (const e of d.edges.filter((x) => x.from === id)) {
      const k = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, k);
      if (k === 0) queue.push(e.to);
    }
  }
  return out.length === d.nodes.length ? out : null;
}

/** Todos los partidos que dependen (directa o indirectamente) de `matchId`. */
export function descendantsOf(d: FormatDescriptor, matchId: string): Set<string> {
  const out = new Set<string>();
  const stack = [matchId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of d.edges) if (e.from === id && !out.has(e.to)) { out.add(e.to); stack.push(e.to); }
  }
  return out;
}

/** ¿Es un partido de ENTRADA del formato (sus huecos pueden ser semillas reales)? */
export function isEntryNode(d: FormatDescriptor, n: FormatNode): boolean {
  switch (d.kind) {
    case "ROUND_ROBIN": return true;
    case "GSL_GROUPS": return n.role === "OPENING";
    default: return n.column === 0 && (n.section === "upper" || n.section === "single");
  }
}

/* ═══════════════════════════════ VALIDADOR (puerta de publicación) ═══════════════════════════════ */

export type IssueSeverity = "ERROR" | "WARNING";
export interface FormatIssue { severity: IssueSeverity; code: string; message: string; matchId?: string }

const FINISHED = new Set(["finished", "completed"]);

/**
 * Valida un descriptor contra los partidos reales. Un ERROR bloquea publicar; un WARNING se enseña.
 * Comprueba identidad, duplicados, ciclos, capacidad de huecos, caminos de ganador/perdedor por
 * formato, alcanzabilidad de la final, fechas y coherencia con los resultados ya jugados.
 */
export function validateFormat(d: FormatDescriptor, real: RealMatchRow[]): FormatIssue[] {
  const issues: FormatIssue[] = [];
  const err = (code: string, message: string, matchId?: string) => issues.push({ severity: "ERROR", code, message, matchId });
  const warn = (code: string, message: string, matchId?: string) => issues.push({ severity: "WARNING", code, message, matchId });
  const realById = new Map(real.map((m) => [m.id, m]));
  const nodeIds = new Set<string>();

  if (!SUPPORTED_FORMATS.includes(d.kind)) err("FORMAT_UNSUPPORTED", `Formato no soportado: ${d.kind}.`);
  if (d.nodes.length === 0) err("EMPTY", "El ámbito no tiene partidos.");

  for (const n of d.nodes) {
    if (nodeIds.has(n.matchId)) err("DUPLICATE_MATCH", `Partido duplicado: ${n.matchId}.`, n.matchId);
    nodeIds.add(n.matchId);
    const r = realById.get(n.matchId);
    if (!r) { err("MATCH_MISSING", `El partido ${n.matchId} no existe en los datos reales.`, n.matchId); continue; }
    if (r.event_id && r.event_id !== d.eventId) err("MATCH_OTHER_EVENT", `El partido ${n.matchId} es de otro evento.`, n.matchId);
    if (!r.start_time || !Number.isFinite(Date.parse(r.start_time))) err("DATE_MISSING", `El partido ${n.matchId} no tiene hora de inicio (sin ella no hay cierre).`, n.matchId);
    if (!(n.points > 0)) err("POINTS", `El partido ${n.matchId} no vale puntos.`, n.matchId);
  }

  const seen = new Set<string>();
  for (const e of d.edges) {
    const k = `${e.from}:${e.source}`;
    if (seen.has(k)) err("DOUBLE_PATH", `El ${e.source === "WINNER" ? "ganador" : "perdedor"} de ${e.from} tiene dos destinos.`, e.from);
    seen.add(k);
    if (e.from === e.to) err("SELF_EDGE", `Autoarista en ${e.from}.`, e.from);
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) err("EDGE_DANGLING", `Arista ${e.from} → ${e.to} con un extremo fuera del ámbito.`, e.from);
  }
  for (const n of d.nodes) {
    const inc = d.edges.filter((e) => e.to === n.matchId);
    if (inc.length > 2) err("SLOT_OVERFLOW", `${n.matchId} recibe ${inc.length} equipos.`, n.matchId);
    for (const s of [1, 2] as const) if (inc.filter((e) => e.slot === s).length > 1) err("SLOT_TAKEN", `El hueco ${s} de ${n.matchId} lo alimentan dos partidos.`, n.matchId);
  }

  const topo = topoOrder(d);
  if (!topo) err("CYCLE", "El grafo tiene un ciclo.");

  // Huecos: los partidos que no son de entrada necesitan sus DOS alimentadores.
  for (const n of d.nodes) {
    const inc = d.edges.filter((e) => e.to === n.matchId).length;
    if (!isEntryNode(d, n) && inc < 2) err("SLOT_UNKNOWN", `${n.roundLabel} (${n.matchId}): ${2 - inc} hueco(s) sin origen conocido.`, n.matchId);
    if (isEntryNode(d, n) && inc > 0) err("ENTRY_FED", `${n.matchId} es de entrada pero lo alimenta otro partido.`, n.matchId);
  }

  // Caminos por formato.
  const winnerOut = (id: string) => d.edges.find((e) => e.from === id && e.source === "WINNER");
  const loserOut = (id: string) => d.edges.find((e) => e.from === id && e.source === "LOSER");
  const qualifies = (id: string) => d.qualifications.some((q) => q.from === id);
  const nodeOf = new Map(d.nodes.map((n) => [n.matchId, n]));
  const terminals = d.nodes.filter((n) => !winnerOut(n.matchId) && !qualifies(n.matchId));
  if (d.kind === "SINGLE_ELIMINATION") {
    if (terminals.length !== 1) err("FINAL_COUNT", `Eliminación simple con ${terminals.length} finales.`);
    for (const e of d.edges) if (e.source === "LOSER") err("LOSER_PATH", `En eliminación simple el perdedor queda fuera (${e.from}).`, e.from);
  }
  if (d.kind === "DOUBLE_ELIMINATION") {
    const grand = d.nodes.filter((n) => n.section === "grand");
    if (grand.length !== 1) err("GRAND_FINAL", `Doble eliminación con ${grand.length} grandes finales.`);
    if (terminals.length !== 1 || terminals[0]?.section !== "grand") err("FINAL_COUNT", "La única final debe ser la Gran Final.");
    for (const n of d.nodes.filter((x) => x.section === "upper")) {
      const l = loserOut(n.matchId);
      if (!l) err("LOSER_MISSING", `${n.roundLabel} (${n.matchId}): falta adónde cae el perdedor.`, n.matchId);
      else if (nodeOf.get(l.to)?.section !== "lower") err("LOSER_PATH", `El perdedor de ${n.matchId} debe caer al cuadro bajo.`, n.matchId);
    }
    for (const n of d.nodes.filter((x) => x.section !== "upper")) if (loserOut(n.matchId)) err("LOSER_PATH", `Solo el cuadro alto tiene segunda vida (${n.matchId}).`, n.matchId);
  }
  if (d.kind === "GSL_GROUPS") {
    for (const n of d.nodes) {
      const role = n.role;
      if (!role) err("GSL_PATH", `${n.matchId} no tiene papel GSL.`, n.matchId);
      if (role === "OPENING" && (!winnerOut(n.matchId) || !loserOut(n.matchId))) err("GSL_PATH", `Apertura ${n.matchId}: faltan los caminos de ganador y perdedor.`, n.matchId);
      if (role === "WINNERS" && (!qualifies(n.matchId) || !loserOut(n.matchId))) err("GSL_PATH", `Ganadores ${n.matchId}: falta la plaza o la caída al Decisivo.`, n.matchId);
      if (role === "ELIMINATION" && (!winnerOut(n.matchId) || loserOut(n.matchId))) err("GSL_PATH", `Eliminación ${n.matchId}: el ganador va al Decisivo y el perdedor queda fuera.`, n.matchId);
      if (role === "DECIDER" && !qualifies(n.matchId)) err("GSL_PATH", `Decisivo ${n.matchId}: falta la plaza.`, n.matchId);
      for (const e of d.edges.filter((x) => x.from === n.matchId)) if (nodeOf.get(e.to)?.section !== n.section) err("GSL_PATH", `${n.matchId} alimenta un partido de otro grupo.`, n.matchId);
    }
  }
  if (d.kind === "ROUND_ROBIN" && d.edges.length > 0) err("RR_EDGES", "Un todos contra todos no tiene aristas de avance.");

  // Fechas: un destino no puede empezar antes que su alimentador (los cierres irían al revés).
  for (const e of d.edges) {
    const a = Date.parse(realById.get(e.from)?.start_time ?? ""), b = Date.parse(realById.get(e.to)?.start_time ?? "");
    if (Number.isFinite(a) && Number.isFinite(b) && b < a) err("DATE_ORDER", `${e.to} empieza antes que su alimentador ${e.from}.`, e.to);
  }

  // Coherencia con los resultados reales ya jugados (y con los equipos ya colocados por la fuente).
  for (const e of d.edges) {
    const f = realById.get(e.from), t = realById.get(e.to);
    if (!f || !t || !FINISHED.has((f.status ?? "").toLowerCase()) || !f.winner_team_id) continue;
    const winner = f.winner_team_id;
    const loser = winner === f.team_a_id ? f.team_b_id : winner === f.team_b_id ? f.team_a_id : null;
    const team = e.source === "WINNER" ? winner : loser;
    const tA = teamRef(t.team_a_id, t.team_a)?.id ?? null, tB = teamRef(t.team_b_id, t.team_b)?.id ?? null;
    if (team && tA && tB && team !== tA && team !== tB) err("RESULT_CONTRADICTS", `El ${e.source === "WINNER" ? "ganador" : "perdedor"} real de ${e.from} no juega ${e.to}.`, e.from);
  }

  // Equipos: semillas de entrada por definir = se podrán predecir cuando la fuente las publique.
  for (const n of d.nodes) {
    if (!isEntryNode(d, n)) continue;
    const r = realById.get(n.matchId);
    if (r && (!teamRef(r.team_a_id, r.team_a) || !teamRef(r.team_b_id, r.team_b))) warn("SEED_PENDING", `${n.roundLabel} (${n.matchId}): equipos aún por definir; se podrá predecir cuando la fuente los publique.`, n.matchId);
    if (n.seeds && r) {
      const now: [string | null, string | null] = [teamRef(r.team_a_id, r.team_a)?.id ?? null, teamRef(r.team_b_id, r.team_b)?.id ?? null];
      if ((n.seeds[0] && now[0] && n.seeds[0] !== now[0]) || (n.seeds[1] && now[1] && n.seeds[1] !== now[1])) warn("SEED_CHANGED", `La fuente cambió los equipos de ${n.matchId} desde que se derivó.`, n.matchId);
    }
  }

  // Alcanzabilidad: desde cada partido, siguiendo al ganador, se llega a la final o a una plaza.
  if (topo && d.kind !== "ROUND_ROBIN") {
    const finalIds = new Set(terminals.map((t) => t.matchId));
    for (const n of d.nodes) {
      let cur = n.matchId;
      for (let i = 0; i < d.nodes.length && winnerOut(cur); i++) cur = winnerOut(cur)!.to;
      if (!finalIds.has(cur) && !qualifies(cur)) err("UNREACHABLE", `Desde ${n.matchId} no se llega a una final ni a una plaza.`, n.matchId);
    }
  }
  return issues;
}

export const hasBlockingIssues = (issues: FormatIssue[]): boolean => issues.some((i) => i.severity === "ERROR");

/** Huella estable del descriptor (lo que se congela). */
export function canonicalDescriptor(d: FormatDescriptor): string {
  return JSON.stringify({
    version: d.version, kind: d.kind, eventId: d.eventId, stageIds: d.stageIds,
    sections: d.sections.map((s) => [s.id, s.label, s.order]),
    nodes: d.nodes.map((n) => [n.matchId, n.stageId, n.section, n.roundLabel, n.column, n.row, n.bestOf, n.points, n.seeds]),
    edges: d.edges.map((e) => [e.from, e.to, e.source, e.slot, e.origin]),
    qualifications: d.qualifications.map((q) => [q.from, q.key, q.label, q.origin]),
  });
}

/** Suma de puntos (sin partidos anulados). */
export function maxPointsOf(d: FormatDescriptor, voided: ReadonlySet<string> = new Set()): number {
  return d.nodes.reduce((s, n) => s + (voided.has(n.matchId) ? 0 : n.points), 0);
}
