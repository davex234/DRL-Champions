"use client";

/** F58 · /admin/users — búsqueda por nombre, email o id (`app_admin_search_users`, paginada en servidor). */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, useDebounced, fmt, dateOnly, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, SearchBox, DataTable, Pager, Loading, ErrorBox, Pill } from "@/components/admin/cc/ui";

interface UserRow { id: string; username: string; email: string | null; createdAt: string | null; lastSignInAt: string | null; lastSeenAt: string | null; isAdmin: boolean; credits: number; level: number; tag: string | null }

export default function AdminUsers() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const dq = useDebounced(q.trim(), 300);
  const data = useAdminQuery<{ rows: UserRow[]; total: number; page: number; pageSize: number }>(`/api/admin/users?q=${encodeURIComponent(dq)}&page=${page}&pageSize=25`);
  return (
    <>
      <PageHeader eyebrow="Jugadores" title="Usuarios" description="Busca por nombre de usuario, email o id. La ficha reúne identidad, economía, colección, competitivo, sanciones y actividad administrativa." />
      <Panel>
        <div className="mb-4 flex flex-wrap gap-3"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="nombre, email, id o #TAG…" label="Buscar usuarios" /></div>
        {data.error && <ErrorBox error={data.error} onRetry={data.reload} />}
        {!data.data && !data.error && <Loading />}
        {data.data && (
          <>
            <DataTable caption="Usuarios" rows={data.data.rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/users/${r.id}`)} empty="Ningún usuario coincide"
              cols={[
                { key: "u", label: "Usuario", render: (r) => <span className="flex items-center gap-2"><span className="font-semibold text-ink-primary">{r.username}</span>{r.tag && <code className="text-[11px] text-ink-faint" data-field="user-tag">#{r.tag}</code>}{r.isAdmin && <Pill tone="drl">admin</Pill>}</span>, sort: (r) => r.username.toLowerCase() },
                { key: "e", label: "Email", render: (r) => <span className="text-ink-muted">{r.email ?? "—"}</span> },
                { key: "l", label: "Nivel", align: "right", render: (r) => fmt(r.level), sort: (r) => r.level },
                { key: "c", label: "Créditos", align: "right", render: (r) => fmt(r.credits), sort: (r) => r.credits },
                { key: "r", label: "Registro", render: (r) => dateOnly(r.createdAt), sort: (r) => r.createdAt ?? "" },
                { key: "s", label: "Última actividad", render: (r) => dateTime(r.lastSeenAt ?? r.lastSignInAt), sort: (r) => r.lastSeenAt ?? r.lastSignInAt ?? "" },
              ]} />
            <Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
