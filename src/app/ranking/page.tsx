"use client";

/**
 * CLASIFICACIÓN — global, regional y por torneo.
 *
 * Las tres ordenan por datos que SOLO escribe el servidor: `profiles.points` (que
 * reparte el corrector de Pick'ems) y `pickem_scores`. Las clasificaciones antiguas
 * ordenaban por columnas que subía el propio cliente, así que eran falsificables; se
 * retiraron en lugar de dejarlas obsoletas.
 *
 * Fase 9D — el ámbito REGIONAL. Un puesto 4.812 del mundo no le dice nada a nadie;
 * «#12 de Europa» sí. La región la declara el usuario en su perfil: quien no la haya
 * declarado sigue contando en la global y esta pestaña se lo explica en lugar de
 * colocarlo en una región que no es la suya.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchGlobalRanking, fetchRegionalRanking, fetchTournamentRanking, fetchPickemOptions,
  fetchMyRankPosition, fetchMyRegionalPosition,
  type RankingRow, type TournamentRankingRow,
} from "@/lib/game/client";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useAuth } from "@/lib/supabase/auth";
import {
  rankDisplay, rankProgress, RANK_REGIONS, REGION_LABEL, EUROPE_REGION,
  type RankRegion,
} from "@/domain/progression/rank";
import { RankBadge } from "@/components/progression/RankBadge";
import { RankEmblem, rankLadder } from "@/components/progression/RankEmblem";
import { Loading, ErrorState, EmptyState, NeedsAccount } from "@/components/ui/States";
import { Plate, Recessed } from "@/components/ui/Surface";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { cn } from "@/lib/format";

type Tab = "global" | "region" | "torneo";

export default function RankingPage() {
  const configured = isSupabaseConfigured();
  const { user, profile } = useAuth();

  const [tab, setTab] = useState<Tab>("global");
  const [global, setGlobal] = useState<RankingRow[]>([]);
  const [options, setOptions] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [tournament, setTournament] = useState<TournamentRankingRow[]>([]);
  const [myPos, setMyPos] = useState<number | null>(null);
  // Ámbito regional. Arranca en la región del usuario; si no tiene, en Europa, que es
  // la que la Fase 9 pide que esté siempre disponible.
  const [scope, setScope] = useState<RankRegion>(EUROPE_REGION);
  const [regional, setRegional] = useState<RankingRow[]>([]);
  const [myRegionPos, setMyRegionPos] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [g, opts] = await Promise.all([fetchGlobalRanking(), fetchPickemOptions()]);
      setGlobal(g);
      setOptions(opts);
      if (opts.length > 0) setSelected((s) => s || opts[0].id);
      if (profile) {
        const [pos, rpos] = await Promise.all([
          fetchMyRankPosition(profile.points ?? 0),
          fetchMyRegionalPosition(profile.points ?? 0, profile.region ?? null),
        ]);
        setMyPos(pos);
        setMyRegionPos(rpos);
        if (profile.region) setScope(profile.region);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la clasificación");
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => { if (configured) load(); else setLoading(false); }, [configured, load]);

  // La clasificación regional se recarga sola al cambiar de región.
  useEffect(() => {
    let alive = true;
    fetchRegionalRanking(scope)
      .then((r) => { if (alive) setRegional(r); })
      .catch(() => { if (alive) setRegional([]); });
    return () => { alive = false; };
  }, [scope]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetchTournamentRanking(selected)
      .then((r) => { if (alive) setTournament(r); })
      .catch(() => { if (alive) setTournament([]); });
    return () => { alive = false; };
  }, [selected]);

  const inTop = global.some((r) => r.id === user?.id);
  const inRegionTop = regional.some((r) => r.id === user?.id);

  return (
    <section className="animate-rise">
      <header className="mb-6">
        <span className="nx-label">Progreso</span>
        <h1 className="mt-1 font-display text-[clamp(28px,5vw,44px)] font-bold uppercase leading-none text-white">
          Clasificación
        </h1>
        <p className="mt-2 text-[15px] text-white/55">
          Clasificación por puntos: Pick&apos;ems y duelos contra el bot. El ranked PvP tiene su propia escalera por rating en Competitivo.
        </p>
      </header>

      {!configured ? (
        <NeedsAccount what="La clasificación" />
      ) : loading ? (
        <Loading label="Cargando clasificación" />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          {/* ── Mi rango ── */}
          {user && profile && (
            <div className="mb-6">
              <RankBadge
                points={profile.points ?? 0}
                position={myPos}
                regionPosition={myRegionPos}
                region={profile.region ?? null}
                action={{ href: "/pickems", label: "Sumar puntos" }}
              />
            </div>
          )}

          {/*
            ── Pestañas ──
            FASE 11 · La activa era una CÁPSULA roja de 450 px con resplandor: la píldora
            decorativa que el lenguaje de la casa no usa. Ahora son tres controles con el
            chaflán del sistema dentro de una superficie hundida, con 44 px de alto y la
            semántica de pestaña (`role="tab"` y `aria-selected`), que antes no tenían.
          */}
          <Recessed depth="sm" className="mb-5 flex gap-1 p-1" role="tablist" aria-label="Ámbito de la clasificación">
            {([["global", "Global"], ["region", "Por región"], ["torneo", "Por torneo"]] as [Tab, string][]).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                disabled={id === "torneo" && options.length === 0}
                className={cn(
                  "nx-clip-sm min-h-[44px] flex-1 px-4 font-display text-sm uppercase tracking-wide transition duration-fast",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  tab === id
                    ? "bg-drl text-white"
                    : "text-ink-muted hover:text-white",
                )}
              >
                {label}
              </button>
            ))}
          </Recessed>

          {tab === "global" ? (
            global.length === 0 ? (
              <EmptyState icon="🏅" title="Todavía no hay clasificación"
                hint="Haz tus predicciones en un torneo: en cuanto se corrijan, aparecerás aquí."
                action={{ href: "/torneos", label: "Ir a los torneos" }} />
            ) : (
              <>
                <div className="space-y-2">
                  {global.map((r, i) => (
                    <Row
                      key={r.id}
                      position={i + 1}
                      avatar={r.avatar}
                      username={r.username}
                      points={r.points}
                      isMe={r.id === user?.id}
                    />
                  ))}
                </div>

                {/* El usuario, si está fuera del top mostrado. */}
                {user && profile && !inTop && myPos && (
                  <>
                    <p className="my-2 text-center text-white/25">···</p>
                    <Row
                      position={myPos}
                      avatar={profile.avatar}
                      username={profile.username}
                      points={profile.points ?? 0}
                      isMe
                    />
                  </>
                )}
              </>
            )
          ) : tab === "region" ? (
            <>
              {/* Selector de región. No es un filtro del ranking global: cada región
                  tiene su propia tabla y su propio primero. */}
              <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Región">
                {RANK_REGIONS.map((rg) => (
                  <button
                    key={rg}
                    type="button"
                    onClick={() => setScope(rg)}
                    aria-pressed={scope === rg}
                    className={cn(
                      "nx-clip-sm min-h-[44px] px-3.5 font-display text-[12px] font-bold uppercase tracking-wide transition duration-fast",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl-cyan",
                      scope === rg
                        ? "bg-drl-cyan/10 text-drl-cyan shadow-[inset_0_0_0_1px_rgb(25_227_255_/_0.6)]"
                        : "text-ink-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:text-white",
                    )}
                  >
                    {REGION_LABEL[rg]}
                  </button>
                ))}
              </div>

              {user && profile && !profile.region && (
                <p className="nx-rail nx-clip-sm mb-4 px-4 py-3 text-[13px] text-white/70">
                  No has declarado tu región, así que no apareces en ninguna clasificación
                  regional —sí en la global.{" "}
                  <Link href="/cuenta" className="text-drl underline-offset-2 hover:underline">
                    Elígela en tu perfil
                  </Link>.
                </p>
              )}

              {regional.length === 0 ? (
                <EmptyState icon="🌍" title={`Todavía no hay clasificación en ${REGION_LABEL[scope]}`}
                  hint="Aparecerá en cuanto alguien de esa región puntúe en un torneo."
                  action={{ href: "/pickems", label: "Ver Pick'ems" }} />
              ) : (
                <>
                  <div className="space-y-2">
                    {regional.map((r, i) => (
                      <Row
                        key={r.id}
                        position={i + 1}
                        avatar={r.avatar}
                        username={r.username}
                        points={r.points}
                        isMe={r.id === user?.id}
                      />
                    ))}
                  </div>

                  {user && profile && profile.region === scope && !inRegionTop && myRegionPos && (
                    <>
                      <p className="my-2 text-center text-white/25">···</p>
                      <Row
                        position={myRegionPos}
                        avatar={profile.avatar}
                        username={profile.username}
                        points={profile.points ?? 0}
                        isMe
                      />
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              {options.length > 1 && (
                /*
                  FASE 11 · Era el único `<select>` nativo de la sección. Un desplegable del
                  sistema operativo dentro de una clasificación competitiva rompe el idioma
                  y en móvil abre una rueda nativa encima de la tabla. Mismos torneos, mismo
                  estado, con la geometría de la casa y 44 px de objetivo táctil.
                */
                <div className="mb-4">
                  <SectionTitle as="h2">Torneo</SectionTitle>
                  <Recessed depth="sm" className="flex max-w-full gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Torneo">
                    {options.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setSelected(o.id)}
                        aria-pressed={selected === o.id}
                        className={cn(
                          "nx-clip-sm min-h-[44px] shrink-0 px-3.5 font-display text-[12px] font-bold uppercase tracking-wide transition duration-fast",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl",
                          selected === o.id ? "bg-drl text-white" : "text-ink-muted hover:text-white",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </Recessed>
                </div>
              )}

              {tournament.length === 0 ? (
                <EmptyState icon="🗳️" title="Este torneo aún no tiene clasificación"
                  hint="Aparecerá cuando se corrijan las primeras predicciones."
                  action={{ href: "/pickems", label: "Ver Pick'ems" }} />
              ) : (
                <div className="space-y-2">
                  {tournament.map((r, i) => (
                    <Row
                      key={r.user_id}
                      position={i + 1}
                      avatar={r.avatar}
                      username={r.username}
                      points={r.points}
                      detail={`${r.correct}/${r.total} aciertos`}
                      isMe={r.user_id === user?.id}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/*
            ═══ LA ESCALERA ═══
            La pieza que faltaba entera. El sistema de rangos existía —nueve escalones,
            divisiones, cúspide posicional— pero el jugador solo veía el suyo: no había
            forma de saber qué hay por encima ni cuánto cuesta. Un rango que no se puede
            ver no se persigue.

            Se dibujan los OCHO escalones reales; «Sin clasificar» no sale porque es un
            estado, no una meta, y enseñarlo aquí sugeriría que hay algo que ganar por no
            haber jugado.
          */}
          <section className="mt-10" aria-label="Los rangos de puntos">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-bold uppercase tracking-[0.06em] text-white">
                Rangos de puntos
              </h2>
              <span className="nx-label">Ocho rangos · tres divisiones cada uno</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
              {rankLadder().map((tier) => {
                const mine = profile ? rankProgress(profile.points ?? 0).tier.id === tier.id : false;
                const reached = profile ? (profile.points ?? 0) >= tier.min : false;
                return (
                  <div
                    key={tier.id}
                    className="nx-clip-sm relative flex flex-col items-center border px-3 py-4 text-center transition duration-fast"
                    style={{
                      borderColor: mine ? tier.color : reached ? `${tier.color}44` : "rgba(255,255,255,0.08)",
                      background: mine ? `${tier.color}14` : "rgba(255,255,255,0.02)",
                    }}
                  >
                    {mine && (
                      <span
                        className="absolute -top-px left-1/2 -translate-x-1/2 px-2 py-0.5 font-display text-[9px] font-bold uppercase tracking-[0.14em]"
                        style={{ background: tier.color, color: "#06070d" }}
                      >
                        Tu rango
                      </span>
                    )}
                    <RankEmblem
                      tierId={tier.id}
                      color={tier.color}
                      size={62}
                      className={cn("mt-1", !reached && "opacity-35")}
                    />
                    <b
                      className="mt-2 font-display text-[13px] font-bold uppercase tracking-[0.08em]"
                      style={{ color: reached ? tier.color : "rgba(255,255,255,0.4)" }}
                    >
                      {tier.label}
                    </b>
                    <span className="nx-readout mt-0.5 text-[11px] text-white/35">
                      {tier.min === 1 ? "1 pt" : `${tier.min} pts`}
                    </span>
                  </div>
                );
              })}
            </div>

            <p className="mt-3 text-[13px] text-white/40">
              La cúspide, <b className="text-drl-gold">Champion</b>, no se alcanza por puntos: la
              ocupa quien va primero del mundo dentro de Nexus. Solo puede haber uno.
            </p>
          </section>

          {/*
            FASE 11 · El enlace del pie medía 119 × 15 px: el único control de la sección por
            debajo de 32. Sigue siendo una frase, pero su parte pulsable es un objetivo de 44.
          */}
          <p className="mt-8 flex flex-wrap items-center justify-center gap-x-1 text-center text-xs text-white/30">
            Los puntos los reparte el servidor: al corregir cada torneo de Pick&apos;ems y al terminar cada duelo contra el bot.
            <Link href="/pickems" className="nx-action !text-drl">Haz tus predicciones →</Link>
          </p>
        </>
      )}
    </section>
  );
}

function Row({
  position, avatar, username, points, detail, isMe,
}: {
  position: number;
  avatar: string;
  username: string;
  points: number;
  detail?: string;
  isMe?: boolean;
}) {
  // La etiqueta lleva división («Oro II»), y el primero del mundo aparece como Champion.
  const display = rankDisplay(points, position);
  return (
    <Plate
      tone={isMe ? "primary" : position <= 3 ? "gold" : "neutral"}
      className="flex items-center gap-3 px-4 py-3"
    >
      {/*
        Placa de puesto. Antes los tres primeros llevaban 🥇🥈🥉: emoji del sistema, que cambia
        de dibujo en cada plataforma y desentona con todo lo demas. El podio se marca con
        el color de la placa, que ademas funciona en blanco y negro.
      */}
      <span
        className="nx-clip-sm grid h-10 w-11 shrink-0 place-items-center border font-display text-[15px] font-bold tabular-nums"
        style={{
          borderColor: position <= 3 ? "rgba(255,211,92,0.45)" : "rgba(255,255,255,0.1)",
          background: position <= 3 ? "rgba(255,211,92,0.1)" : "rgba(255,255,255,0.03)",
          color: position === 1 ? "#ffd35c" : position === 2 ? "#c8d2dc" : position === 3 ? "#cd7f32" : "rgba(255,255,255,0.5)",
          ["--nx-chamfer-sm" as string]: "7px",
        }}
      >
        {position}
      </span>
      <span className="nx-clip-sm grid h-11 w-11 shrink-0 place-items-center bg-base-800 text-xl">
        {avatar}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display font-bold text-white">
          {username}
          {isMe && <span className="ml-2 text-xs font-normal text-drl">tú</span>}
        </span>
        {detail && <span className="block text-[11px] text-white/40">{detail}</span>}
      </span>
      {/* El emblema del rango, no solo su nombre: la escalera se ve tambien en la lista. */}
      <RankEmblem
        tierId={display.champion ? "nexus" : rankProgress(points).tier.id}
        color={display.color}
        champion={display.champion}
        size={26}
        className="shrink-0 opacity-85"
      />
      <span className="hidden shrink-0 font-display text-[11px] uppercase tracking-wider sm:block"
        style={{ color: display.color }}>
        {display.label}
      </span>
      <span className="w-20 shrink-0 text-right font-display text-sm font-bold tabular-nums text-drl-gold">
        {points} pts
      </span>
    </Plate>
  );
}
