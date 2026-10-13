"use client";

/**
 * PLAYER JOURNEY · PRIMERA SESIÓN COMPLETADA (Fase 40).
 *
 * Aparece mientras la cuenta tiene exactamente UNA partida terminada (hecho del servidor). Ganar, perder o empatar vale
 * igual. Enseña destinos REALES (rutas existentes) con una línea cada uno; el evento en directo solo si hay un partido en
 * directo de verdad. No da nada: no hay recompensa de primera sesión.
 */
import Link from "next/link";
import type { DiscoveryDestination } from "@/domain/journey";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("journey");

export function JourneyDiscovery({ items, offline = false, className }: { items: DiscoveryDestination[]; offline?: boolean; className?: string }) {
  useLocale();
  return (
    <section aria-labelledby="journey-discovery-title" data-testid="journey-discovery" className={`nx-clip relative overflow-hidden border border-ok/35 bg-[linear-gradient(160deg,rgba(63,192,122,0.1),rgba(6,8,14,0.96)_60%)] px-5 py-6 sm:px-8 ${className ?? ""}`}>
      <p className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-ok">{t("✓ Primera sesión completada")}</p>
      <h2 id="journey-discovery-title" className="mt-1 font-display text-[clamp(26px,4.4vw,44px)] font-bold uppercase leading-[0.95] text-white">{t("Ya conoces el núcleo de NEXUS")}</h2>
      <p className="mt-2 text-body text-ink-secondary">{t("Ahora elige cómo seguir.")}</p>
      <ul className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((d) => {
          const body = (
            <>
              <span className="block font-display text-[16px] font-bold uppercase leading-tight text-white">{td(d.title)}</span>
              <span className="mt-1 block text-[13px] leading-snug text-ink-muted">{td(d.line)}</span>
            </>
          );
          return (
            <li key={d.id} data-destination={d.id}>
              {offline
                ? <div aria-disabled="true" className="nx-clip-sm block min-h-[64px] border border-white/10 px-4 py-3 opacity-60">{body}</div>
                : <Link href={d.href} className="nx-clip-sm nx-focus block min-h-[64px] border border-white/12 bg-black/30 px-4 py-3 transition hover:-translate-y-0.5 hover:border-ok/50">{body}</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
