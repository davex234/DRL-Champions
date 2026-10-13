/**
 * EL CICLO DE VIDA DE UN PICK'EM (Fase 10, SOLO SERVIDOR).
 *
 * ────────────────────────── QUÉ CONECTA ──────────────────────────
 *
 *   sincronización competitiva  →  ESTO  →  corrector de Pick'ems  →  recompensas
 *   (`lib/esports/sync`)                    (`app_score_pickem_event`)  (`services/rewards`)
 *
 * Las dos puntas existían desde la Fase B y funcionaban. Lo que no existía era el medio:
 * nadie creaba preguntas a partir de los partidos reales y nadie fijaba el resultado
 * cuando un partido terminaba. Las preguntas solo nacían en `scripts/seed-demo.ts` y el
 * corrector solo lo llamaban tres scripts de prueba.
 *
 * Cuatro pasos, y cada uno se puede ejecutar por separado y las veces que haga falta:
 *
 *   1. `ensurePickemEvent`  — un Pick'em por torneo. Si ya hay uno, se reutiliza.
 *   2. `syncQuestions`      — una pregunta por partido predecible. Idempotente por el
 *                             índice único (pickem_event_id, match_id) de la 0018.
 *   3. `resolveFinished`    — fija el resultado de las preguntas cuyo partido ya acabó.
 *   4. `scoreIfReady`       — corrige y reparte, si ya hay algo que corregir.
 *
 * ────────────────────────── POR QUÉ ES SEGURO REEJECUTARLO ──────────────────────────
 *
 * Toda la cadena es idempotente, y no por convenio sino por construcción:
 *
 *   · Las preguntas, por un índice único en la base de datos.
 *   · El resultado correcto, porque fijarlo dos veces al mismo valor no cambia nada.
 *   · Los puntos, porque `app_score_pickem_event` recalcula desde cero y ajusta
 *     `profiles.points` POR DIFERENCIA (migración 0012).
 *   · Las recompensas, por la clave del libro mayor.
 *
 * Eso es lo que permite llamarlo desde la sincronización, que corre cada pocos minutos.
 *
 * ────────────────────────── LO QUE NO HACE ──────────────────────────
 *
 * No decide resultados. El ganador de un partido lo trae la sincronización desde el
 * origen (VLR o la fuente mock) y aquí solo se traduce a «opción a» u «opción b». Si el
 * origen no ha publicado ganador, la pregunta se queda sin corregir — que es lo correcto.
 *
 * No toca `profiles.points` directamente: eso es del corrector.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMatchQuestions, buildScoreQuestions, buildQualificationQuestions, correctOptionForKind,
  type MatchInput, type QualificationMatchInput,
} from "@/domain/pickems/questions";
import {
  buildChampionQuestion, correctAdvanceOption, correctChampionOption, mergeOptions, teamOptionKey,
} from "@/domain/pickems/tournament";
import { scorePickemEvent } from "./pickems";
import { isMissingColumnError, withoutProgressionColumns } from "@/lib/esports/sync/schemaCompat";

export interface LifecycleResult {
  eventId: string;
  pickemEventId: string | null;
  /** Preguntas creadas en esta pasada. */
  created: number;
  /** Preguntas cuyo resultado se ha fijado en esta pasada. */
  resolved: number;
  /**
   * Fase 24.6 · preguntas ya corregidas cuyo resultado se ha RECTIFICADO porque la fuente
   * corrigió el partido (solo las que el sync señaló en `reconcileMatchIds`).
   */
  corrected: number;
  /** ¿Se ha corregido el Pick'em? */
  scored: boolean;
  usersScored: number;
  /** Motivo por el que no se hizo algo, cuando aplica. Para el registro, no para el jugador. */
  notes: string[];
}

const MATCH_COLUMNS = "id, team_a, team_b, start_time, status, winner_team, round, match_order, score_a, score_b, winner_qualifies, winner_qualifies_label, progression_confidence";

/**
 * Fase 24.6 · opciones del ciclo. Todas son ADITIVAS: sin ellas, el comportamiento es el de siempre.
 */
export interface LifecycleOptions {
  /**
   * Partidos cuyo resultado la FUENTE ha corregido después de estar `finished` (lo detecta el
   * sync comparando con lo que ya había en la base de datos). Solo para esos partidos se permite
   * reescribir un `correct_option` ya fijado. Fuera de esta lista, el pasado no se toca: si el
   * origen se corrige a sí mismo sin que el sync lo haya visto, lo revisa un humano.
   */
  reconcileMatchIds?: Iterable<string>;
}

