"use client";

/** F60 · /admin/agents/[id] — ficha y editor de un agente: datos, arte, vista previa real, dependencias, historial y ciclo de vida. */
import { use } from "react";
import { PageHeader, Loading, ErrorBox, LinkButton } from "@/components/admin/cc/ui";
import { useAdminQuery } from "@/components/admin/cc/api";
import { AgentEditor, type AgentDetailData } from "@/components/admin/cms/AgentEditor";

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useAdminQuery<AgentDetailData>(`/api/admin/cms/agents?id=${encodeURIComponent(id)}`);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido · Agentes" title={q.data?.agent.name ?? id} description={<span className="font-mono text-[12px]">{id}</span>}
        actions={<LinkButton href="/admin/agents">← Agentes</LinkButton>} />
      {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data ? <Loading rows={8} /> : q.data && <AgentEditor key={`${q.data.agent.version}`} detail={q.data} onSaved={q.reload} />}
    </div>
  );
}
