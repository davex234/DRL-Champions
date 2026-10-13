"use client";

/**
 * PIEZAS COMPARTIDAS DEL PANEL DE CARTAS (Bloque 8.4.1).
 *
 * Todo lo visual sale del sistema de NEXUS —`Plate`, `Recessed`, `Rail`, `Readout`,
 * `Badge`, `NxButton`, los tonos de `tone.ts`—. Aquí no hay ni un hexadecimal suelto ni un
 * `rounded-full`: las tres pantallas comparten estas piezas para que el panel se vea como
 * una herramienta del juego y no como un CRUD.
 *
 * Y la regla que separa esto de las pantallas de jugador: **densidad antes que decoración**.
 * Un administrador viene a ver un estado y a tomar una decisión, no a disfrutar de una
 * animación.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { Plate, Recessed } from "@/components/ui/Surface";
import { adminFetch } from "@/lib/supabase/adminClient";
import type { Tone } from "@/components/ui/tone";
import { cn } from "@/lib/format";

/** Un ciclo de vida ⇄ el tono que le corresponde. Un solo sitio decide el color de un estado. */
export const LIFECYCLE_TONE: Record<string, Tone> = {
  DRAFT: "muted",
  REVIEW: "info",
  APPROVED: "info",
  PUBLISHED: "ok",
  RETIRED: "warn",
  ARCHIVED: "muted",
  REJECTED: "bad",
};

/** Rareza ⇄ tono. El bucket es el eje estructural del juego; merece color propio. */
export const BUCKET_TONE: Record<string, Tone> = {
  common: "muted", uncommon: "info", rare: "key", epic: "gold", legendary: "gold",
};

export function LifecycleBadge({ state, className }: { state: string; className?: string }) {
  return (
    <Badge tone={LIFECYCLE_TONE[state] ?? "muted"} dot className={className}>
      {state}
    </Badge>
  );
}

export function BucketBadge({ bucket, rank }: { bucket: string; rank?: number }) {
  return (
    <Badge tone={BUCKET_TONE[bucket] ?? "muted"}>
      {bucket}{rank !== undefined ? ` · r${rank}` : ""}
    </Badge>
  );
}

/**
 * Llamada a la API de administración.
 *
 * Pasa SIEMPRE por `adminFetch`, que es el único sitio del producto que sabe adjuntar el
 * Bearer de la sesión. Ni un `fetch` suelto: una llamada sin cabecera es un 401 silencioso
 * que se depura media hora después.
 */
export async function adminApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return adminPost<T>("/api/admin/cards", action, body);
}

/** Lo mismo contra `/api/admin/pools`. Misma forma de error, mismo tratamiento del conflicto. */
export async function adminPoolApi<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  return adminPost<T>("/api/admin/pools", action, body);
}

async function adminPost<T>(url: string, action: string, body: Record<string, unknown>): Promise<T> {
  const res = await adminFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...body }),
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    const e = data as { error?: string; conflict?: boolean; current?: number };
    const err = new Error(e?.error ?? `HTTP ${res.status}`) as Error & { conflict?: boolean; current?: number };
    err.conflict = e?.conflict;
    err.current = e?.current;
    throw err;
  }
  return data as T;
}

/**
 * CABECERA DE UNA FICHA DEL PANEL.
 *
 * `SectionTitle` es un rótulo de SECCIÓN —papel `label`, 10 px, versalitas— y el panel lo
 * estaba usando también para el título de la pantalla. El resultado era una jerarquía del
 * revés: el nombre de la carta o del pool se leía más pequeño que su propio identificador, y
 * la pantalla abría sin decir de qué va.
 *
 * Aquí el título usa el papel que le toca de la escala (`text-h2`, 28 px), con un antetítulo
 * que dice QUÉ es lo que se está mirando. Es el mismo patrón que la portada y la colección
 * llevan desde siempre («COLECCIÓN» encima, «MI ÁLBUM» grande): no se inventa nada, se aplica
 * donde faltaba.
 */
