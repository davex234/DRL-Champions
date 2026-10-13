"use client";

/**
 * F73 · /misiones/crafting/cartas — CARTAS: INTERCAMBIO · PROYECTOS.
 *
 * INTERCAMBIO: eliges visualmente N copias (duplicados) de una clase y recibes 1 carta ALEATORIA de la clase superior.
 * Solo se ofrecen copias que el SERVIDOR dice que puedes entregar (tuyas, no bloqueadas, fuera de tus equipos y
 * conservando al menos una copia de cada carta). La carta que sale la sortea el servidor; el navegador solo manda la
 * receta, los uids y su gesto.
 *
 * PROYECTOS: cartas especiales REALES que se consiguen completando misiones.
 *
 * F74 · la FORJA de cartas: huecos que se llenan con las copias elegidas, núcleo y la salida como carta MISTERIOSA de
 * su clase (nunca una carta concreta antes de que decida el servidor); tras craftear, la carta REAL se revela.
 *
 * F79 · NEXUS FORGE 2.0: el intercambio lee y forja por `/api/game/forge` (protección de favoritas/vitrina, auto-selección
 * conservadora y confirmación «vas a entregar / recibirás»).
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { syncFromServer } from "@/lib/game/sync";
import { getCard } from "@/data/catalog";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { NxButton } from "@/components/ui/NxButton";
import { GameModal } from "@/components/ui/game/GameOverlay";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { CardImage, Crumbs, HubNav, Unavailable, cardName, classLabel } from "@/components/crafting/CraftingUi";
import { CardRevealSequence, ForgeBar, ForgeCore, ForgeStage, ForgeTitle, MysteryCard, Panel, Slot, Stamp, ctaReadyClass, glowOf, haloClass, pickClass } from "@/components/crafting/Forge";
import { fetchForge, fetchMissions, forgeCraftReq, newGesture, type ForgeCraftResult, type ForgeSnapshot, type MissionsSnapshot } from "@/lib/crafting/client";
import { AutoSelectBar, ForgeConfirm, forgeErrorText, useMaterialPick } from "@/components/crafting/ForgeProgress";
import { cn } from "@/lib/format";

export default function CardCraftingPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label="Cargando…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="el crafteo de cartas" />;
  return <Suspense fallback={<Loading kind="hub" label="Cargando…" />}><CardCrafting /></Suspense>;
}

function CardCrafting() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "proyectos" ? "proyectos" : "intercambio";
  const setTab = (t: "intercambio" | "proyectos") => router.replace(t === "proyectos" ? "/misiones/crafting/cartas?tab=proyectos" : "/misiones/crafting/cartas");
  return (
    <ForgeStage className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="card-crafting">
      <ForgeTitle title="Forja de cartas" eyebrow={<Crumbs items={[{ href: "/temporada", label: "Temporada" }, { href: "/misiones/crafting", label: "Crafteo" }, { label: "Cartas" }]} />}>
        <HubNav active="crafting" />
      </ForgeTitle>
      <div role="tablist" aria-label="Cartas" className="grid grid-cols-2 gap-2 sm:flex">
        {(["intercambio", "proyectos"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`cards-tab-${t}`}
            className={cn("nx-focus flex items-center justify-center gap-2 border px-5 py-3 font-display text-[15px] font-bold uppercase tracking-[0.18em] transition sm:min-w-[220px]",
              tab === t ? "border-drl-cyan/70 bg-drl-cyan/15 text-white shadow-[inset_0_-3px_0_#19e3ff]" : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white")}>
            <GameGlyph name={t === "intercambio" ? "cards" : "crown"} className="h-5 w-5" />{t === "intercambio" ? "Intercambio" : "Proyectos"}
          </button>
        ))}
        {/* IA 2026-10-07 · las RECETAS AVANZADAS producen cartas: se entran desde aquí (su ruta no cambia). */}
        <Link href="/misiones/crafting/avanzado" data-testid="cards-advanced-link"
          className="nx-focus flex items-center justify-center gap-2 border border-[#a970ff]/45 bg-[#a970ff]/10 px-5 py-3 font-display text-[15px] font-bold uppercase tracking-[0.18em] text-white/80 transition hover:text-white sm:min-w-[220px]">
          <GameGlyph name="star" className="h-5 w-5" />Recetas avanzadas
        </Link>
      </div>
      {tab === "intercambio" ? <Exchange /> : <Projects />}
    </ForgeStage>
  );
}

