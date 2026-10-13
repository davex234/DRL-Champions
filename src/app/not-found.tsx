"use client";

/**
 * FASE 44 · 404 DEL JUEGO. Sustituye al «This page could not be found.» en inglés de Next: la ruta no existe, pero el
 * jugador sigue dentro de NEXUS (armazón incluido) y tiene dos salidas claras: VOLVER AL LOBBY y JUGAR.
 */
import Link from "next/link";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("app");

export default function NotFound() {
  useLocale(); // I18N · cliente: el 404 se pinta en el idioma del jugador, no en el del servidor
  return (
    <section data-testid="not-found" className="nx-clip relative isolate mx-auto mt-4 max-w-3xl overflow-hidden border border-white/10 px-6 py-14 text-center sm:px-12 sm:py-20"
      style={{ background: "radial-gradient(70% 90% at 50% 0%, rgba(255,46,99,0.16), transparent 70%), linear-gradient(180deg, rgba(17,19,31,0.94), rgba(8,9,16,0.97))" }}>
      <p className="nx-label text-drl">{t("Fuera del mapa")}</p>
      <p aria-hidden className="nx-readout mt-3 text-[clamp(84px,18vw,150px)] leading-none text-white/10">404</p>
      <h1 className="-mt-6 font-display text-[clamp(28px,4.4vw,46px)] font-bold uppercase leading-none tracking-[0.04em] text-white">{t("Esta zona no existe")}</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-white/60">{t("El enlace está roto o la pantalla ya no está en NEXUS. Tu progreso no se ha tocado.")}</p>
      <div className="mt-8 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        <Link href="/" className="nx-clip-sm nx-press inline-flex min-h-[52px] items-center justify-center bg-drl px-8 font-display text-[15px] font-bold uppercase tracking-[0.14em] text-white shadow-glow transition hover:brightness-110" data-cta="primary">
          {t("Volver al juego")}
        </Link>
        <Link href="/jugar" className="nx-clip-sm nx-press inline-flex min-h-[52px] items-center justify-center px-8 font-display text-[15px] font-bold uppercase tracking-[0.14em] text-white/85 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)] transition hover:bg-white/[0.06]">
          {t("Jugar")}
        </Link>
      </div>
    </section>
  );
}
