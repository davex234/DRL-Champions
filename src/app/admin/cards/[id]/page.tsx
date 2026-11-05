"use client";

/**
 * F60 · /admin/cards/[id] — ficha de carta: vista previa con CardArt, lo impreso, clasificación económica derivada,
 * dependencias reales, historial y ciclo de vida (publicar una carta del panel, retirar, borrar un borrador sin historia).
 * Las versiones de combate siguen en el editor avanzado (/admin/cartas/[id]).
 */
import { use } from "react";
import { PageHeader, LinkButton } from "@/components/admin/cc/ui";
import { CardDetailView } from "@/components/admin/cms/CardCms";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export default function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  useLocale();
  const { id } = use(params);
  const cardId = decodeURIComponent(id);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Contenido · Cartas")} title={cardId} actions={<LinkButton href="/admin/cards">{t("← Cartas")}</LinkButton>} />
      <CardDetailView id={cardId} />
    </div>
  );
}
