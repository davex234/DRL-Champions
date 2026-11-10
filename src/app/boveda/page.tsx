"use client";

/**
 * `/boveda` — LA BÓVEDA: el hub de INVENTARIO.
 *
 * ────────────────────────── POR QUÉ EXISTE, Y POR QUÉ NO ES UNA RUTA MÁS ──────────────────────────
 *
 * El menú principal tiene tres acciones, y la segunda es INVENTARIO. Detrás no había nada que
 * agrupara «mis cartas»: la colección, los equipos y los sets vivían en tres sitios distintos del
 * menú de secciones, que es justo lo que la Fase 46 quita de la Home.
 *
 * Ojo con el nombre: `/inventario` YA EXISTE y es otra cosa —los sobres sin abrir y las duplicadas,
 * que pertenecen a TIENDA—. Cambiarle el significado habría roto una URL viva (y el enlace «Mis
 * sobres» de la tienda apunta ahí). Por eso la bóveda estrena ruta en vez de secuestrar una.
 *
 * ────────────────────────── QUÉ ES ──────────────────────────
 *
 * Tres accesos, el mismo lenguaje visual que el menú principal y nada más. No es un cuadro de
 * mandos: no hay métricas, ni carruseles, ni tarjetas de contenido. Presentación pura, sin lecturas
 * al servidor: todo lo que necesita saber es a dónde se va.
 */
import Link from "next/link";
import { playSound } from "@/lib/sound";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("boveda");

const ACCESOS = [
  {
    href: "/coleccion",
    titulo: "Colección",
    sub: "Todas tus cartas",
    k: "79, 195, 247",
    d: "Busca, filtra y mira cada carta de cerca.",
  },
  {
    href: "/duelos/mazos",
    titulo: "Equipos",
    sub: "Tus equipos y el laboratorio",
    k: "139, 92, 246",
    d: "Los diez que entran a la arena, el equipo activo y la estrategia del equipo.",
  },
  {
    href: "/colecciones",
    titulo: "Sets",
    sub: "Colecciones completas",
    k: "255, 196, 77",
    d: "Qué te falta para cerrar cada set y qué da al completarlo.",
  },
];

export default function BovedaPage() {
  useLocale();
  return (
    <main className="relative isolate min-h-[100dvh] px-[clamp(16px,3vw,56px)] py-[clamp(24px,5vh,64px)]">
      <header className="mb-[clamp(20px,4vh,48px)]">
        <Link
          href="/"
          onClick={() => playSound("ui.back")}
          className="nx-label text-white/45 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
        >
          {t("‹ Menú principal")}
        </Link>
        <h1 className="mt-3 font-display text-[clamp(30px,6vh,64px)] font-extrabold uppercase leading-none tracking-[0.04em] text-white">
          {t("Inventario")}
        </h1>
        <p className="mt-2 font-display text-[clamp(10px,1.5vh,14px)] font-bold uppercase tracking-[0.3em] text-white/45">
          {t("Tus cartas, tu poder")}
        </p>
      </header>

      <nav aria-label={t("Secciones del inventario")} className="flex max-w-[980px] flex-col gap-[clamp(10px,1.8vh,20px)]">
        {ACCESOS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            data-testid={`boveda-${a.href.replace(/\//g, "-")}`}
            onClick={() => playSound("ui.confirm")}
            className="nx-menu-btn"
            style={{ "--k": a.k } as React.CSSProperties}
          >
            <span className="nx-menu-ticks" aria-hidden><span /><span /><span /></span>
            <span className="relative flex items-center gap-4 pl-3">
              <span className="min-w-0 flex-1">
                <b className="block font-display text-[clamp(20px,3.6vh,38px)] font-extrabold uppercase leading-none tracking-[0.04em] text-white">
                  {td(a.titulo)}
                </b>
                <span className="mt-1.5 block font-display text-[clamp(9px,1.2vh,12px)] font-bold uppercase tracking-[0.26em] text-white/55">
                  {td(a.sub)}
                </span>
                <span className="mt-2 block max-w-[52ch] text-[12px] leading-snug text-white/40">{td(a.d)}</span>
              </span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"
                className="nx-menu-arrow h-6 w-6 shrink-0 text-white/70">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
