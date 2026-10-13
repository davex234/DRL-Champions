/**
 * F86 · CUADRO DE ELIMINACIÓN DIRECTA (puro). ES LA ESPECIFICACIÓN que la migración 0069 reproduce en SQL
 * (`_cup_generate`, `_cup_place`, `_cup_finish_match`); el ensayo sobre la copia del backup compara las dos.
 *
 * Reglas:
 *   · Tamaño = la potencia de 2 ≥ participantes (mínimo 4). Los huecos son BYES y se los llevan las cabezas de serie
 *     más altas: con 5 inscritos y cuadro de 8, los seeds 1–3 pasan sin jugar.
 *   · Colocación estándar (`seedPositions`): el 1 y el 2 solo pueden cruzarse en la final, el 1–4 en semifinales…
 *   · El cuadro es FIJO: nada se re-siembra entre rondas.
 *   · Un BYE avanza sin partida y no es una victoria de combate. Un lado VACÍO aguas abajo (doble no presentado) da
 *     paso directo al otro lado; dos lados vacíos dejan el cruce VOID y el vacío sigue subiendo. El árbol nunca se rompe.
 *   · Solo un resultado FINAL alimenta la ronda siguiente; un cruce retenido (ACTION_REQUIRED) no hace avanzar a nadie.
 */
import type { CupMatchStatus, CupPlacement, CupResolution } from "./types";
import { CUP_MAX_PARTICIPANTS, CUP_MIN_PARTICIPANTS } from "./types";

export type CupSide = "A" | "B";
export type SlotState = { kind: "PLAYER"; userId: string; seed: number | null } | { kind: "EMPTY" } | { kind: "PENDING" };

export interface BracketMatch {
  round: number;
  slot: number;
  a: SlotState;
  b: SlotState;
  status: CupMatchStatus;
  winnerId: string | null;
  resolution: CupResolution | null;
}

export interface Elimination { round: number; placement: CupPlacement }

export interface BracketState {
  size: number;
  rounds: number;
  participants: number;
  matches: BracketMatch[];
  championId: string | null;
  complete: boolean;
  eliminated: Map<string, Elimination>;
}

export type Outcome = { winnerId: string } | { void: true };

export const nextPow2 = (n: number): number => { let p = 1; while (p < n) p *= 2; return p; };

/** Tamaño del cuadro para N inscritos, o `null` si N está fuera de 4–64. */
export function bracketSize(n: number): number | null {
  if (!Number.isInteger(n) || n < CUP_MIN_PARTICIPANTS || n > CUP_MAX_PARTICIPANTS) return null;
  return Math.max(4, nextPow2(n));
}

export const roundsFor = (size: number): number => Math.round(Math.log2(size));

/**
 * Seed que ocupa cada posición de la primera ronda (posiciones 2i y 2i+1 = cruce i). Construcción por duplicación:
 * [1,2] → [1,4,2,3] → [1,8,4,5,2,7,3,6] … En cada paso cada seed s se empareja con (2·len + 1 − s).
 */
export function seedPositions(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const len = order.length * 2;
    order = order.flatMap((s) => [s, len + 1 - s]);
  }
  return order;
}

/** Nombre de la ronda por los jugadores que la disputan (no por su número): nunca nombres falsos. */
export function roundName(round: number, rounds: number): string {
  const stage = 2 ** (rounds - round + 1);
  if (stage === 2) return "Final";
  if (stage === 4) return "Semifinal";
  if (stage === 8) return "Cuartos de final";
  return `Ronda de ${stage}`;
}

/** Hasta dónde llegó quien cae en `round`. El perdedor de la final es subcampeón. */
export function placementForRound(round: number, rounds: number): CupPlacement {
  const stage = 2 ** (rounds - round + 1);
  switch (stage) {
    case 2: return "RUNNER_UP";
    case 4: return "SEMIFINAL";
    case 8: return "QUARTERFINAL";
    case 16: return "ROUND_OF_16";
    case 32: return "ROUND_OF_32";
    default: return "ROUND_OF_64";
  }
}

export const PLACEMENT_LABEL: Record<CupPlacement, string> = {
  CHAMPION: "Campeón", RUNNER_UP: "Subcampeón", SEMIFINAL: "Semifinal", QUARTERFINAL: "Cuartos de final",
  ROUND_OF_16: "Ronda de 16", ROUND_OF_32: "Ronda de 32", ROUND_OF_64: "Ronda de 64",
};
/** Orden de mérito (menor = mejor) para «mejor resultado». */
export const PLACEMENT_RANK: Record<CupPlacement, number> = {
  CHAMPION: 0, RUNNER_UP: 1, SEMIFINAL: 2, QUARTERFINAL: 3, ROUND_OF_16: 4, ROUND_OF_32: 5, ROUND_OF_64: 6,
};

/** Cruce siguiente y lado que alimenta. `null` en la final. */
export function nextOf(round: number, slot: number, rounds: number): { round: number; slot: number; side: CupSide } | null {
  if (round >= rounds) return null;
  return { round: round + 1, slot: slot >> 1, side: slot % 2 === 0 ? "A" : "B" };
}

