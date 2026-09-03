"use client";

/**
 * TIENDA — todos los sobres, en un solo sitio (Fase 9C).
 *
 * La auditoría del Paso 0 encontró la compra partida en tres pantallas: los sobres
 * normales aquí, los de evento en `/eventos`, y la apertura en `/abrir`. Esta pantalla
 * llegaba a tener un párrafo explicando que los sobres de evento estaban en otro sitio,
 * que es la señal más clara de que la información está mal repartida.
 *
 * Ahora la tienda enseña TODO el catálogo, separado en dos bloques con significados
 * distintos: los sobres permanentes y los de evento. Los de evento siguen dependiendo
 * del Centro de Eventos —esta pantalla no cambia ninguna regla de disponibilidad ni de
 * economía: solo deja de esconder que existen.
 */
import { useMemo } from "react";
import Link from "next/link";
import { PACKS } from "@/data/packs";
import { getEvent } from "@/data/events";
import { PackStoreCard } from "@/components/packs/PackStoreCard";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { useGameStore } from "@/store/useGameStore";
import { formatCredits } from "@/lib/format";

export default function TiendaPage() {
  return (
    <HydrationGate>
      <Store />
    </HydrationGate>
  );
}

function Store() {
  const { toast, notify } = useToast();
  const credits = useGameStore((s) => s.credits);
  const unopened = useGameStore((s) => s.unopenedPacks);

  /*
   * Los sobres RETIRADOS (Fase 13) no se venden. Siguen existiendo, siguen abriéndose y
   * siguen concediéndose como recompensa: lo único que se retira es la venta. Hoy solo le
   * afecta a Prime, que está dominado en todos los ejes medidos — el porqué, con cifras,
   * está en `data/packs`.
   */
  const standard = useMemo(() => PACKS.filter((p) => !p.eventId && !p.retired), []);
  const eventPacks = useMemo(() => PACKS.filter((p) => p.eventId && !p.retired), []);
  const pending = useMemo(
    () => Object.values(unopened).reduce((s, n) => s + n, 0),
    [unopened],
  );

  return (
    <div className="space-y-8">
      {/* ── Cabecera con el saldo: comprar sin ver cuánto tienes es una fricción tonta ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="nx-label">Tienda</span>
          <h1 className="mt-1 font-display text-[clamp(30px,5vw,46px)] font-bold uppercase leading-none text-white">
            Sobres
          </h1>
          <p className="mt-2 max-w-lg text-[15px] text-white/55">
            Cada sobre tiene sus propias probabilidades y su garantía mínima. Están escritas
            en la propia carta del sobre, antes de comprar.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {pending > 0 && (
            <Link
              href="/inventario"
              className="rounded-control border border-drl-cyan/30 bg-drl-cyan/[0.08] px-4 py-2.5 text-center transition duration-fast hover:border-drl-cyan/60"
            >
              <span className="nx-label block">Sin abrir</span>
              <span className="font-display text-xl font-bold tabular-nums text-drl-cyan">{pending}</span>
            </Link>
          )}
          <div className="rounded-control border border-drl-gold/30 bg-drl-gold/[0.08] px-4 py-2.5 text-center">
            <span className="nx-label block">Tu saldo</span>
            <span className="font-display text-xl font-bold tabular-nums text-drl-gold">
              🪙 {formatCredits(credits)}
            </span>
          </div>
        </div>
      </header>

      <section aria-label="Sobres permanentes">
        <h2 className="nx-label mb-3">Siempre disponibles</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {standard.map((pack) => (
            <PackStoreCard key={pack.id} pack={pack} onNotify={notify} />
          ))}
        </div>
      </section>

      {eventPacks.length > 0 && (
        <section aria-label="Sobres de evento">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="nx-label">Sobres de evento</h2>
            <Link
              href="/eventos"
              className="nx-action"
            >
              Centro de eventos →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {eventPacks.map((pack) => {
              const ev = pack.eventId ? getEvent(pack.eventId) : null;
              return (
                <EventPackTeaser
                  key={pack.id}
                  name={pack.name}
                  description={pack.description}
                  accent={pack.accent}
                  eventName={ev?.name ?? "Evento"}
                  cards={pack.cardCount}
                />
              );
            })}
          </div>
          <p className="mt-3 text-[13px] text-white/45">
            Los sobres de evento se consiguen en el Centro de Eventos mientras su evento está
            activo, con fichas en lugar de créditos. Aquí se enseñan para que sepas que existen
            y qué contienen.
          </p>
        </section>
      )}

      <Toast toast={toast} />
    </div>
  );
}

/**
 * Un sobre de evento en la tienda: se ve, se entiende y lleva al sitio donde se consigue.
 * No se puede comprar desde aquí, y el botón lo dice —un botón que promete algo que no
 * hace es peor que no tener botón.
 */
function EventPackTeaser({
  name, description, accent, eventName, cards,
}: {
  name: string;
  description: string;
  accent: string;
  eventName: string;
  cards: number;
}) {
  return (
    <div className="nx-panel relative flex flex-col overflow-hidden p-5">
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-20 blur-2xl"
        style={{ background: accent }}
      />
      <span
        className="w-fit rounded-full px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-label"
        style={{ background: `${accent}22`, color: accent }}
      >
        {eventName}
      </span>
      <h3 className="mt-2 font-display text-xl font-bold uppercase tracking-wide text-white">{name}</h3>
      <p className="mt-2 flex-1 text-sm text-white/55">{description}</p>
      <p className="nx-label mt-3">{cards} cartas</p>
      <Link
        href="/eventos"
        className="mt-4 rounded-control border px-4 py-2.5 text-center font-display text-sm font-bold uppercase tracking-[0.1em] transition duration-fast hover:bg-white/[0.06]"
        style={{ borderColor: `${accent}66`, color: accent }}
      >
        Ir al evento
      </Link>
    </div>
  );
}
