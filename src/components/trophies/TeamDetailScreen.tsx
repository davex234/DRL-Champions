"use client";

/**
 * DETALLE DE LA COLECCIÓN DE UN EQUIPO — todas sus cartas, cuáles tienes y cuáles te FALTAN. Presentación pura sobre la
 * foto del servidor (`TeamDetailView`); la ruta y el arnés montan esta misma pantalla.
 *
 * Cada carta es un requisito: las ediciones de un mismo jugador se pintan por separado y las copias repetidas solo
 * se anotan («×3»), no completan nada más.
 */
import Link from "next/link";
import { useMemo } from "react";
import { CardArt } from "@/components/cards/CardArt";
import { Meter } from "@/components/ui/Meter";
import { getCard } from "@/data/catalog";
import { PACKS } from "@/data/packs";
import { CardRegistry } from "@/collection/registry";
import { getVariant } from "@/domain/cards/variants";
import { cardHref, packsThatCanContain } from "@/domain/collection/room";
import { TEAM_COLLECTION_XP, type TeamDetailView } from "@/domain/teamCollections/model";
import { cn } from "@/lib/format";
import { REGION_TINT } from "./teamCollectionsModel";
import { TeamShield, remainingCards } from "./TrophyRoomScreen";
import { ns, td, getIntlLocale } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("trophies");

type DetailCard = TeamDetailView["cards"][number];

let REG: CardRegistry | null = null;
function whereToGet(cardId: string): string[] {
  try {
    const c = getCard(cardId);
    if (!c) return [];
    REG ??= new CardRegistry();
    return packsThatCanContain(REG, PACKS, c).map((p) => p.name).slice(0, 3);
  } catch { return []; }
}

const variantLabel = (variantId: string): string => { try { return getVariant(variantId as never)?.label ?? variantId; } catch { return variantId; } };

function CardRow({ c }: { c: DetailCard }) {
  useLocale();
  const where = useMemo(() => (c.owned ? [] : whereToGet(c.id)), [c.owned, c.id]);
  const edition = td(variantLabel(c.variantId));
  return (
    <li data-testid="requirement" data-key={c.id} data-satisfied={c.owned ? "1" : "0"}
      className={cn("nx-clip flex min-w-0 items-center gap-3 p-3", c.owned ? "bg-emerald-400/[0.06] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]" : "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]")}>
      <div className="w-[64px] shrink-0 sm:w-[76px]">
        {c.image ? (
          <Link href={cardHref(c.id)} className="nx-focus block" aria-label={t("Ver carta {label}", { label: `${c.nick} · ${edition}` })}>
            <CardArt src={c.image} alt={`${c.nick} · ${edition}`} dim={!c.owned} shadow="rest" sizes="76px" />
          </Link>
        ) : <div className="aspect-[750/1048] w-full rounded bg-white/5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span aria-hidden className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[13px] font-black", c.owned ? "bg-emerald-400 text-black" : "ring-2 ring-white/35 text-white/50")}>{c.owned ? "✓" : ""}</span>
          <span className="truncate font-display text-[17px] font-bold uppercase tracking-wide text-white">{c.nick}</span>
        </p>
        <p className="mt-0.5 truncate text-[12px] text-white/70">{edition} · <span className="nx-readout">{c.ovr}</span></p>
        <p className={cn("mt-0.5 text-[12px] font-bold uppercase tracking-wider", c.owned ? "text-emerald-300" : "text-[#ffce4f]")}>
          {c.owned ? t("Conseguido") : t("Te falta")}
          {c.owned && c.copies > 1 && <span className="font-normal normal-case tracking-normal text-white/60" data-testid="copies"> {t("· ×{copies} copias", { copies: c.copies })}</span>}
        </p>
        {!c.owned && where.length > 0 && <p className="mt-1 text-[12px] text-white/60">{t("Puede salir en:")} <span className="text-white/80">{where.map((w) => td(w)).join(", ")}</span></p>}
      </div>
    </li>
  );
}

export function TeamDetailScreen({ team }: { team: TeamDetailView }) {
  useLocale();
  const done = team.state === "COMPLETED";
  const missing = team.cards.filter((c) => !c.owned);
  const have = team.cards.filter((c) => c.owned);
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:py-8" data-testid="set-detail" data-set={team.id} data-state={team.state}>
      <nav className="mb-3 text-[13px]"><Link href="/coleccion/trofeos" className="nx-focus text-white/60 hover:text-white">{t("← Colecciones")}</Link></nav>

      <header className="nx-clip relative flex flex-col items-center gap-5 overflow-hidden bg-white/[0.03] p-5 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] sm:flex-row sm:text-left">
        <TeamShield team={team} size="lg" locked={!done} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/50">
            {t("Colección de equipo")}{team.region && <> · <span style={{ color: REGION_TINT[team.region] }}>{td(team.region)}</span></>}
          </p>
          <h1 className="font-display text-[34px] font-black uppercase leading-none tracking-wide text-white sm:text-[44px]">{team.title}</h1>
          <div className="mt-3 flex items-center gap-3">
            <Meter value={team.pct} tone={done ? "ok" : "info"} height={8} label={t("Progreso de {title}", { title: team.title })} className="flex-1" />
            <span className="nx-readout shrink-0 font-display text-[22px] font-black text-white" data-testid="set-progress">{team.owned}/{team.total}</span>
          </div>
          <p className={cn("mt-1.5 text-[14px]", done ? "font-bold text-emerald-300" : "text-white/70")}>{remainingCards(team)}</p>
          <p className="mt-1 text-[12px] text-white/55">{t("Hacen falta todas las cartas del equipo: cada edición de cada jugador cuenta por separado.")}</p>
          {team.firstCompletedAt ? (
            <p className="mt-1 text-[12px] text-emerald-300/90" data-testid="first-completion" data-xp={team.xpAwarded ?? "pending"}>
              {t("Completada por primera vez el {fecha}.", { fecha: new Date(team.firstCompletedAt).toLocaleDateString(getIntlLocale(), { day: "numeric", month: "long", year: "numeric" }) })}{" "}
              {team.xpAwarded !== null
                ? (team.xpAwarded > 0 ? t("+{xp} XP de temporada.", { xp: team.xpAwarded }) : "")
                : t("Sus {xp} XP se sumarán cuando haya una temporada activa.", { xp: TEAM_COLLECTION_XP })}
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-[#ffce4f]/90" data-testid="first-completion-reward">{t("Complétala por primera vez y ganas {xp} XP de temporada.", { xp: TEAM_COLLECTION_XP })}</p>
          )}
        </div>
      </header>

      {missing.length > 0 && (
        <section aria-labelledby="missing-title" className="mt-7">
          <h2 id="missing-title" className="mb-3 font-display text-[20px] font-black uppercase tracking-wide text-white">
            {t("{n, plural, one {Te falta #} other {Te faltan #}}", { n: missing.length })}
          </h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="missing-list">
            {missing.map((c) => <CardRow key={c.id} c={c} />)}
          </ul>
        </section>
      )}

      {have.length > 0 && (
        <section aria-labelledby="have-title" className="mt-7">
          <h2 id="have-title" className="mb-3 font-display text-[20px] font-black uppercase tracking-wide text-white">{t("Ya tienes")} {have.length}</h2>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2" data-testid="have-list">
            {have.map((c) => <CardRow key={c.id} c={c} />)}
          </ul>
        </section>
      )}
    </div>
  );
}
