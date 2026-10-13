"use client";

/** F60 · /admin/players/new — alta de un jugador del catálogo de cartas (`content_players`), auditada. */
import { PageHeader, LinkButton } from "@/components/admin/cc/ui";
import { NewPlayerForm } from "@/components/admin/cms/PlayerCms";

export default function NewPlayerPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Contenido · Jugadores" title="Nuevo jugador" description="Para crear cartas de un jugador que todavía no está en el catálogo." actions={<LinkButton href="/admin/players">← Jugadores</LinkButton>} />
      <NewPlayerForm />
    </div>
  );
}
