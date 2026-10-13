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
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface Detail {
  player: { id: string; nick: string; full_name: string | null; team: string | null; team_tag: string | null; region: string | null; role: string | null; country: string | null; status: string | null; origin: string | null; created_at: string | null; updated_at: string | null; stats: Record<string, number> | null; accolades: string[] | null };
  team: { key: string; label: string; canonicalId: string | null };
  cards: { card_id: string; variant_id: string; ovr: number; lifecycle: string; packClass: PackCardClass | null; marketValue: number | null; printedTeam: string | null }[];
}

export default function PlayerPage() {
  useLocale();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params?.id ?? ""));
  const router = useRouter();
  const q = useAdminQuery<Detail>(`/api/admin/catalog?view=player&id=${encodeURIComponent(id)}`);
  const p = q.data?.player;
  return (
    <>
      <PageHeader eyebrow={t("Jugador")} title={p?.nick ?? id} description={td(p?.full_name) ?? undefined}
        actions={<><Link href="/admin/players" className="nx-focus text-[13px] text-ink-muted hover:text-ink-primary">{t("← Jugadores")}</Link><LinkButton href="/admin/cards/new" variant="primary">{t("+ Carta")}</LinkButton></>} />
      {q.error && <ErrorBox error={td(q.error)} onRetry={q.reload} />}
      {!q.data && !q.error && <Loading rows={6} />}
      {q.data && p && (
        <div className="space-y-6">
          <Panel title={t("Datos")}>
            <KV cols={3} items={[
              [t("Equipo actual"), q.data.team.canonicalId ? <Link className="text-drl-cyan hover:underline" href={`/admin/teams/${q.data.team.canonicalId}`}>{td(q.data.team.label)}</Link> : (p.team ?? "—")],
              [t("Etiqueta"), p.team_tag], [t("Región"), p.region], [t("Rol"), p.role], [t("País"), p.country], [t("Estado"), p.status], [t("Origen"), p.origin],
              [t("Alta"), dateTime(p.created_at)], [t("Última edición"), dateTime(p.updated_at)],
              [t("Galardones"), p.accolades?.length ? p.accolades.join(", ") : "—"],
            ]} />
            {p.stats && <div className="mt-4 flex flex-wrap gap-2">{Object.entries(p.stats).slice(0, 12).map(([k, v]) => <Pill key={k}>{td(k)}: {typeof v === "number" ? fmt(v, 2) : String(v)}</Pill>)}</div>}
          </Panel>
          <PlayerEditPanel key={p.updated_at ?? ""} id={id} player={p} onSaved={q.reload} />
          <Panel title={t("Cartas ({length})", { length: q.data.cards.length })} subtitle={t("El equipo IMPRESO en cada carta es histórico: cambiar el equipo del jugador no reescribe cartas existentes.")}>
            <DataTable caption={t("Cartas del jugador")} rows={q.data.cards} rowKey={(r) => r.card_id} onRowClick={(r) => router.push(`/admin/cards/${encodeURIComponent(r.card_id)}`)} empty={t("Sin cartas")}
              cols={[
                { key: "a", label: t("Arte"), render: (r) => { const d = getCard(r.card_id); return d ? <CardThumb card={d} width={44} /> : "—"; } },
                { key: "e", label: t("Edición"), render: (r) => r.variant_id },
                { key: "k", label: t("Clase"), render: (r) => r.packClass ? <Pill>{td(PACK_CLASS_LABEL[r.packClass])}</Pill> : "—" },
                { key: "o", label: "OVR", align: "right", render: (r) => <b className="text-ink-primary">{r.ovr}</b>, sort: (r) => r.ovr },
                { key: "t", label: t("Equipo impreso"), render: (r) => r.printedTeam ?? "—" },
                { key: "s", label: t("Estado"), render: (r) => <Pill tone={r.lifecycle === "PUBLISHED" ? "ok" : "gold"}>{td(r.lifecycle)}</Pill> },
                { key: "v", label: t("Valor"), align: "right", render: (r) => fmt(r.marketValue), sort: (r) => r.marketValue ?? 0 },
              ]} />
          </Panel>
        </div>
      )}
    </>
  );
}
