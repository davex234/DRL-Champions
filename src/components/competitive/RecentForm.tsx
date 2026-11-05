"use client";

/**
 * FORMA RECIENTE (Fase 28). Las últimas letras reales (W/L/D) del historial liquidado y la racha
 * derivada de ellas. Texto además de color: «3 victorias seguidas».
 */
export function RecentForm({ form, streak, compact = false }: { form: ("W" | "L" | "D")[]; streak: { kind: "W" | "L" | "D"; n: number } | null; compact?: boolean }) {
  const label = streak && streak.n >= 2
    ? `${streak.n} ${streak.kind === "W" ? "victorias" : streak.kind === "L" ? "derrotas" : "empates"} seguid${streak.kind === "W" ? "as" : streak.kind === "L" ? "as" : "os"}`
    : null;
  return (
    <div data-form={form.join("")}>
      {!compact && <span className="nx-label block">Forma reciente</span>}
      {form.length === 0 ? (
        <span className="text-caption text-ink-faint">Sin partidas liquidadas</span>
      ) : (
        <ol className="mt-1 flex flex-wrap items-center gap-1" aria-label={`Forma reciente: ${form.map((l) => (l === "W" ? "victoria" : l === "L" ? "derrota" : "empate")).join(", ")}`}>
          {form.map((l, i) => (
            <li
              key={i}
              aria-hidden
              className="nx-readout grid h-7 w-7 place-items-center rounded-[4px] text-[12px]"
              style={{
                background: l === "W" ? "rgba(63,192,122,0.18)" : l === "L" ? "rgba(255,46,99,0.16)" : "rgba(255,211,92,0.16)",
                color: l === "W" ? "#3fc07a" : l === "L" ? "#ff5c8a" : "#ffd35c",
              }}
            >
              {l}
            </li>
          ))}
          {label && <li className="ml-1 text-caption text-ink-secondary">{label}</li>}
        </ol>
      )}
    </div>
  );
}
