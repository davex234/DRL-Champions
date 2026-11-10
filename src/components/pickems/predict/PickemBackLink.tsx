"use client";

/** Miga de `/pickems/cuadro/[slug]`. Es de cliente porque la página es de servidor y no se repinta al cambiar de idioma. */
import Link from "next/link";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("pickems");

export function PickemBackLink() {
  useLocale();
  return (
    <nav aria-label={t("Migas")}><Link href="/pickems" className="nx-label nx-focus hover:text-white">{t("← Pick'ems")}</Link></nav>
  );
}
