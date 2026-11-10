/**
 * EL CUADRO DE ELIMINATORIAS COMO GRAFO (Fase 24.3, estructura confirmada en la 24.4) —
 * funciones PURAS.
 *
 * ────────────────────────── QUÉ HAY EN LOS DATOS ──────────────────────────
 *
 *   · `stages.kind`      group | swiss | playoff | bracket | showmatch  (por fase)
 *   · `matches.round`    el texto de la serie tal y como lo publica el origen
 *   · `matches.match_order`, `start_time`, los dos equipos y el ganador REAL.
 *   · Desde la 24.4 (migración 0045): `winner_to_match_id`/`winner_to_slot`,
 *     `loser_to_match_id`/`loser_to_slot`, `winner_qualifies` y su etiqueta, con
 *     `progression_evidence` y `progression_confidence`. Los escribe el importador SOLO cuando
 *     la fuente confirma la relación; lo desconocido es NULL.
 *
 * ────────────────────────── LAS REGLAS ──────────────────────────
 *
 * **1. El formato lo deciden las fases y las rondas.** Nunca el nombre del torneo.
 *
 * **2. Tres orígenes de arista, en este orden y sin mezclarse:**
 *      a) ESTRUCTURAL CONFIRMADA (24.4): la fuente publica el destino. Existe ANTES del
 *         resultado: «TH vs FNC → [TBD]». Solo `progression_confidence = 'CONFIRMED'`;
 *         cualquier otro valor (INFERRED, NULL) no dibuja nada.
 *      b) VERIFICADA POR RESULTADO (24.3): el partido terminó y su ganador (o perdedor) aparece
 *         en un partido posterior. Solo para lo que no tiene arista estructural.
 *      c) NADA. Un partido futuro sin estructura no tiene aristas.
 *
 * **3. Una estructura que contradice un resultado es un CONFLICTO, no una elección.** Si la
 *    estructura dice «ganador de A → C» y el ganador real de A juega D, la arista no se pinta
 *    y el conflicto queda registrado. Igual si el equipo no ocupa el hueco anunciado.
 *
 * **4. El grafo se valida** (autoarista, destino inexistente, otra fase, hueco doble, ronda
 *    hacia atrás, ciclo) y lo inválido se descarta degradando en seguro: el cuadro sigue
 *    pintándose sin esas aristas.
 *
 * **5. Ronda desconocida = sin cuadro.** Si las etiquetas no permiten ordenar, `reliable`
 *    es falso y la pantalla vuelve a la vista normal.
 *
 * Separación: aquí DATOS. El LAYOUT (columnas) y el RENDER (cajas, líneas SVG) viven en
 * `components/pickems/bracket/`.
 */
import { stateOf, isLockedNow, type AnswerMap, type PickState, type QuestionLike } from "./progress";
import { ns, td } from "@/i18n/runtime";

const tr = ns("pickems");

/* ═══════════════════════════════ ENTRADAS ═══════════════════════════════ */

export interface StageLike {
  id: string;
  name: string;
  slug?: string | null;
  kind: string | null;
  order_idx?: number | null;
}

export interface BracketMatchInput {
  id: string;
  stage_id?: string | null;
  team_a: string | null;
  team_b: string | null;
  team_a_id?: string | null;
  team_b_id?: string | null;
  start_time: string | null;
  status: string;
  score_a: number | null;
  score_b: number | null;
  winner_team_id?: string | null;
  winner_team?: string | null;
  round: string | null;
  match_order: number | null;
  /** Fase 24.4 · estructura confirmada (0045). Ausente/NULL = desconocido. */
  winner_to_match_id?: string | null;
  winner_to_slot?: 1 | 2 | null;
  loser_to_match_id?: string | null;
  loser_to_slot?: 1 | 2 | null;
  winner_qualifies?: string | null;
  winner_qualifies_label?: string | null;
  progression_evidence?: string | null;
  progression_confidence?: string | null;
}

/* ═══════════════════════════════ FORMATO ═══════════════════════════════ */

