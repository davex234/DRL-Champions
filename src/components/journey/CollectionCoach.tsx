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
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("journey");

export function collectionReadiness(cardIds: readonly string[]) {
  return deckReadiness(cardIds, (id) => {
    const c = getCard(id);
    const p = c ? getPlayer(c.playerId) : undefined;
    return c && p ? { playerId: c.playerId, role: c.role ?? p.role, dataVersion: c.dataVersion ?? "", combat: !!c.combat } : null;
  });
}

export function CollectionCoach({ cardIds, packs, onShowOwned }: { cardIds: readonly string[]; packs: number; onShowOwned?: () => void }) {
  useLocale();
  const r = collectionReadiness(cardIds);
  return (
    <JourneyCoach eyebrow={t("Primera sesión · 2/4 · Colecciona")} title={t("Estas son tus cartas")} testId="journey-collection-coach" className="mb-4">
      <p>
        {fill(t("Cada carta es un jugador real: su {role}, su {ovr} y tres estadísticas de combate, {s}, {g} y {e}. Toca una carta para ver su ficha.", slots("role", "ovr", "s", "g", "e")), {
          role: <b className="text-white">{t("rol")}</b>, ovr: <b className="text-white">{t("OVR")}</b>,
          s: <b className="text-white">{t("Stronghold")}</b>, g: <b className="text-white">{t("Gamesense")}</b>, e: <b className="text-white">{t("Entryfrag")}</b>,
        })}
      </p>
      <p className="mt-1.5">{t("Para tu plantilla necesitas dos jugadores distintos de cada rol:")}</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={t("Jugadores distintos por rol")}>
        {r.roles.map((x) => (
          <li key={x.role} className={cn("rounded-[3px] border px-2 py-1 font-display text-[11px] font-bold uppercase tracking-[0.12em]", x.have >= x.need ? "border-ok/60 text-ok" : "border-warn/60 text-warn")}>
            {x.have >= x.need ? "✓ " : "· "}{td(x.role)} {x.have}/{x.need}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        {onShowOwned && <NxButton variant="secondary" size="md" onClick={onShowOwned} data-testid="journey-collection-owned">{t("Ver solo mis cartas")}</NxButton>}
        {r.ready
          ? <NxButton variant="primary" size="md" href={JOURNEY_ROUTES.newDeck} data-testid="journey-collection-cta">{t("Construir mi primer equipo")}</NxButton>
          : packs > 0
            ? <NxButton variant="primary" size="md" href="/inventario" data-testid="journey-collection-cta">{t("Abrir mis sobres")}</NxButton>
            : <NxButton variant="primary" size="md" href={JOURNEY_ROUTES.freePack} data-testid="journey-collection-cta">{t("Conseguir Sobre Inicial gratis")}</NxButton>}
      </div>
    </JourneyCoach>
  );
}
