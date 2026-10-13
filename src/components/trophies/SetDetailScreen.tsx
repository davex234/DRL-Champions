"use client";

/**
 * F82 · DETALLE DE UNA COLECCIÓN — qué tienes, qué te FALTA y dónde conseguirlo. Presentación pura sobre la foto del
 * servidor (`SetView`); la ruta y el arnés montan esta misma pantalla.
 *
 * Un requisito se pinta con UNA carta real: tu mejor variante poseída o, si te falta, la mejor carta elegible atenuada.
 * Las variantes poseídas se listan aparte cuando hay más de una (no se convierte la pantalla en un muro de cartas).
 */
import Link from "next/link";
import { useMemo } from "react";
import { CardArt } from "@/components/cards/CardArt";
import { Meter } from "@/components/ui/Meter";
import { NxButton } from "@/components/ui/NxButton";
import { getCard } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection/registry";
import { getVariant } from "@/domain/cards/variants";
import { cardHref, packsThatCanContain } from "@/domain/collection/room";
import type { RequirementProgress } from "@/domain/collectionSets/progress";
import { cn } from "@/lib/format";
import type { SetView } from "@/domain/collectionSets/view";
import { TrophyBadge } from "./TrophyBadge";
import { remainingText } from "./trophyModel";

let REG: CardRegistry | null = null;
const best = (ids: readonly string[]) =>
  ids.map((id) => getCard(id)).filter((c): c is NonNullable<typeof c> => !!c)
    .sort((a, b) => getVariant(b.variantId).rank - getVariant(a.variantId).rank || b.ovr - a.ovr || a.id.localeCompare(b.id))[0] ?? null;

function whereToGet(ids: readonly string[]): string[] {
  try {
    REG ??= new CardRegistry();
    const names = new Set<string>();
    for (const id of ids) { const c = getCard(id); if (c) for (const p of packsThatCanContain(REG, PACKS, c)) names.add(p.name); }
    return [...names].slice(0, 3);
  } catch { return []; }
}

function RequirementRow({ r, kind, team }: { r: RequirementProgress; kind: SetView["kind"]; team: string }) {
  const shown = best(r.satisfied ? r.ownedCardIds : r.eligibleCardIds);
  const where = useMemo(() => (r.satisfied ? [] : whereToGet(r.eligibleCardIds)), [r]);
  return (
    <li data-testid="requirement" data-key={r.key} data-satisfied={r.satisfied ? "1" : "0"}
      className={cn("nx-clip flex min-w-0 items-center gap-3 p-3", r.satisfied ? "bg-emerald-400/[0.06] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]" : "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]")}>
      <div className="w-[64px] shrink-0 sm:w-[76px]">
        {shown?.image ? (
          <Link href={cardHref(shown.id)} className="nx-focus block" aria-label={`Ver carta ${r.label}`}>
            <CardArt src={shown.image} alt={`${r.label} · ${getVariant(shown.variantId).label}`} dim={!r.satisfied} shadow="rest" sizes="76px" />
          </Link>
        ) : <div className="aspect-[750/1048] w-full rounded bg-white/5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span aria-hidden className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-black", r.satisfied ? "bg-emerald-400 text-black" : "ring-2 ring-white/35 text-white/50")}>{r.satisfied ? "✓" : ""}</span>
          <span className="truncate font-display text-[17px] font-bold uppercase tracking-wide text-white">{r.label}</span>
        </p>
        <p className={cn("mt-0.5 text-[12px] font-bold uppercase tracking-wider", r.satisfied ? "text-emerald-300" : "text-[#ffce4f]")}>
          {r.satisfied ? "Conseguido" : "Te falta"}
          {kind === "TEAM" && !r.satisfied && <span className="font-normal normal-case tracking-normal text-white/60"> · cualquier carta de {r.label} con {team}</span>}
        </p>
        {r.satisfied && r.ownedCardIds.length > 1 && (
          <p className="mt-1 text-[12px] text-white/60" data-testid="owned-variants">Variantes tuyas: {r.ownedCardIds.map((id) => getVariant((getCard(id)?.variantId ?? "base") as never).label).join(" · ")}</p>
        )}
        {!r.satisfied && (
          <p className="mt-1 text-[12px] text-white/60">
            {r.eligibleCardIds.length > 1 ? `${r.eligibleCardIds.length} cartas valen. ` : ""}
            {where.length ? <>Puede salir en: <span className="text-white/80">{where.join(", ")}</span></> : null}
          </p>
        )}
      </div>
    </li>
  );
}

