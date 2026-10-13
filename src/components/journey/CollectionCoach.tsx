"use client";

/**
 * PLAYER JOURNEY · COLECCIÓN (Fase 40). UN bloque, solo mientras el jugador tiene cartas y todavía no ha guardado ningún
 * equipo (`duel_decks` vacío, dato del servidor). Explica qué es una carta y cuántos jugadores distintos por rol tiene
 * para su plantilla. La cuenta de roles es PRESENTACIÓN sobre su colección real; el paso de la primera sesión lo decide
 * el servidor en el vestíbulo.
 */
import { getCard, getPlayer } from "@/data/catalog";
import { NxButton } from "@/components/ui/NxButton";
import { cn } from "@/lib/format";
import { JOURNEY_ROUTES, deckReadiness } from "@/domain/journey";
import { JourneyCoach } from "./JourneyCoach";

export function collectionReadiness(cardIds: readonly string[]) {
  return deckReadiness(cardIds, (id) => {
    const c = getCard(id);
    const p = c ? getPlayer(c.playerId) : undefined;
    return c && p ? { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
  });
}

export function CollectionCoach({ cardIds, packs, onShowOwned }: { cardIds: readonly string[]; packs: number; onShowOwned?: () => void }) {
  const r = collectionReadiness(cardIds);
  return (
    <JourneyCoach eyebrow="Primera sesión · 2/4 · Colecciona" title="Estas son tus cartas" testId="journey-collection-coach" className="mb-4">
      <p>
        Cada carta es un jugador real: su <b className="text-white">rol</b>, su <b className="text-white">OVR</b> y tres estadísticas de combate,
        <b className="text-white"> Stronghold</b>, <b className="text-white">Gamesense</b> y <b className="text-white">Entryfrag</b>. Toca una carta para ver su ficha.
      </p>
      <p className="mt-1.5">Para tu plantilla necesitas dos jugadores distintos de cada rol:</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Jugadores distintos por rol">
        {r.roles.map((x) => (
          <li key={x.role} className={cn("rounded-[3px] border px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.12em]", x.have >= x.need ? "border-ok/60 text-ok" : "border-warn/60 text-warn")}>
            {x.have >= x.need ? "✓ " : "· "}{x.role} {x.have}/{x.need}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {onShowOwned && <NxButton variant="secondary" size="md" onClick={onShowOwned} data-testid="journey-collection-owned">Ver solo mis cartas</NxButton>}
        {r.ready
          ? <NxButton variant="primary" size="md" href={JOURNEY_ROUTES.newDeck} data-testid="journey-collection-cta">Construir mi primer equipo</NxButton>
          : packs > 0
            ? <NxButton variant="primary" size="md" href="/inventario" data-testid="journey-collection-cta">Abrir mis sobres</NxButton>
            : <NxButton variant="primary" size="md" href={JOURNEY_ROUTES.freePack} data-testid="journey-collection-cta">Conseguir Sobre Inicial gratis</NxButton>}
      </div>
    </JourneyCoach>
  );
}
