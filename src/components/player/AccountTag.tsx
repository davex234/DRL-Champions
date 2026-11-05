"use client";

/**
 * 0068 · EL TAG PÚBLICO DE LA CUENTA bajo el nombre: «#7K4M92X», discreto (monoespaciado, tono secundario) y COPIABLE.
 * Pulsarlo (o Enter/Espacio: es un botón) copia «#TAG» al portapapeles y avisa con un «Tag copiado» pequeño y
 * accesible (`role="status"`). Si el portapapeles no está disponible, lo dice; nunca un modal.
 */
import { useEffect, useRef, useState } from "react";
import { formatTag, tagAriaLabel } from "@/domain/account/tag";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("player");

export function AccountTag({ tag, className }: { tag: string; className?: string }) {
  useLocale();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const label = formatTag(tag);
  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(label); ok = true; } catch { ok = false; }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };
  return (
    <span className={`inline-flex flex-col items-center gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("{tag}. Pulsa para copiarlo", { tag: tagAriaLabel(tag) })}
        title={t("Copiar tag")}
        data-testid="account-tag"
        data-tag={tag}
        className="nx-focus inline-flex min-h-[32px] items-center gap-1.5 rounded px-2 font-mono text-[14px] tracking-[0.14em] text-white/55 transition hover:bg-white/[0.06] hover:text-white/85"
      >
        <span>{td(label)}</span>
        <span aria-hidden className="text-[11px] text-white/35">⧉</span>
      </button>
      <span role="status" aria-live="polite" className="min-h-[14px] font-display text-[10px] font-bold uppercase tracking-[0.14em] text-drl-cyan" data-testid="account-tag-status">
        {state === "copied" ? t("Tag copiado") : state === "failed" ? t("No se pudo copiar") : ""}
      </span>
    </span>
  );
}