/**
 * Partidos del torneo con las columnas que lee el ciclo.
 *
 * PRE-0045 (Fase 24.6): las tres columnas de estructura no existen y PostgREST responde 42703.
 * Antes eso tumbaba el ciclo entero (ni preguntas, ni resolución, ni scoring). Ahora se reintenta
 * sin ellas: las preguntas «¿quién se clasifica?» simplemente no nacen, que es lo que ese
 * esquema puede representar.
 */
async function loadMatches(sb: SupabaseClient, eventId: string): Promise<QualificationMatchInput[]> {
  const full = await sb.from("matches").select(MATCH_COLUMNS).eq("event_id", eventId);
  if (!full.error) return (full.data ?? []) as QualificationMatchInput[];
  if (!isMissingColumnError(full.error)) throw new Error(full.error.message);
  const base = await sb.from("matches").select(withoutProgressionColumns(MATCH_COLUMNS)).eq("event_id", eventId);
  if (base.error) throw new Error(base.error.message);
  return (base.data ?? []) as unknown as QualificationMatchInput[];
}

/**
 * Pick'em CLÁSICO (legacy) del torneo, solo si YA existe y está clasificado `LEGACY_V1`.
 *
 * F87.2 · los Pick'ems clásicos están RETIRADOS para torneos nuevos (0072): este ciclo ya no crea ninguno —las
 * predicciones nuevas van por Pick'ems 2.0— y solo termina los que existían antes del corte, con SUS reglas. Además
 * de no intentarlo aquí, la BD rechaza cualquier INSERT (`PICKEM_LEGACY_RETIRED`), así que ningún camino normal
 * (panel, API, worker, script) puede crear uno. `created` se conserva en la firma y es siempre `false`.
 *
 * Un torneo tiene UN Pick'em. Si hubiera varios (algo que el esquema permite pero el producto no usa), se toma el
 * más antiguo: es el que ya tiene las respuestas de la gente.
 */
export async function ensurePickemEvent(
  sb: SupabaseClient, eventId: string,
): Promise<{ id: string; created: boolean } | null> {
  const { data: existing } = await sb
    .from("pickem_events")
    .select("id")
    .eq("event_id", eventId)
    .eq("legacy_mode", "LEGACY_V1")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return { id: (existing as { id: string }).id, created: false };
  return null;
}

/**
 * Crea las preguntas que faltan para los partidos predecibles del torneo.
 *
 * No borra ni reescribe las que ya existen: una pregunta con respuestas de gente detrás no
 * se toca. Solo se refrescan las ETIQUETAS de los equipos, porque un rebranding o una
 * corrección del origen no debe dejar la pregunta enseñando un nombre viejo — la clave de
 * la opción («a»/«b») no cambia, así que las respuestas guardadas siguen siendo válidas.
 */
