"use client";

/**
 * F58 · CLIENTE DEL CONTROL CENTER — lecturas y mutaciones contra `/api/admin/*` con el Bearer de la sesión
 * (`adminFetch`). Sin éxito optimista: una mutación solo «sale bien» cuando el servidor responde 2xx, y entonces el
 * que llama refresca (`reload`). El mensaje de error es el que devuelve el servidor (ya saneado allí).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/supabase/adminClient";
import { ns, getIntlLocale } from "@/i18n/runtime";

const tr = ns("admin");

export class AdminApiError extends Error { constructor(message: string, public status: number) { super(message); } }

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new AdminApiError(data?.error ?? `Error ${res.status}`, res.status);
  return data;
}

export async function adminGet<T>(url: string): Promise<T> {
  return parse<T>(await adminFetch(url, { cache: "no-store" }));
}

export async function adminPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  return parse<T>(await adminFetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

export interface Query<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** GET con estado: `url = null` no pide nada (p. ej. búsqueda vacía). Ignora respuestas viejas (carreras de filtros). */
export function useAdminQuery<T>(url: string | null): Query<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!url });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!url) { setState({ data: null, error: null, loading: false }); return; }
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    adminGet<T>(url)
      .then((data) => { if (my === seq.current) setState({ data, error: null, loading: false }); })
      .catch((e) => { if (my === seq.current) setState({ data: null, error: e instanceof Error ? e.message : tr("Error"), loading: false }); });
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** Una clave de gesto por intención de operación: el mismo diálogo reintentado reusa la clave (idempotencia). */
export function newGestureRef(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export const fmt = (n: number | null | undefined, d = 0): string =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString(getIntlLocale(), { maximumFractionDigits: d, minimumFractionDigits: d });
export const pct = (x: number | null | undefined, d = 1): string => (x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toLocaleString(getIntlLocale(), { maximumFractionDigits: d, minimumFractionDigits: d })} %`);
export const dateTime = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(getIntlLocale(), { dateStyle: "medium", timeStyle: "short" }) : "—");
export const dateOnly = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString(getIntlLocale(), { dateStyle: "medium" }) : "—");
