"use client";

/**
 * F73 · /misiones/crafting/cartas/[project] — UN PROYECTO DE CARTA.
 *
 *            [CARTA OBJETIVO]
 *               3 / 8 MISIONES
 *   [✓] Misión 1   [ ] Misión 2 …
 *            [RECLAMAR CARTA]
 *
 * La carta objetivo es una carta REAL del catálogo que configuró el admin. El progreso lo calcula el servidor; reclamar
 * es una operación del servidor idempotente (una sola copia por proyecto, aunque se pulse diez veces o en dos pestañas).
 *
 * F74 · CAMPAÑA: la carta objetivo domina (contenida mientras se progresa; con halo y RECLAMAR CARTA al completarse) y
 * las misiones son ETAPAS de una ruta (nodos ✓ / número / 🔒 con su dependencia real). Reclamar → revelación corta.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { syncFromServer } from "@/lib/game/sync";
import { getCard } from "@/data/catalog";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { NxButton } from "@/components/ui/NxButton";
import { GameModal } from "@/components/ui/game/GameOverlay";
import { CardImage, Crumbs, HubNav, Unavailable, cardName } from "@/components/crafting/CraftingUi";
import { CardRevealSequence, ForgeBar, ForgeStage, Panel, Stamp, ctaReadyClass, haloClass } from "@/components/crafting/Forge";
import { packCardClass } from "@/domain/packs/packClass";
import { cn } from "@/lib/format";
import { claimProjectReq, fetchForge, fetchMissions, type ForgeSnapshot, type MissionsSnapshot } from "@/lib/crafting/client";
import { forgeErrorText } from "@/components/crafting/ForgeProgress";
import Link from "next/link";

export default function ProjectPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label="Cargando el proyecto…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="los proyectos de carta" />;
  return <Project />;
}

function Project() {
  const { project } = useParams<{ project: string }>();
  const [snap, setSnap] = useState<MissionsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [forge, setForge] = useState<ForgeSnapshot | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setSnap(await fetchMissions()); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo cargar el proyecto"); }
    // F79 · etapas 2.0 (reúne / fabrica): si la Forja no responde, el proyecto se ve como en F73.
    try { setForge(await fetchForge()); } catch { setForge(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const claim = async (id: string) => {
    if (busy) return;
    setBusy(true); setFailure(null);
    try { const r = await claimProjectReq(id); setSnap(r.snapshot); setClaimed(r.cardId); await syncFromServer().catch(() => undefined); }
    catch (e) { setFailure(forgeErrorText(e)); await load(); }
    finally { setBusy(false); }
  };

  if (error && !snap) return <ErrorState message={error} onRetry={load} />;
  if (!snap) return <Loading kind="hub" label="Cargando el proyecto…" />;
  const p = snap.projects.find((x) => x.id === project);
  const missions = snap.missions.filter((m) => m.projectId === project);

  const target = p ? getCard(p.targetCardId) : undefined;
  const cls = (target && packCardClass(target)) ?? "prime";
  const nameOf = (id: string) => snap.missions.find((m) => m.id === id)?.name ?? id;
  const stages = forge?.projects.find((x) => x.id === project)?.stages ?? null;
  const extrasMet = forge?.projects.find((x) => x.id === project)?.extrasMet ?? true;
  const ready = p?.state === "COMPLETED" && extrasMet;
  const done = p?.state === "CLAIMED";

  return (
    <ForgeStage className="mx-auto w-full max-w-[1180px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="project-page">
      <header className="space-y-3">
        <Crumbs items={[{ href: "/temporada", label: "Temporada" }, { href: "/misiones/crafting", label: "Crafteo" }, { href: "/misiones/crafting/cartas?tab=proyectos", label: "Proyectos" }, { label: p?.name ?? "Proyecto" }]} />
        <HubNav active="crafting" />
      </header>
      {!snap.available ? <Unavailable what="Los proyectos de carta" /> : !p ? (
        <Panel className="p-6 text-[15px] text-white/70">Este proyecto no existe o ya no está activo.</Panel>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,340px)] lg:items-start lg:gap-8 xl:grid-cols-[1fr_minmax(0,400px)] xl:gap-10">
          {/* LA CARTA OBJETIVO (arriba en móvil, a la derecha en escritorio). */}
          <section aria-label="Carta objetivo" className="order-1 flex flex-col items-center gap-4 text-center lg:order-2 lg:sticky lg:top-24">
            <span className={cn(haloClass(ready), "relative")} style={{ ["--forge-glow" as string]: ready ? "#ffce4f" : "#19e3ff" }}>
              <span className={cn("block transition", !ready && !done && "brightness-[0.82] saturate-[0.8]")}>
                <CardImage cardId={p.targetCardId} width={340} dim={p.state === "LOCKED"} className="max-w-[72vw]" />
              </span>
              {!ready && !done && (
                <span aria-hidden className="pointer-events-none absolute inset-x-[8%] bottom-[5%] border border-white/15 bg-black/70 py-1.5 font-display text-[12px] font-bold uppercase tracking-[0.24em] text-white/80 backdrop-blur">
                  {p.state === "LOCKED" ? "🔒 Bloqueada" : "En progreso"}
                </span>
              )}
            </span>
            <div className="w-full max-w-[340px] space-y-3">
              {ready && (
                <NxButton variant="primary" size="lg" block onClick={() => claim(p.id)} disabled={busy} data-testid="project-claim" className={ctaReadyClass}>{busy ? "Reclamando…" : "Reclamar carta"}</NxButton>
              )}
              {done && <p className="font-display text-[20px] font-extrabold uppercase tracking-[0.14em] text-[#3ee08f]">Carta conseguida</p>}
              {p.state === "COMPLETED" && !extrasMet && <p className="text-[13px] text-white/70" data-testid="project-extras-pending">Misiones completas. Te faltan las etapas de la Forja (reunir o fabricar) para reclamar.</p>}
              <Stamp kind={done ? "CLAIMED" : ready ? "COMPLETED" : p.state === "LOCKED" ? "LOCKED" : "ACTIVE"} />
              {failure && <p role="alert" className="text-[14px] text-drl">{failure}</p>}
            </div>
          </section>

          {/* LA CAMPAÑA: progreso y etapas. */}
          <section aria-label="Progreso del proyecto" className="order-2 space-y-5 lg:order-1">
            <div className="space-y-2">
              <p className="font-display text-[12px] font-bold uppercase tracking-[0.24em] text-drl-gold">Proyecto de carta</p>
              <h1 className="font-display text-[36px] font-extrabold uppercase leading-[0.95] tracking-[0.03em] text-white sm:text-[52px]">{p.name}</h1>
              {p.description && <p className="max-w-[560px] text-[14px] text-white/65">{p.description}</p>}
            </div>
            <Panel tone={ready ? "ready" : done ? "done" : undefined} className="flex items-center gap-5 px-5 py-4">
              <div>
                <p className="nx-label !text-[10px]">Progreso</p>
                <p className="nx-readout text-[40px] leading-none tabular-nums text-white" data-testid="project-progress">{p.completed} / {p.total}</p>
                <p className="nx-label !text-[10px]">Misiones</p>
              </div>
              <div className="flex-1"><ForgeBar value={p.completed} max={p.total} label={`Misiones de ${p.name}`} big /></div>
            </Panel>
            {stages && stages.some((st) => st.kind !== "MISSIONS" && st.kind !== "CLAIM") ? (
              <div className="space-y-5" data-testid="project-stages">
                {stages.filter((st) => st.kind !== "CLAIM").map((st) => (
                  <section key={st.index} aria-label={st.title} className="space-y-2" data-testid="project-stage" data-kind={st.kind} data-done={st.done}>
                    <p className={cn("font-display text-[13px] font-bold uppercase tracking-[0.2em]", st.done ? "text-[#3ee08f]" : "text-white/70")}>{st.done ? "✓ " : ""}{st.title}</p>
                    {st.kind === "MISSIONS" ? (
                      <ol className="relative space-y-3" aria-label={`Misiones · ${st.title}`}>
                        {missions.filter((m) => st.items.some((it) => it.refId === m.id)).map((m, i) => <MissionRow key={m.id} m={m} i={i} nameOf={nameOf} />)}
                      </ol>
                    ) : (
                      <Panel tone={st.done ? "done" : undefined} className="space-y-1.5 px-4 py-3">
                        {st.kind === "OWN" && <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#3ee08f]">Se comprueba · no se consume</p>}
                        {st.items.map((it, j) => (
                          <div key={j} className="flex items-center justify-between gap-3 text-[14px]">
                            <span className={it.done ? "text-white/80" : "text-white/60"}>{it.done ? "✓" : "○"} {it.label}</span>
                            {st.kind === "FABRICATE" && !it.done ? <Link href="/misiones/crafting/avanzado" className="nx-focus text-[12px] font-bold uppercase tracking-[0.12em] text-drl-cyan">Forjar →</Link>
                              : it.target !== undefined ? <b className="nx-readout tabular-nums text-white/80">{Math.min(it.progress ?? 0, it.target)} / {it.target}</b> : null}
                          </div>
                        ))}
                      </Panel>
                    )}
                  </section>
                ))}
              </div>
            ) : (
            <ol className="relative space-y-3" aria-label="Misiones del proyecto">
              <span aria-hidden className="absolute bottom-6 left-[22px] top-6 w-[2px] bg-gradient-to-b from-drl-cyan/60 via-white/15 to-white/5" />
              {missions.map((m, i) => <MissionRow key={m.id} m={m} i={i} nameOf={nameOf} />)}
            </ol>
            )}
          </section>
        </div>
      )}

      <GameModal open={!!claimed} onClose={() => setClaimed(null)} title="Proyecto completado" eyebrow="Forja · Proyecto" testId="project-claim-dialog" className="max-w-lg"
        actions={<NxButton variant="primary" size="lg" onClick={() => setClaimed(null)} data-autofocus>Continuar</NxButton>}>
        {claimed && <CardRevealSequence cls={cls} cardId={claimed} caption={`${cardName(claimed)} · ${getCard(claimed)?.ovr ?? ""}`} sub="Ya en tu colección" />}
      </GameModal>
    </ForgeStage>
  );
}