export async function syncQuestions(
  sb: SupabaseClient, pickemEventId: string, eventId: string, now = Date.now(),
): Promise<{ created: number; relabelled: number }> {
  const matches = await loadMatches(sb, eventId);

  /*
   * Los DOS tipos de pregunta salen del mismo generador puro y se escriben en la misma
   * pasada (Fase 13). No hay un segundo ciclo de vida: hay una lista más larga.
   */
  const specs = [
    ...buildMatchQuestions(matches, now),
    ...buildScoreQuestions(matches, now),
    // Fase 24.4 · «¿quién se clasifica?» solo donde la estructura CONFIRMADA lo dice.
    ...buildQualificationQuestions(matches, now),
  ];

  /*
   * LA PREGUNTA DE CAMPEÓN (Fase 24.2) va en la misma pasada, con las mismas reglas de
   * idempotencia, pero por su propio camino: no cuelga de un partido (`match_id` nulo), así
   * que el índice único por partido no la cubre y se comprueba por tipo.
   */
  const champion = await syncChampionQuestion(sb, pickemEventId, matches, now);

  if (specs.length === 0) return { created: champion.created, relabelled: champion.relabelled };

  const { data: existingRows } = await sb
    .from("pickem_questions").select("id, match_id, kind, options, points")
    .eq("pickem_event_id", pickemEventId).not("match_id", "is", null);
  /*
   * La clave lleva el TIPO desde la 0023: un partido tiene una pregunta de ganador y otra
   * de resultado, y sin el tipo la segunda se tomaría por un duplicado de la primera.
   */
  const existing = new Map(
    ((existingRows ?? []) as { id: string; match_id: string; kind: string; options: unknown; points: number }[])
      .map((r) => [`${r.match_id}:${r.kind}`, r]),
  );

  const toInsert = specs
    .filter((s) => !existing.has(`${s.matchId}:${s.kind}`))
    .map((s) => ({
      pickem_event_id: pickemEventId,
      kind: s.kind,
      match_id: s.matchId,
      prompt: s.prompt,
      options: s.options,
      points: s.points,
      locks_at: s.locksAt,
      order_idx: s.orderIdx,
    }));

  let created = 0;
  if (toInsert.length > 0) {
    /*
     * `ignoreDuplicates` sobre el índice único de la 0018: si dos pasadas de la
     * sincronización se solapan, la segunda no revienta ni duplica. Es la red de
     * seguridad de la comprobación de arriba, no su sustituta.
     */
    const { data: ins, error: insErr } = await sb
      .from("pickem_questions")
      .upsert(toInsert, { onConflict: "pickem_event_id,match_id,kind", ignoreDuplicates: true })
      .select("id");
    if (insErr) throw new Error(insErr.message);
    created = ((ins ?? []) as unknown[]).length;
  }

  /*
   * Refresco de las que ya existían.
   *
   * ────────────────────── UN FALLO QUE LA FASE 13 DESTAPO ──────────────────────
   *
   * Hasta ahora esto refrescaba `options` y `prompt` pero NO `points`, y solo se disparaba
   * si cambiaban las opciones. Consecuencia: un partido que se movía en el cuadro —de
   * cuartos a semifinal, que es lo normal cuando la sincronización corrige la ronda— se
   * quedaba con los puntos de la ronda vieja PARA SIEMPRE. En la base de datos de demo hay
   * cuatro preguntas así: valen 10 o 15 puntos cuando su ronda dice 15 o 20.
   *
   * No se veía porque no había con qué comparar. Al añadir la pregunta de resultado exacto
   * —que sí calcula sus puntos con la ronda actual— el mismo partido pasó a enseñar «10
   * pts» para el ganador y «30 pts» para el marcador, y la incoherencia salió a la cara.
   *
   * Refrescar los puntos es seguro aquí: `buildMatchQuestions` y `buildScoreQuestions` solo
   * emiten preguntas de partidos que TODAVÍA NO HAN EMPEZADO, así que ninguna de las que se
   * tocan está cerrada ni corregida. Cambiar el valor de una pregunta ya respondida sería
   * otra cosa, y no pasa por aquí.
   */
  let relabelled = 0;
  for (const s of specs) {
    const prev = existing.get(`${s.matchId}:${s.kind}`);
    if (!prev) continue;
    const sameOptions = JSON.stringify(prev.options) === JSON.stringify(s.options);
    const samePoints = prev.points === s.points;
    if (sameOptions && samePoints) continue;
    const { error: upErr } = await sb
      .from("pickem_questions")
      .update({ options: s.options, prompt: s.prompt, points: s.points })
      .eq("id", prev.id);
    if (!upErr) relabelled++;
  }

  return { created: created + champion.created, relabelled: relabelled + champion.relabelled };
}

/**
 * Crea —o refresca— la pregunta «¿Quién será campeón?» de un torneo.
 *
 * ────────────────────────── CUÁNDO NACE ──────────────────────────
 *
 * Solo si el dominio dice que se puede hacer bien (`buildChampionQuestion`): participantes
 * suficientes en los partidos REALES, torneo sin empezar y una fecha de inicio a la que
 * anclar el cierre. Si falta cualquiera de las tres cosas, no se crea nada. Un torneo que
 * ya está en marcha cuando llega aquí por primera vez se queda sin pregunta de campeón: es
 * preferible a abrirla con el cuadro a la vista.
 *
 * ────────────────────────── CUÁNDO SE REFRESCA ──────────────────────────
 *
 * Mientras está abierta, si el origen incorpora equipos nuevos (un cuadro que se va
 * rellenando) se AÑADEN como opciones. Nunca se quita una: podría tener respuestas detrás.
 * Cerrada, no se toca.
 *
 * Idempotente por comprobación previa: una por torneo, identificada por `kind`.
 */