export function SheetHeading({
  kicker, title, badges, meta, action,
}: {
  /** Antetítulo: «Pool», «Carta». Dice qué clase de cosa es esto. */
  kicker: string;
  title: string;
  badges?: React.ReactNode;
  /** Identificador técnico. Va debajo y en monoespaciada: es dato, no titular. */
  meta?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-display text-label uppercase tracking-wide2 text-drl">{kicker}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 truncate font-display text-h2 font-bold uppercase tracking-wide text-white">
            {title}
          </h1>
          {badges}
        </div>
        {meta ? <div className="mt-1.5 font-mono text-[12px] text-drl-cyan">{meta}</div> : null}
      </div>
      {action}
    </header>
  );
}

/** Estado de una llamada, con su error a la vista. Sin `alert()` y sin fallar en silencio. */
export function useAsync<T>(): {
  running: boolean; error: string | null; clear: () => void;
  run: (fn: () => Promise<T>) => Promise<T | null>;
} {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  /*
   * SE REARMA AL MONTAR (bloque 8.4.4). No es defensa contra un caso raro: sin la línea de
   * arriba el panel entero deja de contar lo que va mal en desarrollo.
   *
   * `reactStrictMode` está activado, así que React invoca los efectos DOS veces al montar:
   * monta, desmonta, vuelve a montar. La limpieza pone `alive.current = false` y nadie lo
   * volvía a poner a `true`, así que a partir del segundo montaje —es decir, siempre— ni
   * `setError` ni `setRunning(false)` se ejecutaban.
   *
   * Lo que se veía: una ficha de pool inexistente se quedaba en «Cargando el pool…» para
   * siempre —`running` no bajaba nunca— y el `ErrorBar` no llegaba a aparecer jamás. Un fallo
   * de servidor se convertía en un spinner eterno con los botones deshabilitados: exactamente
   * el «estado optimista permanente» que este bloque tenía el encargo de buscar. Medido en
   * `content-e2e:qa`: `/admin/pools/no-existe-844` respondía 404 en 83 ms y la pantalla seguía
   * cargando ocho segundos después.
   *
   * `usePvpQueue` ya lo hacía bien desde el bloque 7.3 (`vivo.current = true` al montar); esto
   * es la misma lección, aplicada donde faltaba.
   */
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async (fn: () => Promise<T>) => {
    setRunning(true); setError(null);
    try {
      const r = await fn();
      return r;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (alive.current) setRunning(false);
    }
  }, []);

  return { running, error, clear: () => setError(null), run };
}

/** Aviso de error. Ocupa sitio solo cuando hay algo que decir. */
export function ErrorBar({ error, onClose }: { error: string | null; onClose?: () => void }) {
  if (!error) return null;
  return (
    // `Plate` tiene su propio vocabulario de tonos —neutral/primary/cyan/gold/success—, que
    // NO es el de `Badge`. `primary` es el rojo de la marca, que es el que este sistema usa
    // para lo que reclama atención; el papel de «error» lo dice el `role="alert"`.
    <Plate tone="primary" className="flex items-start justify-between gap-3 px-4 py-3">
      <p className="text-sm text-white/85" role="alert">{error}</p>
      {onClose && (
        <NxButton variant="ghost" onClick={onClose} aria-label="Cerrar aviso">✕</NxButton>
      )}
    </Plate>
  );
}

/**
 * Diálogo de confirmación para lo que no se deshace.
 *
 * Retirar una carta no destruye nada (8.2), pero sí la saca de circulación para todo el
 * mundo. El encargo pide confirmación explícita, y aquí además hay que **escribir el
 * motivo**: es el mismo que exige la RPC, así que pedirlo en el diálogo evita un viaje de
 * ida y vuelta con un error.
 */
