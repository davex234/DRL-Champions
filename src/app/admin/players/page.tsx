"use client";

/** F58 · /admin/players — jugadores del catálogo (content_players), paginados en servidor, con su nº de cartas. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, useDebounced, fmt } from "@/components/admin/cc/api";
import { PageHeader, Panel, SearchBox, Field, Select, DataTable, Pager, Loading, ErrorBox, Pill, LinkButton } from "@/components/admin/cc/ui";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface Row { id: string; nick: string; fullName: string | null; team: string | null; teamTag: string | null; region: string | null; role: string | null; status: string | null; cards: number }

export default function Players() {
  useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);
  const data = useAdminQuery<{ rows: Row[]; total: number; page: number; pageSize: number }>(`/api/admin/catalog?view=players&q=${encodeURIComponent(dq)}&region=${region}&page=${page}&pageSize=50`);
  return (
    <>
      <PageHeader eyebrow={t("Contenido")} title={t("Jugadores")}
        description={t("Los jugadores del catálogo de cartas (content_players). F60: alta y edición desde el panel (auditadas, con concurrencia); sin borrado: un jugador con cartas se marca inactivo.")}
        actions={<LinkButton href="/admin/players/new" variant="primary">{t("+ Nuevo jugador")}</LinkButton>} />
      <Panel>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("nick, nombre o id…")} label={t("Buscar jugadores")} />
          <div className="w-44"><Field label={t("Región")} htmlFor="pl-r"><Select id="pl-r" value={region} onChange={(e) => { setRegion(e.target.value); setPage(1); }}><option value="">{t("Todas")}</option>{["EMEA", "Americas", "Pacific", "China"].map((r) => <option key={r}>{td(r)}</option>)}</Select></Field></div>
        </div>
        {data.error && <ErrorBox error={td(data.error)} onRetry={data.reload} />}
        {!data.data && !data.error && <Loading />}
        {data.data && (
          <>
            <DataTable caption={t("Jugadores")} rows={data.data.rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/players/${encodeURIComponent(r.id)}`)} empty={t("Ningún jugador")}
              cols={[
                { key: "n", label: t("Jugador"), render: (r) => <span><span className="font-semibold text-ink-primary">{r.nick}</span><span className="block text-[11px] text-ink-faint">{td(r.fullName) ?? r.id}</span></span>, sort: (r) => r.nick.toLowerCase() },
                { key: "t", label: t("Equipo"), render: (r) => r.team ?? "—", sort: (r) => r.team ?? "" },
                { key: "r", label: t("Región"), render: (r) => r.region ?? "—" },
                { key: "o", label: t("Rol"), render: (r) => r.role ?? "—" },
                { key: "c", label: t("Cartas"), align: "right", render: (r) => fmt(r.cards), sort: (r) => r.cards },
                { key: "s", label: t("Estado"), render: (r) => <Pill tone={r.status === "active" ? "ok" : "default"}>{td(r.status) ?? "—"}</Pill> },
              ]} />
            <Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
