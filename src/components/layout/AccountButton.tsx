"use client";

/**
 * IA 2026-10-07 · ACCESO GLOBAL A MI CUENTA — el icono de usuario de arriba a la derecha (armazón y portada).
 *
 * Una sola pieza para las dos cabeceras: icono de PERSONA en SVG (el sistema usa iconos de trazo, no emoji), objetivo
 * táctil de 44 px, `aria-label` y `title` con su nombre, foco visible y estado activo (`aria-current`) en Mi cuenta,
 * que no depende solo del color (borde + subrayado). Lleva a `/cuenta`.
 */
import Link from "next/link";
import { cn } from "@/lib/format";
import { ROUTES } from "@/design/nav";
import { td } from "@/i18n/runtime";

export const ACCOUNT_LABEL = "Mi cuenta";

export function PersonIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={cn("h-6 w-6", className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.8-3.9 3.8-6 7.5-6s6.7 2.1 7.5 6" />
    </svg>
  );
}

export function AccountButton({ pathname, testId = "account-button", className }: { pathname?: string | null; testId?: string; className?: string }) {
  const on = !!pathname && (pathname === ROUTES.account || pathname.startsWith(`${ROUTES.account}/`));
  return (
    <Link
      href={ROUTES.account}
      aria-label={td(ACCOUNT_LABEL)}
      title={td(ACCOUNT_LABEL)}
      aria-current={on ? "page" : undefined}
      data-testid={testId}
      className={cn(
        "nx-press grid h-11 w-11 shrink-0 place-items-center border text-white/80 transition-colors duration-fast hover:text-white",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/80",
        on ? "border-drl-cyan/70 bg-drl-cyan/15 text-white shadow-[inset_0_-2px_0_#19e3ff]" : "border-white/12 bg-white/[0.04] hover:border-white/30",
        className,
      )}
    >
      <PersonIcon />
    </Link>
  );
}
