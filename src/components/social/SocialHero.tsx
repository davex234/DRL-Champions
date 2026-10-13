"use client";

/**
 * HERO SOCIAL (Fase 29): cifras REALES del snapshot (amigos, en línea ahora, solicitudes, retos
 * pendientes) y la puerta a buscar jugadores. En 390 las cuatro cifras van en dos filas.
 */
import { Readout } from "@/components/ui/Readout";
import { Stage } from "@/components/ui/Surface";
import { NxButton } from "@/components/ui/NxButton";
import type { SocialSnapshot } from "@/server/services/social";
import { PresenceDot } from "./bits";

export function SocialHero({ snap, onSearch }: { snap: SocialSnapshot; onSearch: () => void }) {
  const online = snap.friends.filter((f) => f.presence === "ONLINE").length;
  const pending = snap.counts.incoming + snap.counts.challengesIn;
  return (
    <Stage tone="cyan" grid className="p-5 sm:p-6" data-testid="social-hero" data-friends={snap.counts.friends} data-pending={pending}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span aria-hidden className="grid h-16 w-16 place-items-center rounded-full bg-white/[0.06] text-3xl">{snap.self.avatar}</span>
          <div>
            <span className="nx-label">Tu perfil social</span>
            <h2 className="font-display text-[clamp(22px,4vw,32px)] font-bold uppercase leading-none text-white">{snap.self.username}</h2>
            <PresenceDot presence="ONLINE" className="mt-2" />
          </div>
        </div>
        <NxButton variant="primary" onClick={onSearch} data-testid="social-search-cta">Buscar jugadores</NxButton>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Readout size="sm" label="Amigos" value={snap.counts.friends} tone="var(--nx-cyan)" />
        <Readout size="sm" label="En línea ahora" value={online} tone="var(--nx-ok)" />
        <Readout size="sm" label="Solicitudes" value={snap.counts.incoming} />
        <Readout size="sm" label="Retos pendientes" value={snap.counts.challengesIn} />
      </div>
    </Stage>
  );
}