export type TournamentFormat =
  | "LEAGUE" | "SINGLE_ELIMINATION" | "DOUBLE_ELIMINATION" | "GROUP_STAGE" | "SWISS"
  | "GROUP_PLAYOFF" | "UNKNOWN";

export const BRACKET_FORMATS = new Set<TournamentFormat>(["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "GROUP_PLAYOFF"]);
export const isBracketFormat = (f: TournamentFormat): boolean => BRACKET_FORMATS.has(f);

export type BracketSide = "upper" | "lower" | "single" | "grand";

/** Lo que se sabe de una etiqueta de ronda. Solo lo que dice; nunca lo que se supone. */
export interface RoundInfo {
  raw: string;
  side: BracketSide;
  rank: number | null;
  elimination: boolean;
  league: boolean;
  label: string;
  /** Grupo al que pertenece la ronda cuando la etiqueta lo dice («Opening (A)» → «A»). */
  group?: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

interface Pattern { re: RegExp; rank: number | ((m: RegExpMatchArray) => number); label: string | ((m: RegExpMatchArray) => string); side?: BracketSide }

/** Orden importa: lo específico antes que lo genérico («semifinal» contiene «final»). */
const ELIM_PATTERNS: Pattern[] = [
  { re: /\bgrand\s*-?\s*final|\bgran\s*final/, rank: 100, label: "Gran Final", side: "grand" },
  { re: /\bround\s*of\s*(\d+)|\bronda\s*de\s*(\d+)|\b(\d+)avos\b/, rank: (m) => 60 - Math.log2(Number(m[1] ?? m[2] ?? m[3])), label: (m) => tr("Ronda de {v}", { v: td(m[1]) ?? td(m[2]) ?? td(m[3]) }) },
  { re: /\bquarter\s*-?\s*finals?|\bcuartos|\bqf\b/, rank: 70, label: "Cuartos" },
  { re: /\bsemi\s*-?\s*finals?|\bsemis?\b|\bsf\b/, rank: 80, label: "Semifinales" },
  { re: /\bfinals?\b/, rank: 90, label: "Final" },
  { re: /\bopening\b|\bapertura\b/, rank: 10, label: "Apertura" },
  { re: /\bwinner'?s?\b|\bganadores\b/, rank: 20, label: "Ganadores" },
  { re: /\belimination\b|\beliminaci[oó]n\b/, rank: 20, label: "Eliminación" },
  { re: /\bdecider\b|\bdecisivo\b|\bdesempate\b/, rank: 30, label: "Decisivo" },
  { re: /\bround\s*(\d+)|\bronda\s*(\d+)|\br(\d+)\b/, rank: (m) => 10 + Number(m[1] ?? m[2] ?? m[3]), label: (m) => `Ronda ${m[1] ?? m[2] ?? m[3]}` },
  { re: /\bplay-?in\b/, rank: 5, label: "Play-in" },
];

const LEAGUE_RE = /\bweek\b|\bsemana\b|\bjornada\b|\bmatchday\b|\bday\s*\d+|\bd[ií]a\s*\d+|\bregular\b|\bgroup\s*stage\b|\bfase\s*de\s*grupos\b|\bgrupo\b|\bgroup\s*[a-d]\b/;

export function parseRound(raw: string | null | undefined): RoundInfo {
  const original = (raw ?? "").trim();
  const s = norm(original);
  if (!s) return { raw: original, side: "single", rank: null, elimination: false, league: false, label: tr("Partido") };

  const lower = /\blower\b|\bloser'?s?\b|\bbajo\b|\bperdedores\b/.test(s);
  const upper = /\bupper\b|\bwinner'?s?\s*bracket\b|\balto\b/.test(s);
  const league = LEAGUE_RE.test(s);
  // «Opening (A)», «Decider (B)»: el grupo se conserva en la etiqueta traducida.
  const groupSuffix = /\(([a-z0-9]{1,3})\)\s*$/.exec(s)?.[1];

  for (const p of ELIM_PATTERNS) {
    const m = s.match(p.re);
    if (!m) continue;
    const side: BracketSide = p.side ?? (lower ? "lower" : upper ? "upper" : "single");
    const rank = typeof p.rank === "function" ? p.rank(m) : p.rank;
    const base = typeof p.label === "function" ? p.label(m) : p.label;
    const translate = /\b(opening|winner'?s?|elimination|decider)\b/.test(s);
    const label = /[a-z]/.test(original) && !translate
      ? original
      : side === "lower" ? `${base} · Lower` : side === "upper" ? `${base} · Upper` : base;
    return { raw: original, side, rank, elimination: !league, league, label: label || original, group: groupSuffix?.toUpperCase() };
  }

  if (lower || upper) {
    return { raw: original, side: lower ? "lower" : "upper", rank: null, elimination: true, league: false, label: original };
  }
  return { raw: original, side: "single", rank: null, elimination: false, league, label: original };
}

const STAGE_BRACKET_KINDS = new Set(["playoff", "bracket"]);
const STAGE_LEAGUE_KINDS = new Set(["group", "swiss"]);

export function getTournamentFormat(
  input: { stages?: StageLike[] | null; matches: BracketMatchInput[] },
): TournamentFormat {
  const matches = input.matches ?? [];
  if (matches.length === 0) return "UNKNOWN";
  const stages = (input.stages ?? []).filter((s) => matches.some((m) => m.stage_id === s.id));

  const infos = matches.map((m) => parseRound(m.round));
  const hasLower = infos.some((i) => i.side === "lower");
  const elimKind = (): TournamentFormat => (hasLower ? "DOUBLE_ELIMINATION" : "SINGLE_ELIMINATION");

  if (stages.length > 0) {
    let bracket = 0, league = 0;
    for (const s of stages) {
      const kind = (s.kind ?? "").toLowerCase();
      const own = matches.filter((m) => m.stage_id === s.id).map((m) => parseRound(m.round));
      const gsl = own.length > 0 && own.every((i) => i.elimination);
      if (STAGE_BRACKET_KINDS.has(kind) || (STAGE_LEAGUE_KINDS.has(kind) && gsl && kind === "group")) bracket++;
      else if (STAGE_LEAGUE_KINDS.has(kind)) league++;
    }
    if (bracket > 0 && league > 0) return "GROUP_PLAYOFF";
    if (bracket > 0) return elimKind();
    if (league > 0) {
      return stages.every((s) => (s.kind ?? "").toLowerCase() === "swiss") ? "SWISS" : "GROUP_STAGE";
    }
  }

  const elim = infos.filter((i) => i.elimination).length;
  const lg = infos.filter((i) => i.league).length;
  const labelled = infos.filter((i) => i.raw).length;
  if (labelled === 0) return "UNKNOWN";
  if (elim > 0 && lg > 0) return "GROUP_PLAYOFF";
  if (elim >= Math.ceil(labelled / 2)) return elimKind();
  if (lg > 0) return "LEAGUE";
  return "UNKNOWN";
}

/* ═══════════════════════════════ MODELO ═══════════════════════════════ */

export type LockState = "open" | "locked" | "resolved" | "none";

export interface BracketTeam { name: string; id: string | null }

export interface BracketMatch {
  id: string;
  roundId: string;
  stageId: string | null;
  teamA: BracketTeam | null;
  teamB: BracketTeam | null;
  scoreA: number | null;
  scoreB: number | null;
  /** Lado ganador según el backend. Nunca deducido del marcador. */
  winner: "a" | "b" | null;
  status: string;
  startsAt: string | null;
  order: number;
  questionId: string | null;
  optionA: string | null;
  optionB: string | null;
  points: number | null;
  locksAt: string | null;
  selectedOption: string | null;
  correctOption: string | null;
  lockState: LockState;
  pickState: PickState | null;
  pointsAward: number | null;
}

export interface BracketRound {
  id: string;
  stageId: string | null;
  label: string;
  /** «A», «B»… cuando la ronda pertenece a un grupo (GSL). */
  group?: string;
  side: BracketSide;
  order: number;
  matchIds: string[];
}

export type EdgeEvidence = "SOURCE_EXPLICIT" | "SOURCE_BRACKET_LINK" | "SOURCE_STRUCTURED_HTML" | "RESULT_VERIFIED";

export interface BracketEdge {
  from: string;
  /** Id de partido, o id de nodo de clasificación (`qual:…`). */
  to: string;
  source: "WINNER" | "LOSER";
  /** Hueco que ocupa en el destino; `null` cuando la fuente no lo dice. */
  slot: "a" | "b" | null;
}

/** De dónde sale cada arista. Auditable; la forma de `BracketEdge` no cambia respecto a 24.3. */
export interface EdgeMeta {
  /** STRUCTURAL: la fuente lo publica (existe antes del resultado). RESULT_VERIFIED: lo demuestra el resultado. */
  kind: "STRUCTURAL" | "RESULT_VERIFIED";
  evidence: EdgeEvidence;
  /** Solo se emiten aristas CONFIRMED. Lo demás no llega aquí. */
  confidence: "CONFIRMED";
  toKind: "match" | "qualification";
}

export const edgeKey = (e: { from: string; to: string; source: string }): string => `${e.from}>${e.to}:${e.source}`;

/** [ MATCH ] ──winner──▶ [ CLASIFICADO · equipo o Por definir ] */
export interface QualificationNode {
  id: string;
  key: string;
  label: string;
  stageId: string | null;
  side: BracketSide;
  fromMatchId: string;
  source: "WINNER";
  /** El clasificado REAL (ganador del partido) o `null` mientras no se sepa. */
  team: BracketTeam | null;
}

export interface StructureConflict {
  matchId: string;
  source: "WINNER" | "LOSER";
  expectedTo: string;
  observedTo: string | null;
  reason: string;
}

export interface BracketStage {
  id: string | null;
  name: string;
  kind: string | null;
  bracket: boolean;
  roundIds: string[];
}

export interface BracketModel {
  format: TournamentFormat;
  stages: BracketStage[];
  rounds: BracketRound[];
  matches: Record<string, BracketMatch>;
  edges: BracketEdge[];
  /** Procedencia de cada arista, por `edgeKey`. */
  edgeMeta: Record<string, EdgeMeta>;
  qualificationNodes: QualificationNode[];
  /** Estructura que contradice resultados. No se pinta; se registra. */
  conflicts: StructureConflict[];
  /** Aristas descartadas por el validador del grafo (autoarista, ciclo, hueco doble…). */
  issues: string[];
  reliable: boolean;
}

const teamOf = (name: string | null, id: string | null | undefined): BracketTeam | null =>
  name && name.trim() ? { name: name.trim(), id: id ?? null } : null;

export function winnerSide(m: BracketMatchInput): "a" | "b" | null {
  if (m.winner_team_id) {
    if (m.team_a_id && m.winner_team_id === m.team_a_id) return "a";
    if (m.team_b_id && m.winner_team_id === m.team_b_id) return "b";
  }
  const w = norm(m.winner_team ?? "");
  if (!w) return null;
  if (w === norm(m.team_a ?? "")) return "a";
  if (w === norm(m.team_b ?? "")) return "b";
  return null;
}

const FINISHED = new Set(["finished", "completed"]);
const slotOf = (s: 1 | 2 | null | undefined): "a" | "b" | null => (s === 1 ? "a" : s === 2 ? "b" : null);
export const qualificationNodeId = (key: string): string => `qual:${key}`;

export interface BuildInput {
  format?: TournamentFormat;
  stages?: StageLike[] | null;
  matches: BracketMatchInput[];
  questions: (QuestionLike & { match_id: string | null; kind: string })[];
  answers: AnswerMap;
  now?: number;
}

/**
 * Normaliza torneo → modelo de cuadro. Puro y determinista.
 */
export function buildBracketModel(input: BuildInput): BracketModel {
  const now = input.now ?? Date.now();
  const format = input.format ?? getTournamentFormat({ stages: input.stages, matches: input.matches });
  const stagesById = new Map((input.stages ?? []).map((s) => [s.id, s]));
  const qByMatch = new Map<string, BuildInput["questions"][number]>();
  for (const q of input.questions) if (q.kind === "match_winner" && q.match_id) qByMatch.set(q.match_id, q);
  const inputById = new Map(input.matches.map((m) => [m.id, m]));

  // ── Partidos ──
  const matches: Record<string, BracketMatch> = {};
  const roundKeyOf = (m: BracketMatchInput) => `${m.stage_id ?? "-"}::${norm(m.round ?? "")}`;
  const roundBuckets = new Map<string, { stageId: string | null; info: RoundInfo; matches: BracketMatchInput[] }>();

  for (const m of input.matches) {
    const key = roundKeyOf(m);
    const info = parseRound(m.round);
    const bucket = roundBuckets.get(key) ?? { stageId: m.stage_id ?? null, info, matches: [] };
    bucket.matches.push(m);
    roundBuckets.set(key, bucket);

    const q = qByMatch.get(m.id);
    const mine = q ? input.answers[q.id] : undefined;
    const pickState = q ? stateOf(q, mine, now) : null;
    const lockState: LockState = !q ? "none"
      : (isLockedNow(q, now) && !!q.correct_option) ? "resolved"
      : isLockedNow(q, now) ? "locked" : "open";

    matches[m.id] = {
      id: m.id,
      roundId: key,
      stageId: m.stage_id ?? null,
      teamA: teamOf(m.team_a, m.team_a_id),
      teamB: teamOf(m.team_b, m.team_b_id),
      scoreA: m.score_a,
      scoreB: m.score_b,
      winner: winnerSide(m),
      status: (m.status ?? "upcoming").toLowerCase(),
      startsAt: m.start_time,
      order: m.match_order ?? Number.MAX_SAFE_INTEGER,
      questionId: q?.id ?? null,
      optionA: q?.options[0]?.key ?? null,
      optionB: q?.options[1]?.key ?? null,
      points: q?.points ?? null,
      locksAt: q?.locks_at ?? null,
      selectedOption: mine?.option ?? null,
      correctOption: q?.correct_option ?? null,
      lockState,
      pickState,
      pointsAward: mine?.pointsAward ?? null,
    };
  }

  // ── Rondas ──
  const firstStart = (ms: BracketMatchInput[]): number | null => {
    let best: number | null = null;
    for (const m of ms) {
      if (!m.start_time) continue;
      const t = Date.parse(m.start_time);
      if (Number.isFinite(t) && (best === null || t < best)) best = t;
    }
    return best;
  };
  const stageOrder = (id: string | null) => stagesById.get(id ?? "")?.order_idx ?? 0;

  let reliable = true;
  type Tmp = BracketRound & { _start: number | null; _rank: number | null };
  const rounds: Tmp[] = [...roundBuckets.entries()].map(([id, b]) => {
    const start = firstStart(b.matches);
    if (start === null && b.info.rank === null) reliable = false;
    const sortedIds = [...b.matches]
      .sort((x, y) => (x.match_order ?? 1e9) - (y.match_order ?? 1e9) || Date.parse(x.start_time ?? "") - Date.parse(y.start_time ?? ""))
      .map((m) => m.id);
    return { id, stageId: b.stageId, label: b.info.label, group: b.info.group, side: b.info.side, order: 0, matchIds: sortedIds, _start: start, _rank: b.info.rank };
  });

  const SIDE_ORDER: Record<BracketSide, number> = { single: 0, upper: 0, lower: 1, grand: 2 };
  rounds.sort((a, b) =>
    stageOrder(a.stageId) - stageOrder(b.stageId)
    || SIDE_ORDER[a.side] - SIDE_ORDER[b.side]
    || (a.group ?? "").localeCompare(b.group ?? "")
    || (a._rank ?? 1e9) - (b._rank ?? 1e9)
    || (a._start ?? 1e15) - (b._start ?? 1e15)
    || a.label.localeCompare(b.label));
  for (let i = 1; i < rounds.length; i++) {
    const a = rounds[i - 1], b = rounds[i];
    if (a.stageId === b.stageId && a.side === b.side && a._rank !== null && b._rank !== null
      && a._start !== null && b._start !== null && a._rank < b._rank && a._start > b._start) reliable = false;
  }
  const finalRounds: BracketRound[] = rounds.map((r, i) => ({ id: r.id, stageId: r.stageId, label: r.label, group: r.group, side: r.side, order: i, matchIds: r.matchIds }));
  const roundOrder = new Map(finalRounds.map((r) => [r.id, r.order]));
  const roundById = new Map(finalRounds.map((r) => [r.id, r]));

  // ── Fases ──
  const stageIds = [...new Set(finalRounds.map((r) => r.stageId))];
  const stages: BracketStage[] = stageIds.map((sid) => {
    const st = stagesById.get(sid ?? "");
    const own = finalRounds.filter((r) => r.stageId === sid);
    const kind = (st?.kind ?? null)?.toLowerCase() ?? null;
    const allElim = own.every((r) => parseRound(inputById.get(r.matchIds[0])?.round ?? null).elimination);
    const bracket = kind ? (STAGE_BRACKET_KINDS.has(kind) || (kind === "group" && allElim)) : allElim;
    return {
      id: sid, name: st?.name ?? (bracket ? "Eliminatorias" : tr("Fase de grupos")), kind,
      bracket: isBracketFormat(format) && bracket, roundIds: own.map((r) => r.id),
    };
  });
  if (stages.length === 1 && isBracketFormat(format)) stages[0].bracket = true;

  const edges: BracketEdge[] = [];
  const edgeMeta: Record<string, EdgeMeta> = {};
  type Tagged = BracketEdge & EdgeMeta;
  const emit = (e: Tagged) => {
    edges.push({ from: e.from, to: e.to, source: e.source, slot: e.slot });
    edgeMeta[edgeKey(e)] = { kind: e.kind, evidence: e.evidence, confidence: e.confidence, toKind: e.toKind };
  };
  const qualificationNodes: QualificationNode[] = [];
  const conflicts: StructureConflict[] = [];
  const issues: string[] = [];

  if (isBracketFormat(format)) {
    const sameTeam = (t: BracketTeam | null, team: BracketTeam) =>
      !!t && ((team.id && t.id && t.id === team.id) || norm(t.name) === norm(team.name));
    /** El siguiente partido REAL (ronda posterior, misma fase) en el que aparece un equipo. */
    const nextMatchWith = (from: BracketMatch, team: BracketTeam): { to: BracketMatch; slot: "a" | "b" } | null => {
      const fromOrder = roundOrder.get(from.roundId) ?? 0;
      let best: { to: BracketMatch; slot: "a" | "b"; order: number; start: number } | null = null;
      for (const cand of Object.values(matches)) {
        if (cand.id === from.id || cand.stageId !== from.stageId) continue;
        const order = roundOrder.get(cand.roundId) ?? 0;
        if (order <= fromOrder) continue;
        const slot: "a" | "b" | null = sameTeam(cand.teamA, team) ? "a" : sameTeam(cand.teamB, team) ? "b" : null;
        if (!slot) continue;
        const start = cand.startsAt ? Date.parse(cand.startsAt) : Number.MAX_SAFE_INTEGER;
        if (!best || order < best.order || (order === best.order && start < best.start)) best = { to: cand, slot, order, start };
      }
      return best ? { to: best.to, slot: best.slot } : null;
    };
    const winnerTeam = (m: BracketMatch) => (m.winner === "a" ? m.teamA : m.winner === "b" ? m.teamB : null);
    const loserTeam = (m: BracketMatch) => (m.winner === "a" ? m.teamB : m.winner === "b" ? m.teamA : null);
    const finished = (m: BracketMatch) => FINISHED.has(m.status) && m.winner !== null && !!m.teamA && !!m.teamB;

    /* ── a) ESTRUCTURAL CONFIRMADA ── */
    const structural: Tagged[] = [];
    for (const raw of input.matches) {
      if (raw.progression_confidence !== "CONFIRMED") continue; // INFERRED / NULL: nada
      const evidence = (raw.progression_evidence ?? "") as EdgeEvidence;
      if (!["SOURCE_EXPLICIT", "SOURCE_BRACKET_LINK", "SOURCE_STRUCTURED_HTML"].includes(evidence)) continue;
      const from = matches[raw.id];
      const fromOrder = roundOrder.get(from.roundId) ?? 0;

      const consider = (source: "WINNER" | "LOSER", toId: string | null | undefined, slot: 1 | 2 | null | undefined) => {
        if (!toId) return;
        if (toId === raw.id) { issues.push(`${raw.id}: autoarista (${source})`); return; }
        const to = matches[toId];
        if (!to) { issues.push(`${raw.id}: destino inexistente ${toId} (${source})`); return; }
        if (to.stageId !== from.stageId) { issues.push(tr("{id}: destino {toId} de otra fase ({source})", { id: raw.id, toId: td(toId), source: td(source) })); return; }
        if ((roundOrder.get(to.roundId) ?? 0) <= fromOrder) { issues.push(tr("{id}: destino {toId} no es una ronda posterior ({source})", { id: raw.id, toId: td(toId), source: td(source) })); return; }
        structural.push({ from: raw.id, to: toId, source, slot: slotOf(slot), kind: "STRUCTURAL", evidence, confidence: "CONFIRMED", toKind: "match" });
      };
      consider("WINNER", raw.winner_to_match_id, raw.winner_to_slot);
      consider("LOSER", raw.loser_to_match_id, raw.loser_to_slot);

      if (raw.winner_qualifies) {
        const round = roundById.get(from.roundId);
        const node: QualificationNode = {
          id: qualificationNodeId(raw.winner_qualifies), key: raw.winner_qualifies,
          label: raw.winner_qualifies_label || tr("Clasificado"),
          stageId: from.stageId, side: round?.side ?? "single", fromMatchId: raw.id, source: "WINNER",
          team: finished(from) ? winnerTeam(from) : null,
        };
        qualificationNodes.push(node);
        structural.push({ from: raw.id, to: node.id, source: "WINNER", slot: null, kind: "STRUCTURAL", evidence, confidence: "CONFIRMED", toKind: "qualification" });
      }
    }

    // Hueco doble: dos aristas confirmadas al mismo (destino, hueco) → ninguna vale.
    const slotKey = (e: Tagged) => (e.toKind === "match" && e.slot ? `${e.to}:${e.slot}` : null);
    const slotCount = new Map<string, number>();
    for (const e of structural) { const k = slotKey(e); if (k) slotCount.set(k, (slotCount.get(k) ?? 0) + 1); }
    let kept = structural.filter((e) => {
      const k = slotKey(e);
      if (k && (slotCount.get(k) ?? 0) > 1) { issues.push(tr("{from}: hueco {slot} de {to} alimentado por más de un partido", { from: td(e.from), slot: e.slot, to: td(e.to) })); return false; }
      return true;
    });

    // Ciclos: si los hay, el grafo estructural no es de fiar → se degrada sin aristas estructurales.
    if (hasCycle(kept)) { issues.push(tr("ciclo en la estructura confirmada: se descartan las aristas estructurales")); kept = []; }

    // Conflictos con la realidad: la estructura dice C, el resultado dice D (o el hueco no cuadra).
    kept = kept.filter((e) => {
      const from = matches[e.from];
      if (!finished(from)) return true;
      const team = e.source === "WINNER" ? winnerTeam(from) : loserTeam(from);
      if (!team) return true;
      if (e.toKind === "qualification") return true;
      const to = matches[e.to];
      const observed = nextMatchWith(from, team);
      if (observed && observed.to.id !== e.to) {
        conflicts.push({ matchId: e.from, source: e.source, expectedTo: e.to, observedTo: observed.to.id, reason: tr("la estructura dice {to}, el resultado lleva a {name} a {id}", { to: td(e.to), name: team.name, id: observed.to.id }) });
        return false;
      }
      if (to.teamA && to.teamB && !sameTeam(to.teamA, team) && !sameTeam(to.teamB, team)) {
        conflicts.push({ matchId: e.from, source: e.source, expectedTo: e.to, observedTo: null, reason: tr("{name} no juega {to}", { name: team.name, to: td(e.to) }) });
        return false;
      }
      if (e.slot) {
        const occupant = e.slot === "a" ? to.teamA : to.teamB;
        if (occupant && !sameTeam(occupant, team)) {
          conflicts.push({ matchId: e.from, source: e.source, expectedTo: e.to, observedTo: e.to, reason: tr("{name} no ocupa el hueco {slot} de {to}", { name: team.name, slot: e.slot, to: td(e.to) }) });
          return false;
        }
      }
      return true;
    });
    for (const e of kept) emit(e);

    /* ── b) VERIFICADA POR RESULTADO, solo donde no hay estructura ── */
    const has = (id: string, source: "WINNER" | "LOSER") => edges.some((e) => e.from === id && e.source === source);
    const conflicted = (id: string, source: "WINNER" | "LOSER") => conflicts.some((c) => c.matchId === id && c.source === source);
    for (const m of Object.values(matches)) {
      if (!finished(m)) continue;
      for (const source of ["WINNER", "LOSER"] as const) {
        if (has(m.id, source) || conflicted(m.id, source)) continue; // un conflicto no se resuelve eligiendo
        const team = source === "WINNER" ? winnerTeam(m) : loserTeam(m);
        if (!team) continue;
        const hit = nextMatchWith(m, team);
        if (hit) emit({ from: m.id, to: hit.to.id, source, slot: hit.slot, kind: "RESULT_VERIFIED", evidence: "RESULT_VERIFIED", confidence: "CONFIRMED", toKind: "match" });
      }
    }
  }

  return { format, stages, rounds: finalRounds, matches, edges, edgeMeta, qualificationNodes, conflicts, issues, reliable };
}

/** ¿Hay un ciclo entre aristas partido→partido? (DFS con colores). */
export function hasCycle(edges: { from: string; to: string; toKind: string }[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.toKind !== "match") continue;
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
  }
  const color = new Map<string, 1 | 2>();
  const visit = (n: string): boolean => {
    const c = color.get(n);
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(n, 1);
    for (const next of adj.get(n) ?? []) if (visit(next)) return true;
    color.set(n, 2);
    return false;
  };
  for (const n of adj.keys()) if (visit(n)) return true;
  return false;
}

/* ═══════════════════════════════ LAYOUT (puro) ═══════════════════════════════ */

export interface BracketColumn { round: BracketRound; matches: BracketMatch[] }
export interface BracketLayout {
  upper: BracketColumn[];
  lower: BracketColumn[];
  /** Nodos de clasificación de la fase, por rama, para la columna final «Clasificados». */
  qualifiedUpper: QualificationNode[];
  qualifiedLower: QualificationNode[];
}

export function layoutStage(model: BracketModel, stageId: string | null): BracketLayout {
  const rounds = model.rounds.filter((r) => r.stageId === stageId);
  const col = (r: BracketRound): BracketColumn => ({ round: r, matches: r.matchIds.map((id) => model.matches[id]) });
  const nodes = model.qualificationNodes.filter((n) => n.stageId === stageId);
  return {
    upper: rounds.filter((r) => r.side !== "lower").map(col),
    lower: rounds.filter((r) => r.side === "lower").map(col),
    qualifiedUpper: nodes.filter((n) => n.side !== "lower"),
    qualifiedLower: nodes.filter((n) => n.side === "lower"),
  };
}

export const isDefined = (m: BracketMatch): boolean => !!m.teamA && !!m.teamB;
export const canPickMatch = (m: BracketMatch): boolean => isDefined(m) && m.lockState === "open" && !!m.questionId;
