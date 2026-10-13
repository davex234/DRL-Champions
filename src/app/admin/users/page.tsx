"use client";

/** F58 · /admin/users — búsqueda por nombre, email o id (`app_admin_search_users`, paginada en servidor). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, useDebounced, fmt, dateOnly, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, SearchBox, DataTable, Pager, Loading, ErrorBox, Pill } from "@/components/admin/cc/ui";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

interface UserRow { id: string; username: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; lastSeenAt: string | null; isAdmin: boolean; credits: number; level: number; tag: string | null }

export default function AdminUsers() {
  useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);
  const data = useAdminQuery<{ rows: UserRow[]; total: number; page: number; pageSize: number }>(`/api/admin/users?q=${encodeURIComponent(dq)}&page=${page}&pageSize=25`);
  return (
    <>
      <PageHeader eyebrow={t("Jugadores")} title={t("Usuarios")} description={t("Busca por nombre de usuario, email o id. La ficha reúne identidad, economía, colección, competitivo, sanciones y actividad administrativa.")} />
      <Panel>
        <div className="mb-4 flex flex-wrap gap-3"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("nombre, email, id o #TAG…")} label={t("Buscar usuarios")} /></div>
        {data.error && <ErrorBox error={td(data.error)} onRetry={data.reload} />}
        {!data.data && !data.error && <Loading />}
        {data.data && (
          <>
            <DataTable caption={t("Usuarios")} rows={data.data.rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/users/${r.id}`)} empty={t("Ningún usuario coincide")}
              cols={[
                { key: "u", label: t("Usuario"), render: (r) => <span className="flex items-center gap-2"><span className="font-semibold text-ink-primary">{r.username}</span>{r.tag && <code className="text-[11px] text-ink-faint" data-field="user-tag">#{r.tag}</code>}{r.isAdmin && <Pill tone="drl">{t("admin")}</Pill>}</span>, sort: (r) => r.username.toLowerCase() },
                { key: "e", label: t("Email"), render: (r) => <span className="text-ink-muted">{r.email ?? "—"}</span> },
                { key: "l", label: t("Nivel"), align: "right", render: (r) => fmt(r.level), sort: (r) => r.level },
                { key: "c", label: t("Créditos"), align: "right", render: (r) => fmt(r.credits), sort: (r) => r.credits },
                { key: "r", label: t("Registro"), render: (r) => dateOnly(r.createdAt), sort: (r) => r.createdAt ?? "" },
                { key: "s", label: t("Última actividad"), render: (r) => dateTime(r.lastSeenAt ?? r.lastSignInAt), sort: (r) => r.lastSeenAt ?? r.lastSignInAt ?? "" },
              ]} />
            <Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
