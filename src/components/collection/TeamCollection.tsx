"use client";

/**
 * COLECCIÓN POR EQUIPO (Fase 21.3, §8-§9).
 *
 * Explora la colección del usuario agrupada por equipo. Reutiliza TODO lo existente: las cartas
 * del store (`useGameStore.ownedCards`), la proyección pura `buildTeamCollection`, las identidades
 * de `teamIdentities`, los componentes de carta (`PlayerCard`/`CardVisual`/`Card3D`) y el detalle
 * (`CardViewer`) con su serial y valor reales. No recalcula OVR/valor, no acuña, no crea cartas.
 * Team Heretics es un equipo más: no hay ningún `if team === …`.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/store/useGameStore";
import { buildTeamCollection, sortTeamCards, type TeamCollectionEntry, type TeamCardSort } from "@/domain/collections/teamCollection";
import { getPlayer } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardVisual } from "@/components/cards/CardVisual";
import { Card3D, card3DStagger } from "@/components/visual/Card3D";
import { CardViewer } from "@/components/cards/CardViewer";
import { TeamLogo } from "@/components/cards/layers/TeamLogo";
import { Meter } from "@/components/ui/Meter";
import { Badge } from "@/components/ui/Badge";
import { Segmented } from "@/components/ui/Segmented";
import { formatCredits } from "@/lib/format";
import { CreditGlyph } from "@/components/ui/game/GameGlyph";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("collection");

const SORTS: { value: TeamCardSort; label: string }[] = [
  { value: "rareza", label: "Rareza" },
  { value: "ovr", label: "OVR" },
  { value: "valor", label: "Valor" },
  { value: "reciente", label: "Reciente" },
];

export function TeamCollection() {
  useLocale();
  const router = useRouter();
  const owned = useGameStore((s) => s.ownedCards);
  const entries = useMemo(() => buildTeamCollection(owned), [owned]);

  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TeamCardSort>("rareza");
  const [viewUid, setViewUid] = useState<string | null>(null);

  const current = selected ? entries.find((e) => e.team === selected) ?? null : null;

  if (owned.length === 0 || entries.length === 0) {
    return (
      <Empty
        title={t("Aún no tienes cartas de ningún equipo")}
        body={t("Abre un sobre para empezar tu colección. Cuando obtengas cartas, aquí verás cuánto llevas de cada equipo.")}
        cta={{ label: t("Ir al catálogo de sobres"), href: "/packs" }}
        router={router}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">
      {!current ? (
        <TeamList entries={entries} onSelect={setSelected} />
      ) : (
        <TeamDetail
          entry={current}
          sort={sort}
          onSort={setSort}
          query={query}
          onQuery={setQuery}
          onBack={() => { setSelected(null); setQuery(""); }}
          onOpen={setViewUid}
        />
      )}

      {/* Detalle de carta — el visor existente, con serial y valor reales. */}
      {viewUid && current && (() => {
        const cell = current.cards.find((c) => c.uid === viewUid);
        if (!cell) return null;
        return (
          <CardViewer
            card={cell.def}
            uid={cell.uid}
            serial={cell.serial}
            ownership={{ owned: true, count: cell.count }}
            onClose={() => setViewUid(null)}
          />
        );
      })()}
    </div>
  );
}

