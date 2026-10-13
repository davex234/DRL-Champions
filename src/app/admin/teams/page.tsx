"use client";

/** F58 · /admin/teams — identidades de equipo (teamIdentities.ts) con jugadores, cartas y sobres de equipo reales. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, fmt } from "@/components/admin/cc/api";
import { PageHeader, Panel, SearchBox, DataTable, Loading, ErrorBox, Pill } from "@/components/admin/cc/ui";

interface Row { id: string; name: string; tag: string; region: string; status: string; players: number; cards: number; packs: { id: string; name: string }[] }

export default function Teams() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const data = useAdminQuery<{ rows: Row[] }>("/api/admin/catalog?view=teams");
  const t = q.trim().toLowerCase();
  const rows = (data.data?.rows ?? []).filter((r) => !t || r.name.toLowerCase().includes(t) || r.tag.toLowerCase().includes(t));
  return (
    <>
      <PageHeader eyebrow="Contenido" title="Equipos" description="Las identidades de equipo viven en código (teamIdentities.ts) y se leen aquí. No hay escritura de equipos desde el panel: el equipo impreso de cada carta es histórico y no debe reescribirse en silencio." />
      <Panel>
        <div className="mb-4 flex"><SearchBox value={q} onChange={setQ} placeholder="nombre o etiqueta…" label="Buscar equipos" /></div>
        {data.error && <ErrorBox error={data.error} onRetry={data.reload} />}
        {!data.data && !data.error && <Loading />}
        {data.data && (
          <DataTable caption="Equipos" rows={rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/teams/${r.id}`)} empty="Ningún equipo"
            cols={[
              { key: "l", label: "", render: (r) => <span aria-hidden className="grid h-8 w-8 place-items-center rounded-[8px] border border-white/10 bg-white/[0.04] font-display text-[11px] font-black text-ink-primary">{r.tag.slice(0, 4)}</span> },
              { key: "n", label: "Equipo", render: (r) => <span className="font-semibold text-ink-primary">{r.name}</span>, sort: (r) => r.name.toLowerCase() },
              { key: "r", label: "Región", render: (r) => r.region, sort: (r) => r.region },
              { key: "p", label: "Jugadores", align: "right", render: (r) => fmt(r.players), sort: (r) => r.players },
              { key: "c", label: "Cartas", align: "right", render: (r) => fmt(r.cards), sort: (r) => r.cards },
              { key: "k", label: "Sobres", render: (r) => r.packs.length ? r.packs.map((p) => <Pill key={p.id} tone="cyan">{p.name}</Pill>) : <span className="text-ink-faint">—</span> },
              { key: "s", label: "Identidad", render: (r) => <Pill tone={r.status === "verified" ? "ok" : "warn"}>{r.status === "verified" ? "verificada" : "sin verificar"}</Pill> },
            ]} />
        )}
      </Panel>
    </>
  );
}
