"use client";

/** F60 · /admin/agents/new — alta de agente en BORRADOR (nunca se publica en el mismo gesto). */
import { PageHeader } from "@/components/admin/cc/ui";
import { AgentEditor } from "@/components/admin/cms/AgentEditor";

export default function NewAgentPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido · Agentes" title="Nuevo agente" description="Se crea como borrador: no aparece en el juego hasta que lo publiques con su cara y su cuerpo entero." />
      <AgentEditor detail={null} onSaved={() => undefined} />
    </div>
  );
}
