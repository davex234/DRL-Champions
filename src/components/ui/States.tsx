"use client";

/**
 * Estados de UI compartidos: cargando, error, vacío y "necesitas cuenta".
 *
 * Existen para que cada pantalla nueva no reinvente su propio spinner ni su
 * propio mensaje de error, y para que los cuatro estados que exige el MVP se
 * escriban una sola vez y en el mismo español.
 *
 * FASE 44 · las firmas no cambian (las usan ~60 pantallas), pero la presentación es la de JUEGO: el cargador es la
 * marca NEXUS cargando (sin spinner), el error dice «No se ha podido cargar» con REINTENTAR y VOLVER AL LOBBY, y el
 * vacío siempre ofrece la siguiente acción. Ningún emoji como icono.
 */
import { GameLoader } from "@/components/ui/game/GameLoader";
import { GameSkeleton, type SkeletonKind } from "@/components/ui/game/GameSkeleton";
import { GameEmpty, GameError, GamePanelState } from "@/components/ui/game/GameStates";
import { cn } from "@/lib/format";

/**
 * F64 · con `kind`, la SILUETA de lo que va a aparecer (sin saltos de maquetación al llegar los datos); sin él, el
 * cargador de la marca (cuando no hay forma que anticipar: arrancar una partida, abrir un sobre…).
 */
export function Loading({ label = "Cargando…", className, kind }: { label?: string; className?: string; kind?: SkeletonKind }) {
  if (kind) return <GameSkeleton kind={kind} label={label} className={className} />;
  return <GameLoader label={label} className={className} />;
}

export function ErrorState({
  message, onRetry, className,
}: { message: string; onRetry?: () => void; className?: string }) {
  return <GameError message={message} onRetry={onRetry} className={className} />;
}

export function EmptyState({
  title, hint, action, className,
}: {
  /** Conservado por compatibilidad; ya no se pinta (sin emoji como icono de producto). */
  icon?: string;
  title: string;
  hint?: string;
  action?: { href: string; label: string };
  className?: string;
}) {
  return (
    <GameEmpty
      title={title}
      hint={hint}
      primary={action ? { href: action.href, label: action.label } : undefined}
      secondary={action?.href === "/jugar" ? undefined : [{ href: "/jugar", label: "Jugar" }]}
      className={className}
    />
  );
}

/** Pantalla para funciones que exigen cuenta online. */
export function NeedsAccount({ what }: { what: string }) {
  return (
    <GamePanelState
      glyph="lock"
      tone="cyan"
      eyebrow="Cuenta NEXUS"
      title="Necesitas una cuenta"
      hint={`${what} se guarda en el servidor, así que hace falta iniciar sesión para que sea tuyo de verdad.`}
      primary={{ href: "/cuenta", label: "Entrar o registrarse" }}
      secondary={[{ href: "/", label: "Volver al lobby" }]}
      testId="needs-account"
    />
  );
}

/** Distintivo de datos de demostración (no son resultados reales). */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Datos de demostración: este torneo no refleja resultados reales"
      className={cn(
        "nx-clip-sm border border-drl-gold/40 bg-drl-gold/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-drl-gold",
        className,
      )}
    >
      Demo
    </span>
  );
}
