"use client";

/**
 * FORJA — la UI del Craft Engine (Consolidation F1.1: wire, cero motor nuevo).
 *
 * Conecta EXACTAMENTE el motor existente: recetas data-driven (`@/data/recipes`),
 * `useGameStore.craft()` (plan puro del CraftEngine → único Minter), materiales por rareza
 * y candados (`lockCard`/`unlockCard`). Este componente solo presenta y selecciona; no
 * decide nada: todos los checks (elegibilidad, costes, locks) los hace el motor.
 */
import { useMemo, useState } from "react";
import { useGameStore } from "@/store/useGameStore";
import { RECIPES } from "@/data/recipes";
import { BUCKETS, type CraftIssue, type CraftResult } from "@/craft";
import { getCard, getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { formatCredits, cn } from "@/lib/format";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("craft");

const BUCKET_ICON: Record<string, string> = { common: "⚪", uncommon: "🟢", rare: "🔵", epic: "🟣", legendary: "🟡" };
const BUCKET_NAME: Record<string, string> = { common: "Común", uncommon: "Infrecuente", rare: "Rara", epic: "Épica", legendary: "Legendaria" };
const KIND_LABEL: Record<string, string> = { salvage: "Reciclaje", upgrade: "Mejora", evolution: "Evolución", fusion: "Fusión", promotion: "Promoción" };

export function ForgePanel() {
  useLocale();
  const ownedCards = useGameStore((s) => s.ownedCards);
  const materials = useGameStore((s) => s.materials);
  const credits = useGameStore((s) => s.credits);
  const lockedUids = useGameStore((s) => s.lockedUids);
  const craft = useGameStore((s) => s.craft);
  const lockCard = useGameStore((s) => s.lockCard);
  const unlockCard = useGameStore((s) => s.unlockCard);

  const [recipeId, setRecipeId] = useState<string>(RECIPES[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [issues, setIssues] = useState<CraftIssue[] | null>(null);
  const [lastResult, setLastResult] = useState<CraftResult | null>(null);

  const recipe = RECIPES.find((r) => r.id === recipeId) ?? null;
  const locked = useMemo(() => new Set(lockedUids), [lockedUids]);

  // Nº de copias por carta (para señalar duplicados; la elegibilidad real la decide el motor).
  const copies = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of ownedCards) m.set(o.cardId, (m.get(o.cardId) ?? 0) + 1);
    return m;
  }, [ownedCards]);

  const toggle = (uid: string) =>
    setSelected((s) => { const n = new Set(s); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });

  const doCraft = () => {
    if (!recipe) return;
    const res = craft(recipe.id, selected.size ? [...selected] : undefined);
    if (!res.ok) {
      setIssues(res.issues ?? [{ code: "INVALID_RECIPE", message: res.error ?? t("No se pudo craftear.") }]);
      setLastResult(null);
      return;
    }
    setIssues(null);
    setLastResult(res.result ?? null);
    setSelected(new Set());
  };

  return (
    <div className="space-y-4">
      {/* Materiales */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-base-700/40 p-4">
        <span className="mr-1 font-display text-[11px] uppercase tracking-widest text-white/45">{t("Polvo")}</span>
        {BUCKETS.map((b) => (
          <span key={b} title={td(BUCKET_NAME[b])} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80">
            {td(BUCKET_ICON[b])} {materials[b] ?? 0}
          </span>
        ))}
        <span className="ml-auto text-xs text-white/50">🪙 {formatCredits(credits)}</span>
      </div>

      {/* Recetas */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {RECIPES.map((r) => (
          <button
            key={r.id}
            onClick={() => { setRecipeId(r.id); setIssues(null); setLastResult(null); }}
            className={cn(
              "rounded-xl border p-3 text-left transition",
              r.id === recipeId ? "border-drl bg-drl/10 shadow-glow" : "border-white/10 bg-base-700/40 hover:border-white/25",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-display text-sm font-bold uppercase tracking-wide text-white">{r.name}</p>
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-display text-[9px] uppercase tracking-wide text-white/60">{td(KIND_LABEL[r.kind]) ?? r.kind}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-white/50">{td(r.description)}</p>
            {(r.cost?.materials || r.cost?.credits) && (
              <p className="mt-1.5 text-[11px] text-drl-gold/90">
                {t("Coste:")}{" "}
                {r.cost?.materials && Object.entries(r.cost.materials).map(([b, n]) => `${BUCKET_ICON[b]}${n}`).join(" ")}
                {r.cost?.credits ? ` · 🪙 ${formatCredits(r.cost.credits)}` : ""}
              </p>
            )}
          </button>
        ))}
      </div>

      {/* Selección de cartas */}
      <div className="rounded-2xl border border-white/10 bg-base-700/40 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="font-display text-[11px] uppercase tracking-widest text-white/45">
            {recipe ? t("Tus cartas · selecciona {n} para la receta", { n: recipe.input.count }) : t("Tus cartas · selecciona para la receta")}
            {selected.size > 0 && <span className="ml-2 text-drl-cyan">{t("({n} seleccionadas)", { n: selected.size })}</span>}
          </p>
          <button
            onClick={doCraft}
            disabled={!recipe}
            className="rounded-xl bg-gradient-to-r from-drl to-[#7b1733] px-5 py-2 font-display text-sm font-bold uppercase tracking-wide text-white shadow-glow transition hover:brightness-110 disabled:opacity-40"
          >
            {t("⚒️ Craftear")}
          </button>
        </div>

        {ownedCards.length === 0 ? (
          <p className="py-8 text-center text-white/40">{t("No tienes cartas todavía. Abre sobres en la tienda.")}</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {ownedCards.map((o) => {
              const def = getCard(o.cardId);
              if (!def) return null;
              const isSel = selected.has(o.uid);
              const isLocked = locked.has(o.uid);
              const dup = (copies.get(o.cardId) ?? 0) > 1;
              return (
                <div key={o.uid} className="relative">
                  <button
                    onClick={() => !isLocked && toggle(o.uid)}
                    className={cn(
                      "block w-full rounded-lg text-left transition",
                      isSel && "ring-2 ring-drl-cyan",
                      isLocked ? "cursor-not-allowed opacity-50" : "hover:-translate-y-0.5",
                    )}
                    title={`${getPlayer(def.playerId)?.nick ?? def.id} · ${getVariant(def.variantId).label}`}
                  >
                    <PlayerCard card={def} size="sm" interactive={false} serial={o.serial} showStats={false} />
                  </button>
                  {dup && (
                    <span className="absolute left-1 top-1 rounded bg-drl-cyan/80 px-1 font-display text-[9px] font-bold uppercase text-base-900">{t("dup")}</span>
                  )}
                  <button
                    onClick={() => (isLocked ? unlockCard(o.uid) : lockCard(o.uid))}
                    title={isLocked ? t("Desbloquear (permitir usar en la Forja)") : t("Bloquear (proteger de la Forja)")}
                    aria-label={isLocked ? t("Desbloquear carta") : t("Bloquear carta")}
                    className="absolute right-1 top-1 rounded bg-base-900/80 px-1.5 py-0.5 text-[11px]"
                  >
                    {isLocked ? "🔒" : "🔓"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resultado / errores */}
      {issues && (
        <div className="rounded-2xl border border-drl/40 bg-drl/10 p-4">
          <p className="mb-1 font-display text-[11px] uppercase tracking-widest text-drl">{t("La forja rechazó la operación")}</p>
          <ul className="space-y-0.5 text-sm text-white/75">
            {issues.map((i, k) => <li key={k}>· {td(i.message)}</li>)}
          </ul>
        </div>
      )}
      {lastResult && (
        <div className="rounded-2xl border border-drl-gold/40 bg-drl-gold/10 p-4">
          <p className="mb-2 font-display text-[11px] uppercase tracking-widest text-drl-gold">{t("Forja completada ·")} {td(KIND_LABEL[lastResult.kind]) ?? lastResult.kind}</p>
          {lastResult.instances.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {lastResult.instances.map((i, k) => {
                const def = getCard(i.cardId);
                return def ? <PlayerCard key={`${i.cardId}:${i.serial ?? k}`} card={def} size="sm" interactive={false} serial={i.serial ?? undefined} /> : null;
              })}
            </div>
          ) : (
            <p className="text-sm text-white/75">
              {t("Cartas convertidas en polvo")}{lastResult.creditsAfter > credits ? (" " + t("y créditos")) : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
