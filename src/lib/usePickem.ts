"use client";

/**
 * EL ESTADO DE UN PICK'EM EN PANTALLA (Fase 24.2; vivo desde la 24.5).
 *
 * ────────────────────────── QUÉ HACE ──────────────────────────
 *
 * Carga de una vez todo lo que un torneo necesita para pintarse —torneo, preguntas, mis
 * respuestas con lo que dijo el corrector, mi puntuación, mi recompensa, la clasificación,
 * los partidos y las fases— y ofrece UNA operación: `pick`. Lo usan la pantalla de Pick'ems,
 * la ficha del torneo y el detalle del historial, así que no hay dos formas de guardar ni dos
 * formas de cargar.
 *
 * Con `{ live: true }` (24.5) además REFRESCA en segundo plano: el ritmo lo decide el dominio
 * (`refreshIntervalFor`: más a menudo con partido en directo, poco si el torneo no ha
 * empezado, retroceso si falla, y NADA con la pestaña oculta o sin red). Cada refresco
 * correcto se compara con el anterior (`diffLiveSnapshots`) y lo nuevo —una predicción
 * resuelta, un clasificado, un cambio de posición— sale en `changes`, deduplicado por sesión.
 *
 * ────────────────────────── LAS REGLAS ──────────────────────────
 *
 *   · OPTIMISTA PERO EL SERVIDOR MANDA. La elección se pinta al instante con estado
 *     «Guardando…»; solo pasa a «Predicción guardada» cuando `/api/pickems` responde.
 *   · UN ENVÍO A LA VEZ, y un refresco NUNCA pisa un envío en vuelo: si llega un lote
 *     mientras se guarda, se conserva la respuesta optimista de esa pregunta.
 *   · SOLO OPCIONES DEL SERVIDOR.
 *   · UN FALLO DE REFRESCO NO BORRA NADA: se conserva el último lote válido, se anota el
 *     error y se reintenta con retroceso. Sin red no se sondea ni se guarda.
 *   · LA CACHÉ ES PRESENTACIÓN. Nunca es fuente de verdad ni usa almacenamiento del navegador.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPickemEventById, fetchPickemQuestions, fetchMyAnswerDetails, fetchMyScore,
  fetchPickemReward, fetchTournamentRanking, fetchMatches, fetchStages, submitPick,
  type PickemQuestion, type MyScore, type LedgerRow, type TournamentRankingRow,
  type PickemEventSummary, type MatchRow, type StageRow,
} from "@/lib/game/client";
import { isLockedNow, eventPhase, type AnswerMap } from "@/domain/pickems/progress";
import { buildBracketModel } from "@/domain/pickems/bracket";
import {
  deriveLiveEventSnapshot, diffLiveSnapshots, dedupeChanges, changedIdsOf, refreshIntervalFor,
  type LiveEventSnapshot, type LiveChange,
} from "@/domain/pickems/live";
import { trackPickem } from "@/lib/telemetry/pickems";
import { ns, td } from "@/i18n/runtime";

const tr = ns("lib");

export interface PickemBundle {
  event: PickemEventSummary | null;
  questions: PickemQuestion[];
  answers: AnswerMap;
  score: MyScore | null;
  reward: LedgerRow | null;
  ranking: TournamentRankingRow[];
  /** Partidos y fases REALES del torneo (Fase 24.3): de aquí sale el cuadro. Un lote, no N+1. */
  matches: MatchRow[];
  stages: StageRow[];
  loadedAt: number;
}

export type PickFeedbackKind = "saving" | "saved" | "error" | "locked";
export interface PickFeedback { questionId: string; kind: PickFeedbackKind; message: string }

/** Caché por (torneo, usuario). De módulo: cambiar de torneo y volver no vuelve a esperar. */
const cache = new Map<string, PickemBundle>();
/** Cambios ya anunciados en esta sesión, por (torneo, usuario): un resultado no se anuncia dos veces. */
const seenChanges = new Map<string, Set<string>>();
/** Último snapshot vivo por clave: la base del diff sobrevive a un remontaje del componente. */
const lastSnapshot = new Map<string, LiveEventSnapshot>();

/** Solo para pruebas. */
export function __resetPickemCacheForTests(): void { cache.clear(); seenChanges.clear(); lastSnapshot.clear(); }

const EMPTY: AnswerMap = {};
/** Cuánto dura el brillo de «acaba de cambiar» en el cuadro. */
const HIGHLIGHT_MS = 4000;

export interface UsePickemOptions {
  /** Refresco en segundo plano con el ritmo del evento (24.5). */
  live?: boolean;
}

