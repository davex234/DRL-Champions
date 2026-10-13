"use client";

/**
 * COMENTARISTAS IA — la voz de la retransmisión. Acumula las líneas que el productor
 * (`liveCasters`) genera desde datos REALES, deduplicadas por id. Dos voces (jugada a
 * jugada / color). No genera texto: solo lo muestra con ritmo de caster.
 */
import { useEffect, useRef, useState } from "react";
import type { CasterLine } from "@/broadcast";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("broadcast");

const TONE: Record<string, string> = {
  hype: "text-amber-200", tenso: "text-rose-200", calmado: "text-cyan-200", analisis: "text-white/70",
};
const VOICE: Record<string, string> = { pbp: "🎙", color: "🎧", analista: "📊" };

export function CasterFeed({ lines, max = 5 }: { lines: CasterLine[]; max?: number }) {
  useLocale();
  const [feed, setFeed] = useState<CasterLine[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const fresh = lines.filter((l) => !seen.current.has(l.id));
    if (fresh.length === 0) return;
    for (const l of fresh) seen.current.add(l.id);
    if (seen.current.size > 400) seen.current = new Set([...seen.current].slice(-200));
    setFeed((f) => [...fresh, ...f].slice(0, max));
  }, [lines, max]);

  if (feed.length === 0) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-base-900/70 p-3 backdrop-blur-sm">
      <p className="mb-1.5 font-display text-[10px] uppercase tracking-[0.3em] text-drl">{t("Cabina de comentaristas")}</p>
      <ul className="space-y-1">
        {feed.map((l, i) => (
          <li key={l.id} className={cn("flex items-start gap-1.5 text-[12px] leading-snug transition", i === 0 && "animate-rise")}>
            <span className="shrink-0 opacity-70">{td(VOICE[l.voice]) ?? "🎙"}</span>
            <span className={TONE[l.tone] ?? "text-white/70"}>{td(l.text)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
