"use client";

/**
 * F58 · /admin/economy — OBSERVABILIDAD. F57.6 está cerrada: aquí no hay deslizadores de valor, desguace ni
 * probabilidades. Salud (checks reales), banda de la línea principal, valor por clase, fuentes/sumideros del libro
 * mayor, sobres más abiertos y créditos en circulación.
 */
import { useState } from "react";
import Link from "next/link";
import { useAdminQuery, fmt, pct } from "@/components/admin/cc/api";
import { PageHeader, Panel, LevelBadge, Loading, ErrorBox, Stat, DataTable, Bars, Tabs, type Level } from "@/components/admin/cc/ui";
import { PACK_CLASS_LABEL, type PackCardClass } from "@/domain/packs/packClass";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface Eco {
  band: { median: number; lo: number; hi: number };
  health: { id: string; label: string; level: Level; detail: string }[];
  packs: { id: string; name: string; lifecycle: string; price: number; evOverPrice: number | null; salvageOverPrice: number | null; kind: string }[];
  byClass: { cls: PackCardClass; cards: number; valueMin: number; valueMedian: number; valueMean: number; valueMax: number; salvageMedian: number; salvageMean: number }[];
  ledger7d: { bucket: string; entries: number; credits_in: number; credits_out: number }[];
  ledger30d: { bucket: string; entries: number; credits_in: number; credits_out: number }[];
  mostOpened: { packId: string; name: string; opens: number }[];
  openSample: number;
  credits: number | null;
}

export default function Economy() {
  useLocale();
  const q = useAdminQuery<Eco>("/api/admin/packs?view=economy");
  const [win, setWin] = useState<"7" | "30">("7");
  const d = q.data;
  const ledger = win === "7" ? d?.ledger7d ?? [] : d?.ledger30d ?? [];
  const sources = ledger.reduce((a, r) => a + Number(r.credits_in), 0), sinks = ledger.reduce((a, r) => a + Number(r.credits_out), 0);
  const overall: Level = d ? (d.health.some((h) => h.level === "CRITICAL") ? "CRITICAL" : d.health.some((h) => h.level === "WARNING") ? "WARNING" : "HEALTHY") : "INFO";
  return (
    <>
      <PageHeader eyebrow={t("Juego")} title={t("Economía")} description={t("Solo observación: las reglas (marketValue, desguace, probabilidades, precios) son canónicas y están congeladas por F57.6.")} />
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={8} />}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={t("Salud económica")} value={<LevelBadge level={overall} label={overall === "HEALTHY" ? t("Sana") : overall === "WARNING" ? t("Avisos") : t("Crítica")} />} hint={t("{length} comprobaciones", { length: d.health.length })} />
            <Stat label={t("Créditos en circulación")} value={fmt(d.credits)} accent="gold" />
            <Stat label={t("Entradas {win} d", { win })} value={fmt(sources)} accent="ok" hint={t("créditos creados (libro mayor)")} />
            <Stat label={t("Salidas {win} d", { win })} value={fmt(sinks)} accent="bad" hint={t("créditos gastados")} />
          </div>
          <Panel title={t("Comprobaciones")} subtitle={t("Calculadas con packStats, el catálogo y las tablas F57.3")}>
            <ul className="grid gap-2 md:grid-cols-2">{d.health.map((h) => <li key={h.id} className="flex items-start gap-3 rounded-card border border-white/[0.07] px-3 py-2.5"><LevelBadge level={h.level} /><span><span className="block text-[14px] text-ink-primary">{td(h.label)}</span><span className="text-[12px] text-ink-muted">{td(h.detail)}</span></span></li>)}</ul>
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title={t("Valor por clase")} subtitle={t("marketValue y desguace (F57.5B)")}>
              <DataTable caption={t("Valor por clase")} rows={d.byClass} rowKey={(r) => r.cls}
                cols={[
                  { key: "c", label: t("Clase"), render: (r) => <b className="text-ink-primary">{td(PACK_CLASS_LABEL[r.cls])}</b> },
                  { key: "n", label: t("Cartas"), align: "right", render: (r) => r.cards },
                  { key: "m", label: t("Mediana"), align: "right", render: (r) => fmt(r.valueMedian) },
                  { key: "a", label: t("Media"), align: "right", render: (r) => fmt(r.valueMean) },
                  { key: "r", label: t("Rango"), align: "right", render: (r) => `${fmt(r.valueMin)}–${fmt(r.valueMax)}` },
                  { key: "s", label: t("Desguace med."), align: "right", render: (r) => fmt(r.salvageMedian) },
                ]} />
            </Panel>
            <Panel title={t("Sobres más abiertos")} subtitle={t("Últimas {openSample} aperturas (economy_ops)", { openSample: fmt(d.openSample) })}>
              <Bars label={t("Aperturas por sobre")} data={d.mostOpened.slice(0, 10).map((p) => ({ label: p.name, value: p.opens }))} accent="gold" />
            </Panel>
          </div>
          <Panel title={t("Fuentes y sumideros")} subtitle={t("credit_transactions agrupado por motivo")} actions={<Tabs label={t("Ventana")} value={win} onChange={setWin} items={[{ id: "7", label: t("7 días") }, { id: "30", label: t("30 días") }]} />}>
            <DataTable caption={t("Libro mayor por motivo")} rows={ledger} rowKey={(r) => r.bucket} empty={t("Sin movimientos en la ventana")} initialSort={{ key: "i", dir: "desc" }}
              cols={[
                { key: "b", label: t("Motivo"), render: (r) => <span className="text-ink-primary">{td(r.bucket)}</span> },
                { key: "e", label: t("Asientos"), align: "right", render: (r) => fmt(Number(r.entries)), sort: (r) => Number(r.entries) },
                { key: "i", label: t("Entradas"), align: "right", render: (r) => <span className="text-ok">{fmt(Number(r.credits_in))}</span>, sort: (r) => Number(r.credits_in) },
                { key: "o", label: t("Salidas"), align: "right", render: (r) => <span className="text-bad">{fmt(Number(r.credits_out))}</span>, sort: (r) => Number(r.credits_out) },
              ]} />
          </Panel>
          <Panel title={t("Economía por sobre")} subtitle={t("Banda de la línea principal: {lo}–{hi}× (mediana {median}×)", { lo: d.band.lo.toFixed(2), hi: d.band.hi.toFixed(2), median: d.band.median.toFixed(2) })} actions={<Link href="/admin/packs" className="nx-focus text-[12px] text-drl-cyan hover:underline">{t("Ver sobres →")}</Link>}>
            <Bars label={t("Valor por crédito de los sobres a la venta")} data={d.packs.filter((p) => p.lifecycle === "ACTIVE" && p.evOverPrice != null).map((p) => ({ label: p.name, value: p.evOverPrice!, sub: `· desguace ${pct(p.salvageOverPrice, 0)}` }))} format={(n) => `${n.toFixed(2)}×`} accent="drl" />
          </Panel>
        </div>
      )}
    </>
  );
}
