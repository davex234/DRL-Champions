"use client";

/**
 * PICK'EMS DEL EVENTO (Fase 30). ORQUESTA el sistema existente: resumen (abiertas, pendientes,
 * cierre más próximo, puntos, escalón) y CTA al panel REAL. El formulario es el MISMO
 * `PickemPanel` de `/pickems` y `/torneos/[id]` (mismo guardado, mismos cierres del servidor);
 * aquí no se duplica ninguna pregunta ni se abre/cierra nada por reloj del cliente.
 */
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Readout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { NeedsAccount } from "@/components/ui/States";
import type { PickemView } from "@/server/services/liveEvents";
import { fmtWhen } from "./bits";

export function EventPickems({ pickem, signedIn, panel, onCta }: { pickem: PickemView | null; signedIn: boolean; panel?: React.ReactNode; onCta?: () => void }) {
  return (
    <section id="pickems" aria-label="Pick'ems del evento" data-testid="event-pickems" data-state={!pickem ? "none" : pickem.pending > 0 ? "pending" : pickem.open > 0 ? "done" : "closed"}>
      <SectionTitle action={pickem ? <Link href="/pickems" className="nx-action" onClick={onCta}>Todas mis predicciones →</Link> : undefined}>Pick&apos;ems</SectionTitle>
      {!pickem ? (
        <Plate className="px-6 py-8 text-center"><p className="font-display text-h3 font-bold uppercase tracking-wide text-white">Sin Pick&apos;ems</p><p className="mx-auto mt-1.5 max-w-[46ch] text-body text-ink-muted">Este evento todavía no tiene predicciones abiertas.</p></Plate>
      ) : (
        <>
          <Plate tone={pickem.pending > 0 ? "cyan" : "neutral"} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
            <div className="flex flex-wrap items-end gap-5">
              <Readout size="sm" label="Abiertas" value={pickem.open} />
              {signedIn && <Readout size="sm" label="Pendientes" value={pickem.pending} tone={pickem.pending > 0 ? "var(--nx-gold)" : undefined} />}
              {signedIn && pickem.score && <Readout size="sm" label="Puntos" value={pickem.score.points} tone="var(--nx-gold)" />}
              {signedIn && pickem.resolved > 0 && <Readout size="sm" label="Aciertos" value={`${pickem.correct} / ${pickem.resolved}`} tone="var(--nx-ok)" />}
              {pickem.nextLockAt && <Readout size="sm" label="Próximo cierre" value={fmtWhen(pickem.nextLockAt)} />}
            </div>
            <div className="text-caption text-white/60">
              {pickem.pending > 0 ? `${pickem.pending} ${pickem.pending === 1 ? "predicción pendiente" : "predicciones pendientes"}` : pickem.open > 0 ? (signedIn ? "Ya has respondido las predicciones abiertas." : "Inicia sesión para predecir.") : "Predicciones cerradas."}
              {signedIn && pickem.tier && <span className="ml-2 text-drl-gold">· Escalón {pickem.tier.label}</span>}
            </div>
          </Plate>
          <div className="mt-3">{signedIn ? panel : <NeedsAccount what="Tus predicciones" />}</div>
        </>
      )}
    </section>
  );
}
