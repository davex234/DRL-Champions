"use client";

/**
 * COMMAND CENTER — PUERTAS Y BARRA DE MANDO.
 *
 * ────────────────────────── LA JERARQUÍA ──────────────────────────
 *
 * El vestíbulo anterior terminaba con ocho destinos que pesaban lo mismo: tres puertas
 * grandes y cuatro pastillas, todas del mismo tamaño, todas con su punto de color. Ocho
 * cosas igual de importantes es cero cosas importantes.
 *
 * Aquí hay dos rangos y se distinguen por PESO, no por color:
 *
 *   PUERTAS       modos que se juegan. Emblema grande recortado por el borde, superficie
 *                 propia (`Plate`) y una línea de acento que crece al apuntar.
 *   BARRA DE MANDO destinos de gestión. Una sola tira baja, sin emblema y sin superficie
 *                 individual: son sitios a los que se va a hacer algo y se vuelve.
 *
 * El acento de cada modo NO es decoración: es su identidad, la misma que usa su emblema y
 * su pantalla. Por eso viaja como dato (`tint`) y no como una clase escrita a mano.
 */
import Link from "next/link";
import { ModeEmblem, type ModeId } from "@/components/visual/ModeEmblem";
import { Plate } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/format";

export interface LobbyMode {
  id: ModeId;
  href: string;
  label: string;
  tag: string;
  line: string;
  /** RGB sin envolver, para poder modularlo con alfa. */
  tint: string;
}

export interface LobbyDestination {
  href: string;
  label: string;
  tint: string;
}

export function LobbyModes({
  modes, destinations,
}: { modes: LobbyMode[]; destinations: LobbyDestination[] }) {
  return (
    <section aria-label="Modos de juego">
      <SectionTitle>Otros modos</SectionTitle>

      <div className="grid gap-3 sm:grid-cols-3">
        {modes.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className={cn(
              "nx-focus group relative isolate flex min-h-[150px] flex-col justify-end overflow-hidden",
              "nx-clip p-5 transition duration-normal ease-out motion-safe:hover:-translate-y-1",
            )}
            style={{
              ["--nx-chamfer" as string]: "var(--nx-chamfer-plate)",
              border: `1px solid rgb(${m.tint} / 0.22)`,
              background: `linear-gradient(150deg, rgb(${m.tint} / 0.18), rgba(255,255,255,0.02) 58%)`,
            }}
          >
            <span
              aria-hidden
              className="nx-bloom -right-10 -top-12 h-44 w-44"
              style={{ background: `rgb(${m.tint})` }}
            />
            {/*
              El emblema vive DETRÁS del texto, grande y recortado por el borde. Un icono
              pequeño en una esquina se lee como decoración; a este tamaño, como identidad.
            */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-5 -top-5 -z-10 h-32 w-32 opacity-25 transition-all duration-normal ease-out group-hover:scale-105 group-hover:opacity-45"
            >
              <ModeEmblem mode={m.id} color={m.tint} />
            </span>

            <span className="font-display text-label uppercase tracking-wide2" style={{ color: `rgb(${m.tint})` }}>
              {m.tag}
            </span>
            <span className="mt-1 block font-display text-h2 font-bold uppercase leading-none tracking-wide text-white">
              {m.label}
            </span>
            <span className="mt-2 block max-w-[26ch] text-caption leading-snug text-ink-muted">
              {m.line}
            </span>
            <span
              aria-hidden
              className="mt-4 block h-[3px] w-10 rounded-full transition-[width] duration-normal ease-out group-hover:w-24"
              style={{ background: `rgb(${m.tint})`, boxShadow: `0 0 14px rgb(${m.tint} / 0.9)` }}
            />
          </Link>
        ))}
      </div>

      {/*
        BARRA DE MANDO. Una sola placa dividida, no cuatro pastillas: así se lee como la
        barra de un menú y no compite con las puertas de arriba.
      */}
      <Plate className="mt-3 grid grid-cols-2 divide-x divide-y divide-edge sm:grid-cols-4 sm:divide-y-0">
        {destinations.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="nx-focus group flex min-h-[52px] items-center justify-between gap-2 px-4 py-3 transition-colors duration-fast hover:bg-white/[0.05]"
          >
            <span className="font-display text-caption font-bold uppercase tracking-wide2 text-ink-muted transition-colors duration-fast group-hover:text-white">
              {d.label}
            </span>
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full transition-transform duration-fast group-hover:scale-150"
              style={{ background: `rgb(${d.tint})`, boxShadow: `0 0 10px rgb(${d.tint} / 0.8)` }}
            />
          </Link>
        ))}
      </Plate>
    </section>
  );
}
