"use client";

/**
 * F79 · /misiones/crafting/historial — HISTORIAL DE LA FORJA. Viene del libro mayor del SERVIDOR (`economy_ops`,
 * proyectos reclamados, asientos `forge:*`): fecha, tipo, materiales consumidos, resultado, receta/proyecto y estado.
 * Un intento rechazado no deja asiento, así que tampoco aparece aquí (no se inventa).
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { CardImage, Crumbs, HubNav, PackArt, cardName, packName } from "@/components/crafting/CraftingUi";
import { ForgeStage, ForgeTitle, Panel, Stamp } from "@/components/crafting/Forge";
import { forgeErrorText } from "@/components/crafting/ForgeProgress";
import { fetchForge, type ForgeSnapshot } from "@/lib/crafting/client";

const TYPE = { PACK: "Forja de sobres", EXCHANGE: "Intercambio", ADVANCED: "Receta avanzada", PROJECT: "Proyecto", OBJECTIVE: "Objetivo", ACHIEVEMENT: "Logro" } as const;

export default function HistoryPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label="Cargando…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="el historial de la Forja" />;
  return <History />;
}

function Item({ cardId, packId, qty }: { cardId?: string; packId?: string; qty: number }) {
  return (
    <span className="relative inline-flex flex-col items-center gap-0.5" title={cardId ? cardName(cardId) : packId ? packName(packId) : ""}>
      {cardId ? <CardImage cardId={cardId} width={44} /> : packId ? <PackArt packId={packId} width={36} /> : null}
      <span className="text-[10px] font-bold text-white/70">×{qty}</span>
    </span>
  );
}

function History() {
  const [snap, setSnap] = useState<ForgeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try { setSnap(await fetchForge()); } catch (e) { setError(forgeErrorText(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ForgeStage className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="forge-history">
      <ForgeTitle title="Historial" eyebrow={<Crumbs items={[{ href: "/temporada", label: "Temporada" }, { href: "/misiones/crafting", label: "Crafteo" }, { label: "Historial" }]} />}>
        <HubNav active="crafting" />
      </ForgeTitle>
      {error && !snap && <ErrorState message={error} onRetry={load} />}
      {!snap && !error && <Loading kind="hub" label="Cargando historial…" />}
      {snap && snap.history.length === 0 && <Panel className="p-6 text-[15px] text-white/70">Aún no has forjado nada.</Panel>}
      {snap && snap.history.length > 0 && (
        <ol className="space-y-2" aria-label="Historial de la Forja">
          {snap.history.map((h, i) => (
            <li key={`${h.at}-${i}`} data-testid="forge-history-entry" data-type={h.type}>
              <Panel className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[150px_1fr_auto_1fr_auto] sm:gap-4">
                <div>
                  <p className="font-display text-[13px] font-bold uppercase tracking-[0.08em] text-white">{TYPE[h.type]}</p>
                  <time className="text-[11px] text-white/50" dateTime={new Date(h.at).toISOString()}>{new Date(h.at).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
                <div className="flex flex-wrap items-end gap-1.5" aria-label="Materiales consumidos">{h.consumed.length ? h.consumed.map((c, j) => <Item key={j} {...c} />) : <span className="text-[12px] text-white/40">—</span>}</div>
                <span aria-hidden className="hidden text-white/40 sm:block">→</span>
                <div className="flex flex-wrap items-end gap-1.5" aria-label="Resultado">{h.produced.length ? h.produced.map((c, j) => <Item key={j} {...c} />) : <span className="text-[12px] text-white/40">Recompensa reclamada</span>}</div>
                <div className="flex items-center gap-2"><span className="hidden text-[11px] text-white/40 lg:inline">{h.sourceId}</span><Stamp kind="DONE" /></div>
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </ForgeStage>
  );
}
