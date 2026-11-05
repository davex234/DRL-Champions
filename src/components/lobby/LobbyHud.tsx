"use client";

/**
 * COMMAND CENTER — HUD DEL JUGADOR.
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * «¿Qué tengo yo?» tiene que contestarse de un vistazo y sin leer. Antes eran cuatro
 * enlaces sueltos con la cifra escrita a mano (`nx-readout text-[22px]`) y una barra de
 * progreso de 2 px dibujada con dos `<span>`; ahora es un RAÍL del escenario: los datos
 * viven sobre el plano, separados por filos, con la cifra del sistema (`Readout`) y el
 * medidor del sistema (`Meter`).
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * **1. Funciona sin sesión.** Nivel, colección y créditos salen del estado local, que
 * existe siempre. El rango es lo único que necesita cuenta —es competitivo y vive en el
 * servidor—, así que es la única celda que aparece y desaparece.
 *
 * **2. Nada de cajas.** Un dato de videojuego no vive en una tarjeta. Lo que separa una
 * cifra de la siguiente es el espacio y un filo de 1 px, no un borde por cada número.
 *
 * **3. Cada celda es un destino.** Si el dato invita a mirarlo, tiene que poder pulsarse,
 * y con área táctil de verdad (44 px), no con la altura de su línea de texto.
 */
import Link from "next/link";
import { Meter } from "@/components/ui/Meter";
import { Readout } from "@/components/ui/Readout";
import { RankEmblem } from "@/components/progression/RankEmblem";
import type { RankTierId } from "@/domain/progression/rank";
import { formatCredits } from "@/lib/format";

export interface LobbyHudRank {
  tierId: RankTierId;
  color: string;
  label: string;
  division: number;
  divisions: number;
  /** Puesto mundial, si el servidor lo conoce. */
  position: number | null;
  points: number;
  champion: boolean;
}

export function LobbyHud({
  rank, level, collection, credits, packs,
}: {
  /** Solo con sesión: el rango es competitivo y lo decide el servidor. */
  rank: LobbyHudRank | null;
  level: { level: number; xpIntoLevel: number; xpForNext: number; progress: number };
  collection: { distinct: number; total: number; owned: number };
  credits: number;
  packs: number;
}) {
  return (
    <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-edge bg-black/30 px-5 py-4 sm:px-9">
      {rank && (
        <>
          <Link
            href="/ranking"
            className="nx-focus group flex min-h-[44px] items-center gap-3 pr-1"
            aria-label={`Tu rango: ${rank.label}`}
          >
            <RankEmblem
              tierId={rank.champion ? "nexus" : rank.tierId}
              color={rank.color}
              champion={rank.champion}
              division={rank.division}
              divisions={rank.divisions}
              size={40}
              className="shrink-0 transition-transform duration-fast group-hover:scale-110"
            />
            <Readout
              size="md"
              label="Rango"
              value={rank.label}
              tone={rank.color}
              className="min-w-0"
            />
          </Link>
          <Filo />
        </>
      )}

      <HudCell
        href="/cuenta"
        label="Nivel"
        value={String(level.level)}
        foot={`${level.xpIntoLevel} / ${level.xpForNext} XP`}
        progress={level.progress}
        tone="info"
      />

      <HudCell
        href="/coleccion"
        label="Colección"
        value={String(collection.distinct)}
        unit={`/ ${collection.total}`}
        foot={`${collection.owned} cartas en total`}
        progress={collection.total ? collection.distinct / collection.total : 0}
        tone="key"
      />

      <HudCell
        href={packs > 0 ? "/inventario" : "/tienda"}
        label="Créditos"
        value={formatCredits(credits)}
        foot={packs > 0 ? `${packs} ${packs === 1 ? "sobre" : "sobres"} sin abrir` : "Sin sobres pendientes"}
        tone="gold"
      />
    </div>
  );
}

function Filo() {
  return <span aria-hidden className="hidden h-9 w-px bg-edge sm:block" />;
}

const TONE_COLOR = {
  info: "var(--nx-cyan)",
  key: "var(--nx-accent)",
  gold: "var(--nx-gold)",
} as const;

function HudCell({
  href, label, value, unit, foot, progress, tone,
}: {
  href: string;
  label: string;
  value: string;
  unit?: string;
  foot: string;
  progress?: number;
  tone: keyof typeof TONE_COLOR;
}) {
  return (
    <Link href={href} className="nx-focus group flex min-h-[44px] min-w-[118px] flex-col justify-center">
      <Readout size="md" label={label} value={value} unit={unit} tone={TONE_COLOR[tone]} />
      {progress !== undefined && (
        <Meter
          value={progress * 100}
          tone={tone}
          height={3}
          label={label}
          className="mt-1.5 max-w-[124px]"
        />
      )}
      <span className="mt-1 block text-caption text-ink-faint transition-colors duration-fast group-hover:text-ink-muted">
        {foot}
      </span>
    </Link>
  );
}
