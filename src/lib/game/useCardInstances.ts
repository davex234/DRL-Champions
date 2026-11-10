"use client";

/**
 * COPIAS DE UNA CARTA, CARGADAS POR PÁGINAS (COLECCIONES ILIMITADAS).
 *
 * La pantalla enseña la primera página y pide la siguiente cuando el jugador llega al final de la lista (o pulsa
 * «ver más»). Nunca se descargan todas las copias de golpe, así que da igual que sean 3 o 30.000.
 *
 *   · Una sola petición a la vez: mientras una página viaja, pedir otra no hace nada (ni scroll ni doble toque la duplican).
 *   · Cambiar de carta, de filtros o de cuenta descarta lo que estuviera en camino: una respuesta vieja nunca se pinta.
 *   · Un fallo conserva lo ya cargado y deja `retry()` para repetir EXACTAMENTE la página que falló.
 *   · Sin duplicados aunque el servidor repita una fila: se indexa por `uid`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useArtworkStore } from "@/store/useArtworkStore";
import { CardsApiError, fetchCardInstances, type CardInstance, type CardInstancesQuery } from "./instances";
import { ns } from "@/i18n/runtime";

const t = ns("ui");

export interface CardInstancesState {
  items: CardInstance[];
  /** Total que cumple los filtros (lo da la primera página). `null` mientras no se sabe. */
  total: number | null;
  /** Cargando la primera página. */
  loading: boolean;
  /** Cargando una página siguiente. */
  loadingMore: boolean;
  hasMore: boolean;
  /** Mensaje del último fallo, o `null`. */
  error: string | null;
  /** Segundos que pide el servidor antes de reintentar (límite de frecuencia), o `null`. */
  retryAfter: number | null;
  loadMore: () => void;
  retry: () => void;
  /** Vuelve a empezar desde la primera página (tras desguazar, vender, etc.). */
  reload: () => void;
}

export interface UseCardInstancesOptions extends Omit<CardInstancesQuery, "cursor"> {
  enabled: boolean;
  /** Cambia con la cuenta: una sesión nueva no hereda las páginas de la anterior. */
  userKey?: string | null;
}

export function useCardInstances(opts: UseCardInstancesOptions): CardInstancesState {
  const { enabled, cardId = null, sort, locked = null, numbered = false, limit, userKey = null } = opts;
  const [items, setItems] = useState<CardInstance[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [epoch, setEpoch] = useState(0);

  /** Cursor de la página siguiente y marca de «hay una petición en vuelo». Refs: no deben provocar otro render. */
  const cursor = useRef<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const seen = useRef<Set<string>>(new Set());
  /** Identidad de la consulta vigente: una respuesta de otra consulta se descarta. */
  const token = useRef(0);

  const fetchPage = useCallback(async (first: boolean) => {
    if (inFlight.current) return; // una a la vez
    const mine = token.current;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    if (first) setLoading(true); else setLoadingMore(true);
    setError(null); setRetryAfter(null);
    try {
      const page = await fetchCardInstances({ cardId, sort, locked, numbered, limit, cursor: first ? null : cursor.current }, ctrl.signal);
      if (mine !== token.current) return;
      if (!page) { setItems([]); setTotal(null); setHasMore(false); return; } // sin sesión
      useArtworkStore.getState().addArtworks(page.artworks ?? {});
      const fresh = page.items.filter((i) => !seen.current.has(i.uid));
      for (const i of fresh) seen.current.add(i.uid);
      setItems((prev) => (first ? fresh : [...prev, ...fresh]));
      if (first) setTotal(page.total);
      cursor.current = page.nextCursor;
      setHasMore(page.hasMore && !!page.nextCursor);
    } catch (e) {
      if (mine !== token.current || ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : t("No se pudieron leer tus cartas"));
      setRetryAfter(e instanceof CardsApiError ? e.retryAfter : null);
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null;
      if (mine === token.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [cardId, sort, locked, numbered, limit]);

  // Consulta nueva (otra carta, otros filtros, otra cuenta, o `reload`): se empieza de cero.
  useEffect(() => {
    token.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    cursor.current = null;
    seen.current = new Set();
    setItems([]); setTotal(null); setHasMore(false); setError(null); setRetryAfter(null); setLoading(false); setLoadingMore(false);
    if (enabled) void fetchPage(true);
    const tk = token, fl = inFlight;
    return () => { tk.current++; fl.current?.abort(); fl.current = null; };
  }, [enabled, userKey, epoch, fetchPage]);

  const loadMore = useCallback(() => { if (enabled && hasMore && !error) void fetchPage(false); }, [enabled, hasMore, error, fetchPage]);
  const retry = useCallback(() => { if (enabled) void fetchPage(items.length === 0 && cursor.current === null); }, [enabled, fetchPage, items.length]);
  const reload = useCallback(() => setEpoch((n) => n + 1), []);

  return { items, total, loading, loadingMore, hasMore, error, retryAfter, loadMore, retry, reload };
}

/**
 * Llama a `onReach` cuando el elemento centinela entra en pantalla (scroll infinito). Sin `IntersectionObserver`
 * (navegadores antiguos, tests) no hace nada: el botón «ver más» sigue funcionando.
 */
export function useReachEnd(onReach: () => void, active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cb = useRef(onReach);
  useEffect(() => { cb.current = onReach; }, [onReach]);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) cb.current(); }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [active]);
  return ref;
}
