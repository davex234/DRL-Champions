"use client";

/** F60 · /admin/agents/new — alta de agente en BORRADOR (nunca se publica en el mismo gesto). */
import { PageHeader } from "@/components/admin/cc/ui";
import { AgentEditor } from "@/components/admin/cms/AgentEditor";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export default function NewAgentPage() {
  useLocale();
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Contenido · Agentes")} title={t("Nuevo agente")} description={t("Se crea como borrador: no aparece en el juego hasta que lo publiques con su cara y su cuerpo entero.")} />
      <AgentEditor detail={null} onSaved={() => undefined} />
    </div>
  );
}
