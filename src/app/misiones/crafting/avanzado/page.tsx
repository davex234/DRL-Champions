"use client";

/**
 * F79 · /misiones/crafting/avanzado — RECETAS AVANZADAS, CADENAS y PLANOS.
 *
 *   LOCKED      silueta + pista + qué condiciones ya cumples (no se revela qué consume ni qué sale).
 *   DISCOVERED  desbloqueada; te falta POSEER algo o material para forjarla.
 *   AVAILABLE   lista: eliges materiales (o AUTO-SELECCIONAR), confirmas «VAS A ENTREGAR / RECIBIRÁS» y el servidor forja.
 *   COMPLETED   paso de cadena hecho (no repetible).
 *
 * El servidor confirma PRIMERO; la animación solo representa el resultado que ya devolvió (nunca lo supone).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { syncFromServer } from "@/lib/game/sync";
import { getCard } from "@/data/catalog";
import { packCardClass } from "@/domain/packs/packClass";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { NxButton } from "@/components/ui/NxButton";
import { GameModal } from "@/components/ui/game/GameOverlay";
import { CardImage, Crumbs, HubNav, Unavailable, cardName, classLabel } from "@/components/crafting/CraftingUi";
import { CardRevealSequence, ForgeCore, ForgeStage, ForgeTitle, MysteryCard, Panel, ctaReadyClass, glowOf } from "@/components/crafting/Forge";
import { AutoSelectBar, ForgeConfirm, MaterialSelector, forgeErrorText, useMaterialPick } from "@/components/crafting/ForgeProgress";
import { fetchForge, forgeCraftReq, newGesture, trackRecipeView, type ForgeCraftResult, type ForgeSnapshot } from "@/lib/crafting/client";
import type { AdvancedRecipeView } from "@/domain/forge/snapshot";
import { cn } from "@/lib/format";
import s from "@/components/crafting/forgeProgress.module.css";

const STATE = {
  LOCKED: { t: "Por descubrir", c: "border-white/15 text-white/50" },
  DISCOVERED: { t: "Descubierta", c: "border-drl-cyan/60 text-drl-cyan" },
  AVAILABLE: { t: "Disponible", c: "border-[#3ee08f]/70 text-[#3ee08f]" },
  COMPLETED: { t: "Completada", c: "border-white/20 text-white/60" },
} as const;

export default function AdvancedPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label="Cargando…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="las recetas avanzadas" />;
  return <Advanced />;
}

function Advanced() {
  const [snap, setSnap] = useState<ForgeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try { const s2 = await fetchForge(); setSnap(s2); setSelected((cur) => cur ?? s2.core.recipes.find((r) => r.state === "AVAILABLE")?.id ?? s2.core.recipes.find((r) => r.state !== "LOCKED")?.id ?? s2.core.recipes[0]?.id ?? null); } catch (e) { setError(forgeErrorText(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected) trackRecipeView(selected); }, [selected]);
  const recipe = snap?.core.recipes.find((r) => r.id === selected) ?? null;

  return (
    <ForgeStage className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="forge-advanced">
      <ForgeTitle title="Recetas avanzadas" eyebrow={<Crumbs items={[{ href: "/temporada", label: "Temporada" }, { href: "/misiones/crafting", label: "Crafteo" }, { href: "/misiones/crafting/cartas", label: "Cartas" }, { label: "Avanzado" }]} />}>
        <HubNav active="crafting" />
      </ForgeTitle>
      {error && !snap && <ErrorState message={error} onRetry={load} />}
      {!snap && !error && <Loading kind="hub" label="Cargando recetas…" />}
      {snap && !snap.available && <Unavailable what="La Forja" />}
      {snap?.available && (
        <>
          {snap.core.chains.length > 0 && (
            <section aria-label="Cadenas" className="space-y-3" data-testid="forge-chains">
              {snap.core.chains.map((c) => (
                <Panel key={c.id} tone={c.completed ? "done" : undefined} className="space-y-3 px-4 py-4 sm:px-6" data-testid="forge-chain" data-chain={c.id} data-done={c.done}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-display text-[18px] font-extrabold uppercase tracking-[0.06em] text-white">{c.name}</p>
                    <p className="nx-readout text-[16px] text-white/80">{c.done} / {c.total}</p>
                  </div>
                  {c.description && <p className="text-[13px] text-white/60">{c.description}</p>}
                  <ol className="flex flex-wrap items-center gap-2" aria-label={`Pasos de ${c.name}`}>
                    {c.steps.map((st, i) => (
                      <li key={st.recipeId} className="flex items-center gap-2">
                        {i > 0 && <span aria-hidden className={cn("h-[2px] w-5 sm:w-8", st.done || c.steps[i - 1].done ? "bg-drl-cyan" : "bg-white/15")} />}
                        <button type="button" onClick={() => setSelected(st.recipeId)} className={cn("nx-focus flex items-center gap-2 border px-2.5 py-1.5 text-[12px] font-bold uppercase tracking-[0.06em]", st.done ? "border-[#3ee08f]/60 text-[#3ee08f]" : "border-white/15 text-white/70", selected === st.recipeId && "bg-white/10")}>
                          <HexNode label={st.done ? "✓" : String(i + 1)} />{st.name}
                        </button>
                      </li>
                    ))}
                  </ol>
                </Panel>
              ))}
            </section>
          )}

          {snap.core.blueprints.length > 0 && (
            <section aria-label="Planos" data-testid="forge-blueprints">
              <ul className="flex flex-wrap gap-2">{snap.core.blueprints.map((b) => (
                <li key={b.id} className={cn("border px-3 py-2 text-[12px]", b.owned ? "border-drl-gold/60 bg-drl-gold/10 text-drl-gold" : "border-white/10 text-white/55")} data-owned={b.owned}>
                  <b className="font-display uppercase tracking-[0.08em]">{b.owned ? "◆" : "◇"} {b.name}</b>{!b.owned && <span className="block text-[11px] text-white/50">{b.hint}</span>}
                </li>
              ))}</ul>
            </section>
          )}

          {snap.core.recipes.length === 0 ? (
            <Panel className="flex items-center gap-4 p-6"><ForgeCore on={false} size={56} /><p className="text-[15px] text-white/70">No hay recetas avanzadas activas ahora mismo. Las fundamentales (sobres e intercambio) siguen a tu alcance.</p></Panel>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1" aria-label="Recetas" role="listbox" aria-activedescendant={selected ?? undefined}>
                {snap.core.recipes.map((r) => (
                  <li key={r.id} id={r.id} role="option" aria-selected={r.id === selected}>
                    <button type="button" onClick={() => setSelected(r.id)} data-testid="advanced-recipe" data-recipe={r.id} data-state={r.state}
                      className={cn("nx-focus flex w-full items-center gap-3 border px-3 py-2.5 text-left transition", r.id === selected ? "border-drl-cyan bg-white/[0.07]" : "border-white/10 bg-white/[0.025] hover:border-white/30")}>
                      <span className={cn("shrink-0", r.state === "LOCKED" && s.silhouette)}>{r.output?.type === "CARD" ? <CardImage cardId={r.output.cardId} width={38} /> : <ForgeCore on={r.state === "AVAILABLE"} size={38} color={r.output?.type === "CLASS" ? glowOf(r.output.class) : undefined} />}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-[14px] font-bold uppercase tracking-[0.05em] text-white">{r.state === "LOCKED" ? "???" : r.name}</span>
                        <span className={cn("mt-0.5 inline-block border px-1.5 text-[10px] font-bold uppercase tracking-[0.12em]", STATE[r.state].c)}>{STATE[r.state].t}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {recipe && <RecipeDetail key={recipe.id} recipe={recipe} onDone={load} />}
            </div>
          )}
        </>
      )}
    </ForgeStage>
  );
}

function RecipeDetail({ recipe, onDone }: { recipe: AdvancedRecipeView; onDone: () => Promise<void> }) {
  const pick = useMaterialPick(recipe.materials);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ForgeCraftResult | null>(null);
  const gesture = useRef<string | null>(null);
  const ownMet = (recipe.own ?? []).every((o) => o.met);
  const canForge = recipe.state === "AVAILABLE" && ownMet && pick.complete;
  const outCls = useMemo(() => (recipe.output?.type === "CLASS" ? recipe.output.class : recipe.output?.type === "CARD" ? (getCard(recipe.output.cardId) ? packCardClass(getCard(recipe.output.cardId)!) : null) : null) ?? "prime", [recipe.output]);

  const start = () => { gesture.current = newGesture(); setFailure(null); setResult(null); setOpen(true); };
  const close = () => { if (busy) return; setOpen(false); if (result) { pick.clear(); setResult(null); void onDone(); } };
  const confirm = async () => {
    if (busy || !gesture.current) return;
    setBusy(true); setFailure(null);
    try { const r = await forgeCraftReq(recipe.id, pick.uids, gesture.current, pick.protectedUids); setResult(r); await syncFromServer().catch(() => undefined); }
    catch (e) { setFailure(forgeErrorText(e)); }
    finally { setBusy(false); }
  };

  if (recipe.state === "LOCKED") {
    return (
      <Panel className="space-y-4 px-5 py-6 sm:px-7" data-testid="advanced-detail" data-state="LOCKED">
        <div className="flex items-center gap-4"><span className={s.silhouette}><ForgeCore on={false} size={84} /></span>
          <div><p className="font-display text-[12px] font-bold uppercase tracking-[0.24em] text-white/50">Receta por descubrir</p><p className="font-display text-[26px] font-extrabold uppercase text-white">???</p></div></div>
        <p className="text-[14px] text-white/75">{recipe.hint}</p>
        <ul className="space-y-1.5" aria-label="Condiciones de desbloqueo">{recipe.rules.map((r, i) => (
          <li key={i} className={cn("flex items-center gap-2 text-[13px]", r.met ? "text-[#3ee08f]" : "text-white/60")}><span aria-hidden>{r.met ? "✓" : "🔒"}</span>{r.label}</li>
        ))}</ul>
        {recipe.chain && <p className="text-[12px] uppercase tracking-[0.12em] text-white/45">Paso {recipe.chain.step} de {recipe.chain.total} · {recipe.chain.name}</p>}
      </Panel>
    );
  }

  return (
    <>
    <Panel tone={canForge ? "ready" : recipe.state === "COMPLETED" ? "done" : undefined} className="space-y-5 px-4 py-5 sm:px-7" data-testid="advanced-detail" data-state={recipe.state}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {recipe.chain && <p className="font-display text-[11px] font-bold uppercase tracking-[0.24em] text-drl-cyan">{recipe.chain.name} · paso {recipe.chain.step}/{recipe.chain.total}</p>}
          <h2 className="font-display text-[28px] font-extrabold uppercase leading-none text-white sm:text-[34px]">{recipe.name}</h2>
          {recipe.timesDone > 0 && <p className="mt-1 text-[12px] text-white/50">Forjada {recipe.timesDone} {recipe.timesDone === 1 ? "vez" : "veces"}</p>}
        </div>
        <span className={cn("border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.16em]", STATE[recipe.state].c)} data-testid="advanced-state">{STATE[recipe.state].t}</span>
      </header>

      {(recipe.own ?? []).length > 0 && (
        <section aria-label="Requisitos de posesión" className="border border-[#3ee08f]/25 bg-[#3ee08f]/[0.04] px-4 py-3">
          <p className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-[#3ee08f]">Posees · se comprueba, NO se consume</p>
          <ul className="mt-1.5 space-y-1">{recipe.own!.map((o, i) => (
            <li key={i} className={cn("flex items-center justify-between gap-2 text-[13px]", o.met ? "text-white/80" : "text-white/55")} data-testid="advanced-own" data-met={o.met}>
              <span>{o.met ? "✓" : "✗"} {o.label}</span><b className="nx-readout tabular-nums">{Math.min(o.have, o.need)} / {o.need}</b>
            </li>
          ))}</ul>
        </section>
      )}

      {recipe.state !== "COMPLETED" && recipe.materials && (
        <section aria-label="Materiales que se consumen" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-display text-[12px] font-bold uppercase tracking-[0.2em] text-drl">Entregas · estas cartas desaparecen</p>
            <AutoSelectBar pick={pick} />
          </div>
          <MaterialSelector materials={recipe.materials} pick={pick} />
        </section>
      )}

      <div className="flex flex-col items-center gap-3 border-t border-white/10 pt-4 sm:flex-row sm:justify-between">
        <span className="flex items-center gap-3">
          <ForgeCore on={canForge} color={glowOf(outCls)} size={56} />
          {recipe.output?.type === "CARD" ? <CardImage cardId={recipe.output.cardId} width={70} /> : <MysteryCard cls={outCls} width={70} label={false} />}
          <span className="text-[13px] text-white/70">{recipe.output?.type === "CARD" ? cardName(recipe.output.cardId) : `Carta ${classLabel(outCls)} aleatoria`}</span>
        </span>
        <NxButton variant="primary" size="lg" onClick={start} disabled={!canForge} className={cn("min-w-[200px]", canForge && ctaReadyClass)} data-testid="forge-craft">
          {recipe.state === "COMPLETED" ? "Completada" : !ownMet ? "Te falta poseer" : !pick.complete ? "Elige los materiales" : "Forjar"}
        </NxButton>
      </div>
    </Panel>

    {/* Fuera del Panel: su clip-path (chaflán) recortaría el diálogo, que es `fixed`. */}
    <GameModal open={open} onClose={close} title={result ? "Forja completada" : "Confirmar forja"} eyebrow="Nexus Forge · Avanzado" testId="forge-confirm-dialog" dismissable={!busy} className="max-w-2xl"
      actions={result ? <NxButton variant="primary" size="lg" onClick={close} data-autofocus>Continuar</NxButton> : <>
        <NxButton variant="ghost" onClick={close} disabled={busy}>Cancelar</NxButton>
        <NxButton variant="primary" size="lg" onClick={confirm} disabled={busy} data-testid="forge-confirm-button" data-autofocus>{busy ? "Forjando…" : "Confirmar forja"}</NxButton>
      </>}>
      {!result && recipe.materials && recipe.output && <ForgeConfirm uids={pick.uids} protectedUids={pick.protectedUids} materials={recipe.materials} output={recipe.output} ownNote={(recipe.own ?? []).map((o) => o.label)} />}
      {failure && <p role="alert" className="mt-3 text-center text-[14px] text-drl" data-testid="forge-error">{failure}</p>}
      {result?.outputs[0] && <CardRevealSequence cls={outCls} cardId={result.outputs[0].cardId} caption={`${cardName(result.outputs[0].cardId)} · ${getCard(result.outputs[0].cardId)?.ovr ?? ""}`} sub="Añadida a tu colección" />}
    </GameModal>
    </>
  );
}

/** Nodo hexagonal de un paso de cadena (SVG: borde nítido a cualquier tamaño). */
function HexNode({ label }: { label: string }) {
  return (
    <span aria-hidden className="relative grid h-7 w-7 shrink-0 place-items-center">
      <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full"><polygon points="14,1 26,7.5 26,20.5 14,27 2,20.5 2,7.5" fill="rgba(10,11,19,0.9)" stroke="currentColor" strokeWidth="1.6" /></svg>
      <span className="relative text-[12px] font-extrabold">{label}</span>
    </span>
  );
}
