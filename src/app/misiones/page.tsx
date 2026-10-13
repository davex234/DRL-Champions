"use client";

/**
 * F73 · /misiones — EL HUB DE PROGRESIÓN: MISIONES · CRAFTING. F74: rediseño visual (NEXUS FORGE).
 *
 * Misiones configurables (admin) con progreso calculado SOLO por el servidor a partir de lo que de verdad pasa
 * (partidas terminadas, aperturas, crafteos). Aquí se ve el progreso y se reclama; nunca se suma nada desde el cliente.
 * Las misiones de un PROYECTO de carta se ven en su proyecto (Crafting → Cartas → Proyectos).
 *
 * F74 · cada misión es una placa con su RECOMPENSA en arte (sobre real / créditos / XP), barra grande y un sello de
 * estado que se lee sin leer (En curso · Reclamable · Reclamada · Completada · Bloqueada). El aviso «misión
 * actualizada» usa el sistema de avisos existente (`useToast`), comparando con lo que este navegador vio la última vez.
 *
 * IA 2026-10-07 · OBJETIVOS (segunda área del hub de Temporada) = QUÉ HACER: arriba los objetivos del pase (diarios,
 * semanales, de temporada e hitos, con su reclamo — la vista «objectives» de `ProgressionHub`, misma lectura
 * `GET /api/game/meta` y mismos reclamos) y debajo las misiones especiales F73. Dos fuentes que ya existían, ningún
 * almacén nuevo. Lo CONSEGUIDO vive en Mi cuenta → Progresión.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { syncFromServer } from "@/lib/game/sync";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { NxButton } from "@/components/ui/NxButton";
import { Toast } from "@/components/ui/Toast";
import { useToast } from "@/lib/useToast";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { CardImage, PackArt, Unavailable } from "@/components/crafting/CraftingUi";
import { ForgeBar, ForgeStage, ForgeTitle, Panel, RewardArt, Stamp, ctaReadyClass, haloClass, type StampKind } from "@/components/crafting/Forge";
import { claimMissionReq, fetchMissions, type MissionsSnapshot } from "@/lib/crafting/client";
import { fetchMetaSnapshot, type MetaSnapshot } from "@/lib/progression/meta";
import { ProgressionHub } from "@/components/progression/hub/ProgressionHub";
import { Crumbs } from "@/components/crafting/CraftingUi";
import { cn } from "@/lib/format";

export default function MisionesPage() {
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="hub" label="Cargando tus misiones…" />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what="tus objetivos" />;
  return <Missions />;
}

type Mission = MissionsSnapshot["missions"][number];

function stampOf(m: Mission): StampKind {
  if (m.state === "LOCKED") return "LOCKED";
  if (m.state === "ACTIVE") return "ACTIVE";
  if (m.state === "COMPLETED") return m.hasReward ? "COMPLETED" : "DONE";
  return m.hasReward ? "CLAIMED" : "DONE";
}

/** Medallón de la misión: el arte de su recompensa; sin recompensa, el glifo de lo que pide. */
function Medallion({ m }: { m: Mission }) {
  const claimed = m.state === "CLAIMED";
  if (m.reward.packId && m.reward.packCount) return <span className={haloClass(m.state === "COMPLETED")} style={{ ["--forge-glow" as string]: "#ffce4f" }}><PackArt packId={m.reward.packId} width={60} dim={claimed} className="sm:!w-[72px]" /></span>;
  const glyph = m.reward.credits ? "coin" : m.reward.xp ? "xp" : /PACK/.test(m.conditionType) ? "pack" : /WIN|MATCH|TURN|STREAK/.test(m.conditionType) ? "duel" : "star";
  const tone = claimed ? "text-white/40" : m.reward.credits ? "text-drl-gold" : m.reward.xp ? "text-drl-cyan" : "text-white/75";
  return (
    <span className={cn("grid h-[64px] w-[64px] place-items-center sm:h-[84px] sm:w-[84px]", tone)}
      style={{ clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)", background: m.state === "COMPLETED" ? "radial-gradient(circle, rgba(255,206,79,0.28), rgba(255,206,79,0.06))" : "radial-gradient(circle, rgba(255,255,255,0.10), rgba(255,255,255,0.03))" }}>
      <GameGlyph name={glyph} className="h-9 w-9 sm:h-12 sm:w-12" strokeWidth={2} />
    </span>
  );
}

const SEEN_KEY = "nx-f74-missions-seen";

function Missions() {
  const [snap, setSnap] = useState<MissionsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const { toast, notify } = useToast(3200);
  const announced = useRef(false);
  const load = useCallback(async () => {
    setError(null);
    try { setSnap(await fetchMissions()); } catch (e) { setError(e instanceof Error ? e.message : "No se pudieron cargar tus misiones"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  /* F74 · aviso breve de progreso (sin modal, sin spam): UNO por visita, comparando con lo visto en este navegador. */
  useEffect(() => {
    if (!snap?.available || announced.current) return;
    announced.current = true;
    let seen: Record<string, number> = {};
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>; } catch { /* sin almacenamiento */ }
    const hadHistory = Object.keys(seen).length > 0;
    const moved = snap.missions.filter((m) => (seen[m.id] ?? 0) < m.progress);
    const completed = moved.find((m) => m.progress >= m.target);
    if (hadHistory && completed) notify(`Misión completada · ${completed.name}`);
    else if (hadHistory && moved[0]) notify(`Misión actualizada · ${moved[0].progress} / ${moved[0].target}`);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(snap.missions.map((m) => [m.id, m.progress])))); } catch { /* sin almacenamiento */ }
  }, [snap, notify]);

  const claim = async (id: string) => {
    if (busy) return;
    setBusy(id); setNotice(null);
    try {
      const r = await claimMissionReq(id);
      setSnap(r.snapshot);
      setNotice({ ok: true, text: r.repeated ? "Esa recompensa ya estaba reclamada." : "Recompensa reclamada." });
      await syncFromServer().catch(() => undefined);
    } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : "No se pudo reclamar" }); await load(); }
    finally { setBusy(null); }
  };

  const header = (
    <>
      {/* «Objetivos» UNA vez: el título. La miga solo vuelve a Temporada y la vista de objetivos no repite su encabezado
          (antes: título + pestaña + encabezado). Crafteo se alcanza desde el hub de Temporada. */}
      <ForgeTitle title="Objetivos" eyebrow={<Crumbs items={[{ href: "/temporada", label: "← Temporada" }]} />} />
      <PassObjectives />
    </>
  );
  if (error && !snap) return <ForgeStage className="mx-auto w-full max-w-[1120px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="missions-hub">{header}<ErrorState message={error} onRetry={load} /></ForgeStage>;
  if (!snap) return <ForgeStage className="mx-auto w-full max-w-[1120px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="missions-hub">{header}<Loading kind="hub" label="Cargando tus misiones…" /></ForgeStage>;
  const standalone = snap.missions.filter((m) => !m.projectId);
  const order = { COMPLETED: 0, ACTIVE: 1, LOCKED: 2, CLAIMED: 3 } as const;
  const sorted = [...standalone].sort((a, b) => order[a.state] - order[b.state] || a.sortOrder - b.sortOrder);
  const nameOf = (id: string) => snap.missions.find((m) => m.id === id)?.name ?? id;
  const lead = snap.projects[0];

  return (
    <ForgeStage className="mx-auto w-full max-w-[1120px] space-y-6 px-4 pb-10 pt-5 sm:px-6" testId="missions-hub">
      {header}
      <h2 className="font-display text-[18px] font-bold uppercase tracking-[0.12em] text-white" data-testid="special-missions-title">Misiones especiales</h2>
      {notice && <p role="status" className={notice.ok ? "text-[14px] text-[#3ee08f]" : "text-[14px] text-drl"}>{notice.text}</p>}
      {!snap.available ? <Unavailable what="Misiones" /> : (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:gap-3" data-testid="missions-summary" aria-label="Resumen de tus misiones">
            {[
              { k: "active", label: "Activas", n: standalone.filter((m) => m.state === "ACTIVE").length, tone: "text-drl-cyan", bar: "bg-drl-cyan" },
              { k: "done", label: "Completadas", n: standalone.filter((m) => m.state === "COMPLETED" || m.state === "CLAIMED").length, tone: "text-[#3ee08f]", bar: "bg-[#3ee08f]" },
              { k: "rewards", label: "Recompensas", n: standalone.filter((m) => m.state === "COMPLETED" && m.hasReward).length, tone: "text-drl-gold", bar: "bg-drl-gold" },
            ].map((x) => (
              <Panel key={x.k} data-summary={x.k} className="flex flex-col items-start gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
                <span aria-hidden className={cn("hidden h-10 w-1.5 sm:block", x.bar)} />
                <dd className={cn("nx-readout text-[34px] leading-none tabular-nums sm:text-[46px]", x.tone)}>{x.n}</dd>
                <dt className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-white/65 sm:text-[13px]">{x.label}</dt>
              </Panel>
            ))}
          </dl>

          {sorted.length === 0 ? (
            <Panel className="flex items-center gap-4 p-6">
              <GameGlyph name="star" className="h-10 w-10 text-white/40" />
              <p className="text-[15px] text-white/70">No hay misiones activas ahora mismo. Las nuevas aparecerán aquí.</p>
            </Panel>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2" aria-label="Misiones">
              {sorted.map((m) => {
                const k = stampOf(m);
                const claimable = m.state === "COMPLETED" && m.hasReward;
                return (
                  <Panel as="li" key={m.id} data-testid="mission-card" data-mission={m.id} data-state={m.state}
                    tone={claimable ? "ready" : m.state === "CLAIMED" || m.state === "LOCKED" ? "muted" : k === "DONE" ? "done" : undefined}
                    className={cn("flex min-w-0 gap-3 p-4 sm:gap-4 sm:p-5", m.state === "LOCKED" && "opacity-75", m.state === "CLAIMED" && "opacity-70")}>
                    <div className="flex shrink-0 flex-col items-center justify-center"><Medallion m={m} /></div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1.5">
                        <h2 className="min-w-0 break-words font-display text-[18px] font-extrabold uppercase leading-tight tracking-[0.04em] text-white sm:text-[21px]">{m.name}</h2>
                        <Stamp kind={k} />
                      </div>
                      {m.description && <p className="-mt-1 truncate text-[13px] text-white/55" title={m.description}>{m.description}</p>}
                      <ForgeBar value={m.progress} max={m.target} label={`Progreso de ${m.name}`} big />
                      {m.state === "LOCKED" && m.dependsOn.length > 0 && (
                        <p className="text-[12px] uppercase tracking-[0.12em] text-white/50"><span aria-hidden>🔒 </span>Tras: {m.dependsOn.map(nameOf).join(" · ")}</p>
                      )}
                      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                        {m.hasReward ? <RewardArt reward={m.reward} claimed={m.state === "CLAIMED"} /> : <span />}
                        {claimable && (
                          <NxButton variant="primary" size="md" className={ctaReadyClass} onClick={() => claim(m.id)} disabled={busy !== null} data-testid="mission-claim">{busy === m.id ? "Reclamando…" : "Reclamar"}</NxButton>
                        )}
                      </div>
                    </div>
                  </Panel>
                );
              })}
            </ul>
          )}

          {lead && (
            <Link href="/misiones/crafting/cartas?tab=proyectos" data-testid="missions-projects-banner"
              className="nx-focus group block">
              <Panel tone="ready" className="flex items-center gap-5 overflow-hidden p-4 sm:gap-8 sm:p-6">
                <span className={cn(haloClass(lead.state === "COMPLETED"), "shrink-0 transition-transform group-hover:-translate-y-1 motion-reduce:transform-none")} style={{ ["--forge-glow" as string]: "#ffce4f" }}>
                  <CardImage cardId={lead.targetCardId} width={96} dim={lead.state === "LOCKED"} />
                </span>
                <span className="min-w-0 flex-1 space-y-2">
                  <span className="block font-display text-[12px] font-bold uppercase tracking-[0.22em] text-drl-gold">Proyectos de carta · {snap.projects.length}</span>
                  <span className="block font-display text-[22px] font-extrabold uppercase leading-tight text-white sm:text-[28px]">{lead.name}</span>
                  <span className="block max-w-[420px]"><ForgeBar value={lead.completed} max={lead.total} label={`Misiones de ${lead.name}`} /></span>
                </span>
                <span aria-hidden className="hidden font-display text-[14px] font-bold uppercase tracking-[0.2em] text-drl group-hover:text-white sm:block">Ver →</span>
              </Panel>
            </Link>
          )}
        </>
      )}
      <Toast toast={toast} />
    </ForgeStage>
  );
}

/**
 * IA 2026-10-07 · LOS OBJETIVOS DEL PASE en Objetivos: la MISMA vista y los MISMOS reclamos que Mi cuenta → Progresión
 * (`ProgressionHub view="objectives"` sobre `GET /api/game/meta`). Si la foto no llega, se dice y se reintenta; las
 * misiones especiales de debajo siguen funcionando.
 */
function PassObjectives() {
  const [meta, setMeta] = useState<{ snap: MetaSnapshot; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const s = await fetchMetaSnapshot();
      if (s) setMeta({ snap: s, at: Date.now() }); else setFailed(true);
    } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (failed && !meta) return <ErrorState message="No se pudieron cargar los objetivos de la temporada" onRetry={load} />;
  if (!meta) return <Loading kind="hub" label="Cargando objetivos…" />;
  return <div data-testid="pass-objectives"><ProgressionHub snap={meta.snap} receivedAt={meta.at} reload={load} view="objectives" /></div>;
}
