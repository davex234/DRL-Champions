"use client";

import type { RarityPalette } from "@/domain/cards/types";

/** Placa premium de número de serie (arriba a la derecha). #7/100 */
export function SerialBadge({
  serial,
  limit,
  palette,
  size = "md",
}: {
  serial: number;
  limit: number;
  palette: RarityPalette;
  size?: "sm" | "md";
}) {
  const low = serial <= Math.max(3, Math.ceil(limit * 0.05)); // serie muy baja
  return (
    <div
      className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 backdrop-blur"
      style={{
        borderColor: palette.primary,
        background: "rgba(0,0,0,0.45)",
        boxShadow: low ? `0 0 12px ${palette.primary}` : undefined,
      }}
    >
      {low && <span style={{ fontSize: size === "sm" ? 8 : 10 }}>⭐</span>}
      <span
        className="font-display font-bold leading-none tabular-nums text-white"
        style={{ fontSize: size === "sm" ? 10 : 12 }}
      >
        #{serial}
        <span className="opacity-55">/{limit}</span>
      </span>
    </div>
  );
}
