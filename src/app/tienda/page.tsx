"use client";

import { PACKS } from "@/data/packs";
import { PackStoreCard } from "@/components/packs/PackStoreCard";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";

export default function TiendaPage() {
  const { toast, notify } = useToast();

  return (
    <HydrationGate>
      <section className="animate-rise">
        <header className="mb-6">
          <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
            Tienda de <span className="text-drl">Sobres</span>
          </h1>
          <p className="mt-1 text-white/50">
            Compra sobres, ábrelos y consigue a las estrellas de Valorant.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PACKS.filter((p) => !p.eventId).map((pack) => (
            <PackStoreCard key={pack.id} pack={pack} onNotify={notify} />
          ))}
        </div>

        <p className="mt-6 rounded-xl border border-white/10 bg-base-700/30 px-4 py-3 text-sm text-white/50">
          🎟️ Los <span className="text-white">Sobres de Evento</span> (Masters, Champions, EWC)
          solo están disponibles en el <a href="/eventos" className="text-drl hover:underline">Centro de Eventos</a> mientras el evento esté activo.
        </p>
      </section>
      <Toast toast={toast} />
    </HydrationGate>
  );
}
