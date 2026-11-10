"use client";

/**
 * F58 · /admin/packs/[id] — ficha del sobre: configuración, probabilidades (tabla F57.3 o rarezas medidas), garantías,
 * pools vinculados, economía real y SIMULADOR «¿y si…?» de solo lectura (antes/después con las mismas semillas).
 */
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminQuery, adminPost, fmt, pct } from "@/components/admin/cc/api";
import { PageHeader, Panel, KV, Pill, Loading, ErrorBox, Field, Input, Button, Bars, LevelBadge } from "@/components/admin/cc/ui";
import { packArtwork } from "@/data/packArtwork";
import { CmsPackEditor } from "@/components/admin/cms/PackCms";
import { ns, td as i18nTd, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface Sim { price: number; cardCount: number; ev: number; evOverPrice: number; salvageEV: number; salvageOverPrice: number; primePct: number; iconPct: number; p50: number; p90: number; p99: number }
interface Detail {
  pack: { id: string; name: string; description: string; price: number; cardCount: number; weights: Record<string, number>; guaranteedMin: string | null; restrictRegion: string | null; team: string | null; eventId: string | null; tag: string | null; lifecycle: string; purchasable: boolean };
  row: { ev: number | null; evOverPrice: number | null; salvageEV: number | null; salvageOverPrice: number | null; primePct: number | null; iconPct: number | null } | null;
  classDistribution: Record<string, number> | null;
  odds: { rows: { bucket: string; label: string; perCard: number; atLeastOne: number; guaranteed: boolean; impossible: boolean }[]; classOdds: { rows: { cls: string; label: string; scope: string; perCard: number; atLeastOne: number }[]; guarantee: string | null } | null; teamBoost: { team: string; copy: string } | null };
  stats: { costPerRarity: Record<string, number> } | null;
  pools: { pool_id: string; priority: number; enabled: boolean; entries: number }[];
  drawSource: { mode: "class-distribution" | "rarity-weights"; probability: string; eligibility: string; pools: { poolId: string; priority: number; role: "eligibility" | "boost" | "other" }[]; missingEligibilityPool: boolean };
  frozen: string;
}

/** F60 · un sobre del panel (`cms-…`) se edita con el gestor del CMS; los de código siguen con su ficha de solo lectura. */
export default function PackPage() {
  useLocale();
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  if (id.startsWith("cms-")) return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Contenido · Sobres del panel")} title={id} actions={<Link href="/admin/packs" className="text-[13px] text-drl-cyan">{t("← Sobres")}</Link>} />
      <CmsPackEditor id={id} />
    </div>
  );
  return <CodePackPage id={id} />;
}