type MissionRowView = MissionsSnapshot["missions"][number];
/** Una misión del proyecto (nodo ✓ / número / 🔒 con su dependencia real). F74 · misma marca; F79 · reutilizable por etapa. */
function MissionRow({ m, i, nameOf }: { m: MissionRowView; i: number; nameOf: (id: string) => string }) {
  const ok = m.state === "COMPLETED" || m.state === "CLAIMED";
  const locked = m.state === "LOCKED";
  return (
    <li key={m.id} data-testid="project-mission" data-state={m.state} className="relative flex gap-4">
      <span aria-hidden className={cn("relative z-10 mt-3 grid h-11 w-11 shrink-0 place-items-center border-2 font-display text-[16px] font-extrabold",
        ok ? "border-[#3ee08f] bg-[#0c2a1d] text-[#3ee08f] shadow-[0_0_16px_rgba(62,224,143,0.6)]" : locked ? "border-white/15 bg-[#0b0c12] text-white/40" : "border-drl-cyan bg-[#0a1c24] text-drl-cyan shadow-[0_0_16px_rgba(25,227,255,0.5)]")}
        style={{ clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)" }}>{ok ? "✓" : locked ? "🔒" : i + 1}</span>
      <Panel tone={ok ? "done" : undefined} className={cn("flex min-w-0 flex-1 flex-col gap-2 px-4 py-3 xl:flex-row xl:items-center xl:gap-5", locked && "opacity-70")}>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[16px] font-bold uppercase tracking-[0.05em] text-white">{m.name}</p>
          {locked && m.dependsOn.length > 0 ? <p className="text-[12px] uppercase tracking-[0.1em] text-white/50">Tras: {m.dependsOn.map(nameOf).join(" · ")}</p>
            : m.description ? <p className="truncate text-[13px] text-white/55" title={m.description}>{m.description}</p> : null}
        </div>
        <div className="flex items-center gap-3 xl:contents"><div className="min-w-0 flex-1 xl:w-[200px] xl:flex-none"><ForgeBar value={m.progress} max={m.target} label={`${locked ? "Bloqueada" : "Progreso"}: ${m.name}`} /></div>
        <Stamp kind={ok ? "DONE" : locked ? "LOCKED" : "ACTIVE"} /></div>
      </Panel>
    </li>
  );
}