export function usePickem(pickemEventId: string | null, userId: string | null, opts: UsePickemOptions = {}) {
  const key = pickemEventId ? `${pickemEventId}:${userId ?? "anon"}` : null;
  const live = !!opts.live;

  const [bundle, setBundle] = useState<PickemBundle | null>(() => (key ? cache.get(key) ?? null : null));
  const [loading, setLoading] = useState<boolean>(() => !!key && !cache.has(key));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PickFeedback | null>(null);

  // ── Estado vivo (24.5) ──
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [visibility, setVisibility] = useState<"visible" | "hidden">(() =>
    (typeof document === "undefined" || !document.hidden ? "visible" : "hidden"));
  const [changes, setChanges] = useState<LiveChange[]>([]);
  const [changedIds, setChangedIds] = useState<Set<string>>(() => new Set());
  const [previousPosition, setPreviousPosition] = useState<number | null>(null);
  const failuresRef = useRef(0);
  const [failures, setFailures] = useState(0);

  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;
  const savingRef = useRef<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = useCallback((f: PickFeedback | null, clearAfterMs?: number) => {
    if (feedbackTimer.current) { clearTimeout(feedbackTimer.current); feedbackTimer.current = null; }
    setFeedback(f);
    if (f && clearAfterMs) {
      feedbackTimer.current = setTimeout(() => setFeedback((cur) => (cur === f ? null : cur)), clearAfterMs);
    }
  }, []);

  /** Compara con el lote anterior y publica lo nuevo (solo en modo vivo). */
  const publishChanges = useCallback((next: PickemBundle) => {
    if (!key) return;
    const now = Date.now();
    const model = buildBracketModel({ stages: next.stages, matches: next.matches, questions: next.questions, answers: next.answers, now });
    const phase = next.event
      ? eventPhase({ status: next.event.status, eventStatus: next.event.events?.status, startDate: next.event.events?.start_date, endDate: next.event.events?.end_date }, next.questions, now)
      : undefined;
    const snap = deriveLiveEventSnapshot({
      model, stages: next.stages, event: next.event?.events ?? null, phase, questions: next.questions, answers: next.answers,
      score: next.score, ranking: next.ranking, reward: next.reward, userId, now,
    });
    const prev = lastSnapshot.get(key) ?? null;
    lastSnapshot.set(key, snap);
    if (!prev) return;
    const seen = seenChanges.get(key) ?? new Set<string>();
    seenChanges.set(key, seen);
    const fresh = dedupeChanges(diffLiveSnapshots(prev, snap), seen);
    if (fresh.length === 0) return;
    setChanges((c) => [...c, ...fresh]);
    const rank = fresh.find((c): c is Extract<LiveChange, { kind: "RANK_CHANGED" }> => c.kind === "RANK_CHANGED");
    if (rank) setPreviousPosition(rank.from);
    const ids = changedIdsOf(fresh);
    if (ids.size > 0) {
      setChangedIds(ids);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setChangedIds(new Set()), HIGHLIGHT_MS);
    }
  }, [key, userId]);

  const load = useCallback(async (silent = false) => {
    if (!pickemEventId || !key) return;
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const event = await fetchPickemEventById(pickemEventId);
      const [questions, answers, score, reward, ranking, matches, stages] = await Promise.all([
        fetchPickemQuestions(pickemEventId),
        userId ? fetchMyAnswerDetails(pickemEventId) : Promise.resolve(EMPTY),
        userId ? fetchMyScore(pickemEventId) : Promise.resolve(null),
        userId ? fetchPickemReward(pickemEventId) : Promise.resolve(null),
        fetchTournamentRanking(pickemEventId).catch(() => [] as TournamentRankingRow[]),
        event ? fetchMatches(event.event_id).catch(() => [] as MatchRow[]) : Promise.resolve([] as MatchRow[]),
        event ? fetchStages(event.event_id).catch(() => [] as StageRow[]) : Promise.resolve([] as StageRow[]),
      ]);
      /*
       * CARRERA envío/refresco: si hay una predicción guardándose, el lote del servidor puede
       * ser anterior al envío. Se conserva la respuesta optimista de ESA pregunta; el resto
       * del lote entra. Cuando el envío responda, el siguiente refresco ya la traerá.
       */
      const merged: AnswerMap = { ...answers };
      const inFlight = savingRef.current;
      if (inFlight && bundleRef.current?.answers[inFlight]) merged[inFlight] = bundleRef.current.answers[inFlight];
      const next: PickemBundle = { event, questions, answers: merged, score, reward, ranking, matches, stages, loadedAt: Date.now() };
      cache.set(key, next);
      setBundle(next);
      setLastUpdatedAt(next.loadedAt);
      setRefreshError(null);
      failuresRef.current = 0;
      setFailures(0);
      if (live) publishChanges(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tr("No se pudieron cargar las predicciones");
      if (bundleRef.current) {
        // Hay un lote válido: se conserva, se avisa y se reintentará con retroceso.
        setRefreshError(msg);
        failuresRef.current += 1;
        setFailures(failuresRef.current);
        if (live) trackPickem("event_refresh_failed", { once: `refresh-failed:${key}:${failuresRef.current}` });
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [pickemEventId, userId, key, live, publishChanges]);

  // Al cambiar de torneo: lo cacheado sale al instante y se refresca por detrás.
  useEffect(() => {
    if (!key) { setBundle(null); setLoading(false); return; }
    const cached = cache.get(key) ?? null;
    setBundle(cached);
    setLoading(!cached);
    showFeedback(null);
    setChanges([]);
    setPreviousPosition(null);
    void load(!!cached);
  }, [key, load, showFeedback]);

  useEffect(() => () => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);

  // ── Visibilidad y red: la pestaña oculta no sondea; al volver, refresco inmediato ──
  useEffect(() => {
    if (!live || typeof document === "undefined") return;
    const onVisibility = () => {
      const v = document.hidden ? "hidden" : "visible";
      setVisibility(v);
      if (v === "visible") void load(true);
    };
    const onOnline = () => { setOnline(true); void load(true); };
    const onOffline = () => setOnline(false);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [live, load]);

  // ── El ritmo lo decide el dominio: estado del torneo, partido en directo, fallos, pestaña, red ──
  const liveSnapshot = key ? lastSnapshot.get(key) ?? null : null;
  const status = liveSnapshot?.status ?? "upcoming";
  const hasLive = (liveSnapshot?.liveMatches.length ?? 0) > 0;
  useEffect(() => {
    if (!live || !key || !bundle) return;
    const ms = refreshIntervalFor({ status, hasLive, visibility, online, failures });
    if (ms === null) return;
    const t = setTimeout(() => void load(true), ms);
    return () => clearTimeout(t);
  }, [live, key, bundle, status, hasLive, visibility, online, failures, load]);

  const pick = useCallback(async (q: PickemQuestion, option: string): Promise<void> => {
    const current = bundleRef.current;
    if (!userId || !current || !key) return;
    if (savingRef.current) return;                                   // un envío a la vez
    if (!q.options.some((o) => o.key === option)) return;             // solo opciones del servidor
    if (typeof navigator !== "undefined" && !navigator.onLine) {      // sin red no se afirma nada
      showFeedback({ questionId: q.id, kind: "error", message: tr("Sin conexión · la predicción no se ha enviado") }, 4000);
      return;
    }
    if (isLockedNow(q, Date.now())) {
      showFeedback({ questionId: q.id, kind: "locked", message: tr("Cerrada · ya no admite cambios") }, 3000);
      return;
    }
    const previous = current.answers[q.id];
    if (previous?.option === option) return;

    savingRef.current = q.id;
    setSaving(q.id);
    showFeedback({ questionId: q.id, kind: "saving", message: tr("Guardando…") });

    const apply = (answers: AnswerMap) => {
      setBundle((b) => {
        if (!b) return b;
        const next = { ...b, answers };
        cache.set(key, next);
        return next;
      });
    };

    // Optimista: se pinta ya, pero todavía no está guardada.
    apply({ ...current.answers, [q.id]: { option, isCorrect: null, pointsAward: null } });

    try {
      await submitPick(q.id, option);
      showFeedback({ questionId: q.id, kind: "saved", message: tr("Predicción guardada") }, 2500);
      trackPickem(previous ? "pickem_prediction_changed" : "pickem_prediction_saved");
    } catch (e) {
      const restored = { ...(bundleRef.current?.answers ?? {}) };
      if (previous) restored[q.id] = previous; else delete restored[q.id];
      apply(restored);
      const msg = e instanceof Error ? e.message : tr("No se pudo guardar");
      if (/cerrad/i.test(msg)) {
        showFeedback({ questionId: q.id, kind: "locked", message: tr("Cerrada · el servidor ya no admite cambios") }, 4000);
        trackPickem("pickem_locked_seen");
        void load(true);
      } else {
        showFeedback({ questionId: q.id, kind: "error", message: tr("Error al guardar · {msg}", { msg: td(msg) }) }, 4000);
      }
    } finally {
      savingRef.current = null;
      setSaving(null);
    }
  }, [userId, key, load, showFeedback]);

  const reload = useCallback(() => load(true), [load]);
  const ackChanges = useCallback(() => setChanges([]), []);
  const liveState = useMemo(() => ({
    lastUpdatedAt, refreshError, online, visibility, changes, changedIds, previousPosition, failures,
  }), [lastUpdatedAt, refreshError, online, visibility, changes, changedIds, previousPosition, failures]);

  return { bundle, loading, error, saving, feedback, pick, reload, retry: () => load(false), live: liveState, ackChanges };
}