function CodePackPage({ id }: { id: string }) {
  useLocale();
  const q = useAdminQuery<Detail>(`/api/admin/packs?id=${encodeURIComponent(id)}`);
  const [price, setPrice] = useState("");
  const [cards, setCards] = useState("");
  const [sim, setSim] = useState<{ before: Sim; after: Sim; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = q.data;
  const art = packArtwork(id);
  const simulate = async () => {
    setBusy(true); setErr(null);
    try { setSim(await adminPost("/api/admin/packs", { action: "simulate", packId: id, price: price || undefined, cardCount: cards || undefined, n: 3000 })); }
    catch (e) { setErr(e instanceof Error ? e.message : t("Error")); } finally { setBusy(false); }
  };
  const odds = d?.odds.classOdds ? d.odds.classOdds.rows.map((r) => ({ label: r.label, value: r.perCard * 100, sub: `≥1: ${pct(r.atLeastOne, 0)}` }))
    : (d?.odds.rows ?? []).filter((r) => !r.impossible).map((r) => ({ label: r.label, value: r.perCard * 100, sub: r.guaranteed ? t("garantía") : `≥1: ${pct(r.atLeastOne, 0)}` }));
  const cmp: [string, (s: Sim) => string][] = [[t("Precio"), (s) => fmt(s.price)], [t("Cartas"), (s) => String(s.cardCount)], ["EV", (s) => fmt(s.ev)], [t("EV/precio"), (s) => `${s.evOverPrice.toFixed(2)}×`], [t("Desguace EV"), (s) => fmt(s.salvageEV)], [t("Desguace/precio"), (s) => pct(s.salvageOverPrice)], [t("Prime por carta"), (s) => pct(s.primePct)], [t("Icon por carta"), (s) => pct(s.iconPct)], ["P50", (s) => fmt(s.p50)], ["P90", (s) => fmt(s.p90)], ["P99", (s) => fmt(s.p99)]];
  return (
    <>
      <PageHeader eyebrow={t("Sobre")} title={i18nTd(d?.pack.name) ?? id} description={d && <span className="flex flex-wrap gap-2"><Pill tone={d.pack.lifecycle === "ACTIVE" ? "ok" : "default"}>{i18nTd(d.pack.lifecycle)}</Pill>{d.pack.purchasable && <Pill tone="gold">{t("comprable")}</Pill>}{d.pack.tag && <Pill>{d.pack.tag}</Pill>}</span>}
        actions={<Link href="/admin/packs" className="nx-focus text-[13px] text-ink-muted hover:text-ink-primary">{t("← Sobres")}</Link>} />
      {q.error && <ErrorBox error={i18nTd(q.error)} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={6} />}
      {d && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
            <div className="grid place-items-center rounded-panel border border-white/[0.07] bg-gradient-to-b from-surface-elevated to-surface-raised p-4">{art ? <img src={art} alt={i18nTd(d.pack.name)} className="max-h-72 w-auto drop-shadow-[0_18px_30px_rgba(0,0,0,0.6)]" /> : <span className="text-ink-faint">{t("Sin arte")}</span>}</div>
            <Panel title={t("Configuración")} subtitle={i18nTd(d.frozen)}>
              <KV cols={3} items={[[t("Precio"), d.pack.price > 0 ? t("{n} créditos", { n: fmt(d.pack.price) }) : t("Gratis")], [t("Cartas"), d.pack.cardCount], [t("Sorteo"), d.classDistribution ? t("Por clase (F57.3)") : t("Por rareza")], [t("Garantía"), d.odds.classOdds?.guarantee ?? d.pack.guaranteedMin ?? "—"], [t("Región"), d.pack.restrictRegion ?? t("Global")], [t("Equipo"), d.pack.team ?? "—"], [t("Evento"), d.pack.eventId ?? "—"], [t("Descripción"), d.pack.description]]} />
            </Panel>
          </div>
          <Panel title={t("Cómo obtiene sus cartas")} subtitle={d.drawSource.mode === "class-distribution" ? t("Sobre de la línea principal · distribución por clase") : t("Sobre por rareza · pesos + pools")} tone={d.drawSource.missingEligibilityPool ? "danger" : "cyan"}>
            <ol className="grid gap-3 md:grid-cols-2">
              <li className="rounded-card border border-white/[0.07] bg-white/[0.02] px-3 py-2.5"><p className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-drl-cyan">{t("1 · Probabilidad")}</p><p className="mt-1 text-[13px] text-ink-secondary">{i18nTd(d.drawSource.probability)}</p></li>
              <li className="rounded-card border border-white/[0.07] bg-white/[0.02] px-3 py-2.5"><p className="font-display text-[11px] font-bold uppercase tracking-[0.14em] text-drl-cyan">{t("2 · Elegibilidad")}</p><p className="mt-1 text-[13px] text-ink-secondary">{i18nTd(d.drawSource.eligibility)}</p></li>
            </ol>
            <ul className="mt-3 flex flex-wrap gap-2">{d.pools.length ? d.pools.map((p) => { const role = d.drawSource.pools.find((x) => x.poolId === p.pool_id)?.role; return <li key={p.pool_id}><Link href={`/admin/pools/${encodeURIComponent(p.pool_id)}`} className="nx-focus"><Pill tone={role === "eligibility" ? "cyan" : role === "boost" ? "gold" : "default"}>{t("{pool} · {rol} · {n} cartas · prioridad {prioridad}", { pool: p.pool_id, rol: role === "eligibility" ? t("elegibilidad") : role === "boost" ? t("refuerzo de equipo") : t("pool"), n: p.entries, prioridad: p.priority })}</Pill></Link></li>; }) : <li><Pill tone="bad">{t("Sin pool vinculado")}</Pill></li>}</ul>
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title={t("Probabilidades por carta")} subtitle={d.classDistribution ? t("Tabla por clase F57.3 (fija)") : t("Rareza MEDIDA con el motor real (packStats)")}>
              <Bars label={t("Probabilidades")} data={odds} format={(n) => `${n.toLocaleString(getIntlLocale(), { maximumFractionDigits: 2 })} %`} accent="cyan" />
              {d.odds.teamBoost && <p className="mt-3 text-[12px] text-ink-muted">{i18nTd(d.odds.teamBoost.copy)}</p>}
            </Panel>
            <Panel title={t("Economía real")} subtitle={t("packStats (F57.6)")}>
              <KV cols={3} items={[["EV", fmt(d.row?.ev)], [t("EV/precio"), d.row?.evOverPrice != null ? `${d.row.evOverPrice.toFixed(2)}×` : "—"], [t("Desguace EV"), fmt(d.row?.salvageEV)], [t("Desguace/precio"), pct(d.row?.salvageOverPrice)], [t("Prime por carta"), pct(d.row?.primePct)], [t("Icon por carta"), pct(d.row?.iconPct)]]} />
              {d.stats && <p className="mt-4 text-[12px] text-ink-faint">{t("Coste medio por rareza:")} {Object.entries(d.stats.costPerRarity).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ")}</p>}
            </Panel>
          </div>
          <Panel title={t("Simulador «¿y si…?»")} subtitle={t("Solo lectura: nada se guarda. Mismas semillas antes/después; 3.000 aperturas.")} tone="cyan">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40"><Field label={t("Precio candidato")} htmlFor="sim-p" hint={t("actual {price}", { price: fmt(d.pack.price) })}><Input id="sim-p" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 6))} /></Field></div>
              <div className="w-40"><Field label={t("Nº de cartas")} htmlFor="sim-c" hint={t("actual {cardCount}", { cardCount: d.pack.cardCount })}><Input id="sim-c" inputMode="numeric" value={cards} onChange={(e) => setCards(e.target.value.replace(/\D/g, "").slice(0, 2))} /></Field></div>
              <Button variant="cyan" onClick={simulate} disabled={busy}>{busy ? t("Simulando…") : t("Simular")}</Button>
            </div>
            {err && <div className="mt-3"><ErrorBox error={i18nTd(err)} /></div>}
            {sim && (
              <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
                <table className="w-full text-[13px]"><caption className="sr-only">{t("Antes y después")}</caption>
                  <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint"><th className="py-1">{t("Métrica")}</th><th className="py-1 text-right">{t("Antes")}</th><th className="py-1 text-right">{t("Después")}</th></tr></thead>
                  <tbody>{cmp.map(([k, f]) => <tr key={k} className="border-t border-white/[0.06]"><td className="py-1.5 text-ink-muted">{i18nTd(k)}</td><td className="py-1.5 text-right tabular-nums">{f(sim.before)}</td><td className={`py-1.5 text-right tabular-nums ${f(sim.before) !== f(sim.after) ? "text-drl-cyan" : ""}`}>{f(sim.after)}</td></tr>)}</tbody>
                </table>
                <ul className="space-y-2">{sim.warnings.map((w) => <li key={w} className="flex gap-2 text-[13px]"><LevelBadge level={/NO válida/.test(w) ? "CRITICAL" : /congelada/.test(w) ? "INFO" : "WARNING"} /><span>{i18nTd(w)}</span></li>)}</ul>
              </div>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
