"use client";

/**
 * FASE 44 · ESQUELETOS CONTEXTUALES — la silueta de lo que va a aparecer, no barras grises de SaaS.
 *
 *   · `hero`   — el escenario de una pantalla (título grande + acción).
 *   · `cards`  — una fila de cartas con su proporción real (5:7) y chaflán.
 *   · `deck`   — un equipo: cabecera + diez huecos de carta.
 * Ninguna cifra: todavía no se sabe nada. `aria-busy` + texto para lector de pantalla.
 */
import { cn } from "@/lib/format";
import { td, ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("ui");

export type SkeletonKind = "hero" | "cards" | "deck" | "hub" | "profile";

export function GameSkeleton({ kind, label = t("Cargando…"), count = 6, className }: { kind: SkeletonKind; label?: string; count?: number; className?: string }) {
  useLocale();
  return (
    <div aria-busy="true" data-testid={`game-skeleton-${kind}`} className={cn("w-full", className)}>
      <span className="sr-only" role="status">{td(label)}</span>
      {kind === "hero" && (
        <div className="nx-clip border border-white/10 bg-[linear-gradient(160deg,rgba(12,15,26,0.96),rgba(6,8,14,0.98))] px-6 py-9 sm:px-10">
          <div className="nx-skel nx-clip-sm h-3 w-40" />
          <div className="nx-skel nx-clip-sm mt-4 h-14 w-3/4 max-w-xl" />
          <div className="nx-skel nx-clip-sm mt-3 h-4 w-1/2 max-w-md" />
          <div className="nx-skel nx-clip-sm mt-8 h-[64px] w-full max-w-[300px]" />
        </div>
      )}
      {kind === "cards" && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: count }, (_, i) => <div key={i} className="nx-skel nx-clip-sm aspect-[5/7] w-full" />)}
        </div>
      )}
      {/* F64 · un HUB (progresión, temporada, logros, competitivo, modos): cabecera + dos paneles + filas. */}
      {kind === "hub" && (
        <div className="space-y-4">
          <div className="nx-skel nx-clip-sm h-3 w-32" />
          <div className="nx-skel nx-clip-sm h-11 w-2/3 max-w-lg" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="nx-skel nx-clip h-[168px] w-full" />
            <div className="nx-skel nx-clip h-[168px] w-full" />
          </div>
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="nx-skel nx-clip-sm h-16 w-full" />)}
        </div>
      )}
      {/* F64 · un PERFIL: emblema + nombre + cifras + vitrina de cartas. */}
      {kind === "profile" && (
        <div className="space-y-5">
          <div className="flex items-center gap-5">
            <div className="nx-skel h-24 w-24 shrink-0" style={{ clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)" }} />
            <div className="flex-1 space-y-3"><div className="nx-skel nx-clip-sm h-10 w-1/2" /><div className="nx-skel nx-clip-sm h-4 w-1/3" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="nx-skel nx-clip-sm h-20" />)}</div>
          <div className="grid grid-cols-3 gap-3 sm:w-2/3">{Array.from({ length: 3 }, (_, i) => <div key={i} className="nx-skel nx-clip-sm aspect-[5/7] w-full" />)}</div>
        </div>
      )}
      {kind === "deck" && (
        <div className="nx-clip border border-white/10 bg-white/[0.02] p-5">
          <div className="nx-skel nx-clip-sm h-8 w-48" />
          <div className="mt-5 grid grid-cols-5 gap-2">
            {Array.from({ length: 10 }, (_, i) => <div key={i} className="nx-skel nx-clip-sm aspect-[5/7] w-full" />)}
          </div>
        </div>
      )}
    </div>
  );
}