export function ConfirmDialog({
  open, title, body, confirmLabel, tone = "key", requireReason = true, running, onConfirm, onCancel,
}: {
  open: boolean; title: string; body: React.ReactNode; confirmLabel: string;
  tone?: "key" | "danger"; requireReason?: boolean; running?: boolean;
  onConfirm: (reason: string) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const first = useRef<HTMLTextAreaElement | HTMLButtonElement>(null);
  useEffect(() => { if (open) { setReason(""); first.current?.focus(); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  const puede = !requireReason || reason.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
      role="dialog" aria-modal="true" aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <Plate className="w-full max-w-lg p-5">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide text-white">{title}</h2>
        <div className="mt-2 text-sm text-white/70">{body}</div>
        {requireReason && (
          <label className="mt-4 block">
            <span className="font-display text-label uppercase tracking-wider text-white/50">
              Motivo (queda registrado)
            </span>
            <textarea
              ref={first as React.RefObject<HTMLTextAreaElement>}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full resize-y border border-white/15 bg-base-800 px-3 py-2 text-sm text-white outline-none focus-visible:border-drl"
              placeholder="Por qué se hace este cambio"
            />
          </label>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <NxButton variant="secondary" onClick={onCancel} disabled={running}>Cancelar</NxButton>
          <NxButton
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={() => onConfirm(reason.trim())}
            disabled={!puede || running}
          >
            {running ? "…" : confirmLabel}
          </NxButton>
        </div>
      </Plate>
    </div>
  );
}

/** Campo etiquetado, denso. La unidad de construcción de la ficha. */
export function Field({
  label, children, className, mono,
}: { label: string; children: React.ReactNode; className?: string; mono?: boolean }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="font-display text-label uppercase tracking-wider text-white/40">{label}</div>
      <div className={cn("truncate text-sm text-white/90", mono && "font-mono text-[12px]")}>
        {children}
      </div>
    </div>
  );
}

/** Rejilla de campos que se apila sola en móvil. */
export function FieldGrid({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  return (
    <Recessed className={cn(
      "grid gap-x-4 gap-y-3 p-4",
      cols === 2 ? "grid-cols-2" : cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-4",
    )}>
      {children}
    </Recessed>
  );
}

/**
 * Un desplegable de filtro. Vive aquí y no en cada pantalla porque ya iba por la segunda
 * copia idéntica, y la tercera —el panel de pools— habría convertido «tres copias iguales»
 * en «tres copias que se parecen».
 */
export function Select({
  label, value, onChange, options, noEmpty, vacio = "Todas",
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; noEmpty?: boolean; vacio?: string;
}) {
  return (
    <label className="min-w-0">
      <span className="font-display text-label uppercase tracking-wider text-white/50">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-2 text-sm text-white outline-none focus-visible:border-drl"
      >
        {!noEmpty && <option value="">{vacio}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Campo de texto con etiqueta visible y objetivo táctil de 44 px. */
export function TextField({
  label, value, onChange, placeholder, hint, id,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; hint?: string; id?: string;
}) {
  const auto = id ?? `f-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <label className="block min-w-0" htmlFor={auto}>
      <span className="font-display text-label uppercase tracking-wider text-white/50">{label}</span>
      <input
        id={auto} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-describedby={hint ? `${auto}-h` : undefined}
        className="mt-1 min-h-[44px] w-full border border-white/15 bg-base-800 px-3 text-sm text-white outline-none focus-visible:border-drl"
      />
      {hint && <span id={`${auto}-h`} className="mt-1 block text-[11px] text-white/35">{hint}</span>}
    </label>
  );
}

/** Estado de un pool. Vocabulario propio (DRAFT/ACTIVE/RETIRED), no el de las cartas. */
export const POOL_TONE: Record<string, Tone> = {
  DRAFT: "muted", ACTIVE: "ok", RETIRED: "warn",
};

export function PoolBadge({ state }: { state: string }) {
  return <Badge tone={POOL_TONE[state] ?? "muted"}>{state}</Badge>;
}

/** Porcentaje con tres decimales: 10/35 es 28,571 %, y ese detalle importa al repartir peso. */
export const fmtCuota = (p: number): string =>
  `${(p * 100).toLocaleString("es-ES", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} %`;

export const fmtDate = (s?: string | null): string =>
  s ? new Date(s).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";
export const fmtPct = (p?: number | null): string =>
  p == null ? "—" : `${(p * 100).toFixed(p < 0.001 ? 4 : 2)} %`;
