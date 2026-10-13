"use client";

/**
 * F58 · /admin/rewards — las fuentes REALES de recompensa (pase, logros, desafíos de evento, escalones de pick'em) y lo
 * que han repartido según el libro mayor. Solo lectura: no hay un segundo motor de recompensas; todas pagan por
 * `award()`/`app_grant_reward`. Las concesiones manuales a un jugador se hacen desde su ficha.
 */
import { useAdminQuery, fmt } from "@/components/admin/cc/api";
import { PageHeader, Panel, Loading, ErrorBox, DataTable, Stat, Pill } from "@/components/admin/cc/ui";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("admin");

type Reward = { credits?: number; xp?: number; packId?: string; packCount?: number; cardId?: string };
interface V {
  pass: { free: number; competitive: number; premium: number };
  achievements: { id: string; label: string; goal: number; reward: number }[];
  eventSets: { id: string; label: string; challenges: { id: string; label: string; goal: number; reward: Reward }[] }[];
  pickemTiers: Record<string, unknown>[];
  ledger30d: { bucket: string; entries: number; credits_in: number; credits_out: number }[];
}
const r2s = (r: Reward) => [r.credits ? `${fmt(r.credits)} cr` : null, r.xp ? `${r.xp} XP` : null, r.packId ? `${r.packCount ?? 1}× ${r.packId}` : null, r.cardId ? `carta ${r.cardId}` : null].filter(Boolean).join(" · ") || "—";

export default function Rewards() {
  useLocale();
  const q = useAdminQuery<V>("/api/admin/catalog?view=rewards");
  const d = q.data;
  const REWARD_BUCKETS = new Set(["duel_win", "duel_loss", "mission_reward", "achievement", "event_challenge", "campaign_first_clear", "pass", "pickem", "starter_grant", "admin_adjust", "admin_grant"]);
  return (
    <>
      <PageHeader eyebrow={tr("Juego")} title={tr("Recompensas")} description={tr("Qué reparte el juego y cuánto ha repartido. Para conceder algo a un jugador concreto, abre su ficha de usuario.")} />
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {!d && !q.error && <Loading />}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={tr("Pase · niveles gratis")} value={d.pass.free} accent="ok" />
            <Stat label={tr("Pase · competitivo")} value={d.pass.competitive} accent="cyan" />
            <Stat label={tr("Logros")} value={d.achievements.length} accent="gold" />
            <Stat label={tr("Conjuntos de evento")} value={d.eventSets.length} accent="drl" />
          </div>
          <Panel title={tr("Repartido en 30 días (libro mayor)")}>
            <DataTable caption={tr("Recompensas por motivo")} rows={d.ledger30d.filter((r) => REWARD_BUCKETS.has(r.bucket))} rowKey={(r) => r.bucket} empty={tr("Sin recompensas en la ventana")}
              cols={[{ key: "b", label: tr("Fuente"), render: (r) => <b className="text-ink-primary">{td(r.bucket)}</b> }, { key: "e", label: tr("Asientos"), align: "right", render: (r) => fmt(Number(r.entries)) }, { key: "i", label: tr("Créditos"), align: "right", render: (r) => fmt(Number(r.credits_in)) }]} />
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title={tr("Desafíos de evento")}>
              {d.eventSets.map((s) => (
                <div key={s.id} className="mb-4 last:mb-0"><p className="mb-1.5 font-display text-[12px] font-bold uppercase tracking-wider text-drl-cyan">{td(s.label)}</p>
                  <ul className="space-y-1 text-[13px]">{s.challenges.map((c) => <li key={c.id} className="flex justify-between gap-3"><span>{td(c.label)}</span><span className="text-drl-gold">{r2s(c.reward)}</span></li>)}</ul></div>
              ))}
            </Panel>
            <Panel title={tr("Logros")}>
              <DataTable caption={tr("Logros")} rows={d.achievements} rowKey={(r) => r.id} cols={[{ key: "n", label: tr("Logro"), render: (r) => td(r.label) }, { key: "g", label: tr("Meta"), align: "right", render: (r) => fmt(r.goal) }, { key: "r", label: tr("Créditos"), align: "right", render: (r) => fmt(r.reward), sort: (r) => r.reward }]} />
            </Panel>
          </div>
          <Panel title={tr("Escalones de pick'em")}>
            <div className="flex flex-wrap gap-2">{d.pickemTiers.map((t, i) => <Pill key={i} tone="gold">{String(t.label ?? t.id ?? `Escalón ${i + 1}`)}: {r2s((t.reward ?? {}) as Reward)}</Pill>)}</div>
          </Panel>
        </div>
      )}
    </>
  );
}
