"use client";

/** F58 · /admin/players/[id] — ficha del jugador: datos del catálogo, equipo canónico y sus cartas (arte real). */
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAdminQuery, fmt, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, KV, Pill, Loading, ErrorBox, DataTable, LinkButton } from "@/components/admin/cc/ui";
import { CardThumb } from "@/components/cards/CardThumb";
import { PlayerEditPanel } from "@/components/admin/cms/PlayerCms";
import { getCard } from "@/data/catalog";
import { PACK_CLASS_LABEL, type PackCardClass } from "@/domain/packs/packClass";

interface Detail {
  player: { id: string; nick: string; full_name: string | null; team: string | null; team_tag: string | null; region: string | null; role: string | null; country: string | null; status: string | null; origin: string | null; created_at: string | null; updated_at: string | null; stats: Record<string, number> | null; accolades: string[] | null };
  team: { key: string; label: string; canonicalId: string | null };
  cards: { card_id: string; variant_id: string; ovr: number; lifecycle: string; packClass: PackCardClass | null; marketValue: number | null; printedTeam: string | null }[];
}

export default function PlayerPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const router = useRouter();
  const q = useAdminQuery<Detail>(`/api/admin/catalog?view=player&id=${encodeURIComponent(id)}`);
  const p = q.data?.player;
  return (
    <>
      <PageHeader eyebrow="Jugador" title={p?.nick ?? id} description={p?.full_name ?? undefined}
        actions={<><Link href="/admin/players" className="nx-focus text-[13px] text-ink-muted hover:text-ink-primary">← Jugadores</Link><LinkButton href="/admin/cards/new" variant="primary">+ Carta</LinkButton></>} />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {!q.data && !q.error && <Loading rows={6} />}
      {q.data && p && (
        <div className="space-y-6">
          <Panel title="Datos">
            <KV cols={3} items={[
              ["Equipo actual", q.data.team.canonicalId ? <Link className="text-drl-cyan hover:underline" href={`/admin/teams/${q.data.team.canonicalId}`}>{q.data.team.label}</Link> : (p.team ?? "—")],
              ["Etiqueta", p.team_tag], ["Región", p.region], ["Rol", p.role], ["País", p.country], ["Estado", p.status], ["Origen", p.origin],
              ["Alta", dateTime(p.created_at)], ["Última edición", dateTime(p.updated_at)],
              ["Galardones", p.accolades?.length ? p.accolades.join(", ") : "—"],
            ]} />
            {p.stats && <div className="mt-4 flex flex-wrap gap-2">{Object.entries(p.stats).slice(0, 12).map(([k, v]) => <Pill key={k}>{k}: {typeof v === "number" ? fmt(v, 2) : String(v)}</Pill>)}</div>}
          </Panel>
          <PlayerEditPanel key={p.updated_at ?? ""} id={id} player={p} onSaved={q.reload} />
          <Panel title={`Cartas (${q.data.cards.length})`} subtitle="El equipo IMPRESO en cada carta es histórico: cambiar el equipo del jugador no reescribe cartas existentes.">
            <DataTable caption="Cartas del jugador" rows={q.data.cards} rowKey={(r) => r.card_id} onRowClick={(r) => router.push(`/admin/cards/${encodeURIComponent(r.card_id)}`)} empty="Sin cartas"
              cols={[
                { key: "a", label: "Arte", render: (r) => { const d = getCard(r.card_id); return d ? <CardThumb card={d} width={44} /> : "—"; } },
                { key: "e", label: "Edición", render: (r) => r.variant_id },
                { key: "k", label: "Clase", render: (r) => r.packClass ? <Pill>{PACK_CLASS_LABEL[r.packClass]}</Pill> : "—" },
                { key: "o", label: "OVR", align: "right", render: (r) => <b className="text-ink-primary">{r.ovr}</b>, sort: (r) => r.ovr },
                { key: "t", label: "Equipo impreso", render: (r) => r.printedTeam ?? "—" },
                { key: "s", label: "Estado", render: (r) => <Pill tone={r.lifecycle === "PUBLISHED" ? "ok" : "gold"}>{r.lifecycle}</Pill> },
                { key: "v", label: "Valor", align: "right", render: (r) => fmt(r.marketValue), sort: (r) => r.marketValue ?? 0 },
              ]} />
          </Panel>
        </div>
      )}
    </>
  );
}