export function SetDetailScreen({ set, onClaim, claiming, error }: { set: SetView; onClaim?: () => void; claiming?: boolean; error?: string | null }) {
  const done = set.state === "COMPLETED";
  const missing = set.requirements.filter((r) => !r.satisfied);
  const have = set.requirements.filter((r) => r.satisfied);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-8" data-testid="set-detail" data-set={set.id} data-state={set.state}>
      <nav className="mb-3 text-[13px]"><Link href="/coleccion/trofeos" className="nx-focus text-white/60 hover:text-white">← Sala de Trofeos</Link></nav>

      <header className="nx-clip relative flex flex-col items-center gap-5 overflow-hidden bg-white/[0.03] p-5 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] sm:flex-row sm:text-left">
        {set.badge && <TrophyBadge badge={set.badge} size="lg" locked={!done} />}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/50">{set.kind === "TEAM" ? "Colección de equipo" : "Colección de edición"}{set.version > 1 ? ` · versión ${set.version}` : ""}</p>
          <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-wide text-white sm:text-[44px]">{set.title}</h1>
          <div className="mt-3 flex items-center gap-3">
            <Meter value={done ? 100 : set.pct} tone={done ? "ok" : set.state === "CLAIMABLE" ? "gold" : "info"} height={8} label={`Progreso de ${set.title}`} className="flex-1" />
            <span className="nx-readout shrink-0 font-display text-[22px] font-black text-white" data-testid="set-progress">{set.owned}/{set.required}</span>
          </div>
          <p className={cn("mt-1.5 text-[14px]", set.state === "CLAIMABLE" ? "font-bold text-[#ffce4f]" : "text-white/70")}>{remainingText(set)}</p>
          {done && set.completedAt && (
            <p className="mt-1 text-[12px] text-white/55">Completada el {new Date(set.completedAt).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}. Es permanente aunque cambie tu inventario{!set.completeNow ? ` (hoy tienes ${set.owned}/${set.required})` : ""}.</p>
          )}
          {set.retired && <p className="mt-1 text-[12px] text-white/55">Colección retirada: ya no se puede completar, pero tu trofeo se conserva.</p>}
        </div>
        {set.state === "CLAIMABLE" && onClaim && (
          <div className="w-full sm:w-auto">
            <NxButton variant="primary" accent="gold" size="lg" block onClick={onClaim} disabled={claiming} data-testid="claim-badge">
              {claiming ? "Reclamando…" : "Reclamar insignia"}
            </NxButton>
          </div>
        )}
      </header>
      {error && <p role="alert" className="mt-3 text-[13px] text-red-300" data-testid="claim-error">{error}</p>}

      {missing.length > 0 && (
        <section aria-labelledby="missing-title" className="mt-7">
          <h2 id="missing-title" className="mb-3 font-display text-[20px] font-black uppercase tracking-wide text-white">
            Te falta{missing.length === 1 ? "" : "n"} {missing.length}
          </h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="missing-list">
            {missing.map((r) => <RequirementRow key={r.key} r={r} kind={set.kind} team={set.title} />)}
          </ul>
        </section>
      )}

      {have.length > 0 && (
        <section aria-labelledby="have-title" className="mt-7">
          <h2 id="have-title" className="mb-3 font-display text-[20px] font-black uppercase tracking-wide text-white">Ya tienes {have.length}</h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="have-list">
            {have.map((r) => <RequirementRow key={r.key} r={r} kind={set.kind} team={set.title} />)}
          </ul>
        </section>
      )}

      {set.badge && (
        <section aria-labelledby="reward-title" className="nx-clip mt-8 flex items-center gap-4 bg-[#ffce4f]/[0.06] p-4 shadow-[inset_0_0_0_1px_rgba(255,206,79,0.3)]">
          <TrophyBadge badge={set.badge} size="md" locked={!done} />
          <div className="min-w-0">
            <h2 id="reward-title" className="font-display text-[16px] font-black uppercase tracking-wide text-[#ffce4f]">Recompensa · Insignia {set.badge.label}</h2>
            <p className="text-[13px] text-white/70">Insignia permanente para tu perfil. No se consume, no se vende, no se craftea y no se pierde aunque uses las cartas.</p>
          </div>
        </section>
      )}
    </div>
  );
}
