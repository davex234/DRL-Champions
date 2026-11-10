"use client";
import { ns, td as i18nTd } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("admin");

/** F58 · tabla ANTES / DESPUÉS de los diálogos de guardado (solo los campos que cambian). */
export function DiffTable({ rows }: { rows: [string, string, string][] }) {
  useLocale();
  const changed = rows.filter(([, a, b]) => a !== b);
  if (!changed.length) return <p className="text-ink-muted">{t("No hay cambios.")}</p>;
  return (
    <table className="w-full text-[13px]">
      <caption className="sr-only">{t("Cambios")}</caption>
      <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-faint"><th className="py-1">{t("Campo")}</th><th className="py-1">{t("Antes")}</th><th className="py-1">{t("Después")}</th></tr></thead>
      <tbody>{changed.map(([k, a, b]) => <tr key={k} className="border-t border-white/[0.06] align-top"><td className="py-1.5 pr-3 text-ink-muted">{i18nTd(k)}</td><td className="py-1.5 pr-3 text-bad line-through decoration-bad/40">{i18nTd(a)}</td><td className="py-1.5 text-ok">{i18nTd(b)}</td></tr>)}</tbody>
    </table>
  );
}
