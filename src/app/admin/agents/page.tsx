"use client";

/**
 * F60 · /admin/agents — GESTOR DE AGENTES. La fuente es `public.agents`: lo que se publica aquí lo ve el juego (roster
 * del entrenador, retratos, estadísticas) sin tocar código ni reiniciar. Retrato pintado con el MISMO componente que el
 * juego (`AgentPortrait`).
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Panel, DataTable, Tabs, SearchBox, Loading, ErrorBox, LinkButton, type Col } from "@/components/admin/cc/ui";
import { useAdminQuery, dateTime } from "@/components/admin/cc/api";
import { LifecycleBadge } from "@/components/admin/cms/cms";
import { AgentPortrait } from "@/components/agents/AgentArt";
import { AGENT_CLASS_LABEL } from "@/components/tactics/AgentEmblem";

interface Row {
  id: string; name: string; role: string; code: string | null; lifecycle: "DRAFT" | "PUBLISHED" | "RETIRED"; origin: string;
  faceAssetId: string | null; fullAssetId: string | null; faceUrl: string | null; fullUrl: string | null; version: number; updatedAt: string;
  usage: { stats: number; compositions: number };
}

export default function AdminAgentsPage() {
  const router = useRouter();
  const q = useAdminQuery<{ rows: Row[]; counts: Record<string, number> }>("/api/admin/cms/agents");
  const [tab, setTab] = useState<"all" | "DRAFT" | "PUBLISHED" | "RETIRED">("all");
  const [text, setText] = useState("");
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => (tab === "all" || r.lifecycle === tab)
    && (!text || r.name.toLowerCase().includes(text.toLowerCase()) || r.id.includes(text.toLowerCase()))), [q.data, tab, text]);
  const cols: Col<Row>[] = [
    { key: "face", label: "", render: (r) => <AgentPortrait agentId={r.id} size={34} decorative preview={r.lifecycle === "DRAFT" ? { name: r.name, role: r.role, face: r.faceUrl ? { src: r.faceUrl, width: 96, height: 96, alpha: true, source: "", sourceSha: "" } : null } : undefined} />, className: "w-12" },
    { key: "name", label: "Agente", render: (r) => <span><b className="text-ink-primary">{r.name}</b><span className="ml-2 font-mono text-[11px] text-ink-faint">{r.id}</span></span>, sort: (r) => r.name },
    { key: "role", label: "Rol", render: (r) => (AGENT_CLASS_LABEL as Record<string, string>)[r.role] ?? r.role, sort: (r) => r.role },
    { key: "state", label: "Estado", render: (r) => <LifecycleBadge state={r.lifecycle} />, sort: (r) => r.lifecycle },
    { key: "art", label: "Arte", render: (r) => (r.origin === "seed" && !r.faceAssetId ? <span className="text-ink-faint">estático F59</span> : <span>{r.faceAssetId ? "cara ✓" : "cara —"} · {r.fullAssetId ? "cuerpo ✓" : "cuerpo —"}</span>) },
    { key: "use", label: "Uso", render: (r) => <span className="tabular-nums">{r.usage.stats} stats · {r.usage.compositions} comps</span>, sort: (r) => r.usage.stats + r.usage.compositions, align: "right" },
    { key: "upd", label: "Modificado", render: (r) => dateTime(r.updatedAt), sort: (r) => r.updatedAt, className: "hidden lg:table-cell" },
  ];
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido" title="Agentes" description="Roster real de Valorant. Crear, editar, subir cara y cuerpo, publicar y retirar sin tocar código."
        actions={<LinkButton href="/admin/agents/new" variant="primary">+ Nuevo agente</LinkButton>} />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Tabs label="Estado" value={tab} onChange={setTab} items={[
            { id: "all", label: "Todos", count: q.data?.rows.length },
            { id: "PUBLISHED", label: "Publicados", count: q.data?.counts.PUBLISHED },
            { id: "DRAFT", label: "Borradores", count: q.data?.counts.DRAFT },
            { id: "RETIRED", label: "Retirados", count: q.data?.counts.RETIRED },
          ]} />
          <div className="min-w-[200px] flex-1"><SearchBox value={text} onChange={setText} placeholder="Nombre o id" /></div>
        </div>
        {q.loading && !q.data ? <Loading rows={8} /> : (
          <DataTable rows={rows} cols={cols} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/admin/agents/${r.id}`)}
            empty={tab === "DRAFT" ? "No hay borradores" : tab === "RETIRED" ? "No hay agentes retirados" : "Sin agentes"} caption="Agentes" initialSort={{ key: "name", dir: "asc" }} />
        )}
      </Panel>
    </div>
  );
}
