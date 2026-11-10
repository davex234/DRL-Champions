/**
 * FASE 61 · EL ICONO DEL ROL DEL TURNO — espada (atacas), escudo (defiendes), reloj de arena (esperas).
 *
 * Existe para que «quién ataca» no dependa solo del color (cian/rojo): va SIEMPRE junto al texto. SVG propio
 * (trazos simples, `currentColor`), sin assets ni iconografía de terceros. Decorativo: `aria-hidden`.
 */
import type { RoleKind } from "@/lib/duel/matchFlow";

export function RoleIcon({ kind, className }: { kind: Exclude<RoleKind, "NONE">; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" data-role-icon={kind}>
      {kind === "ATTACK" && (
        <>
          <path d="M14.5 3.5 20.5 3.5 20.5 9.5 9 21 3 15Z" />
          <path d="M6 12 12 18" />
        </>
      )}
      {kind === "DEFENSE" && <path d="M12 2.8 20 6v5.6c0 4.6-3.3 8.3-8 9.6-4.7-1.3-8-5-8-9.6V6Z" />}
      {kind === "WAIT" && (
        <>
          <path d="M6 3h12M6 21h12" />
          <path d="M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9" />
        </>
      )}
    </svg>
  );
}
