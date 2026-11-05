"use client";

/** Aviso de panel desactivado. Es de cliente porque el layout de `/admin` es de servidor y no se repinta al cambiar de idioma. */
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

export function AdminDisabled() {
  useLocale();
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <p className="font-display text-2xl font-bold uppercase text-white">{t("Panel no disponible")}</p>
        <p className="mt-2 max-w-sm text-white/50">
          {t("El panel de administración está desactivado en este despliegue (")}<code className="text-drl">NEXT_PUBLIC_ADMIN</code>).
        </p>
      </div>
    </div>
  );
}
