"use client";

/**
 * ESTADOS LÍMITE DE LA APERTURA (Fase 38). Cada uno dice qué ha pasado, por qué y qué hacer, sin asustar:
 *
 *   · `recovering`  — había una apertura enviada sin confirmar en esta pestaña: se pide su resultado con la MISMA clave.
 *   · `error`       — el servidor o la red fallaron ANTES de confirmar: reintentar repite la misma operación (nunca abre dos).
 *   · `no_pack`     — no queda ninguna unidad (p. ej. otra pestaña lo abrió): las cartas, si se abrió, ya están guardadas.
 *   · `missing`     — no tienes este sobre en el inventario.
 *   · `unavailable` — DRAFT u otro estado no público.
 *   · `not_found`   — el enlace no apunta a un sobre del catálogo.
 */
import { NxButton } from "@/components/ui/NxButton";

export type PackStatusKind = "recovering" | "error" | "no_pack" | "missing" | "unavailable" | "not_found";

export function PackStatus({
  kind, title, message, packsLeft, onNavigate, onRetry, layout = "screen",
}: {
  kind: PackStatusKind;
  title: string;
  message: string;
  packsLeft: number;
  onNavigate: (href: string) => void;
  onRetry?: () => void;
  layout?: "screen" | "inline";
}) {
  const box = layout === "screen" ? "fixed inset-0 z-modal grid place-items-center bg-base-900 px-6" : "grid min-h-[520px] place-items-center bg-base-900 px-6 py-10";
  const pending = packsLeft > 0;
  return (
    <div className={box} data-testid="pack-status" data-kind={kind}>
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="nx-label">Apertura de sobres</span>
        {kind === "recovering" && (
          <div aria-hidden className="h-9 w-9 rounded-full border-2 border-drl-cyan border-t-transparent motion-safe:animate-spin" />
        )}
        <h1 className="font-display text-[clamp(26px,6vw,40px)] font-bold uppercase leading-none text-white">{title}</h1>
        <p role={kind === "recovering" ? "status" : undefined} aria-live="polite" className="text-body leading-relaxed text-ink-muted">{message}</p>
        {kind !== "recovering" && (
          <div className="mt-1 flex flex-wrap justify-center gap-2.5">
            {kind === "error" && onRetry && (
              <NxButton variant="primary" onClick={onRetry} data-testid="pack-retry">Reintentar</NxButton>
            )}
            {kind === "no_pack" && (
              <NxButton variant="primary" onClick={() => onNavigate("/coleccion")}>Ver mi colección</NxButton>
            )}
            <NxButton variant={kind === "error" || kind === "no_pack" ? "secondary" : "primary"} onClick={() => onNavigate(pending ? "/inventario" : "/packs")}>
              {pending ? `Abrir mis sobres · ${packsLeft}` : "Ver sobres"}
            </NxButton>
            {kind !== "error" && kind !== "no_pack" && (
              <NxButton variant="secondary" onClick={() => onNavigate(pending ? "/packs" : "/inventario")}>
                {pending ? "Ver sobres" : "Ver mi inventario"}
              </NxButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
