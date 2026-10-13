"use client";

/** F58 · /admin/moderation — sanciones (activas, caducadas, revocadas). Emitir se hace desde la ficha del usuario. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminQuery, dateTime } from "@/components/admin/cc/api";
import { PageHeader, Panel, Tabs, DataTable, Pager, Loading, ErrorBox, LevelBadge, Pill } from "@/components/admin/cc/ui";

interface Row { id: string; user_id: string; username: string | null; type: "ban" | "suspension"; reason: string; created_at: string; expires_at: string | null; revoked_at: string | null; status: "ACTIVE" | "EXPIRED" | "REVOKED"; createdByName: string | null; revokedByName: string | null }

export default function Moderation() {
  const router = useRouter();
  const [status, setStatus] = useState<"ACTIVE" | "ALL" | "REVOKED" | "EXPIRED">("ACTIVE");
  const [page, setPage] = useState(1);
  const q = useAdminQuery<{ rows: Row[]; total: number; page: number; pageSize: number }>(`/api/admin/moderation?status=${status === "ALL" ? "" : status}&page=${page}&pageSize=50`);
  return (
    <>
      <PageHeader eyebrow="Jugadores" title="Moderación"
        description="Sanciones persistidas (user_sanctions). Una sanción activa bloquea en el servidor todas las mutaciones del juego de esa cuenta. Para sancionar, abre la ficha del usuario: nunca con un clic desde una lista." />
      <Panel actions={<Tabs label="Estado" value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ id: "ACTIVE", label: "Activas" }, { id: "EXPIRED", label: "Caducadas" }, { id: "REVOKED", label: "Revocadas" }, { id: "ALL", label: "Todas" }]} />} title="Sanciones">
        {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
        {!q.data && !q.error && <Loading />}
        {q.data && (
          <>
            <DataTable caption="Sanciones" rows={q.data.rows} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/users/${r.user_id}`)} empty={status === "ACTIVE" ? "No hay sanciones activas" : "Sin resultados"}
              cols={[
                { key: "s", label: "Estado", render: (r) => <LevelBadge level={r.status === "ACTIVE" ? "CRITICAL" : "INFO"} label={r.status === "ACTIVE" ? "Activa" : r.status === "REVOKED" ? "Revocada" : "Caducada"} /> },
                { key: "u", label: "Usuario", render: (r) => <span className="font-semibold text-ink-primary">{r.username ?? r.user_id.slice(0, 8)}</span>, sort: (r) => r.username ?? "" },
                { key: "t", label: "Tipo", render: (r) => <Pill tone={r.type === "ban" ? "bad" : "warn"}>{r.type === "ban" ? "Ban" : "Suspensión"}</Pill> },
                { key: "w", label: "Motivo", render: (r) => <span className="line-clamp-2 max-w-md text-ink-muted">{r.reason}</span> },
                { key: "c", label: "Emitida", render: (r) => <span>{dateTime(r.created_at)}<span className="block text-[11px] text-ink-faint">por {r.createdByName ?? "—"}</span></span>, sort: (r) => r.created_at },
                { key: "e", label: "Hasta", render: (r) => r.expires_at ? dateTime(r.expires_at) : <Pill tone="bad">Permanente</Pill> },
              ]} />
            <Pager page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
    </>
  );
}
