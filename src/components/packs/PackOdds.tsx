"use client";

/**
 * PROBABILIDADES DEL SOBRE, PARA PERSONAS (Fase 25).
 *
 * Pinta lo que devuelve `packOddsFor` (dominio puro sobre la distribución MEDIDA del motor):
 * por carta, «al menos una en el sobre», garantía del catálogo y, en sobres de equipo, la
 * frase honesta de probabilidad aumentada. Ni un pool id, ni un peso interno, ni un JSON.
 */
import type { PackOdds, ClassOdds } from "@/domain/packs/odds";
import { pct, tablePct, finePct as fine, ICON_COPY } from "@/domain/packs/odds";
import type { RarityBucket } from "@/domain/packs/types";
import { PACK_CLASS_COLOR } from "@/domain/packs/packClass";
import { Badge } from "@/components/ui/Badge";

export const BUCKET_COLOR: Record<RarityBucket, string> = {
  common: "#8b96a3", uncommon: "#3fd48a", rare: "#3aa6ff", epic: "#b06bff", legendary: "#ffce4f",
};


/**
 * Fase 57.3 · LÍNEA PRINCIPAL. Lo que decide el sorteo es la clase de sobre (`packClass`), así que se enseña la tabla,
 * tal cual, y nada de rarezas. «Garantizada» solo aparece si el sobre la cumple por construcción (Icon).
 */
