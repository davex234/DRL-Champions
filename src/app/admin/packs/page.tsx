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

interface Row { id: string; name: string; lifecycle: string; kind: string; price: number; cardCount: number; ev: number | null; evOverPrice: number | null; salvageEV: number | null; salvageOverPrice: number | null; primePct: number | null; iconPct: number | null; drawMode: string; team: string | null; region: string | null; p90: number | null; p95: number | null; poolSize: number; featuredSlot: boolean; targeting: string; gate: { code: string; message: string }[] }

export default function Packs() {
  const router = useRouter();
  const q = useAdminQuery<{ rows: Row[] }>("/api/admin/packs");
  const [tab, setTab] = useState("ACTIVE");
  const rows = (q.data?.rows ?? []).filter((r) => tab === "ALL" || r.lifecycle === tab);
  return (
    <>
      <PageHeader eyebrow="Contenido" title="Sobres" description="Los sobres de código muestran su economía real (20.000 aperturas, packStats) y siguen congelados (F57.3–F57.6): aquí se observan y se simulan. Los sobres nuevos se crean desde el panel heredando la economía de uno existente."
        actions={<LinkButton href="/admin/packs/new" variant="primary">+ Nuevo sobre</LinkButton>} />
      <CmsPacksPanel />
      <Panel title="Sobres de código" actions={<Tabs label="Estado" value={tab} onChange={setTab} items={[{ id: "ACTIVE", label: "A la venta" }, { id: "RETIRED", label: "Retirados" }, { id: "DRAFT", label: "Borradores" }, { id: "ALL", label: "Todos" }]} />}>
        {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
        {!q.data && !q.error && <Loading />}
        {q.data && (
          <DataTable caption="Sobres" rows={rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/packs/${r.id}`)} initialSort={{ key: "p", dir: "asc" }}
            cols={[
              { key: "a", label: "", render: (r) => { const src = packArtwork(r.id); return src ? <img src={src} alt="" className="h-12 w-auto" loading="lazy" /> : <span className="text-ink-faint">—</span>; } },
              { key: "n", label: "Sobre", render: (r) => <span><span className="font-semibold text-ink-primary">{r.name}</span><span className="block text-[11px] text-ink-faint">{r.kind}{r.region ? ` · ${r.region}` : ""} · sorteo por {r.drawMode}</span></span>, sort: (r) => r.name },
              { key: "s", label: "Estado", render: (r) => <Pill tone={r.lifecycle === "ACTIVE" ? "ok" : r.lifecycle === "DRAFT" ? "gold" : "default"}>{r.lifecycle}</Pill> },
              { key: "p", label: "Precio", align: "right", render: (r) => (r.price > 0 ? fmt(r.price) : "Gratis"), sort: (r) => r.price },
              { key: "c", label: "Cartas", align: "right", render: (r) => r.cardCount },
              { key: "e", label: "EV", align: "right", render: (r) => fmt(r.ev), sort: (r) => r.ev ?? 0 },
              { key: "r", label: "EV/precio", align: "right", render: (r) => (r.evOverPrice == null ? "—" : `${r.evOverPrice.toFixed(2)}×`), sort: (r) => r.evOverPrice ?? 0 },
              { key: "sv", label: "Desguace/precio", align: "right", render: (r) => <span className={r.salvageOverPrice != null && r.salvageOverPrice >= 0.7 ? "text-bad" : ""}>{pct(r.salvageOverPrice)}</span>, sort: (r) => r.salvageOverPrice ?? 0 },
              { key: "pr", label: "Prime", align: "right", render: (r) => pct(r.primePct), sort: (r) => r.primePct ?? 0 },
              { key: "ic", label: "Icon", align: "right", render: (r) => pct(r.iconPct), sort: (r) => r.iconPct ?? 0 },
              { key: "p9", label: "Mejor ≥90", align: "right", render: (r) => pct(r.p90), sort: (r) => r.p90 ?? 0 },
              { key: "p5", label: "Mejor ≥95", align: "right", render: (r) => pct(r.p95), sort: (r) => r.p95 ?? 0 },
              { key: "pl", label: "Pool", align: "right", render: (r) => <span title={`Targeting: ${r.targeting}${r.featuredSlot ? " · con carta destacada" : ""}`}>{r.poolSize}</span>, sort: (r) => r.poolSize },
              { key: "g", label: "Compuerta", render: (r) => (r.gate.length ? <span title={r.gate.map((g) => g.message).join(" · ")}><Pill tone="bad">{r.gate.map((g) => g.code).join(", ")}</Pill></span> : <span className="text-ink-faint">OK</span>) },
            ]} />
        )}
      </Panel>
    </>
  );
}
