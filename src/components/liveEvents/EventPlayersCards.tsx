"use client";

/**
 * JUGADORES Y CARTAS DEL EVENTO (Fase 30). Jugadores REALES (rol solo si la fuente lo trae) y
 * las cartas EXISTENTES del catálogo ligadas a ellos: EN TU COLECCIÓN / NO CONSEGUIDA sin tocar
 * la propiedad. El denominador del progreso son las cartas reales elegibles; un jugador sin
 * carta no cuenta como «carta que falta».
 */
import { useState } from "react";
import Link from "next/link";
import { Plate } from "@/components/ui/Surface";
import { Badge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Meter";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { EventHubSnapshot } from "@/server/services/liveEvents";

const SHOW = 12;

export function EventPlayersCards({ snap, onCollectionCta }: { snap: EventHubSnapshot; onCollectionCta?: () => void }) {
  const [allPlayers, setAllPlayers] = useState(false);
  const [allCards, setAllCards] = useState(false);
  const c = snap.collection;
  const players = allPlayers ? snap.players : snap.players.slice(0, SHOW);
  const cards = allCards ? snap.cards : snap.cards.slice(0, SHOW);
  return (
    <section id="cartas" aria-label="Jugadores y cartas" data-testid="event-cards" data-cards={snap.cards.length} data-players={snap.players.length} className="space-y-4">
      <SectionTitle action={snap.cards.length > 0 ? <Link href="/coleccion" className="nx-action" onClick={onCollectionCta}>Mi colección →</Link> : undefined}>Cartas del evento</SectionTitle>
      {c && c.total > 0 ? (
        <Plate className="px-4 py-3" data-testid="collection-progress" data-owned={c.owned} data-total={c.total}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-2"><span className="nx-readout text-[22px] text-white tabular-nums">{snap.signedIn ? c.owned : "—"} / {c.total}</span><span className="nx-label">cartas del evento</span></span>
            <span className="nx-label">{snap.signedIn ? `${c.pct}%` : "inicia sesión para ver las tuyas"}</span>
          </div>
          <Meter value={snap.signedIn ? c.pct : 0} tone="info" height={5} label={`${c.owned} de ${c.total} cartas del evento`} className="mt-2" />
        </Plate>
      ) : (
        <Plate className="px-4 py-4 text-caption text-ink-muted">Ningún jugador de este evento tiene carta en el catálogo todavía.</Plate>
      )}

      {snap.cards.length > 0 && (
        <>
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((k) => (
              <li key={k.cardId}>
                <Plate tone={k.owned ? "success" : "neutral"} className="flex items-center justify-between gap-3 px-3 py-2" data-card={k.cardId} data-owned={k.owned ? "yes" : "no"}>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-[13px] font-bold uppercase text-white">{k.nick}</span>
                    <span className="block text-[11px] text-white/45">{k.teamName ?? ""}{k.teamName ? " · " : ""}{k.variantId} · OVR {k.ovr}</span>
                  </span>
                  <Badge tone={k.owned ? "ok" : "muted"}>{snap.signedIn ? (k.owned ? "En tu colección" : "No conseguida") : "Carta del evento"}</Badge>
                </Plate>
              </li>
            ))}
          </ol>
          {!allCards && snap.cards.length > SHOW && <button type="button" onClick={() => setAllCards(true)} className="nx-focus min-h-[44px] font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan">Ver las {snap.cards.length} cartas</button>}
        </>
      )}

      <div>
        <SectionTitle as="h3">Jugadores <span className="ml-2 text-ink-faint">({snap.players.length})</span></SectionTitle>
        {snap.players.length === 0 ? (
          <Plate className="px-4 py-4 text-caption text-ink-muted">Los jugadores aparecerán cuando el pipeline publique las plantillas.</Plate>
        ) : (
          <>
            <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
              {players.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]" data-player={p.id} data-role={p.role ?? "unknown"}>
                  <span className="min-w-0 flex-1 truncate font-display font-bold uppercase text-white">{p.nick}{p.substitute && <span className="ml-2 text-[10px] text-white/40">suplente</span>}</span>
                  <span className="hidden text-white/50 sm:inline">{p.teamName ?? "—"}</span>
                  <span className="text-[11px] text-white/45">{p.role ?? "Rol no publicado"}</span>
                  <span className="nx-label">{p.cardIds.length === 0 ? "sin carta" : `${p.cardIds.length} ${p.cardIds.length === 1 ? "carta" : "cartas"}`}</span>
                </li>
              ))}
            </ol>
            {!allPlayers && snap.players.length > SHOW && <button type="button" onClick={() => setAllPlayers(true)} className="nx-focus mt-2 min-h-[44px] font-display text-[11px] font-bold uppercase tracking-[0.12em] text-drl-cyan">Ver los {snap.players.length} jugadores</button>}
          </>
        )}
      </div>
    </section>
  );
}
