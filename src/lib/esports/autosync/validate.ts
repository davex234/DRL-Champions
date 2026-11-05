/**
 * ESPORTS AUTO-SYNC · VALIDACIÓN DE FUENTE Y TRANSICIONES (Fase 24.6) — funciones PURAS.
 *
 * Antes de persistir nada importante se comprueba el payload. Lo contradictorio se descarta
 * con motivo (skip seguro + registro), nunca se «arregla» inventando. Y una ejecución incompleta
 * (timeout, HTML raro, lista vacía sospechosa) NUNCA se interpreta como «los partidos han
 * desaparecido»: el sync no borra, y además aquí se corta antes de escribir.
 */
import { normalizeStatus, type RawMatch } from "@/lib/esports/sync/source";
import type { EsportsAutoSyncConfig } from "./config";

export interface MatchIssue { matchId: string; reason: string }

/** Lo que el sync sabe de un partido ANTES de esta pasada (fila de `matches`). */
export interface KnownMatch {
  id: string;
  status: string;
  score_a: number | null;
  score_b: number | null;
  winner_team_id: string | null;
  start_time?: string | null;
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/**
 * ¿Es un hueco todavía sin equipo (TBD/TBA/TBC)? El conector VLR los convierte en un «equipo»
 * (`vlr-t-tbd`) porque aparecen en las tarjetas de partido. Un partido TBD vs TBD es ESTRUCTURA
 * legítima del cuadro (24.4 la persiste con sus aristas), no un payload inválido: se acepta y se
 * escribe; lo que nunca debe hacer es generar preguntas de Pick'ems (eso lo filtra el dominio).
 */
export function isPlaceholderTeamId(id: string | null | undefined): boolean {
  if (!id) return false;
  const tail = id.toLowerCase().replace(/^vlr-t-/, "");
  return tail === "tbd" || tail === "tba" || tail === "tbc" || tail === "sin-nombre";
}

/** Valida un partido normalizado. `null` = válido; si no, el motivo. */
export function validateRawMatch(m: RawMatch): string | null {
  if (!m.id || typeof m.id !== "string") return "sin id";
  if (!m.teamAId || !m.teamBId) return "equipo sin identidad";
  if (m.teamAId === m.teamBId && !isPlaceholderTeamId(m.teamAId)) return "los dos lados son el mismo equipo";
  if (m.startTime && !Number.isFinite(Date.parse(m.startTime))) return "fecha de inicio ilegible";
  if (m.scoreA != null && !isInt(m.scoreA)) return "marcador A no entero";
  if (m.scoreB != null && !isInt(m.scoreB)) return "marcador B no entero";
  if (m.winnerTeamId && m.winnerTeamId !== m.teamAId && m.winnerTeamId !== m.teamBId) {
    return "ganador que no es ninguno de los dos equipos";
  }
  const status = normalizeStatus(m.status);
  if (m.scoreA != null && m.scoreB != null && m.winnerTeamId && m.scoreA !== m.scoreB) {
    const byScore = m.scoreA > m.scoreB ? m.teamAId : m.teamBId;
    if (byScore !== m.winnerTeamId) return "ganador contradice el marcador";
  }
  if (status === "finished" && (isPlaceholderTeamId(m.teamAId) || isPlaceholderTeamId(m.teamBId))) {
    return "terminado con un hueco sin equipo";
  }
  if (status === "finished") {
    const hasScore = m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB;
    if (!m.winnerTeamId && !hasScore) return "terminado sin ganador ni marcador";
  }
  if (m.progression?.winnerTo?.matchId === m.id || m.progression?.loserTo?.matchId === m.id) {
    return "progresión hacia sí mismo";
  }
  return null;
}

export type Transition = "same" | "new" | "progress" | "correction" | "revert" | "regression";

/**
 * Clasifica el cambio de estado entre lo conocido y lo que trae la fuente.
 *
 *   upcoming→live, upcoming→finished, live→finished  progress   (se aplica; UPCOMING→FINISHED
 *                                                                 directo es válido: no hace falta
 *                                                                 haber visto el directo)
 *   finished→finished con marcador/ganador distinto  correction (se aplica y se REGISTRA)
 *   live→upcoming                                    revert     (se aplica: un directo que se
 *                                                                 retrasa; no hay resultado que
 *                                                                 perder)
 *   finished→upcoming/live                           regression (se RECHAZA: no se pierde un
 *                                                                 resultado por una página rara;
 *                                                                 salvo que el «finished» previo
 *                                                                 no tuviera resultado alguno)
 */
export function classifyTransition(prev: KnownMatch | undefined, next: RawMatch): Transition {
  if (!prev) return "new";
  const from = normalizeStatus(prev.status);
  const to = normalizeStatus(next.status);
  if (from === to) {
    if (from !== "finished") return "same";
    const sameScore = (prev.score_a ?? null) === (next.scoreA ?? null) && (prev.score_b ?? null) === (next.scoreB ?? null);
    const sameWinner = (prev.winner_team_id ?? null) === (next.winnerTeamId ?? null);
    return sameScore && sameWinner ? "same" : "correction";
  }
  if (from === "finished") {
    const hadResult = prev.winner_team_id != null || (prev.score_a != null && prev.score_b != null);
    return hadResult ? "regression" : "progress";
  }
  if (from === "live" && to === "upcoming") return "revert";
  return "progress";
}

export interface MatchDiff {
  accepted: RawMatch[];
  unchanged: number;
  created: string[];
  updated: string[];
  /** Pasan a `finished` en esta pasada (incluye upcoming→finished directo). */
  finished: string[];
  /** Ya estaban `finished` y la fuente ha cambiado marcador/ganador. */
  corrections: { matchId: string; from: string; to: string }[];
  /** Rechazados por regresión; se conserva lo que había. */
  rejected: MatchIssue[];
  /** Descartados por payload inválido. */
  invalid: MatchIssue[];
}

const isoOrNull = (s: string | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** Compara la fuente con lo conocido y decide qué se acepta. Puro. */
export function diffMatches(known: KnownMatch[], incoming: RawMatch[]): MatchDiff {
  const byId = new Map(known.map((k) => [k.id, k]));
  const out: MatchDiff = { accepted: [], unchanged: 0, created: [], updated: [], finished: [], corrections: [], rejected: [], invalid: [] };
  const seen = new Set<string>();
  for (const m of incoming) {
    if (seen.has(m.id)) { out.invalid.push({ matchId: m.id, reason: "id duplicado en la fuente" }); continue; }
    seen.add(m.id);
    const bad = validateRawMatch(m);
    if (bad) { out.invalid.push({ matchId: m.id, reason: bad }); continue; }
    const prev = byId.get(m.id);
    const t = classifyTransition(prev, m);
    if (t === "regression") {
      out.rejected.push({ matchId: m.id, reason: `regresión ${normalizeStatus(prev!.status)}→${normalizeStatus(m.status)} con resultado previo` });
      continue;
    }
    out.accepted.push(m);
    const toFinished = normalizeStatus(m.status) === "finished";
    if (t === "new") { out.created.push(m.id); if (toFinished) out.finished.push(m.id); continue; }
    if (t === "same") {
      // Sin cambio de estado ni resultado. Un cambio de hora se acepta (upsert idempotente) y
      // cuenta como actualización; lo demás es «sin cambios».
      const p = prev!;
      const nextStart = isoOrNull(m.startTime);
      const prevStart = isoOrNull(p.start_time ?? undefined);
      if (nextStart !== null && nextStart !== prevStart) out.updated.push(m.id); else out.unchanged++;
      continue;
    }
    out.updated.push(m.id);
    if (t === "correction") {
      const p = prev!;
      out.corrections.push({
        matchId: m.id,
        from: `${p.score_a ?? "-"}:${p.score_b ?? "-"} ${p.winner_team_id ?? "?"}`,
        to: `${m.scoreA ?? "-"}:${m.scoreB ?? "-"} ${m.winnerTeamId ?? "?"}`,
      });
    }
    if (toFinished && normalizeStatus(prev!.status) !== "finished") out.finished.push(m.id);
  }
  return out;
}

/**
 * ¿La lista de la fuente es sospechosa frente a lo conocido? Vacía cuando había partidos, o
 * encogida por debajo de la fracción configurada. Una página parcial no debe escribir nada.
 */
export function isSuspiciousShrink(knownCount: number, incomingCount: number, cfg: EsportsAutoSyncConfig): string | null {
  if (knownCount === 0) return null;
  if (incomingCount === 0) return `la fuente no devuelve partidos y se conocían ${knownCount}`;
  if (knownCount >= 4 && incomingCount < knownCount * cfg.suspiciousShrinkRatio) {
    return `la fuente devuelve ${incomingCount} partidos de ${knownCount} conocidos`;
  }
  return null;
}

/** Huella estable de los resultados aceptados: cambia si cambia un estado, marcador o ganador. */
export function resultsFingerprint(matches: RawMatch[]): string {
  const parts = matches
    .map((m) => `${m.id}:${normalizeStatus(m.status)}:${m.scoreA ?? ""}-${m.scoreB ?? ""}:${m.winnerTeamId ?? ""}`)
    .sort();
  // FNV-1a de 32 bits: suficiente para detectar cambio, sin dependencias.
  let h = 0x811c9dc5;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  }
  return `${parts.length}:${h.toString(16).padStart(8, "0")}`;
}
