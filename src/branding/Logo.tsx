"use client";

/**
 * DRL CHAMPIONS — componentes de marca (React). Renderizan la misma geometría que los
 * SVG/PNG (fuente única `geometry.ts`). Usar en navbar, splash, carga, etc.
 */
import { useId } from "react";
import {
  markInner, wordPath, PALETTE, type MarkVariant,
} from "./geometry";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("branding");

/** El ICONO solo (escudo + corona + hoja). Funciona sin texto, a cualquier tamaño. */
export function BrandMark({ size = 40, variant = "color", className, title }: {
  size?: number; variant?: MarkVariant; className?: string; title?: string;
}) {
  useLocale();
  const id = useId().replace(/[:]/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" className={className} role="img" aria-label={td(title) ?? t("DRL Champions")}>
      <g dangerouslySetInnerHTML={{ __html: markInner(id, variant) }} />
    </svg>
  );
}

/** El wordmark (lettering exclusivo). `text` por defecto "DRL". */
export function Wordmark({ text = "DRL", height = 26, color = PALETTE.white, weight = 12, tracking = 10, className }: {
  text?: string; height?: number; color?: string; weight?: number; tracking?: number; className?: string;
}) {
  useLocale();
  const { d, width } = wordPath(text, tracking);
  const w = width + weight; // margen para el grosor del trazo
  return (
    <svg height={height} viewBox={`${-weight / 2} ${-weight / 2} ${w} ${100 + weight}`} className={className}
      style={{ width: (height * w) / (100 + weight) }} role="img" aria-label={td(text)}>
      <path d={d} fill="none" stroke={color} strokeWidth={weight} strokeLinecap="butt" strokeLinejoin="miter" />
    </svg>
  );
}

/** Lockup horizontal: icono + "DRL" (héroe) sobre "CHAMPIONS" (tracked). */
export function BrandLockup({ iconSize = 40, variant = "color", className }: {
  iconSize?: number; variant?: MarkVariant; className?: string;
}) {
  useLocale();
  const accent = variant === "light" ? PALETTE.graphite : PALETTE.white;
  const sub = variant === "light" ? PALETTE.steel : "rgba(255,255,255,0.45)";
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: iconSize * 0.28 }}>
      <BrandMark size={iconSize} variant={variant} />
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1, gap: 3 }}>
        <Wordmark text={t("DRL")} height={iconSize * 0.5} color={accent} weight={13} tracking={9} />
        <Wordmark text={t("CHAMPIONS")} height={iconSize * 0.2} color={sub} weight={9} tracking={14} />
      </span>
    </span>
  );
}
