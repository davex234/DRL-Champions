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
  const q = useAdminQuery<Eco>("/api/admin/packs?view=economy");
  const [win, setWin] = useState<"7" | "30">("7");
  const d = q.data;
  const ledger = win === "7" ? d?.ledger7d ?? [] : d?.ledger30d ?? [];
  const sources = ledger.reduce((a, r) => a + Number(r.credits_in), 0), sinks = ledger.reduce((a, r) => a + Number(r.credits_out), 0);
  const overall: Level = d ? (d.health.some((h) => h.level === "CRITICAL") ? "CRITICAL" : d.health.some((h) => h.level === "WARNING") ? "WARNING" : "HEALTHY") : "INFO";
  return (
    <>
      <PageHeader eyebrow="Juego" title="Economía" description="Solo observación: las reglas (marketValue, desguace, probabilidades, precios) son canónicas y están congeladas por F57.6." />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={8} />}
      {d && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Salud económica" value={<LevelBadge level={overall} label={overall === "HEALTHY" ? "Sana" : overall === "WARNING" ? "Avisos" : "Crítica"} />} hint={`${d.health.length} comprobaciones`} />
            <Stat label="Créditos en circulación" value={fmt(d.credits)} accent="gold" />
            <Stat label={`Entradas ${win} d`} value={fmt(sources)} accent="ok" hint="créditos creados (libro mayor)" />
            <Stat label={`Salidas ${win} d`} value={fmt(sinks)} accent="bad" hint="créditos gastados" />
          </div>
          <Panel title="Comprobaciones" subtitle="Calculadas con packStats, el catálogo y las tablas F57.3">
            <ul className="grid gap-2 md:grid-cols-2">{d.health.map((h) => <li key={h.id} className="flex items-start gap-3 rounded-card border border-white/[0.07] px-3 py-2.5"><LevelBadge level={h.level} /><span><span className="block text-[14px] text-ink-primary">{h.label}</span><span className="text-[12px] text-ink-muted">{h.detail}</span></span></li>)}</ul>
          </Panel>
          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Valor por clase" subtitle="marketValue y desguace (F57.5B)">
              <DataTable caption="Valor por clase" rows={d.byClass} rowKey={(r) => r.cls}
                cols={[
                  { key: "c", label: "Clase", render: (r) => <b className="text-ink-primary">{PACK_CLASS_LABEL[r.cls]}</b> },
                  { key: "n", label: "Cartas", align: "right", render: (r) => r.cards },
                  { key: "m", label: "Mediana", align: "right", render: (r) => fmt(r.valueMedian) },
                  { key: "a", label: "Media", align: "right", render: (r) => fmt(r.valueMean) },
                  { key: "r", label: "Rango", align: "right", render: (r) => `${fmt(r.valueMin)}–${fmt(r.valueMax)}` },
                  { key: "s", label: "Desguace med.", align: "right", render: (r) => fmt(r.salvageMedian) },
                ]} />
            </Panel>
            <Panel title="Sobres más abiertos" subtitle={`Últimas ${fmt(d.openSample)} aperturas (economy_ops)`}>
              <Bars label="Aperturas por sobre" data={d.mostOpened.slice(0, 10).map((p) => ({ label: p.name, value: p.opens }))} accent="gold" />
            </Panel>
          </div>
          <Panel title="Fuentes y sumideros" subtitle="credit_transactions agrupado por motivo" actions={<Tabs label="Ventana" value={win} onChange={setWin} items={[{ id: "7", label: "7 días" }, { id: "30", label: "30 días" }]} />}>
            <DataTable caption="Libro mayor por motivo" rows={ledger} rowKey={(r) => r.bucket} empty="Sin movimientos en la ventana" initialSort={{ key: "i", dir: "desc" }}
              cols={[
                { key: "b", label: "Motivo", render: (r) => <span className="text-ink-primary">{r.bucket}</span> },
                { key: "e", label: "Asientos", align: "right", render: (r) => fmt(Number(r.entries)), sort: (r) => Number(r.entries) },
                { key: "i", label: "Entradas", align: "right", render: (r) => <span className="text-ok">{fmt(Number(r.credits_in))}</span>, sort: (r) => Number(r.credits_in) },
                { key: "o", label: "Salidas", align: "right", render: (r) => <span className="text-bad">{fmt(Number(r.credits_out))}</span>, sort: (r) => Number(r.credits_out) },
              ]} />
          </Panel>
          <Panel title="Economía por sobre" subtitle={`Banda de la línea principal: ${d.band.lo.toFixed(2)}–${d.band.hi.toFixed(2)}× (mediana ${d.band.median.toFixed(2)}×)`} actions={<Link href="/admin/packs" className="nx-focus text-[12px] text-drl-cyan hover:underline">Ver sobres →</Link>}>
            <Bars label="Valor por crédito de los sobres a la venta" data={d.packs.filter((p) => p.lifecycle === "ACTIVE" && p.evOverPrice != null).map((p) => ({ label: p.name, value: p.evOverPrice!, sub: `· desguace ${pct(p.salvageOverPrice, 0)}` }))} format={(n) => `${n.toFixed(2)}×`} accent="drl" />
          </Panel>
        </div>
      )}
    </>
  );
}