export async function syncChampionQuestion(
  sb: SupabaseClient, pickemEventId: string, matches: MatchInput[], now = Date.now(),
): Promise<{ created: number; relabelled: number }> {
  const { data: existing, error } = await sb
    .from("pickem_questions").select("id, options, locks_at, correct_option")
    .eq("pickem_event_id", pickemEventId).eq("kind", "champion")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);

  const spec = buildChampionQuestion(matches, now);

  if (!existing) {
    if (!spec) return { created: 0, relabelled: 0 };
    const { error: insErr } = await sb.from("pickem_questions").insert({
      pickem_event_id: pickemEventId,
      kind: "champion",
      match_id: null,
      prompt: spec.prompt,
      options: spec.options,
      points: spec.points,
      locks_at: spec.locksAt,
      order_idx: spec.orderIdx,
    });
    if (insErr) throw new Error(insErr.message);
    return { created: 1, relabelled: 0 };
  }

  const row = existing as { id: string; options: { key: string; label: string }[]; locks_at: string; correct_option: string | null };
  // Cerrada o corregida: el pasado no se reescribe.
  if (row.correct_option || new Date(row.locks_at).getTime() <= now) return { created: 0, relabelled: 0 };
  if (!spec) return { created: 0, relabelled: 0 };

  const merged = mergeOptions(row.options ?? [], spec.options);
  if (JSON.stringify(merged) === JSON.stringify(row.options)) return { created: 0, relabelled: 0 };
  const { error: upErr } = await sb.from("pickem_questions").update({ options: merged }).eq("id", row.id);
  if (upErr) throw new Error(upErr.message);
  return { created: 0, relabelled: 1 };
}

/**
 * Fija el resultado de las preguntas cuyo partido ya terminó.
 *
 * Solo toca las que NO tienen resultado todavía: reescribir una ya corregida sería
 * cambiar el pasado, y si el origen se corrigiera a sí mismo lo correcto es que un humano
 * lo revise, no que la sincronización lo cambie sin avisar.
 */