/* ═══════════════════════════ INTERCAMBIO ═══════════════════════════ */

/*
 * F79 · el intercambio usa la foto de NEXUS FORGE (`GET /api/game/forge`): mismas recetas F73, pero con PROTECCIÓN
 * (favoritas y vitrina no entran salvo que lo pidas carta a carta), AUTO-SELECCIONAR conservador (duplicados y menor
 * OVR primero) y una confirmación que enseña EXACTAMENTE qué copias desaparecen. Forja por `/api/game/forge`.
 */
type ExchangeRecipe = ForgeSnapshot["exchange"][number];
type PickKey = `${number}:${string}`;

function Exchange() {
  const [snap, setSnap] = useState<ForgeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ForgeCraftResult | null>(null);
  const gesture = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { const s = await fetchForge(); setSnap(s); setRecipeId((cur) => cur ?? s.exchange.find((r) => r.live)?.id ?? s.exchange[0]?.id ?? null); }
    catch (e) { setError(forgeErrorText(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const recipe: ExchangeRecipe | undefined = snap?.exchange.find((r) => r.id === recipeId);
  const pick = useMaterialPick(recipe ? recipe.materials : null);
  const m = recipe?.materials[0];
  const count = recipe ? pick.pickedInSlot(0) : 0;
  const selectRecipe = (id: string) => { setRecipeId(id); pick.clear(); setFailure(null); };
  /** Lo elegido en orden de huecos (una entrada por copia). */
  const slots = useMemo(() => (m ? m.candidates.flatMap((c) => Array.from({ length: pick.counts[`0:${c.cardId}` as PickKey] ?? 0 }, () => c.cardId)) : []), [m, pick.counts]);

  const start = () => { gesture.current = newGesture(); setFailure(null); setResult(null); setOpen(true); };
  const close = () => { if (busy) return; setOpen(false); if (result) { pick.clear(); void load(); } setResult(null); };
  const confirm = async () => {
    if (!recipe || busy || !gesture.current) return;
    setBusy(true); setFailure(null);
    try { const r = await forgeCraftReq(recipe.id, pick.uids, gesture.current, pick.protectedUids); setResult(r); await syncFromServer().catch(() => undefined); }
    catch (e) { setFailure(forgeErrorText(e)); }
    finally { setBusy(false); }
  };

  if (error && !snap) return <ErrorState message={error} onRetry={load} />;
  if (!snap) return <Loading kind="hub" label="Cargando tus cartas…" />;
  if (!snap.available) return <Unavailable what="El intercambio de cartas" />;
  if (snap.exchange.length === 0) return <Panel className="p-6 text-[15px] text-white/70">No hay recetas de intercambio activas ahora mismo.</Panel>;
  const full = !!recipe && pick.complete;
  const cols = recipe ? (recipe.inputQty <= 7 ? recipe.inputQty : Math.ceil(recipe.inputQty / 2)) : 7;

  return (
    <section aria-label="Intercambio" className="space-y-5" data-testid="exchange">
      {/* La transformación: de qué clase a qué clase. */}
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-5" role="radiogroup" aria-label="Receta">
        {snap.exchange.map((r) => {
          const on = r.id === recipeId;
          const free = r.materials[0]?.availableTotal ?? 0;
          return (
            <button key={r.id} role="radio" aria-checked={on} onClick={() => selectRecipe(r.id)} data-testid="card-recipe" data-recipe={r.id}
              className={cn("nx-focus relative flex min-w-[158px] shrink-0 snap-start flex-col gap-1.5 border px-3 py-3 text-left transition sm:min-w-0", on ? "bg-white/[0.07]" : "border-white/10 bg-white/[0.025] hover:border-white/30", !r.live && "opacity-60")}
              style={on ? { borderColor: glowOf(r.outputClass), boxShadow: `0 0 26px -8px ${glowOf(r.outputClass)}` } : undefined}>
              <span className="flex items-center gap-1.5 font-display text-[13px] font-bold uppercase tracking-[0.08em] text-white">
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rotate-45" style={{ background: glowOf(r.inputClass) }} />
                <span>{classLabel(r.inputClass)} → {classLabel(r.outputClass)}</span>
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rotate-45" style={{ background: glowOf(r.outputClass) }} />
              </span>
              <span className="flex items-baseline gap-2"><b className="nx-readout text-[22px] leading-none tabular-nums text-white">{r.inputQty}</b><span className="text-[11px] uppercase tracking-[0.12em] text-white/50">copias</span></span>
              <span className={cn("text-[11px] font-bold uppercase tracking-[0.1em]", free >= r.inputQty ? "text-[#3ee08f]" : "text-white/45")}>{free} libres</span>
            </button>
          );
        })}
      </div>

      {recipe && m && (
        <>
          {/* LA FORJA: huecos → núcleo → carta aleatoria de la clase superior. */}
          <Panel tone={full ? "ready" : undefined} data-testid="exchange-bar" className="grid items-center gap-5 px-4 py-5 sm:px-7 lg:grid-cols-[1fr_auto_auto] lg:gap-8"
            style={{ ["--forge-glow" as string]: glowOf(recipe.outputClass) }}>
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="nx-label">Entregas</p>
                <p className="nx-readout text-[26px] leading-none tabular-nums" data-testid="exchange-count"><span className={full ? "text-[#3ee08f]" : "text-white"}>{count}</span><span className="text-white/35"> / {recipe.inputQty}</span></p>
              </div>
              <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-label={`${count} de ${recipe.inputQty} huecos llenos`}>
                {Array.from({ length: recipe.inputQty }, (_, i) => <Slot key={i} index={i} cardId={slots[i]} color={glowOf(recipe.inputClass)} onRemove={slots[i] ? () => pick.remove(0, slots[i]) : undefined} />)}
              </div>
              <AutoSelectBar pick={pick} />
            </div>
            <div className="flex flex-col items-center gap-3">
              <ForgeCore on={full} color={glowOf(recipe.outputClass)} />
              <NxButton variant="primary" size="lg" onClick={start} disabled={!recipe.live || !full} data-testid="exchange-craft" className={cn("min-w-[180px]", full && ctaReadyClass)}>Craftear</NxButton>
              {count === 0 && <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">Elige {recipe.inputQty} duplicados</p>}
            </div>
            <div className="flex justify-center"><MysteryCard cls={recipe.outputClass} width={150} /></div>
          </Panel>

          {m.candidates.length === 0 ? (
            <Panel className="flex items-center gap-4 p-6">
              <GameGlyph name="cards" className="h-10 w-10 shrink-0 text-white/35" />
              <p className="text-[15px] text-white/70">No tienes duplicados {classLabel(recipe.inputClass)} libres. Solo cuentan copias repetidas fuera de tus equipos.</p>
            </Panel>
          ) : (
            <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-label={`Duplicados ${classLabel(recipe.inputClass)}`}>
              {m.candidates.map((c) => {
                const n = pick.counts[`0:${c.cardId}` as PickKey] ?? 0; const def = getCard(c.cardId);
                const anyProtected = c.free.some((f) => f.protectedBy.length > 0);
                const protectedOnly = c.free.every((f) => f.protectedBy.length > 0);
                const allow = !!pick.allowProtected[c.cardId];
                const cap = Math.min(c.usable, c.free.filter((f) => allow || f.protectedBy.length === 0).length);
                const cannot = n >= cap || count >= recipe.inputQty;
                return (
                  <li key={c.cardId} className="relative flex flex-col items-center gap-1.5" data-testid="exchange-candidate" data-card={c.cardId} data-picked={n} data-protected={anyProtected}>
                    {anyProtected && <span className="absolute left-1 top-1 z-10 border border-drl-gold/70 bg-black/80 px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-drl-gold">★ protegida</span>}
                    <button type="button" data-testid="exchange-add" onClick={() => pick.add(0, c.cardId)} disabled={cannot}
                      aria-label={`Añadir ${cardName(c.cardId)} (${def?.ovr ?? ""}), ${n} de ${cap} libres`}
                      className={cn(pickClass(n > 0), "nx-focus relative block w-full rounded-[8px] disabled:cursor-default", n === 0 && cannot && "opacity-55", protectedOnly && !allow && "opacity-55")}>
                      <CardImage cardId={c.cardId} width={200} className="!w-full" />
                      {n > 0 && <span className="absolute right-1 top-1 grid h-8 min-w-8 place-items-center rounded-full bg-drl-cyan px-1.5 font-display text-[15px] font-extrabold text-black shadow-[0_0_14px_#19e3ff]" aria-hidden>✓{n > 1 ? ` ${n}` : ""}</span>}
                    </button>
                    {n > 0 && <button type="button" data-testid="exchange-remove" onClick={() => pick.remove(0, c.cardId)} aria-label={`Quitar una copia de ${cardName(c.cardId)}`}
                      className="nx-focus absolute left-1 top-8 grid h-8 w-8 place-items-center rounded-full border border-white/30 bg-black/75 text-[18px] font-bold text-white hover:bg-drl">−</button>}
                    <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/55">{c.usable} libres · ×{c.copies}</span>
                    {anyProtected && <button type="button" onClick={() => pick.toggleProtected(c.cardId)} aria-pressed={allow} data-testid="exchange-allow-protected"
                      className={cn("nx-focus w-full border py-1 text-[10px] font-bold uppercase tracking-[0.08em]", allow ? "border-drl-gold bg-drl-gold/15 text-drl-gold" : "border-white/15 text-white/60")}>{allow ? "Protegida: usar" : "Usar protegida"}</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <GameModal open={open} onClose={close} title={result ? "Forja" : "Confirmar forja"} eyebrow="Forja · Cartas" testId="card-craft-dialog" dismissable={!busy} className="max-w-2xl"
        actions={result ? <NxButton variant="primary" size="lg" onClick={close} data-autofocus>Continuar</NxButton> : <>
          <NxButton variant="ghost" onClick={close} disabled={busy}>Cancelar</NxButton>
          <NxButton variant="primary" size="lg" onClick={confirm} disabled={busy} data-testid="card-craft-confirm" data-autofocus>{busy ? "Crafteando…" : "Confirmar forja"}</NxButton>
        </>}>
        {recipe && !result && <ForgeConfirm uids={pick.uids} protectedUids={pick.protectedUids} materials={recipe.materials} output={{ type: "CLASS", class: recipe.outputClass }} />}
        {failure && <p role="alert" className="mt-3 text-center text-[14px] text-drl">{failure}</p>}
        {result && result.outputs[0] && recipe && (
          <CardRevealSequence cls={recipe.outputClass} cardId={result.outputs[0].cardId} caption={`${cardName(result.outputs[0].cardId)} · ${getCard(result.outputs[0].cardId)?.ovr ?? ""}`} sub="Añadida a tu colección" />
        )}
      </GameModal>
    </section>
  );
}

/* ═══════════════════════════ PROYECTOS ═══════════════════════════ */

function Projects() {
  const [snap, setSnap] = useState<MissionsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setSnap(await fetchMissions()); } catch (e) { setError(e instanceof Error ? e.message : "No se pudieron cargar los proyectos"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (error && !snap) return <ErrorState message={error} onRetry={load} />;
  if (!snap) return <Loading kind="hub" label="Cargando proyectos…" />;
  if (!snap.available) return <Unavailable what="Los proyectos de carta" />;
  if (snap.projects.length === 0) return (
    <Panel className="flex items-center gap-4 p-6">
      <GameGlyph name="crown" className="h-10 w-10 shrink-0 text-white/35" />
      <p className="text-[15px] text-white/70">No hay proyectos de carta activos ahora mismo.</p>
    </Panel>
  );
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Proyectos" data-testid="projects">
      {snap.projects.map((p) => {
        const ready = p.state === "COMPLETED";
        return (
          <li key={p.id}>
            <Link href={`/misiones/crafting/cartas/${p.id}`} data-testid="project-card" data-project={p.id} data-state={p.state} className="nx-focus group block h-full">
              <Panel tone={ready ? "ready" : p.state === "CLAIMED" ? "done" : undefined} className="flex h-full flex-col items-center gap-4 px-5 pb-6 pt-7 text-center">
                <span className={cn(haloClass(ready), "transition-transform group-hover:-translate-y-1.5 motion-reduce:transform-none")} style={{ ["--forge-glow" as string]: "#ffce4f" }}>
                  <CardImage cardId={p.targetCardId} width={190} dim={p.state === "LOCKED"} />
                </span>
                <h2 className="font-display text-[20px] font-extrabold uppercase leading-tight tracking-[0.06em] text-white">{p.name}</h2>
                <Stamp kind={p.state === "COMPLETED" ? "COMPLETED" : p.state === "CLAIMED" ? "CLAIMED" : p.state === "LOCKED" ? "LOCKED" : "ACTIVE"} />
                <div className="w-full"><ForgeBar value={p.completed} max={p.total} label={`Misiones de ${p.name}`} /></div>
              </Panel>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
