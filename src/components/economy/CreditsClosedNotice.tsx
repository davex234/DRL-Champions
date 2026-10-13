/**
 * FASE 41 · AVISO DE TIENDA DE PRUEBA CERRADA. El servidor ya no concede créditos de prueba salvo en entornos de prueba
 * (`NEXUS_SANDBOX_CREDITS=1`); la pantalla lo dice y explica de dónde salen los créditos.
 */
export function CreditsClosedNotice({ currency }: { currency: string }) {
  return (
    <p role="status" data-testid="credits-closed" className="rounded-2xl border border-white/15 bg-white/[0.04] p-4 text-[14px] leading-relaxed text-white/70">
      La tienda de prueba está cerrada: en esta versión los {currency} se ganan jugando (partidas, misiones, logros y eventos).
    </p>
  );
}
