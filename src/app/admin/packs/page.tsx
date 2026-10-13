"use client";

/**
 * F58 · /admin/packs — todos los sobres con su economía REAL (`PACK_STATS`, motor real, F57.6): precio, cartas, estado,
 * tipo, EV, EV/precio, desguace EV, % Prime y % Icon por carta. La economía está congelada: aquí se observa.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, fmt, pct } from "@/components/admin/cc/api";
import { PageHeader, Panel, Tabs, DataTable, Loading, ErrorBox, Pill, LinkButton } from "@/components/admin/cc/ui";
import { CmsPacksPanel } from "@/components/admin/cms/PackCms";
import { packArtwork } from "@/data/packArtwork";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface Row { id: string; name: string; lifecycle: string; kind: string; price: number; cardCount: number; ev: number | null; evOverPrice: number | null; salvageEV: number | null; salvageOverPrice: number | null; primePct: number | null; iconPct: number | null; drawMode: string; team: string | null; region: string | null; p90: number | null; p95: number | null; poolSize: number; featuredSlot: boolean; targeting: string; gate: { code: string; message: string }[] }

export default function Packs() {
  useLocale();
  const router = useRouter();
  const q = useAdminQuery<{ rows: Row[] }>("/api/admin/packs");
  const [tab, setTab] = useState("ACTIVE");
  const rows = (q.data?.rows ?? []).filter((r) => tab === "ALL" || r.lifecycle === tab);
  return (
    <>
      <PageHeader eyebrow={t("Contenido")} title={t("Sobres")} description={t("Los sobres de código muestran su economía real (20.000 aperturas, packStats) y siguen congelados (F57.3–F57.6): aquí se observan y se simulan. Los sobres nuevos se crean desde el panel heredando la economía de uno existente.")}
        actions={<LinkButton href="/admin/packs/new" variant="primary">{t("+ Nuevo sobre")}</LinkButton>} />
      <CmsPacksPanel />
      <Panel title={t("Sobres de código")} actions={<Tabs label={t("Estado")} value={tab} onChange={setTab} items={[{ id: "ACTIVE", label: t("A la venta") }, { id: "RETIRED", label: t("Retirados") }, { id: "DRAFT", label: t("Borradores") }, { id: "ALL", label: t("Todos") }]} />}>
        {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
        {!q.data && !q.error && <Loading />}
        {q.data && (
          <DataTable caption={t("Sobres")} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/packs/${r.id}`)} initialSort={{ key: "p", dir: "asc" }}
            cols={[
              { key: "a", label: "", render: (r) => { const src = packArtwork(r.id); return src ? <img src={src} alt="" className="h-12 w-auto" loading="lazy" /> : <span className="text-ink-faint">—</span>; } },
              { key: "n", label: t("Sobre"), render: (r) => <span><span className="font-semibold text-ink-primary">{r.name}</span><span className="block text-[11px] text-ink-faint">{t("{tipo}{region} · sorteo por {modo}", { tipo: td(r.kind), region: r.region ? ` · ${r.region}` : "", modo: td(r.drawMode) })}</span></span>, sort: (r) => r.name },
              { key: "s", label: t("Estado"), render: (r) => <Pill tone={r.lifecycle === "ACTIVE" ? "ok" : r.lifecycle === "DRAFT" ? "gold" : "default"}>{td(r.lifecycle)}</Pill> },
              { key: "p", label: t("Precio"), align: "right", render: (r) => (r.price > 0 ? fmt(r.price) : t("Gratis")), sort: (r) => r.price },
              { key: "c", label: t("Cartas"), align: "right", render: (r) => r.cardCount },
              { key: "e", label: "EV", align: "right", render: (r) => fmt(r.ev), sort: (r) => r.ev ?? 0 },
              { key: "r", label: "EV/precio", align: "right", render: (r) => (r.evOverPrice == null ? "—" : `${r.evOverPrice.toFixed(2)}×`), sort: (r) => r.evOverPrice ?? 0 },
              { key: "sv", label: t("Desguace/precio"), align: "right", render: (r) => <span className={r.salvageOverPrice != null && r.salvageOverPrice >= 0.7 ? "text-bad" : ""}>{pct(r.salvageOverPrice)}</span>, sort: (r) => r.salvageOverPrice ?? 0 },
              { key: "pr", label: t("Prime"), align: "right", render: (r) => pct(r.primePct), sort: (r) => r.primePct ?? 0 },
              { key: "ic", label: t("Icon"), align: "right", render: (r) => pct(r.iconPct), sort: (r) => r.iconPct ?? 0 },
              { key: "p9", label: t("Mejor ≥90"), align: "right", render: (r) => pct(r.p90), sort: (r) => r.p90 ?? 0 },
              { key: "p5", label: t("Mejor ≥95"), align: "right", render: (r) => pct(r.p95), sort: (r) => r.p95 ?? 0 },
              { key: "pl", label: t("Pool"), align: "right", render: (r) => <span title={r.featuredSlot ? t("Targeting: {targeting} · con carta destacada", { targeting: td(r.targeting) }) : t("Targeting: {targeting}", { targeting: td(r.targeting) })}>{r.poolSize}</span>, sort: (r) => r.poolSize },
              { key: "g", label: t("Compuerta"), render: (r) => (r.gate.length ? <span title={r.gate.map((g) => g.message).join(" · ")}><Pill tone="bad">{r.gate.map((g) => g.code).join(", ")}</Pill></span> : <span className="text-ink-faint">{t("OK")}</span>) },
            ]} />
        )}
      </Panel>
    </>
  );
}