/** LISTA DE EQUIPOS — mosaicos con el progreso del usuario. */
function TeamList({ entries, onSelect }: { entries: TeamCollectionEntry[]; onSelect: (team: string) => void }) {
  useLocale();
  const totalDistinct = entries.reduce((s, e) => s + e.ownedDistinct, 0);
  return (
    <>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">{t("Colección por equipo")}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {fill(t("Tienes cartas de {equipos} equipos · {cartas} cartas distintas. Elige uno para verlas.", slots("equipos", "cartas")), { equipos: <b className="text-white">{entries.length}</b>, cartas: <b className="text-white">{totalDistinct}</b> })}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => (
          <button
            key={e.team}
            type="button"
            onClick={() => onSelect(e.team)}
            aria-label={t("Ver mi colección de {displayName}", { displayName: e.displayName })}
            className="nx-focus nx-clip group flex items-center gap-4 bg-white/[0.03] p-4 text-left shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] transition hover:bg-white/[0.06] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.20)]"
          >
            <div className="grid h-14 w-14 shrink-0 place-items-center">
              <TeamLogo team={e.team} size={48} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-display text-base font-bold text-white">{e.displayName}</h2>
                {e.region && <span className="text-caption text-ink-faint">{td(e.region)}</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <Meter value={e.progress * 100} tone="info" height={5} label={t("Progreso de {displayName}", { displayName: e.displayName })} className="flex-1" />
                <span className="nx-readout shrink-0 text-caption text-ink-secondary">{e.ownedDistinct}/{e.total}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/** DETALLE DE UN EQUIPO — sus cartas poseídas, con búsqueda, orden y acceso al detalle. */
function TeamDetail({
  entry, sort, onSort, query, onQuery, onBack, onOpen,
}: {
  entry: TeamCollectionEntry;
  sort: TeamCardSort; onSort: (s: TeamCardSort) => void;
  query: string; onQuery: (q: string) => void;
  onBack: () => void; onOpen: (uid: string) => void;
}) {
  useLocale();
  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entry.cards.filter((c) => {
          const p = getPlayer(c.def.playerId);
          return `${p?.nick ?? ""} ${p?.fullName ?? ""}`.toLowerCase().includes(q);
        })
      : entry.cards;
    return sortTeamCards(filtered, sort);
  }, [entry.cards, query, sort]);

  return (
    <>
      <button onClick={onBack} className="nx-focus mb-4 inline-flex items-center gap-1 text-caption text-ink-muted hover:text-white">
        {t("← Equipos")}
      </button>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <TeamLogo team={entry.team} size={56} />
          <div>
            <h1 className="font-display text-2xl font-bold uppercase text-white md:text-3xl">{entry.displayName}</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
              <b className="nx-readout text-white">{entry.ownedDistinct}</b> / {entry.total} {t("cartas")}
              <span className="text-ink-faint">·</span>
              <b className="nx-readout text-white">{Math.round(entry.progress * 100)}%</b>
              {entry.ownedCopies > entry.ownedDistinct && (
                <>
                  <span className="text-ink-faint">·</span>
                  <span>{entry.ownedCopies} {t("copias")}</span>
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="nx-clip-sm flex min-w-[200px] flex-1 items-center gap-2 bg-white/[0.04] px-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] sm:max-w-xs">
          <span aria-hidden className="text-ink-faint">🔎</span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("Buscar jugador…")}
            aria-label={t("Buscar jugador en {displayName}", { displayName: entry.displayName })}
            className="nx-focus min-h-[44px] w-full bg-transparent text-body text-white placeholder:text-ink-faint focus:outline-none"
          />
        </label>
        <Segmented value={sort} onChange={onSort} options={SORTS} label={t("Ordenar cartas")} />
      </div>

      {cards.length === 0 ? (
        <div className="nx-clip flex min-h-[200px] items-center justify-center bg-white/[0.02] p-8 text-center text-sm text-ink-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          {t("Ningún jugador coincide con «")}{query}».
        </div>
      ) : (
        <div className="grid grid-cols-2 justify-items-center gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
          {cards.map((c, i) => (
            <button
              key={c.uid}
              type="button"
              onClick={() => onOpen(c.uid)}
              aria-label={t("Ver {v}", { v: getPlayer(c.def.playerId)?.nick ?? c.cardId })}
              className="nx-focus group relative w-full max-w-[190px]"
            >
              <Card3D mode="static" status={undefined} delay={card3DStagger(i, 0.05, 0.3)} className="w-full">
                <CardVisual uid={c.uid} alt={t("Carta de {v}", { v: getPlayer(c.def.playerId)?.nick ?? c.cardId })} chamfer="12px" className="w-full">
                  <PlayerCard card={c.def} size="sm" serial={c.serial} interactive={false} />
                </CardVisual>
              </Card3D>
              <div className="mt-1.5 flex items-center justify-center gap-1.5">
                {c.count > 1 && <Badge tone="info">×{c.count}</Badge>}
                {getVariant(c.def.variantId).serialized && c.serial != null && (
                  <span className="nx-readout text-caption text-ink-faint">#{c.serial}</span>
                )}
                <span className="nx-readout text-caption text-drl-gold"><CreditGlyph className="align-[-2px]" /> {formatCredits(c.value)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function Empty({ title, body, cta, router }: { title: string; body: string; cta: { label: string; href: string }; router: ReturnType<typeof useRouter> }) {
  useLocale();
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-display text-2xl font-bold uppercase text-white">{td(title)}</h1>
      <p className="max-w-md text-sm text-ink-muted">{td(body)}</p>
      <button
        onClick={() => router.push(cta.href)}
        className="nx-focus nx-clip-sm bg-drl px-5 py-3 font-display text-label font-bold uppercase tracking-wide2 text-white shadow-glow"
      >
        {td(cta.label)}
      </button>
    </div>
  );
}
