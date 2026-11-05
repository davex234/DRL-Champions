"use client";

import { cn } from "@/lib/format";

export function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Fase 37 · el estado se anuncia (no solo el color) y la diana mide 44 px en todos los anchos (tabletas táctiles incluidas).
      aria-pressed={active}
      className={cn(
        "min-h-[44px] rounded-full px-3 py-1 font-display text-xs uppercase tracking-wide transition",
        active
          ? "bg-drl text-white shadow-glow"
          : "border border-white/10 bg-white/5 text-white/55 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
