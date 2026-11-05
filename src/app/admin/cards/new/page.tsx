"use client";

/**
 * F60 · /admin/cards/new — ASISTENTE DE ALTA DE CARTA (CMS): jugador → edición → rol de carta → OVR y seis stats →
 * equipo impreso → arte → vista previa exacta (CardArt) → validación → borrador. Nunca publica en el mismo gesto.
 * El alta derivada anterior (sin arte ni impreso) sigue en /admin/cartas/nueva.
 */
import { PageHeader, LinkButton } from "@/components/admin/cc/ui";
import { NewCardWizard } from "@/components/admin/cms/CardCms";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export default function NewCardPage() {
  useLocale();
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Contenido · Cartas")} title={t("Nueva carta")} description={t("La carta es su arte: lo impreso (rol, OVR, seis stats, equipo) describe la imagen que subes. Termina en borrador.")}
        actions={<LinkButton href="/admin/cards">{t("← Cartas")}</LinkButton>} />
      <NewCardWizard />
    </div>
  );
}