export async function resolveFinished(
  sb: SupabaseClient, pickemEventId: string, eventId: string, opts: LifecycleOptions = {},
): Promise<{ resolved: number; pending: number; corrected: number }> {
  const reconcile = new Set(opts.reconcileMatchIds ?? []);
  const { data: qRows, error } = await sb
    .from("pickem_questions").select("id, match_id, kind, correct_option, options")
    .eq("pickem_event_id", pickemEventId);
  if (error) throw new Error(error.message);
  const questions = (qRows ?? []) as {
    id: string; match_id: string | null; kind: string; correct_option: string | null;
    options: { key: string; label: string }[];
  }[];
  if (questions.length === 0) return { resolved: 0, pending: 0, corrected: 0 };

  const matches: MatchInput[] = await loadMatches(sb, eventId);
  const byId = new Map(matches.map((m) => [m.id, m]));

  /*
   * CLASIFICADOS (Fase 24.2): solo se piden si hay alguna pregunta `advance` sin corregir.
   * `standings.status = 'qualified'` lo rellena el origen; si no hay filas, no hay nada que
   * corregir y la pregunta se queda pendiente — que es lo correcto.
   */
  let qualifiedKeys: string[] | null = null;
  const loadQualified = async (): Promise<string[]> => {
    if (qualifiedKeys) return qualifiedKeys;
    const { data: st } = await sb
      .from("standings").select("team_id, status, teams(name)")
      .eq("event_id", eventId).eq("status", "qualified");
    qualifiedKeys = ((st ?? []) as unknown as { team_id: string; teams: { name: string } | null }[])
      .map((r) => r.teams?.name ?? r.team_id)
      .map(teamOptionKey);
    return qualifiedKeys;
  };

  let resolved = 0;
  let pending = 0;
  let corrected = 0;
  for (const q of questions) {
    /*
     * Fase 24.6 · CORRECCIÓN DE LA FUENTE. Una pregunta ya corregida solo se reabre si el sync ha
     * visto cambiar el resultado de SU partido (evidencia, no sospecha). Reescribir el resultado es
     * seguro para los puntos: `app_score_pickem_event` recalcula desde cero y ajusta por diferencia.
     * Las recompensas por escalón ya pagadas no se retiran: su clave de libro mayor es una sola vez
     * por escalón, y ese es el contrato que la Fase 10 fijó.
     */
    const reconciling = !!q.correct_option && !!q.match_id && reconcile.has(q.match_id);
    if (q.correct_option && !reconciling) continue;
    let correct: string | null = null;
    if (q.kind === "champion") {
      correct = correctChampionOption(matches, q.options ?? []);
    } else if (q.kind === "advance" && q.match_id) {
      // 24.4 · clasificación por partido: se clasifica el ganador real de ese partido.
      const m = byId.get(q.match_id);
      correct = m ? correctOptionForKind("match_winner", m) : null;
    } else if (q.kind === "advance") {
      correct = correctAdvanceOption(q.options ?? [], await loadQualified());
    } else if (q.match_id) {
      const m = byId.get(q.match_id);
      // El corrector no sabe de tipos: pregunta por el `kind` que leyó de la fila.
      correct = m ? correctOptionForKind(q.kind, m) : null;
    }
    if (!correct) { if (!reconciling) pending++; continue; }
    // Misma respuesta que la ya fijada: una corrección de marcador que no cambia el ganador.
    if (reconciling && correct === q.correct_option) continue;
    // Se usa la RPC y no un UPDATE directo: es la operación que el dominio declara para
    // esto, y mantenerla como única puerta permite auditarla en un solo sitio.
    const { error: rpcErr } = await sb.rpc("app_set_correct_option", {
      p_question_id: q.id, p_correct: correct,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    if (reconciling) corrected++; else resolved++;
  }
  return { resolved, pending, corrected };
}

/**
 * Corrige el Pick'em si ya hay algo que corregir.
 *
 * Se corrige EN CUANTO hay al menos una pregunta resuelta, sin esperar a que acabe el
 * torneo. Es deliberado: `app_score_pickem_event` recalcula desde cero y ajusta por
 * diferencia, así que corregir a mitad de torneo y volver a corregir al final da el mismo
 * total. A cambio, el jugador ve sus puntos subir el mismo día que acierta, en lugar de
 * dos semanas después — que es la diferencia entre un ciclo vivo y un informe.
 *
 * La recompensa por escalón sí se paga una sola vez por escalón alcanzado: su clave de
 * idempotencia es `pickem:<evento>:<escalón>`. Subir de escalón más adelante paga el
 * escalón nuevo, no otra vez el viejo.
 */
export async function scoreIfReady(
  sb: SupabaseClient, pickemEventId: string,
): Promise<{ scored: boolean; users: number; note?: string }> {
  const { count } = await sb
    .from("pickem_questions")
    .select("id", { count: "exact", head: true })
    .eq("pickem_event_id", pickemEventId)
    .not("correct_option", "is", null);
  if (!count || count === 0) return { scored: false, users: 0, note: "sin preguntas resueltas" };

  const res = await scorePickemEvent(sb, pickemEventId);
  if (!res.ok) return { scored: false, users: 0, note: res.error };
  return { scored: true, users: res.data?.users ?? 0 };
}

/**
 * La cadena completa para un torneo. Es lo que llama la sincronización.
 *
 * Nunca lanza: un fallo aquí NO puede tumbar la sincronización competitiva, que es la que
 * trae los datos. Se devuelve en `notes` y se sigue.
 */
export async function runPickemLifecycle(
  sb: SupabaseClient, eventId: string, now = Date.now(), opts: LifecycleOptions = {},
): Promise<LifecycleResult> {
  const out: LifecycleResult = {
    eventId, pickemEventId: null, created: 0, resolved: 0, corrected: 0, scored: false, usersScored: 0, notes: [],
  };

  try {
    const pe = await ensurePickemEvent(sb, eventId);
    if (!pe) { out.notes.push("sin Pick'em clásico para este torneo (retirados desde F87.1: las predicciones nuevas van por Pick'ems 2.0)"); return out; }
    out.pickemEventId = pe.id;
    if (pe.created) out.notes.push("Pick'em creado");

    const q = await syncQuestions(sb, pe.id, eventId, now);
    out.created = q.created;
    if (q.relabelled > 0) out.notes.push(`${q.relabelled} etiqueta(s) refrescada(s)`);

    const r = await resolveFinished(sb, pe.id, eventId, opts);
    out.resolved = r.resolved;
    out.corrected = r.corrected;
    if (r.corrected > 0) out.notes.push(`${r.corrected} resultado(s) rectificado(s) por corrección de la fuente`);

    const s = await scoreIfReady(sb, pe.id);
    out.scored = s.scored;
    out.usersScored = s.users;
    if (s.note) out.notes.push(s.note);
  } catch (e) {
    out.notes.push((e as Error).message);
  }

  return out;
}
