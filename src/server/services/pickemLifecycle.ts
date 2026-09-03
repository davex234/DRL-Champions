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
  buildMatchQuestions, buildScoreQuestions, correctOptionForKind, type MatchInput,
} from "@/domain/pickems/questions";
import { scorePickemEvent } from "./pickems";

export interface LifecycleResult {
  eventId: string;
  pickemEventId: string | null;
  /** Preguntas creadas en esta pasada. */
  created: number;
  /** Preguntas cuyo resultado se ha fijado en esta pasada. */
  resolved: number;
  /** ¿Se ha corregido el Pick'em? */
  scored: boolean;
  usersScored: number;
  /** Motivo por el que no se hizo algo, cuando aplica. Para el registro, no para el jugador. */
  notes: string[];
}

const MATCH_COLUMNS = "id, team_a, team_b, start_time, status, winner_team, round, match_order, score_a, score_b";

/**
 * Pick'em del torneo, creándolo si no existe.
 *
 * Un torneo tiene UN Pick'em. Si hubiera varios (algo que el esquema permite pero el
 * producto no usa), se toma el más antiguo: es el que ya tiene las respuestas de la gente.
 *
 * `locks_at` del Pick'em es el cierre del CONJUNTO y se pone en el último partido conocido.
 * No es lo que cierra cada pregunta —eso es por pregunta— sino la fecha a partir de la
 * cual ya no tiene sentido enseñarlo como abierto.
 */
export async function ensurePickemEvent(
  sb: SupabaseClient, eventId: string,
): Promise<{ id: string; created: boolean } | null> {
  const { data: existing } = await sb
    .from("pickem_events")
    .select("id")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return { id: (existing as { id: string }).id, created: false };

  const { data: ev } = await sb
    .from("events").select("id, name, end_date").eq("id", eventId).maybeSingle();
  if (!ev) return null;
  const event = ev as { id: string; name: string; end_date: string | null };

  const { data: lastMatch } = await sb
    .from("matches").select("start_time").eq("event_id", eventId)
    .not("start_time", "is", null)
    .order("start_time", { ascending: false }).limit(1).maybeSingle();

  const locksAt =
    (lastMatch as { start_time: string } | null)?.start_time
    ?? event.end_date
    // Sin partidos ni fecha de fin no se puede deducir un cierre. Se pone a una semana
    // vista para que el Pick'em nazca abierto y la siguiente pasada, ya con partidos,
    // lo corrija. Un cierre en el pasado lo dejaría muerto al nacer.
    ?? new Date(Date.now() + 7 * 24 * 3600_000).toISOString();

  const { data: created, error } = await sb
    .from("pickem_events")
    .insert({
      event_id: eventId,
      title: `Predicciones · ${event.name}`,
      description: "Acierta los ganadores y suma puntos de rango.",
      locks_at: locksAt,
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: (created as { id: string }).id, created: true };
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
  const { data: rows, error } = await sb
    .from("matches").select(MATCH_COLUMNS).eq("event_id", eventId);
  if (error) throw new Error(error.message);
  const matches = ((rows ?? []) as MatchInput[]);

  /*
   * Los DOS tipos de pregunta salen del mismo generador puro y se escriben en la misma
   * pasada (Fase 13). No hay un segundo ciclo de vida: hay una lista más larga.
   */
  const specs = [...buildMatchQuestions(matches, now), ...buildScoreQuestions(matches, now)];
  if (specs.length === 0) return { created: 0, relabelled: 0 };

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

  return { created, relabelled };
}

/**
 * Fija el resultado de las preguntas cuyo partido ya terminó.
 *
 * Solo toca las que NO tienen resultado todavía: reescribir una ya corregida sería
 * cambiar el pasado, y si el origen se corrigiera a sí mismo lo correcto es que un humano
 * lo revise, no que la sincronización lo cambie sin avisar.
 */
export async function resolveFinished(
  sb: SupabaseClient, pickemEventId: string, eventId: string,
): Promise<{ resolved: number; pending: number }> {
  const { data: qRows, error } = await sb
    .from("pickem_questions").select("id, match_id, kind, correct_option")
    .eq("pickem_event_id", pickemEventId).not("match_id", "is", null);
  if (error) throw new Error(error.message);
  const questions = (qRows ?? []) as { id: string; match_id: string; kind: string; correct_option: string | null }[];
  if (questions.length === 0) return { resolved: 0, pending: 0 };

  const { data: mRows } = await sb
    .from("matches").select(MATCH_COLUMNS).eq("event_id", eventId);
  const byId = new Map(((mRows ?? []) as MatchInput[]).map((m) => [m.id, m]));

  let resolved = 0;
  let pending = 0;
  for (const q of questions) {
    if (q.correct_option) continue;
    const m = byId.get(q.match_id);
    // El corrector no sabe de tipos: pregunta por el `kind` que leyó de la fila.
    const correct = m ? correctOptionForKind(q.kind, m) : null;
    if (!correct) { pending++; continue; }
    // Se usa la RPC y no un UPDATE directo: es la operación que el dominio declara para
    // esto, y mantenerla como única puerta permite auditarla en un solo sitio.
    const { error: rpcErr } = await sb.rpc("app_set_correct_option", {
      p_question_id: q.id, p_correct: correct,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    resolved++;
  }
  return { resolved, pending };
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
  sb: SupabaseClient, eventId: string, now = Date.now(),
): Promise<LifecycleResult> {
  const out: LifecycleResult = {
    eventId, pickemEventId: null, created: 0, resolved: 0, scored: false, usersScored: 0, notes: [],
  };

  try {
    const pe = await ensurePickemEvent(sb, eventId);
    if (!pe) { out.notes.push("el torneo no existe"); return out; }
    out.pickemEventId = pe.id;
    if (pe.created) out.notes.push("Pick'em creado");

    const q = await syncQuestions(sb, pe.id, eventId, now);
    out.created = q.created;
    if (q.relabelled > 0) out.notes.push(`${q.relabelled} etiqueta(s) refrescada(s)`);

    const r = await resolveFinished(sb, pe.id, eventId);
    out.resolved = r.resolved;

    const s = await scoreIfReady(sb, pe.id);
    out.scored = s.scored;
    out.usersScored = s.users;
    if (s.note) out.notes.push(s.note);
  } catch (e) {
    out.notes.push((e as Error).message);
  }

  return out;
}
