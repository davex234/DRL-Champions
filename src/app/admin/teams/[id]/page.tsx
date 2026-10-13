"use client";

/** F58 · /admin/teams/[id] — ficha del equipo: identidad, alias actuales/históricos, plantilla, cartas y sobres. */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAdminQuery, fmt } from "@/components/admin/cc/api";
import { PageHeader, Panel, KV, Pill, Loading, ErrorBox, DataTable } from "@/components/admin/cc/ui";
import { CardThumb } from "@/components/cards/CardThumb";
import { getCard } from "@/data/catalog";
import { PACK_CLASS_LABEL, type PackCardClass } from "@/domain/packs/packClass";

interface Detail {
  team: { id: string; name: string; tag: string; region: string; status: string; unverifiedReason: string | null; currentAliases: string[]; historicalAliases: string[] };
  players: { id: string; nick: string; team: string; role: string | null; region: string | null; current: boolean }[];
  cards: { id: string; playerId: string; variantId: string; ovr: number; printedTeam: string | null; packClass: PackCardClass | null; marketValue: number }[];
  packs: { id: string; name: string; price: number }[];
  note: string;
}

export default function TeamPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const router = useRouter();
  const q = useAdminQuery<Detail>(`/api/admin/catalog?view=team&id=${encodeURIComponent(id)}`);
  const d = q.data;
  return (
    <>
      <PageHeader eyebrow="Equipo" title={d?.team.name ?? id} description={d ? <span className="flex gap-2"><Pill>{d.team.tag}</Pill><Pill tone="cyan">{d.team.region}</Pill><Pill tone={d.team.status === "verified" ? "ok" : "warn"}>{d.team.status}</Pill></span> : null}
        actions={<Link href="/admin/teams" className="nx-focus text-[13px] text-ink-muted hover:text-ink-primary">← Equipos</Link>} />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!d && !q.error && <Loading rows={6} />}
      {d && (
        <div className="space-y-6">
          <Panel title="Identidad" subtitle="Solo lectura">
            <KV items={[["Alias actuales", d.team.currentAliases.join(", ") || "—"], ["Alias históricos", d.team.historicalAliases.join(", ") || "—"], ["Motivo sin verificar", d.team.unverifiedReason], ["Sobres del equipo", d.packs.length ? d.packs.map((p) => `${p.name} (${fmt(p.price)} cr)`).join(" · ") : "—"]]} />
            <p className="mt-4 text-[12px] text-ink-faint">{d.note}</p>
          </Panel>
          <Panel title={`Plantilla (${d.players.length})`}>
            <DataTable caption="Jugadores del equipo" rows={d.players} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/players/${encodeURIComponent(r.id)}`)} empty="Sin jugadores"
              cols={[{ key: "n", label: "Jugador", render: (r) => <b className="text-ink-primary">{r.nick}</b> }, { key: "r", label: "Rol", render: (r) => r.role ?? "—" }, { key: "t", label: "Alias", render: (r) => r.team }, { key: "c", label: "Roster", render: (r) => <Pill tone={r.current ? "ok" : "default"}>{r.current ? "actual" : "histórico"}</Pill> }]} />
          </Panel>
          <Panel title={`Cartas (${d.cards.length})`}>
            <DataTable caption="Cartas del equipo" rows={d.cards} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/cartas/${encodeURIComponent(r.id)}`)} empty="Sin cartas" initialSort={{ key: "o", dir: "desc" }}
              cols={[
                { key: "a", label: "Arte", render: (r) => { const c = getCard(r.id); return c ? <CardThumb card={c} width={40} /> : "—"; } },
                { key: "i", label: "Carta", render: (r) => <span className="text-ink-primary">{r.id}</span> },
                { key: "k", label: "Clase", render: (r) => r.packClass ? PACK_CLASS_LABEL[r.packClass] : "—" },
                { key: "o", label: "OVR", align: "right", render: (r) => r.ovr, sort: (r) => r.ovr },
                { key: "p", label: "Equipo impreso", render: (r) => r.printedTeam ?? "—" },
                { key: "v", label: "Valor", align: "right", render: (r) => fmt(r.marketValue), sort: (r) => r.marketValue },
              ]} />
          </Panel>
        </div>
      )}
    </>
  );
}
