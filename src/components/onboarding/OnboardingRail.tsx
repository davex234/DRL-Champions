"use client";

/**
 * FASE 63 · «TU INICIO» EN CUALQUIER PANTALLA — una franja fina arriba del contenido mientras la guía está activa.
 *
 * Existe para quien entra directo por URL (`/jugar`, `/duelos/mazos`, `/tienda`…): no se bloquea ninguna ruta, pero la
 * pantalla dice en qué paso estás y te devuelve a él con un toque. Las pantallas que YA tienen su bloque de la guía
 * (colección, progreso) no la repiten. Con la guía completada o saltada no existe: nada de cromo de tutorial permanente.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { useOnboarding } from "@/lib/onboarding/client";
import { OnboardingPill } from "./OnboardingKit";
import type { OnboardingStepId } from "@/domain/onboarding";

/**
 * Pantallas con su PROPIO bloque de la guía, y en qué pasos lo pintan. Fuera de esos pasos la franja sí aparece (p. ej.
 * `/coleccion` antes de abrir el primer sobre): ninguna URL directa se queda sin contexto.
 */
export const OWN_COACH: Record<string, readonly OnboardingStepId[]> = {
  "/coleccion": ["collection", "deck", "match"],
  "/progresion": ["progress"],
};

export function railVisibleOn(pathname: string, current: OnboardingStepId | null = null): boolean {
  if (pathname === "/cuenta" || pathname.startsWith("/cuenta/")) return false; // alta/entrada: nada encima del formulario
  const own = OWN_COACH[pathname];
  return !(own && current && own.includes(current));
}

export function OnboardingRail() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { view } = useOnboarding(user?.id ?? null, railVisibleOn(pathname));
  if (!view?.active || !view.next || !railVisibleOn(pathname, view.current)) return null;
  // Las órdenes (empezar, crear equipo) viven en la portada, que es donde se enseñan con su contexto.
  const href = view.next.command ? "/" : view.next.href;
  return (
    <nav aria-label="Tu inicio" data-testid="onboarding-rail" data-step={view.current ?? ""} className="nx-f63-coach mb-4 flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <OnboardingPill view={view} />
        <span className="font-display text-[13px] font-bold uppercase tracking-[0.1em] text-white">{view.next.title}</span>
      </p>
      {/* F64 · el botón dice la ACCIÓN («Abrir el siguiente sobre»), no un «Continuar» genérico. */}
      <Link href={href} className="nx-f62-cta shrink-0" data-testid="onboarding-rail-cta">{view.next.command ? "Ir a tu inicio" : view.next.cta} →</Link>
    </nav>
  );
}
