"use client";

/** F58 · /admin/teams — identidades de equipo (teamIdentities.ts) con jugadores, cartas y sobres de equipo reales. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, fmt } from "@/components/admin/cc/api";
import { PageHeader, Panel, SearchBox, DataTable, Loading, ErrorBox, Pill } from "@/components/admin/cc/ui";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { TeamIdentitiesPanel } from "@/components/admin/cms/TeamIdentitiesPanel";

const tr = ns("admin");

interface Row { id: string; name: string; tag: string; region: string; status: string; players: number; cards: number; packs: { id: string; name: string }[]; logo?: string | null; logoSource?: "cms" | "product" | null }

interface Collections { teams: number; cards: number; byRegion: Record<string, { teams: number; cards: number }>; unassigned: { id: string; title: string; cards: number; printed?: string | null }[]; teamless: string[]; withoutCards: string[]; withoutLogo: string[]; managed?: number; identitiesAvailable?: boolean }

export default function Teams() {
  useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const data = useAdminQuery<{ rows: Row[]; collections?: Collections | null }>("/api/admin/catalog?view=teams");
  const col = data.data?.collections ?? null;
  const t = q.trim().toLowerCase();
  const rows = (data.data?.rows ?? []).filter((r) => !t || r.name.toLowerCase().includes(t) || r.tag.toLowerCase().includes(t));
  return (
    <>
      <PageHeader eyebrow={tr("Contenido")} title={tr("Equipos")} description={tr("Las identidades de los equipos del catálogo diseñado viven en código (teamIdentities.ts) y se leen aquí; el equipo impreso de cada carta es histórico y no se reescribe. Los equipos nuevos que aparezcan al publicar cartas se dan de alta abajo, y el logo de cualquier equipo se sube desde su ficha.")} />
      {col && (
        <Panel title={tr("Colecciones de equipo")} subtitle={tr("Lo que ve el jugador en Colección → Colecciones: una colección por equipo con cartas publicadas, y una insignia por región. Sale del catálogo publicado; no hay lista fija.")}>
          <div className="flex flex-wrap gap-2" data-testid="team-collections-summary">
            <Pill tone="cyan">{tr("{teams} equipos · {cards} cartas", { teams: fmt(col.teams), cards: fmt(col.cards) })}</Pill>
            {Object.entries(col.byRegion).map(([r, v]) => <Pill key={r} tone={v.teams ? "ok" : "warn"}>{r}: {tr("{teams} equipos · {cards} cartas", { teams: fmt(v.teams), cards: fmt(v.cards) })}</Pill>)}
          </div>
          {col.unassigned.length > 0 && <p className="mt-3 text-[13px] text-amber-300" data-testid="teams-without-region">{tr("Equipos con cartas pero sin región (no se enseñan en Colecciones ni cuentan para ninguna insignia hasta darlos de alta):")} {col.unassigned.map((t) => `${t.title} (${t.cards})`).join(", ")}</p>}
          {col.teamless.length > 0 && <p className="mt-2 text-[13px] text-amber-300">{tr("Cartas publicadas sin equipo:")} {col.teamless.join(", ")}</p>}
          {Object.entries(col.byRegion).some(([, v]) => v.teams === 0) && <p className="mt-2 text-[13px] text-amber-300">{tr("Regiones sin equipos (su insignia no se puede conseguir):")} {Object.entries(col.byRegion).filter(([, v]) => v.teams === 0).map(([r]) => r).join(", ")}</p>}
          {col.withoutCards.length > 0 && <p className="mt-2 text-[13px] text-ink-faint">{tr("Equipos del registro sin cartas (no aparecen en Colecciones):")} {col.withoutCards.join(", ")}</p>}
          {col.withoutLogo.length > 0 && <p className="mt-2 text-[13px] text-ink-faint">{tr("Equipos sin logo (se pintan con su etiqueta):")} {col.withoutLogo.join(", ")}</p>}
        </Panel>
      )}
      <TeamIdentitiesPanel onChanged={data.reload} />
      <Panel>
        <div className="mb-4 flex"><SearchBox value={q} onChange={setQ} placeholder={tr("nombre o etiqueta…")} label={tr("Buscar equipos")} /></div>
        {data.error && <ErrorBox error={td(data.error)} onRetry={data.reload} />}
        {!data.data && !data.error && <Loading />}
        {data.data && (
          <DataTable caption={tr("Equipos")} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/teams/${r.id}`)} empty={tr("Ningún equipo")}
            cols={[
              { key: "l", label: tr("Logo"), render: (r) => r.logo
                ? <img src={r.logo} alt={tr("Logo de {equipo}", { equipo: r.name })} width={32} height={32} loading="lazy" className="h-8 w-8 rounded-[8px] border border-white/10 bg-white/[0.04] object-contain p-0.5" />
                : <span aria-hidden className="grid h-8 w-8 place-items-center rounded-[8px] border border-white/10 bg-white/[0.04] font-display text-[11px] font-black text-ink-primary">{r.tag.slice(0, 4)}</span> },
              { key: "n", label: tr("Equipo"), render: (r) => <span className="font-semibold text-ink-primary">{r.name}</span>, sort: (r) => r.name.toLowerCase() },
              { key: "r", label: tr("Región"), render: (r) => r.region, sort: (r) => r.region },
              { key: "p", label: tr("Jugadores"), align: "right", render: (r) => fmt(r.players), sort: (r) => r.players },
              { key: "c", label: tr("Cartas"), align: "right", render: (r) => fmt(r.cards), sort: (r) => r.cards },
              { key: "k", label: tr("Sobres"), render: (r) => r.packs.length ? r.packs.map((p) => <Pill key={p.id} tone="cyan">{td(p.name)}</Pill>) : <span className="text-ink-faint">—</span> },
              { key: "s", label: tr("Identidad"), render: (r) => <Pill tone={r.status === "verified" ? "ok" : "warn"}>{r.status === "verified" ? tr("verificada") : tr("sin verificar")}</Pill> },
              { key: "d", label: tr("Datos"), render: (r) => {
                const gaps = [!r.logo && tr("sin logo"), r.cards === 0 && tr("sin cartas")].filter(Boolean) as string[];
                return gaps.length ? <span className="flex flex-wrap gap-1">{gaps.map((g) => <Pill key={g} tone="warn">{g}</Pill>)}</span> : <Pill tone="ok">{tr("completos")}</Pill>;
              } },
            ]} />
        )}
      </Panel>
    </>
  );
}
