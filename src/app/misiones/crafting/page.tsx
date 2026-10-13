"use client";

/**
 * F73 · /misiones/crafting — CRAFTING HOME. F74: dos RAMAS gigantes (SOBRES · CARTAS) con arte real.
 *
 * F79 · NEXUS FORGE 2.0: la home gira alrededor de la PROGRESIÓN. Arriba, el núcleo de la Forja (evoluciona con tu nivel
 * real), la XP al siguiente nivel y la maestría por rama; después las cuatro zonas (Sobres · Cartas · Avanzado ·
 * Historial), el proyecto activo, los objetivos del periodo y la actividad reciente. Todo lo pinta la foto del servidor
 * (`GET /api/game/forge`): el navegador no calcula nivel, XP ni desbloqueos.
 *
 * IA 2026-10-07 · CRAFTEO (tercera área del hub de Temporada) presenta EXACTAMENTE DOS opciones: CARTAS y SOBRES, lo
 * primero de la pantalla. «Avanzado» (recetas que producen CARTAS) se entra desde Cartas; el historial queda como enlace
 * («Ver todo» de la actividad). Las rutas, las recetas y la seguridad de la Forja no cambian.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { CardImage, Crumbs, HubNav, PackArt, cardName } from "@/components/crafting/CraftingUi";
import { ForgeBar, ForgeStage, ForgeTitle, Panel, RewardArt, Stamp, branchArtClass, branchClass, haloClass } from "@/components/crafting/Forge";
import { LevelCore, MasteryGrid, XpBar, forgeErrorText } from "@/components/crafting/ForgeProgress";
import { claimObjectiveReq, fetchForge, type ForgeSnapshot } from "@/lib/crafting/client";
import { CARDS } from "@/data/catalog";
import { packCardClass } from "@/domain/packs/packClass";
import { cn } from "@/lib/format";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("misiones");

/** Tres cartas REALES de la clase más alta, en orden estable (escaparate, no promesa de salida). */
const SHOWCASE = CARDS.filter((c) => packCardClass(c) === "icon" && !!c.image).sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).slice(0, 3);
const PACKS = ["estandar", "premium", "oro", "masters"] as const;
const chamfer = (n: number) => `polygon(0 0, calc(100% - ${n}px) 0, 100% ${n}px, 100% 100%, ${n}px 100%, 0 calc(100% - ${n}px))`;

