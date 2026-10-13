"use client";

/** F60 · /admin/packs/new — alta de un sobre del panel en BORRADOR a partir de una plantilla económica existente. */
import { PageHeader, LinkButton } from "@/components/admin/cc/ui";
import { NewPackForm } from "@/components/admin/cms/PackCms";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export default function NewPackPage() {
  useLocale();
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Contenido · Sobres")} title={t("Nuevo sobre")} description={t("Borrador: no se vende ni se abre hasta publicarlo con arte, pool y simulación dentro de los invariantes.")} actions={<LinkButton href="/admin/packs">{t("← Sobres")}</LinkButton>} />
      <NewPackForm />
    </div>
  );
}