function ClassOddsPanel({ odds, classOdds }: { odds: PackOdds; classOdds: ClassOdds }) {
  const one = odds.cardCount === 1;
  return (
    <section aria-label="Probabilidades del sobre" className="mt-6" data-draw-mode="class-distribution">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">Qué puede salir</p>
        <p className="text-caption text-ink-faint">
          Media por carta · {one ? "1 carta por sobre" : `${odds.cardCount} cartas por sobre`}
        </p>
      </div>

      {classOdds.guarantee && (
        <p className="mt-2" data-class-guarantee>
          <Badge tone="ok">{classOdds.guarantee}</Badge>
        </p>
      )}

      {/* ICON POR SOBRE (2026-10-09): frase y cifras del plan que sortea el servidor (`iconOddsFor`). */}
      {classOdds.icon && (
        <div className="mt-3 nx-clip-sm border border-white/15 bg-white/[0.04] px-3 py-2.5" data-icon-odds data-icon-chance={classOdds.icon.atLeastOne}>
          <p className="font-display text-[11px] font-bold uppercase tracking-wide2 text-ink-faint">Probabilidades · ICON</p>
          <p className="mt-1 text-caption font-bold text-white" data-icon-text>{classOdds.icon.text}</p>
          {classOdds.icon.cards.length > 0 && (
            <ul aria-label="Probabilidad de cada ICON por carta" className="mt-1.5 space-y-0.5 text-caption text-ink-secondary" data-icon-cards>
              {classOdds.icon.cards.map((c) => (
                <li key={c.cardId} data-card={c.cardId}>
                  <b className="text-white">{c.label}</b> · OVR {c.ovr} · <span className="nx-readout">{tablePct(c.p)}</span> por carta
                </li>
              ))}
            </ul>
          )}
          {classOdds.icon.top && (
            <p className="mt-1 text-caption text-ink-secondary" data-icon-top>{ICON_COPY.topAtLeastOne(classOdds.icon.top.ovr, classOdds.icon.top.atLeastOne)}</p>
          )}
          {classOdds.icon.quality && (
            <p className="mt-1.5 text-caption leading-snug text-ink-faint" data-icon-method>
              {classOdds.icon.quality.levels.map((l) => `Nivel ${l.value.toLocaleString("es-ES")}: ${fine(l.p)}`).join(" · ")}. {classOdds.icon.quality.method}
            </p>
          )}
        </div>
      )}

      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="Reparto por clase de cada carta">
        {classOdds.rows.map((r) => (
          <div key={r.cls} title={`${r.label}: ${tablePct(r.perCard)} por carta`} style={{ width: `${r.perCard * 100}%`, background: PACK_CLASS_COLOR[r.cls] }} />
        ))}
      </div>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {classOdds.rows.map((r) => (
          <li key={r.cls} data-class={r.cls} className="nx-clip-sm flex items-center gap-3 bg-white/[0.03] px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PACK_CLASS_COLOR[r.cls], transform: "rotate(45deg)" }} />
            <span className="min-w-0 flex-1">
              <span className="block font-display text-caption font-bold uppercase tracking-wide text-white">{r.label}</span>
              <span className="block text-[11px] leading-tight text-ink-faint">{r.scope}</span>
            </span>
            <span className="nx-readout text-body text-white">{tablePct(r.perCard)}</span>
            {!one && (
              <span className="text-caption text-ink-muted">
                <span className="nx-readout text-ink-secondary">{pct(r.atLeastOne)}</span> ≥1
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* PACK OPENING 3.0 · ranuras, mejor carta e inclinación: lo mismo que decide el servidor, calculado exacto. */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2" data-pack-slots>
        {classOdds.slots.regular.count > 0 && (
          <div className="nx-clip-sm bg-white/[0.03] px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" data-slot="regular">
            <p className="font-display text-[11px] font-bold uppercase tracking-wide2 text-ink-faint">{classOdds.slots.regular.count} {classOdds.slots.regular.count === 1 ? "carta normal" : "cartas normales"}</p>
            <p className="mt-1 text-caption text-ink-secondary">{classOdds.slots.regular.rows.map((r) => `${r.label} ${tablePct(r.p)}`).join(" · ")}</p>
          </div>
        )}
        <div className="nx-clip-sm border border-drl-gold/30 bg-drl-gold/[0.05] px-3 py-2.5" data-slot="featured">
          <p className="font-display text-[11px] font-bold uppercase tracking-wide2 text-drl-gold">Carta destacada · 1 por sobre</p>
          <p className="mt-1 text-caption text-ink-secondary">{classOdds.slots.featured.rows.map((r) => `${r.label} ${tablePct(r.p)}`).join(" · ")}</p>
        </div>
      </div>
      <p className="mt-2 text-caption text-ink-secondary" data-best-odds>
        Mejor carta del sobre: <b className="text-white">OVR 90+</b> {fine(classOdds.slots.bestAtLeast.ovr90)} ·{" "}
        <b className="text-white">93+</b> {fine(classOdds.slots.bestAtLeast.ovr93)} · <b className="text-white">95</b> {fine(classOdds.slots.bestAtLeast.ovr95)}
      </p>
      <p className="mt-2 text-caption leading-snug text-ink-faint">
        {one
          ? "Una sola carta: primero se sortea la clase y después una carta de esa clase."
          : `Cada carta se sortea por separado: las normales con su tabla y la destacada con la suya.${classOdds.icon ? " La ICON se sortea una sola vez por sobre y, si sale, ocupa la carta destacada." : ""} «≥1» es la probabilidad de que el sobre traiga al menos una de esa clase.`}
        {classOdds.slots.ovrTilt > 0 && " En este sobre, dentro de cada clase, las cartas de OVR más alto son menos probables que las de OVR más bajo; todas pueden salir."}
      </p>
      {odds.teamBoost && (
        <p className="mt-3 nx-clip-sm border border-drl-cyan/35 bg-drl-cyan/[0.07] px-3 py-2 text-caption leading-relaxed text-ink-secondary">
          <b className="font-display uppercase tracking-wide text-drl-cyan">Probabilidad aumentada</b> · {odds.teamBoost.copy}
        </p>
      )}
    </section>
  );
}

export function PackOddsPanel({ odds }: { odds: PackOdds }) {
  if (odds.classOdds) return <ClassOddsPanel odds={odds} classOdds={odds.classOdds} />;
  const rows = odds.rows.filter((r) => !r.impossible);
  const impossible = odds.rows.filter((r) => r.impossible);
  return (
    <section aria-label="Probabilidades del sobre" className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-label font-bold uppercase tracking-wide2 text-ink-faint">Qué puede salir</p>
        <p className="text-caption text-ink-faint">
          {odds.source === "measured" ? "Medido con el motor real" : "Según los pesos del sobre"} · {odds.cardCount} cartas por sobre
        </p>
      </div>

      {/* Hotfix 57.2 · techo de poder (gama base): lo dice la regla del servidor, no un texto aparte */}
      {odds.powerCap && (
        <p className="mt-2 text-caption leading-snug text-ink-secondary" data-power-cap={odds.powerCap.maxOvr ?? "none"}>
          <b className="font-display uppercase tracking-wide text-white">{odds.powerCap.headline}</b> · {odds.powerCap.blurb}
        </p>
      )}

      {/* Barra de reparto por carta */}
      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label="Reparto de rarezas por carta">
        {rows.map((r) => (
          <div key={r.bucket} title={`${r.label}: ${pct(r.perCard)} por carta`} style={{ width: `${Math.max(0.5, r.perCard * 100)}%`, background: BUCKET_COLOR[r.bucket] }} />
        ))}
      </div>

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {rows.map((r) => (
          <li key={r.bucket} className="nx-clip-sm flex items-center gap-3 bg-white/[0.03] px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: BUCKET_COLOR[r.bucket], transform: "rotate(45deg)" }} />
            <span className="flex-1 font-display text-caption font-bold uppercase tracking-wide text-white">{r.label}</span>
            <span className="text-caption text-ink-muted">
              <span className="nx-readout text-ink-secondary">{pct(r.perCard)}</span> por carta
            </span>
            <span className="text-caption text-ink-muted">
              {r.guaranteed
                ? <Badge tone="ok">Garantizada</Badge>
                : <><span className="nx-readout text-white">{pct(r.atLeastOne)}</span> ≥1 por sobre</>}
            </span>
          </li>
        ))}
      </ul>

      {odds.guaranteedMin && (
        <p className="mt-2 text-caption leading-snug text-ink-secondary">
          Garantiza al menos una carta <b className="text-white">{odds.rows.find((r) => r.bucket === odds.guaranteedMin)?.label.toLowerCase()}</b> o superior en la última carta.
          «≥1 por sobre» es aproximado: se calcula carta a carta.
        </p>
      )}
      {impossible.length > 0 && (
        <p className="mt-2 text-caption leading-snug text-warn">
          No contiene {impossible.map((r) => r.label.toLowerCase()).join(" ni ")}: no hay cartas de esa rareza para este sobre.
        </p>
      )}
      {odds.teamBoost && (
        <p className="mt-3 nx-clip-sm border border-drl-cyan/35 bg-drl-cyan/[0.07] px-3 py-2 text-caption leading-relaxed text-ink-secondary">
          <b className="font-display uppercase tracking-wide text-drl-cyan">Probabilidad aumentada</b> · {odds.teamBoost.copy}
        </p>
      )}
    </section>
  );
}
