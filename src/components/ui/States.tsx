"use client";

/**
 * Estados de UI compartidos: cargando, error, vacío y "necesitas cuenta".
 *
 * Existen para que cada pantalla nueva no reinvente su propio spinner ni su
 * propio mensaje de error, y para que los cuatro estados que exige el MVP se
 * escriban una sola vez y en el mismo español.
 */
import Link from "next/link";
import { cn } from "@/lib/format";

export function Loading({ label = "Cargando…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("grid min-h-[30vh] place-items-center", className)} role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-drl border-t-transparent" />
        <p className="font-display text-xs uppercase tracking-widest text-white/45">{label}</p>
      </div>
    </div>
  );
}

export function ErrorState({
  message, onRetry, className,
}: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={cn("rounded-2xl border border-drl/30 bg-drl/5 p-6 text-center", className)}
    >
      <p className="text-3xl">⚠️</p>
      <p className="mt-2 font-display text-base font-bold uppercase tracking-wide text-white">
        Algo ha fallado
      </p>
      <p className="mx-auto mt-1 max-w-md text-sm text-white/60">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-xl border border-white/15 bg-white/5 px-4 py-2 font-display text-xs uppercase tracking-wide text-white transition hover:bg-white/10"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon = "📭", title, hint, action, className,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-white/15 bg-base-700/30 p-10 text-center", className)}>
      <p className="text-3xl">{icon}</p>
      <p className="mt-2 font-display text-base font-bold uppercase tracking-wide text-white">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-white/55">{hint}</p>}
      {action && (
        <Link
          href={action.href}
          className="mt-4 inline-block rounded-xl bg-drl px-5 py-2 font-display text-xs uppercase tracking-wide text-white shadow-glow transition hover:brightness-110"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** Pantalla para funciones que exigen cuenta online. */
export function NeedsAccount({ what }: { what: string }) {
  return (
    <EmptyState
      icon="🔐"
      title="Necesitas una cuenta"
      hint={`${what} se guarda en el servidor, así que hace falta iniciar sesión para que sea tuyo de verdad.`}
      action={{ href: "/cuenta", label: "Entrar o registrarse" }}
    />
  );
}

/** Distintivo de datos de demostración (no son resultados reales). */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span
      title="Datos de demostración: este torneo no refleja resultados reales"
      className={cn(
        "rounded-full border border-drl-gold/40 bg-drl-gold/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-drl-gold",
        className,
      )}
    >
      Demo
    </span>
  );
}
