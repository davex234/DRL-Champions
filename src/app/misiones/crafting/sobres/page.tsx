"use client";

/**
 * F73 · /misiones/crafting/sobres — CRAFTEO DE SOBRES. F74: la FORJA.
 *
 *   [sobres de entrada en abanico · 7 / 4]  ══energía══ ⬡ CRAFTEAR ══energía══  [SOBRE DESTINO +1]
 *
 * Confirmar → el SERVIDOR consume N y entrega 1 en una transacción (idempotente por gesto: un doble clic o un F5 no
 * craftean dos veces). El sobre nuevo va a «sin abrir»: no se abre solo. Lo que se pinta después es lo que devolvió
 * el servidor (inventario autoritativo), no una resta en el navegador. La secuencia de forja representa ese resultado
 * YA confirmado; no decide nada.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { syncFromServer } from "@/lib/game/sync";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { NxButton } from "@/components/ui/NxButton";
import { GameModal } from "@/components/ui/game/GameOverlay";
import { Crumbs, HubNav, PackArt, Unavailable, packName } from "@/components/crafting/CraftingUi";
import { Beam, ForgeCore, ForgeStage, ForgeTitle, HaveNeed, PackFan, PackForgeSequence, Panel, ctaReadyClass, haloClass, lane, packGlow } from "@/components/crafting/Forge";
import { craftPackReq, fetchCrafting, newGesture, type CraftingSnapshot, type PackCraftResult } from "@/lib/crafting/client";
import { cn } from "@/lib/format";

export default function PackCraftingPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label="Cargando tus sobres…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="el crafteo de sobres" />;
  return <PackCrafting />;
}

type Recipe = CraftingSnapshot["packRecipes"][number];

function PackCrafting() {
  const [snap, setSnap] = useState<CraftingSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Recipe | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<PackCraftResult | null>(null);
  const gesture = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { setSnap(await fetchCrafting()); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el crafteo"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const start = (r: Recipe) => { gesture.current = newGesture(); setFailure(null); setResult(null); setOpen(r); };
  const close = useCallback(() => { if (!busy) { setOpen(null); setResult(null); setFailure(null); } }, [busy]);
  const confirm = async () => {
    if (!open || busy || !gesture.current) return;
    setBusy(true); setFailure(null);
    try {
      // La MISMA clave para este diálogo: si la respuesta se pierde y se reintenta, el servidor devuelve lo mismo.
      const r = await craftPackReq(open.id, gesture.current, open.inputQty);
      setResult(r);
      await load();
      await syncFromServer().catch(() => undefined);
    } catch (e) { setFailure(e instanceof Error ? e.message : "No se pudo craftear"); await load(); }
    finally { setBusy(false); }
  };

  if (error && !snap) return <ErrorState message={error} onRetry={load} />;
  if (!snap) return <Loading kind="hub" label="Cargando tus sobres…" />;
  const ladder = [...new Set(snap.packRecipes.flatMap((r) => [r.inputPackId, r.outputPackId]))];

  return (
    <ForgeStage className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="pack-crafting">
      <ForgeTitle title="Forja de sobres" eyebrow={<Crumbs items={[{ href: "/temporada", label: "Temporada" }, { href: "/misiones/crafting", label: "Crafteo" }, { label: "Sobres" }]} />}>
        <HubNav active="crafting" />
      </ForgeTitle>
      {!snap.available ? <Unavailable what="El crafteo" /> : snap.packRecipes.length === 0 ? (
        <Panel className="p-6 text-[15px] text-white/70">No hay recetas de sobres activas ahora mismo.</Panel>
      ) : (
        <>
          {/* Tu escalera de sobres: arte real + cuántos tienes de cada uno. */}
          <Panel className="overflow-x-auto px-3 py-3 sm:px-5" aria-label="Tus sobres">
            <ol className="flex min-w-max items-end gap-3 sm:gap-5" data-testid="pack-ladder">
              {ladder.map((id, i) => (
                <li key={id} className="flex items-end gap-3 sm:gap-5">
                  {i > 0 && <span aria-hidden className="mb-6 text-[16px] text-white/25">›</span>}
                  <span className="flex flex-col items-center gap-1">
                    <PackArt packId={id} width={40} dim={!(snap.packs[id] > 0)} />
                    <b className={cn("nx-readout text-[16px] leading-none tabular-nums", snap.packs[id] > 0 ? "text-white" : "text-white/35")} aria-label={`${packName(id)}: ${snap.packs[id] ?? 0}`}>{snap.packs[id] ?? 0}</b>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          <ol className="space-y-4" aria-label="Recetas de sobres">
            {snap.packRecipes.map((r) => {
              const glow = packGlow(r.outputPackId);
              const missing = Math.max(0, r.inputQty - r.have);
              return (
                <Panel as="li" key={r.id} data-testid="pack-recipe" data-recipe={r.id} data-ready={r.canCraft ? "1" : "0"}
                  tone={r.canCraft ? "ready" : undefined}
                  className={cn(lane.root, "px-3 py-5 sm:px-8 md:py-7")}
                  style={{ ["--forge-glow" as string]: glow }}>
                  {/* ORIGEN */}
                  <div className={cn(lane.in, "flex flex-col items-center gap-1.5")}>
                    <span className="md:hidden"><PackFan packId={r.inputPackId} count={r.inputQty} width={50} dim={r.have === 0} /></span>
                    <span className="hidden md:block"><PackFan packId={r.inputPackId} count={r.inputQty} width={82} dim={r.have === 0} /></span>
                    <p className="text-center font-display text-[12px] font-bold uppercase tracking-[0.12em] text-white/80 md:text-[14px]">{r.inputQty} × {packName(r.inputPackId)}</p>
                  </div>
                  {/* TRANSFORMACIÓN */}
                  <div className={cn(lane.core, "flex items-center justify-center gap-2")}>
                    <Beam on={r.canCraft} color={glow} className="w-5 md:w-16 lg:w-20" />
                    <span className="md:hidden"><ForgeCore on={r.canCraft} color={glow} size={54} /></span>
                    <span className="hidden md:block"><ForgeCore on={r.canCraft} color={glow} /></span>
                    <Beam on={r.canCraft} color={glow} className="w-5 md:w-16 lg:w-20" />
                  </div>
                  {/* DESTINO */}
                  <div className={cn(lane.out, "flex flex-col items-center gap-1.5")}>
                    <span className={cn(haloClass(r.canCraft), "md:hidden")}><PackArt packId={r.outputPackId} width={92} dim={!r.live} /></span>
                    <span className={cn(haloClass(r.canCraft), "hidden md:block")}><PackArt packId={r.outputPackId} width={150} dim={!r.live} /></span>
                    <p className="nx-label !text-[10px]">Recibes</p>
                    <p className="text-center font-display text-[15px] font-extrabold uppercase tracking-[0.08em] text-drl-gold md:text-[20px]">+1 {packName(r.outputPackId)}</p>
                  </div>
                  <div className={cn(lane.counts, "flex justify-center")}><HaveNeed have={r.have} need={r.inputQty} /></div>
                  <div className={cn(lane.cta, "flex flex-col items-center gap-2")}>
                    <NxButton variant="primary" size="lg" onClick={() => start(r)} disabled={!r.canCraft} data-testid="pack-recipe-craft"
                      className={cn("w-full max-w-[340px] md:w-auto md:min-w-[210px]", r.canCraft && ctaReadyClass)}
                      aria-label={`Craftear: ${r.inputQty} ${packName(r.inputPackId)} por 1 ${packName(r.outputPackId)}`}>Craftear</NxButton>
                    {!r.live ? <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/50">No disponible ahora</p>
                      : missing > 0 ? <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/55">Faltan {missing}</p>
                        : <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#3ee08f]">Listo para craftear</p>}
                  </div>
                </Panel>
              );
            })}
          </ol>
          <p className="text-center text-[13px] text-white/50">Los sobres crafteados quedan sin abrir. <Link className="nx-focus underline hover:text-white" href="/inventario">Ver mis sobres</Link></p>
        </>
      )}

      <GameModal open={!!open} onClose={close} title={result ? "Forja" : "Craftear"} eyebrow="Forja · Sobres" testId="pack-craft-dialog" dismissable={!busy} className="max-w-2xl"
        actions={result ? <NxButton variant="primary" size="lg" onClick={close} data-autofocus>Continuar</NxButton> : <>
          <NxButton variant="ghost" onClick={close} disabled={busy}>Cancelar</NxButton>
          <NxButton variant="primary" size="lg" onClick={confirm} disabled={busy} data-testid="pack-craft-confirm" data-autofocus>{busy ? "Crafteando…" : "Craftear"}</NxButton>
        </>}>
        {open && !result && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 text-center sm:gap-6" style={{ ["--forge-glow" as string]: packGlow(open.outputPackId) }}>
            <div className="flex flex-col items-center gap-2">
              <p className="nx-label">Entregas</p>
              <span className="sm:hidden"><PackFan packId={open.inputPackId} count={open.inputQty} width={46} /></span>
              <span className="hidden sm:block"><PackFan packId={open.inputPackId} count={open.inputQty} width={72} /></span>
              <p className="font-display text-[14px] font-bold uppercase text-white sm:text-[17px]">{open.inputQty} × {packName(open.inputPackId)}</p>
            </div>
            <span className="sm:hidden"><ForgeCore on color={packGlow(open.outputPackId)} size={46} /></span>
            <span className="hidden sm:block"><ForgeCore on color={packGlow(open.outputPackId)} size={64} /></span>
            <div className="flex flex-col items-center gap-2">
              <p className="nx-label">Recibes</p>
              <span className={cn(haloClass(true), "sm:hidden")}><PackArt packId={open.outputPackId} width={80} /></span>
              <span className={cn(haloClass(true), "hidden sm:block")}><PackArt packId={open.outputPackId} width={118} /></span>
              <p className="font-display text-[14px] font-bold uppercase text-drl-gold sm:text-[17px]">1 × {packName(open.outputPackId)}</p>
            </div>
          </div>
        )}
        {failure && <p role="alert" className="mt-3 text-center text-[14px] text-drl">{failure}</p>}
        {result && open && (
          <PackForgeSequence inputPackId={result.inputs[0]?.packId ?? open.inputPackId} inputQty={result.inputs[0]?.qty ?? open.inputQty} outputPackId={result.outputs[0]?.packId ?? open.outputPackId} />
        )}
      </GameModal>
    </ForgeStage>
  );
}
