"use client";

/** F60 · /admin/players/new — alta de un jugador del catálogo de cartas (`content_players`), auditada. */
import { PageHeader, LinkButton } from "@/components/admin/cc/ui";
import { NewPlayerForm } from "@/components/admin/cms/PlayerCms";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export default function NewPlayerPage() {
  useLocale();
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Contenido · Jugadores")} title={t("Nuevo jugador")} description={t("Para crear cartas de un jugador que todavía no está en el catálogo.")} actions={<LinkButton href="/admin/players">{t("← Jugadores")}</LinkButton>} />
      <NewPlayerForm />
    </div>
  );
}