const idx = (state: BracketState, round: number, slot: number): number => {
  // Rondas contiguas: la ronda r empieza tras las (size − size/2^(r−1)) posiciones previas.
  let offset = 0;
  for (let r = 1; r < round; r++) offset += state.size >> r;
  return offset + slot;
};

export const matchAt = (state: BracketState, round: number, slot: number): BracketMatch | undefined => state.matches[idx(state, round, slot)];

const playerOf = (s: SlotState): string | null => (s.kind === "PLAYER" ? s.userId : null);

/**
 * Cuadro inicial a partir de los inscritos YA ORDENADOS por seed (posición 0 = seed 1). Crea TODOS los cruces de todas
 * las rondas (los huecos se rellenan al avanzar) y resuelve en el acto los BYES de la primera ronda.
 */
export function planBracket(seeded: readonly string[]): BracketState {
  const size = bracketSize(seeded.length);
  if (size === null) throw new Error(`Participantes fuera de rango: ${seeded.length}`);
  if (new Set(seeded).size !== seeded.length) throw new Error("Participante repetido");
  const rounds = roundsFor(size);
  const state: BracketState = { size, rounds, participants: seeded.length, matches: [], championId: null, complete: false, eliminated: new Map() };
  for (let r = 1; r <= rounds; r++) {
    for (let s = 0; s < size >> r; s++) {
      state.matches.push({ round: r, slot: s, a: { kind: "PENDING" }, b: { kind: "PENDING" }, status: "PENDING", winnerId: null, resolution: null });
    }
  }
  const pos = seedPositions(size);
  const slotFor = (seed: number): SlotState => (seed <= seeded.length ? { kind: "PLAYER", userId: seeded[seed - 1], seed } : { kind: "EMPTY" });
  for (let i = 0; i < size / 2; i++) {
    const m = matchAt(state, 1, i)!;
    m.a = slotFor(pos[2 * i]);
    m.b = slotFor(pos[2 * i + 1]);
  }
  for (let i = 0; i < size / 2; i++) autoResolve(state, matchAt(state, 1, i)!);
  return state;
}

/** Con los dos lados definidos: dos jugadores → READY; uno → BYE (avanza); ninguno → VOID (sube el vacío). */
function autoResolve(state: BracketState, m: BracketMatch): void {
  if (m.a.kind === "PENDING" || m.b.kind === "PENDING") { m.status = "PENDING"; return; }
  const a = playerOf(m.a), b = playerOf(m.b);
  if (a && b) { m.status = "READY"; return; }
  if (a || b) { finish(state, m, (a ?? b) as string, "BYE", "BYE"); return; }
  finish(state, m, null, "VOID", null);
}

function finish(state: BracketState, m: BracketMatch, winnerId: string | null, status: CupMatchStatus, resolution: CupResolution | null): void {
  m.status = status;
  m.winnerId = winnerId;
  m.resolution = resolution;
  // Caen los participantes que no avanzan (un BYE no elimina a nadie; un VOID con jugadores = doble no presentado).
  for (const p of [playerOf(m.a), playerOf(m.b)]) {
    if (p && p !== winnerId) state.eliminated.set(p, { round: m.round, placement: placementForRound(m.round, state.rounds) });
  }
  const next = nextOf(m.round, m.slot, state.rounds);
  if (!next) {
    state.complete = true;
    state.championId = winnerId;
    return;
  }
  const n = matchAt(state, next.round, next.slot)!;
  const filled: SlotState = winnerId ? { kind: "PLAYER", userId: winnerId, seed: seedOf(m, winnerId) } : { kind: "EMPTY" };
  const current = next.side === "A" ? n.a : n.b;
  // Un lado del siguiente cruce solo se escribe UNA vez: si ya estaba resuelto, el árbol está corrupto.
  if (current.kind !== "PENDING") throw new Error(`Cruce ${n.round}:${n.slot} ya tenía el lado ${next.side}`);
  if (next.side === "A") n.a = filled; else n.b = filled;
  autoResolve(state, n);
}

const seedOf = (m: BracketMatch, userId: string): number | null => {
  for (const s of [m.a, m.b]) if (s.kind === "PLAYER" && s.userId === userId) return s.seed;
  return null;
};

export type ApplyError = "NO_MATCH" | "NOT_PLAYABLE" | "NOT_A_PARTICIPANT";

/**
 * Aplica un resultado FINAL a un cruce jugable (READY, ACTIVE o ACTION_REQUIRED). `void` = doble no presentado.
 * Devuelve un estado NUEVO (el de entrada no cambia). Un cruce ya resuelto no admite otro resultado: así un mismo
 * resultado repetido 20 veces avanza una sola vez.
 */