function Branch({ href, title, line, art, testId, glow, badge }: { href: string; title: string; line: string; art: React.ReactNode; testId: string; glow: string; badge?: React.ReactNode }) {
  useLocale();
  return (
    <Link href={href} data-testid={testId}
      className={cn(branchClass, "nx-focus group relative flex min-h-[230px] flex-col items-center justify-end overflow-hidden border border-white/10 px-4 pb-5 pt-4 text-center transition sm:min-h-[300px]")}
      style={{ clipPath: chamfer(22), background: `radial-gradient(70% 60% at 50% 38%, ${glow}33, transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(7,8,14,0.9))` }}>
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent, ${glow}, transparent)` }} />
      {badge && <span className="absolute right-3 top-3">{badge}</span>}
      <div className={cn(branchArtClass, "flex flex-1 items-center justify-center")}>{art}</div>
      <h2 className="font-display text-[30px] font-extrabold uppercase leading-none tracking-[0.08em] text-white sm:text-[38px]">{td(title)}</h2>
      <p className="mt-1.5 max-w-[260px] text-[13px] text-white/70">{td(line)}</p>
    </Link>
  );
}

const HISTORY_LABEL = { PACK: "Sobres", EXCHANGE: "Intercambio", ADVANCED: "Receta avanzada", PROJECT: "Proyecto", OBJECTIVE: "Objetivo", ACHIEVEMENT: "Logro" } as const;

export default function CraftingHomePage() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label={t("Cargando…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={t("el crafteo")} />;
  return <ForgeHome />;
}

function ForgeHome() {
  useLocale();
  const [snap, setSnap] = useState<ForgeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setError(null); try { setSnap(await fetchForge()); } catch (e) { setError(forgeErrorText(e)); } }, []);
  useEffect(() => { void load(); }, [load]);

  const core = snap?.core;
  const advanced = core?.recipes ?? [];
  const ready = advanced.filter((r) => r.state === "AVAILABLE").length;
  const project = snap?.projects.find((p) => p.state === "COMPLETED") ?? snap?.projects.find((p) => p.state === "ACTIVE");
  const exchangeReady = snap?.exchange.filter((e) => e.live && e.materials[0] && e.materials[0].availableUnprotected >= e.inputQty).length ?? 0;

  return (
    <ForgeStage className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="crafting-home">
      <ForgeTitle title={t("Crafteo")} eyebrow={<Crumbs items={[{ href: "/temporada", label: t("Temporada") }, { label: t("Crafteo") }]} />}><HubNav active="crafting" /></ForgeTitle>

      {/* LAS DOS OPCIONES (y solo dos): CARTAS · SOBRES. */}
      <nav aria-label={t("Crafteo")} className="grid gap-3 sm:grid-cols-2" data-testid="crafting-options">
        <Branch href="/misiones/crafting/cartas" testId="crafting-entry-cartas" title={t("Cartas")} line={t("Intercambia duplicados, completa proyectos y forja recetas.")} glow="#19e3ff"
          badge={exchangeReady > 0 ? <span className="border border-[#3ee08f]/60 bg-[#3ee08f]/10 px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-[#3ee08f]">{t("{n, plural, one {# lista} other {# listas}}", { n: exchangeReady })}</span> : core && ready > 0 ? <span className="border border-[#a970ff]/60 bg-[#a970ff]/15 px-2 py-0.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white">{t("{n, plural, one {# receta lista} other {# recetas listas}}", { n: ready })}</span> : undefined}
          art={<span className="relative flex origin-bottom scale-[0.6] items-end justify-center sm:scale-[0.72]">{SHOWCASE.map((c, i) => (
            <span key={c.id} className={cn("relative", i === 1 && haloClass(true))} style={{ zIndex: i === 1 ? 3 : i, marginLeft: i ? -46 : 0, transform: `translateY(${i === 1 ? -12 : 10}px) rotate(${[-9, 0, 9][i]}deg)`, ["--forge-glow" as string]: "#fff1b8" }}><CardImage cardId={c.id} width={i === 1 ? 170 : 132} /></span>
          ))}</span>} />
        <Branch href="/misiones/crafting/sobres" testId="crafting-entry-sobres" title={t("Sobres")} line={t("Convierte sobres inferiores en superiores.")} glow="#ffce4f"
          art={<span className="relative flex origin-bottom scale-[0.6] items-end justify-center sm:scale-[0.72]">{PACKS.map((p, i) => (
            <span key={p} className={cn("relative", i === 3 ? haloClass(true) : "")} style={{ zIndex: i, marginLeft: i ? -38 : 0, transform: `translateY(${[18, 8, 2, -10][i]}px) rotate(${[-14, -6, 4, 10][i]}deg)`, ["--forge-glow" as string]: "#a970ff" }}><PackArt packId={p} width={[84, 96, 108, 132][i]} /></span>
          ))}</span>} />
      </nav>

      {error && !snap && <ErrorState message={td(error)} onRetry={load} />}
      {!snap && !error && <Loading kind="hub" label={t("Encendiendo la Forja…")} />}

      {core && (
        <Panel tone={core.level.maxed ? "done" : undefined} className="grid items-center gap-5 px-5 py-6 sm:px-8 md:grid-cols-[auto_1fr] md:gap-10" data-testid="forge-hero">
          <div className="flex justify-center">
            <span className="sm:hidden"><LevelCore level={core.level.level} maxLevel={core.maxLevel} size={150} /></span>
            <span className="hidden sm:block"><LevelCore level={core.level.level} maxLevel={core.maxLevel} size={210} /></span>
          </div>
          <div className="min-w-0 space-y-4">
            <div>
              <p className="font-display text-[12px] font-bold uppercase tracking-[0.3em] text-drl-cyan">{t("Nivel de Forja")}</p>
              <p className="font-display text-[34px] font-extrabold uppercase leading-none text-white sm:text-[44px]">{t("Forjador nivel")} {core.level.level}</p>
            </div>
            <XpBar into={core.level.xpIntoLevel} need={core.level.xpForNext} total={core.xp.total} maxed={core.level.maxed} />
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[[t("Crafteos"), core.counts.packCrafts + core.counts.cardCrafts], [t("Cadenas"), core.counts.chainsDone], [t("Proyectos"), core.counts.projects]].map(([k, v]) => (
                <div key={k as string} className="border border-white/10 bg-black/25 py-2">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">{k}</dt>
                  <dd className="nx-readout text-[22px] leading-none text-white">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Panel>
      )}

      {core && <MasteryGrid mastery={core.mastery} />}

      {snap && (
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          {project ? (
            <Link href={`/misiones/crafting/cartas/${project.id}`} className="nx-focus group block" data-testid="forge-active-project">
              <Panel tone={project.state === "COMPLETED" ? "ready" : undefined} className="flex h-full items-center gap-4 px-4 py-4 sm:gap-6 sm:px-6">
                <span className={cn(haloClass(project.state === "COMPLETED"), "shrink-0")} style={{ ["--forge-glow" as string]: "#ffce4f" }}><CardImage cardId={project.targetCardId} width={110} /></span>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-display text-[11px] font-bold uppercase tracking-[0.24em] text-drl-gold">{t("Proyecto activo")}</p>
                  <p className="truncate font-display text-[22px] font-extrabold uppercase leading-tight text-white">{project.name}</p>
                  <ol className="flex flex-wrap gap-1.5" aria-label={t("Etapas")}>{project.stages.map((s) => (
                    <li key={s.index} className={cn("border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]", s.done ? "border-[#3ee08f]/60 text-[#3ee08f]" : "border-white/15 text-white/55")}>{s.done ? "✓ " : ""}{td(s.title)}</li>
                  ))}</ol>
                  <ForgeBar value={project.completed} max={Math.max(1, project.total)} label={t("Misiones de {name}", { name: project.name })} />
                </div>
              </Panel>
            </Link>
          ) : (
            <Panel className="flex items-center gap-4 px-5 py-5"><GameGlyph name="crown" className="h-10 w-10 shrink-0 text-white/35" /><p className="text-[14px] text-white/65">{t("No hay proyectos de carta activos ahora mismo.")}</p></Panel>
          )}

          <Panel className="space-y-3 px-5 py-4" data-testid="forge-activity">
            <div className="flex items-baseline justify-between"><p className="font-display text-[13px] font-bold uppercase tracking-[0.2em] text-white">{t("Actividad reciente")}</p><Link href="/misiones/crafting/historial" className="nx-focus text-[12px] font-bold uppercase tracking-[0.12em] text-drl-cyan">{t("Ver todo")}</Link></div>
            {snap.history.length === 0 ? <p className="text-[13px] text-white/55">{t("Aún no has forjado nada. Tu primer crafteo enciende el núcleo.")}</p> : (
              <ul className="space-y-1.5">{snap.history.slice(0, 5).map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-white/80"><b className="text-white">{td(HISTORY_LABEL[h.type])}</b> · {h.produced[0]?.cardId ? cardName(h.produced[0].cardId) : h.produced[0]?.packId ?? h.sourceId}</span>
                  <time className="shrink-0 text-[11px] text-white/45" dateTime={new Date(h.at).toISOString()}>{new Date(h.at).toLocaleDateString(getIntlLocale(), { day: "2-digit", month: "short" })}</time>
                </li>
              ))}</ul>
            )}
          </Panel>
        </div>
      )}

      {core && (core.objectives.length > 0 || core.achievements.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {core.objectives.length > 0 && <ObjectivesPanel snap={snap!} onChange={setSnap} />}
          {core.achievements.length > 0 && (
            <Panel className="space-y-2 px-5 py-4" data-testid="forge-achievements">
              <p className="font-display text-[13px] font-bold uppercase tracking-[0.2em] text-white">{t("Logros de Forja")}</p>
              <ul className="grid grid-cols-2 gap-2">{core.achievements.map((a) => (
                <li key={a.id} className={cn("border px-3 py-2", a.state === "ACTIVE" ? "border-white/10 opacity-80" : "border-drl-gold/50")} data-state={a.state}>
                  <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-white">{a.state === "ACTIVE" ? "🔒 " : "★ "}{a.name}</p>
                  <p className="text-[11px] text-white/55">{td(a.description)}</p>
                  <p className="nx-readout text-[13px] text-white/70">{a.progress} / {a.target}</p>
                </li>
              ))}</ul>
            </Panel>
          )}
        </div>
      )}
    </ForgeStage>
  );
}

function ObjectivesPanel({ snap, onChange }: { snap: ForgeSnapshot; onChange: (s: ForgeSnapshot) => void }) {
  useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const claim = async (id: string) => {
    if (busy) return; setBusy(id); setMsg(null);
    try { const r = await claimObjectiveReq(id); onChange(r.snapshot); }
    catch (e) { setMsg(forgeErrorText(e)); } finally { setBusy(null); }
  };
  return (
    <Panel className="space-y-3 px-5 py-4" data-testid="forge-objectives">
      <p className="font-display text-[13px] font-bold uppercase tracking-[0.2em] text-white">{t("Objetivos de Forja")}</p>
      <ul className="space-y-2">{snap.core.objectives.map((o) => (
        <li key={o.id} className="space-y-1" data-testid="forge-objective" data-state={o.state}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-bold uppercase tracking-[0.06em] text-white">{td(o.name)} <span className="text-[10px] text-white/45">{o.period === "DAILY" ? t("Hoy") : t("Esta semana")}</span></p>
            {o.state === "COMPLETED" ? <button type="button" onClick={() => claim(o.id)} disabled={busy === o.id} className="nx-focus border border-drl-gold/70 bg-drl-gold/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-drl-gold" data-testid="forge-objective-claim">{busy === o.id ? "…" : t("Reclamar")}</button>
              : <Stamp kind={o.state === "CLAIMED" ? "CLAIMED" : o.state === "DONE" ? "DONE" : "ACTIVE"} />}
          </div>
          <ForgeBar value={o.progress} max={o.target} label={td(o.name)} />
          {o.hasReward && <RewardArt reward={o.reward} claimed={o.state === "CLAIMED"} />}
        </li>
      ))}</ul>
      {msg && <p role="alert" className="text-[13px] text-drl">{td(msg)}</p>}
    </Panel>
  );
}
