"use client";

/**
 * MAESTRÍA DE COLECCIÓN (Fase 13).
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * Al 91 % del catálogo no queda nada que hacer. Esto son 77 objetivos sobre las cartas que
 * ya tienes: equipos, regiones, variantes y las dos rarezas altas.
 *
 * ────────────────────────── DECISIONES ──────────────────────────
 *
 * **1. Con 77 conjuntos, el orden ES la interfaz.** Los ordena el servidor: primero lo que
 * se puede cobrar, después lo más cerca de terminarse. Una lista alfabética de 77 filas
 * obligaría a buscar, y buscar es lo contrario de que algo te llame.
 *
 * **2. Se enseñan pocos y se piden más.** Doce caben en pantalla sin que la colección
 * desaparezca debajo. Los otros 65 siguen ahí, a un clic.
 *
 * **3. Lo cobrable se ve desde lejos.** Es lo único de este panel que pide una acción.
 *
 * **4. No se dice cuántos créditos da, porque no da ninguno.** Da insignias. Enseñar un
 * «0 🪙» sería contestar a una pregunta que nadie ha hecho y sembrar la duda de si esto
 * paga poco. No paga: reconoce.
 */
import { useState } from "react";
import type { MasteryView, MasterySetView } from "@/lib/game/mastery";
import { claimMastery } from "@/lib/game/mastery";
import { cosmetic } from "@/domain/cosmetics/catalog";
import { cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("collection");

/** Tono por eje. Tabla, no `switch`: un eje nuevo sale neutro en vez de romper. */
const AXIS: Record<string, { tint: string; label: string }> = {
  equipo: { tint: "25,227,255", label: "Equipo" },
  region: { tint: "123,92,255", label: "Región" },
  variante: { tint: "255,206,79", label: "Variante" },
  rareza: { tint: "255,46,99", label: "Rareza" },
};
const NEUTRAL = { tint: "150,160,180", label: "Conjunto" };

const PAGE = 12;

/** Las insignias de un escalón, con el nombre que les da el catálogo de cosméticos. */
function badgeNames(ids: string[] | undefined): string {
  if (!ids || ids.length === 0) return "";
  return ids.map((id) => cosmetic(id)?.label ?? id).join(" · ");
}

function SetRow({
  set, onClaim, busy,
}: {
  set: MasterySetView;
  onClaim: (setId: string, at: number) => void;
  busy: string | null;
}) {
  useLocale();
  const a = AXIS[set.axis] ?? NEUTRAL;
  const pct = set.total === 0 ? 0 : Math.round((set.owned / set.total) * 100);
  const next = set.tiers.find((t) => t.claimable) ?? null;
  const done = set.owned >= set.total && set.total > 0;

  return (
    <li
      className={cn(
        "nx-clip-sm relative border p-3.5 transition duration-fast",
        set.hasClaimable ? "border-white/25" : "border-white/10",
      )}
      style={set.hasClaimable ? { background: `rgb(${a.tint} / 0.10)` } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className="font-display text-[9px] font-bold uppercase tracking-[0.14em]"
            style={{ color: `rgb(${a.tint})` }}
          >
            {td(a.label)}
          </span>
          <div className={cn(
            "mt-0.5 truncate font-display text-[13.5px] font-bold uppercase tracking-[0.04em]",
            done ? "text-white" : "text-white/85",
          )}>
            {td(set.label)}
          </div>
        </div>

        {next ? (
          <button
            type="button"
            onClick={() => onClaim(set.id, next.at)}
            disabled={busy !== null}
            className="nx-clip-sm shrink-0 px-3 py-1.5 font-display text-[10px] font-bold uppercase tracking-[0.12em] text-black transition duration-fast disabled:opacity-50"
            style={{ background: `rgb(${a.tint})` }}
          >
            {busy === `${set.id}:${next.at}` ? "…" : tr("Insignia")}
          </button>
        ) : (
          <span className="nx-readout shrink-0 text-[12px] text-white/45">
            {set.owned}/{set.total}
          </span>
        )}
      </div>

      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-slow"
          style={{ width: `${pct}%`, background: `rgb(${a.tint} / 0.85)` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-white/40">
          {next
            ? badgeNames(next.reward.cosmetics)
            : set.nextLabel
              ? tr("Faltan {toNext} para {nextLabel}", { toNext: set.toNext, nextLabel: td(set.nextLabel) })
              : tr("Completo")}
        </span>
        {/* Las insignias ya conseguidas de este conjunto, como puntos. */}
        <span className="flex shrink-0 gap-1" aria-hidden>
          {set.tiers.map((t) => (
            <span
              key={t.at}
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: t.claimed ? `rgb(${a.tint})` : t.reached ? `rgb(${a.tint} / 0.4)` : "rgba(255,255,255,0.14)",
              }}
            />
          ))}
        </span>
      </div>
    </li>
  );
}

export function MasteryPanel({
  view, onChanged, notify,
}: {
  view: MasteryView;
  onChanged: () => void;
  notify?: (msg: string, ok?: boolean) => void;
}) {
  useLocale();
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);

  async function claim(setId: string, at: number) {
    setBusy(`${setId}:${at}`);
    try {
      const r = await claimMastery(setId, at);
      notify?.(r.applied
        ? tr("Insignia conseguida · {v}", { v: badgeNames(r.reward.cosmetics) || td(r.label) })
        : tr("Esa insignia ya era tuya"));
      onChanged();
    } catch (e) {
      notify?.(e instanceof Error ? e.message : tr("No se pudo reclamar"), false);
    } finally {
      setBusy(null);
    }
  }

  const t = view.totals;

  return (
    <section className="mt-8" aria-label={tr("Maestría de colección")}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="nx-label">{tr("Maestría")}</h2>
          <p className="mt-1 text-[12.5px] text-white/50">
            {tr("{n} conjuntos sobre las cartas que ya tienes. Pagan insignias, no créditos.", { n: t.sets })}
          </p>
        </div>
        <div className="flex gap-4">
          <span className="text-right">
            <span className="nx-label block text-[9px]">{tr("Completos")}</span>
            <span className="nx-readout text-[19px] text-white">{t.completed}</span>
          </span>
          <span className="text-right">
            <span className="nx-label block text-[9px]">{tr("Insignias")}</span>
            <span className="nx-readout text-[19px] text-white">{t.badgesEarned}</span>
          </span>
          {t.claimable > 0 && (
            <span className="text-right">
              <span className="nx-label block text-[9px]">{tr("Sin reclamar")}</span>
              <span className="nx-readout text-[19px] text-drl-gold">{t.claimable}</span>
            </span>
          )}
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {view.sets.slice(0, shown).map((s) => (
          <SetRow key={s.id} set={s} onClaim={claim} busy={busy} />
        ))}
      </ul>

      {shown < view.sets.length && (
        <div className="mt-4 flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShown((n) => n + PAGE * 2)}
            /* FASE 12 · 44 px y chaflán: medía 167 × 42 y usaba `rounded-control`. */
            className="nx-focus nx-clip-sm min-h-[44px] border border-white/15 px-6 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white/80 transition duration-fast hover:bg-white/[0.07]"
          >
            {tr("Ver más conjuntos")}
          </button>
          <span className="nx-label">{tr("{n} de {total}", { n: shown, total: view.sets.length })}</span>
        </div>
      )}
    </section>
  );
}