export function applyOutcome(
  input: BracketState, round: number, slot: number, outcome: Outcome, resolution: CupResolution,
): { ok: true; state: BracketState } | { ok: false; error: ApplyError } {
  const state = cloneBracket(input);
  const m = matchAt(state, round, slot);
  if (!m) return { ok: false, error: "NO_MATCH" };
  if (m.status !== "READY" && m.status !== "ACTIVE" && m.status !== "ACTION_REQUIRED") return { ok: false, error: "NOT_PLAYABLE" };
  if ("void" in outcome) { finish(state, m, null, "VOID", "ADMIN_DOUBLE_NO_SHOW"); return { ok: true, state }; }
  if (outcome.winnerId !== playerOf(m.a) && outcome.winnerId !== playerOf(m.b)) return { ok: false, error: "NOT_A_PARTICIPANT" };
  finish(state, m, outcome.winnerId, "COMPLETED", resolution);
  return { ok: true, state };
}

/** Marca un cruce como retenido (la partida acabó sin ganador canónico). No avanza a nadie. */
export function holdMatch(input: BracketState, round: number, slot: number): BracketState {
  const state = cloneBracket(input);
  const m = matchAt(state, round, slot);
  if (m && (m.status === "READY" || m.status === "ACTIVE")) m.status = "ACTION_REQUIRED";
  return state;
}

export function cloneBracket(s: BracketState): BracketState {
  return {
    ...s,
    matches: s.matches.map((m) => ({ ...m, a: { ...m.a }, b: { ...m.b } })),
    eliminated: new Map(s.eliminated),
  };
}

/** Cruces que se pueden jugar ahora mismo (dos participantes, sin resultado). */
export const playable = (s: BracketState): BracketMatch[] => s.matches.filter((m) => m.status === "READY" || m.status === "ACTIVE" || m.status === "ACTION_REQUIRED");

/**
 * INVARIANTES verificables del cuadro. Devuelve la lista de violaciones (vacía = sano). Se usa en las pruebas de
 * propiedades (miles de cuadros aleatorios) y la misma lista se comprueba en SQL en el ensayo.
 */
export function bracketViolations(s: BracketState, seeded?: readonly string[]): string[] {
  const out: string[] = [];
  const r1 = s.matches.filter((m) => m.round === 1);
  const firstRound = r1.flatMap((m) => [playerOf(m.a), playerOf(m.b)]).filter((x): x is string => !!x);
  if (firstRound.length !== s.participants) out.push(`ronda 1 con ${firstRound.length} jugadores, se esperaban ${s.participants}`);
  if (new Set(firstRound).size !== firstRound.length) out.push("un jugador aparece dos veces en la ronda 1");
  if (seeded && [...seeded].sort().join() !== [...firstRound].sort().join()) out.push("los jugadores de la ronda 1 no son los inscritos");
  const byes = r1.filter((m) => m.a.kind === "EMPTY" || m.b.kind === "EMPTY").length;
  if (byes !== s.size - s.participants) out.push(`byes ${byes}, se esperaban ${s.size - s.participants}`);
  if (r1.some((m) => m.a.kind === "EMPTY" && m.b.kind === "EMPTY")) out.push("cruce de ronda 1 sin nadie");
  for (let r = 1; r <= s.rounds; r++) {
    const ps = s.matches.filter((m) => m.round === r).flatMap((m) => [playerOf(m.a), playerOf(m.b)]).filter((x): x is string => !!x);
    if (new Set(ps).size !== ps.length) out.push(`un jugador aparece dos veces en la ronda ${r}`);
  }
  for (const m of s.matches) {
    const a = playerOf(m.a), b = playerOf(m.b);
    if (a && a === b) out.push(`cruce ${m.round}:${m.slot} con el mismo jugador dos veces`);
    if (m.winnerId && m.winnerId !== a && m.winnerId !== b) out.push(`cruce ${m.round}:${m.slot}: el ganador no es participante`);
    if ((m.status === "COMPLETED" || m.status === "BYE") && !m.winnerId) out.push(`cruce ${m.round}:${m.slot} terminado sin ganador`);
    if (m.status === "VOID" && m.winnerId) out.push(`cruce ${m.round}:${m.slot} vacío con ganador`);
    if (m.round > 1) {
      for (const [side, src] of [["A", 2 * m.slot], ["B", 2 * m.slot + 1]] as const) {
        const from = matchAt(s, m.round - 1, src)!;
        const here = side === "A" ? m.a : m.b;
        const resolved = from.status === "COMPLETED" || from.status === "BYE" || from.status === "VOID";
        if (!resolved && here.kind !== "PENDING") out.push(`cruce ${m.round}:${m.slot} lado ${side} relleno antes de que termine su origen`);
        if (resolved && (here.kind === "PLAYER" ? here.userId : null) !== from.winnerId) out.push(`cruce ${m.round}:${m.slot} lado ${side} no es el ganador de su origen`);
      }
    }
  }
  const final = s.matches[s.matches.length - 1];
  const finalDone = final.status === "COMPLETED" || final.status === "BYE" || final.status === "VOID";
  if (s.complete !== finalDone) out.push("«completo» no coincide con el estado de la final");
  if (s.championId !== (finalDone ? final.winnerId : null)) out.push("el campeón no es el ganador de la final");
  if (s.championId && s.eliminated.has(s.championId)) out.push("el campeón figura como eliminado");
  return out;
}
