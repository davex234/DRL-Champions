"use client";

/** F60 · /admin/packs/new — alta de un sobre del panel en BORRADOR a partir de una plantilla económica existente. */
import { PageHeader, LinkButton } from "@/components/admin/cc/ui";
import { NewPackForm } from "@/components/admin/cms/PackCms";

export default function NewPackPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido · Sobres" title="Nuevo sobre" description="Borrador: no se vende ni se abre hasta publicarlo con arte, pool y simulación dentro de los invariantes." actions={<LinkButton href="/admin/packs">← Sobres</LinkButton>} />
      <NewPackForm />
    </div>
  );
}
