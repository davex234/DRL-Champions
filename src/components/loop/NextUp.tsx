"use client";

/**
 * QUÉ HACER AHORA (Fase 10).
 *
 * ────────────────────────── POR QUÉ EXISTE ──────────────────────────
 *
 * La Fase 9.6 dejó el vestíbulo pareciendo un videojuego, pero seguía respondiendo solo a
 * «¿a qué juego?». La auditoría de la Fase 10 encontró la otra mitad del problema: NEXUS
 * tenía torneos, predicciones, duelos, sobres, colección, mazos, pase y rango, y **ninguna
 * pantalla sabía de las otras**. El jugador tenía que recordar que le quedaban sobres sin
 * abrir, que había predicciones cerrando y que tenía tres niveles del pase sin reclamar.
 *
 * Esta tira es el hilo que une las piezas. Cada paso existe porque **hay un dato del
 * servidor que lo justifica**, y desaparece en cuanto deja de haberlo: no es un menú
 * disfrazado de recomendaciones.
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * **1. El orden lo decide el servidor, no esta tira.** `getLoop` ordena por prioridad y
 * aquí solo se pinta. Si el orden se decidiera en dos sitios, acabarían discrepando.
 *
 * **2. Como mucho cuatro.** Una lista de nueve cosas pendientes no orienta: abruma. Los
 * pasos vienen ordenados, así que quedarse con los primeros es quedarse con lo que más
 * importa. El resto sigue estando en su pantalla.
 *
 * **3. Lo que caduca se marca.** Una predicción que cierra es lo único de esta lista que
 * se puede PERDER. Lleva su propia señal; el resto puede esperar.
 *
 * **4. Si no hay nada, no se pinta nada.** Una tira que dice «no tienes nada pendiente»
 * ocupa el mejor sitio de la pantalla para no decir nada.
 */
import Link from "next/link";
import type { LoopStep, LoopStepKind } from "@/lib/game/loop";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/format";

/**
 * Identidad visual por tipo de paso. Es una tabla y no un `switch` para que añadir un
 * tipo nuevo en el servidor sea añadir una fila aquí — y para que, si no se añade, el
 * paso salga igualmente con el tono neutro en vez de desaparecer.
 */
const KIND: Record<LoopStepKind, { tint: string; glyph: string }> = {
  resume:  { tint: "255,46,99",  glyph: "▸" },
  predict: { tint: "25,227,255", glyph: "◈" },
  claim:   { tint: "255,211,92", glyph: "✦" },
  open:    { tint: "255,138,61", glyph: "▣" },
  build:   { tint: "123,92,255", glyph: "⬢" },
  // Rombo, no espadas: `⚔` no existe en la familia display y el navegador lo sustituía
  // por un glifo de otra fuente, más pequeño y de otro color. Un icono que cambia de
  // dibujo según la fuente disponible no es un icono.
  play:    { tint: "255,46,99",  glyph: "◆" },
  explore: { tint: "63,192,122", glyph: "◎" },
  // Fase 27: un objetivo a medio camino.
  objective: { tint: "25,227,255", glyph: "◐" },
  // Fase 29: un reto privado recibido, pendiente.
  challenge: { tint: "25,227,255", glyph: "⬡" },
};

const NEUTRAL = { tint: "150,160,180", glyph: "•" };

export function NextUp({ steps, max = 4 }: { steps: LoopStep[]; max?: number }) {
  const list = steps.slice(0, max);
  if (list.length === 0) return null;

  return (
    <section aria-label="Qué hacer ahora">
      <SectionTitle>Qué hacer ahora</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {list.map((s) => {
          const k = KIND[s.kind] ?? NEUTRAL;
          return (
            <Link
              key={s.id}
              href={s.href}
              className={cn(
                "nx-clip-sm group relative flex min-h-[92px] flex-col justify-between overflow-hidden",
                "border p-4 transition duration-fast hover:-translate-y-0.5",
              )}
              style={{
                borderColor: `rgb(${k.tint} / ${s.urgent ? 0.5 : 0.22})`,
                background: `linear-gradient(150deg, rgb(${k.tint} / ${s.urgent ? 0.14 : 0.08}), rgba(255,255,255,0.015) 62%)`,
              }}
            >
              <span
                aria-hidden
                className="nx-bloom -right-8 -top-10 h-32 w-32"
                style={{ background: `rgb(${k.tint})`, opacity: s.urgent ? 0.45 : 0.25 }}
              />

              <span className="relative flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span
                    className="font-display text-[15px] font-bold uppercase tracking-[0.06em] text-white"
                  >
                    {s.label}
                  </span>
                  {/*
                    Lo que caduca lleva su marca. Es la única distinción de urgencia de la
                    tira: si todo pudiera ser urgente, nada lo sería.
                  */}
                  {s.urgent && (
                    <span
                      className="ml-2 align-middle font-display text-[9px] font-bold uppercase tracking-[0.14em]"
                      style={{ color: `rgb(${k.tint})` }}
                    >
                      · caduca
                    </span>
                  )}
                </span>

                <span className="flex shrink-0 items-center gap-1.5">
                  {typeof s.count === "number" && s.count > 0 && (
                    <span
                      className="nx-readout grid h-6 min-w-6 place-items-center rounded-chip px-1.5 text-[13px]"
                      style={{ background: `rgb(${k.tint} / 0.18)`, color: `rgb(${k.tint})` }}
                    >
                      {s.count}
                    </span>
                  )}
                  <span
                    aria-hidden
                    className="text-[15px] leading-none transition-transform duration-fast group-hover:scale-110"
                    style={{ color: `rgb(${k.tint})` }}
                  >
                    {k.glyph}
                  </span>
                </span>
              </span>

              <span className="relative mt-2 block text-[12.5px] leading-snug text-white/55">
                {s.detail}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
