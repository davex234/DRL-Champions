"use client";

/**
 * VITRINA DE CARTAS (Fase 31) — el núcleo del perfil. Tres INSTANCIAS reales (serial y variante de
 * ese ejemplar), en el orden guardado; el slot 1 es la carta DESTACADA: más grande, al frente y con
 * halo si su rareza lo merece. Se pinta con las piezas canónicas —`PlayerCard` dentro de `Card3D`—,
 * como la vitrina de la home y la de `/cuenta`: nada de un renderizador propio. Tocar una carta abre
 * el `CardViewer` canónico.
 *
 * Móvil: carrusel con snap horizontal y un asomo de la siguiente. Vacía: en el perfil propio, una
 * invitación a elegir; en uno ajeno, una línea discreta (nada de tres huecos gigantes).
 */
import { useState } from "react";
import { getCard } from "@/data/catalog";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardViewer } from "@/components/cards/CardViewer";
import { Card3D } from "@/components/visual/Card3D";
import { Badge } from "@/components/ui/Badge";
import { Plate, Recessed } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { ShowcaseSlot } from "@/domain/profile/identity";
import { RARITY_TONE, ProfileButton, serialText } from "./bits";

export function CardShowcase({ slots, isSelf, unavailable = 0, onEdit, onView }: { slots: ShowcaseSlot[]; isSelf: boolean; unavailable?: number; onEdit?: () => void; onView?: (s: ShowcaseSlot) => void }) {
  const [open, setOpen] = useState<ShowcaseSlot | null>(null);

  if (slots.length === 0) {
    if (!isSelf) {
      return (
        <section aria-label="Vitrina" data-testid="showcase" data-count={0}>
          <p className="nx-clip-sm border border-dashed border-white/10 px-4 py-3 text-caption text-ink-muted">Sin cartas destacadas: todavía no ha elegido cartas para su vitrina.</p>
        </section>
      );
    }
    return (
      <section aria-label="Vitrina" data-testid="showcase" data-count={0}>
        <Plate className="flex flex-col items-center gap-4 px-6 py-8 text-center sm:flex-row sm:text-left">
          <div className="flex items-end gap-2" aria-hidden>
            {[0, 1, 2].map((i) => <Recessed key={i} depth="sm" className={i === 1 ? "h-24 w-[68px]" : "h-20 w-14"} />)}
          </div>
          <div className="flex-1">
            <h2 className="font-display text-h3 font-bold uppercase tracking-wide text-white">Expón tus cartas favoritas</h2>
            <p className="mt-1 text-caption text-ink-muted">Elige hasta 3 cartas de tu colección —la copia concreta, con su serie— para enseñarlas en tu perfil. La primera será tu carta destacada.</p>
            {unavailable > 0 && <p className="mt-1 text-[11px] text-drl-gold">{unavailable === 1 ? "Una carta de tu vitrina ya no está en tu colección." : `${unavailable} cartas de tu vitrina ya no están en tu colección.`}</p>}
          </div>
          <ProfileButton tone="primary" onClick={onEdit} data-action="choose-cards">Elegir cartas</ProfileButton>
        </Plate>
      </section>
    );
  }

  const view = (s: ShowcaseSlot) => { onView?.(s); setOpen(s); };
  const openDef = open ? getCard(open.cardId) : null;

  return (
    <section aria-label="Vitrina de cartas" data-testid="showcase" data-count={slots.length}>
      <SectionTitle action={isSelf ? <button type="button" onClick={onEdit} className="nx-action">Editar vitrina</button> : undefined}>Vitrina</SectionTitle>
      {isSelf && unavailable > 0 && <p className="-mt-1.5 mb-2 text-[11px] text-drl-gold">{unavailable === 1 ? "Una carta de tu vitrina ya no está en tu colección y no se enseña." : `${unavailable} cartas de tu vitrina ya no están en tu colección y no se enseñan.`}</p>}
      <ol className="-mx-4 flex snap-x snap-mandatory items-end gap-5 overflow-x-auto px-4 pb-3 [scrollbar-width:none] lg:mx-0 lg:justify-center lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
        {slots.map((s, i) => {
          const def = getCard(s.cardId);
          const lead = i === 0;
          return (
            <li
              key={s.uid}
              className={`flex shrink-0 snap-center flex-col items-center gap-2 ${lead ? "order-first lg:order-2" : i === 1 ? "lg:order-1" : "lg:order-3"}`}
              data-slot={s.slot}
              data-uid={s.uid}
              data-low-serial={s.lowSerial ? "yes" : "no"}
            >
              <div style={{ transform: lead ? undefined : `rotate(${i === 1 ? -5 : 5}deg)` }} className="motion-reduce:!transform-none">
                {def ? (
                  <Card3D
                    mode={lead && s.rarity === "legendary" ? "legendary" : lead ? "showcase" : "hover"}
                    glow={s.glow}
                    delay={0.08 + i * 0.08}
                    onClick={() => view(s)}
                    label={`Ver ${s.nick}, ${s.variantLabel}, ${serialText(s.serial, s.serialLimit)}`}
                  >
                    <PlayerCard card={def} serial={s.serial ?? undefined} size={lead ? "lg" : "md"} interactive={false} />
                  </Card3D>
                ) : (
                  <Recessed depth="sm" className={`${lead ? "h-[420px] w-[300px]" : "h-[322px] w-[230px]"} grid place-items-center text-caption text-ink-muted`}>Carta no disponible</Recessed>
                )}
              </div>
              <div className="flex max-w-[300px] flex-wrap items-center justify-center gap-1.5 text-center">
                {lead && <Badge tone="gold" dot>Destacada</Badge>}
                <Badge tone={RARITY_TONE[s.rarity]}>{s.rarityLabel}</Badge>
                <span className="font-display text-[12px] font-bold uppercase text-white" data-field="serial">{serialText(s.serial, s.serialLimit)}</span>
                {s.lowSerial && <Badge tone="gold">Serie baja</Badge>}
              </div>
              <p className="text-[11px] text-white/45">{s.variantLabel}{s.team ? ` · ${s.team}` : ""}</p>
            </li>
          );
        })}
      </ol>
      {open && openDef && <CardViewer card={openDef} serial={open.serial ?? undefined} onClose={() => setOpen(null)} />}
    </section>
  );
}
