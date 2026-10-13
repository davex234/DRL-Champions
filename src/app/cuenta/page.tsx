"use client";

/**
 * PERFIL — la FICHA DE JUGADOR (recompuesta en 9.6).
 *
 * Todas las cifras vienen del servidor: `profiles` (rango, puntos, saldo, XP),
 * `user_cards`, `user_packs` y `pickem_scores`. Nada de esto se puede modificar desde el
 * navegador, y eso no cambia: lo que cambia es cómo se presenta.
 *
 * EL PROBLEMA (captura `18-perfil`). El perfil era un cuadro de mando: una tarjeta de
 * identidad con doce emoji de avatar desplegados a la vista, una tarjeta de rango, cuatro
 * botones de región y **ocho celdas con una cifra cada una**. Ocho módulos pequeños del
 * mismo tamaño, ninguno más importante que otro. Ninguna respuesta a la pregunta de un
 * jugador que abre su perfil: *¿quién soy en este juego?*
 *
 * LA RECOMPOSICIÓN
 *
 *   1. **Una ficha, no tres tarjetas.** Identidad, rango y progreso viven en el mismo
 *      escenario, teñido por el color del rango. El emblema es la pieza grande.
 *   2. **Las cifras salen de sus cajas.** Las ocho celdas pasan a ser una tira de datos de
 *      HUD sobre la ficha. Mismos ocho datos, mismos destinos, cero cajas.
 *   3. **Se enseñan tus cartas.** Un perfil de un juego de cartas que no enseña ni una
 *      carta habla de todo menos de lo que has conseguido. Sale del store que ya estaba
 *      cargado: ni una lectura nueva.
 *   4. **Los ajustes, al final.** Avatar y región son configuración. Estaban por delante
 *      de las estadísticas y por eso el perfil parecía un formulario de cuenta.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/supabase/auth";
import { AuthForms } from "@/components/auth/AuthForms";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { useGameStore } from "@/store/useGameStore";
import { useEconomyView } from "@/lib/game/serverEconomy";
import { Toast } from "@/components/ui/Toast";
import { AudioSettingsPanel } from "@/components/ui/game/AudioSettingsPanel";
import { OpeningAnimationSettings } from "@/components/ui/game/OpeningAnimationSettings";
import { useToast } from "@/lib/useToast";
import { formatCredits, cn } from "@/lib/format";
import { equippedDefs } from "@/domain/cosmetics/catalog";
import { fetchPrestige, type PrestigeView } from "@/lib/game/prestige";
import { RankEmblem } from "@/components/progression/RankEmblem";
import { CompetitiveSummary } from "@/components/competitive/CompetitiveSummary";
import { SocialSummary } from "@/components/social/SocialSummary";
import { ProfilePreviewCard } from "@/components/player/ProfilePreviewCard";
import { AVATARS } from "@/domain/profile/avatars";
import { rankProgress, rankDisplay } from "@/domain/progression/rank";
import { levelFromXp } from "@/domain/progression/levels";
import { Plate, Recessed } from "@/components/ui/Surface";
import { Readout as NxReadout } from "@/components/ui/Readout";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { InternalTools } from "@/components/layout/InternalTools";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Card3D, card3DStagger } from "@/components/visual/Card3D";
import { getCard } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { Loading, EmptyState } from "@/components/ui/States";
import {
  fetchMyRankPosition, fetchMyRegionalPosition, setMyRegion, fetchLedger, fetchMyPacks,
} from "@/lib/game/client";
import { RANK_REGIONS, REGION_LABEL, type RankRegion } from "@/domain/progression/rank";
import { isReward } from "@/domain/pickems/ledger";
import { groupCollection } from "@/store/selectors";
import { TOTAL_CARDS } from "@/data/catalog";
import { PasswordRecoveryForm } from "@/components/auth/PasswordRecoveryForm";
import { playerMessage } from "@/components/ui/game/GameStates";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AccountHub, accountSectionOf } from "@/components/account/AccountHub";



interface PickemSummary { events: number; points: number; correct: number; total: number }

const NO_CARDS: ReturnType<typeof useGameStore.getState>["ownedCards"] = [];

/**
 * IA 2026-10-07 · la pantalla de siempre de `/cuenta` (ficha + ajustes; y, sin sesión, entrar / registrarse / recuperar)
 * pasa a ser la pestaña CUENTA de MI CUENTA. Su lógica no cambia.
 */
function AccountSettings() {
  const { configured, loading, user, profile, signOut, refreshProfile, recovering } = useAuth();
  const { toast, notify } = useToast();
  const [savingAvatar, setSavingAvatar] = useState<string | null>(null);

  // F81.2 · la colección del store solo es de esta cuenta cuando su estado del servidor ya está volcado (ni caché, ni demo).
  const collectionReady = useEconomyView() === "server";
  const storeCards = useGameStore((s) => s.ownedCards);
  const ownedCards = collectionReady ? storeCards : NO_CARDS;

  const [position, setPosition] = useState<number | null>(null);
  const [regionPosition, setRegionPosition] = useState<number | null>(null);
  const [savingRegion, setSavingRegion] = useState(false);
  const [rewards, setRewards] = useState(0);
  const [packs, setPacks] = useState(0);
  const [pickems, setPickems] = useState<PickemSummary>({ events: 0, points: 0, correct: 0, total: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  /*
   * LA VITRINA DE PRESTIGIO (Fase 14). Es lo que convierte la ficha en identidad: el rango
   * dice lo bien que juegas y la coleccion lo mucho que tienes, pero el prestigio dice a QUE
   * le has dedicado creditos, que es una eleccion y no un numero.
   *
   * Falla en silencio y no bloquea nada: el perfil no puede quedarse en blanco porque una
   * vitrina no haya llegado.
   */
  const [prestige, setPrestige] = useState<PrestigeView | null>(null);
  useEffect(() => {
    if (!user) { setPrestige(null); return; }
    let alive = true;
    fetchPrestige()
      .then((v) => { if (alive) setPrestige(v); })
      .catch(() => { if (alive) setPrestige(null); });
    return () => { alive = false; };
  }, [user]);

  const loadStats = useCallback(async () => {
    if (!user) return;
    setStatsLoading(true);
    try {
      const sb = getSupabase();
      const [pos, regPos, ledger, myPacks] = await Promise.all([
        fetchMyRankPosition(profile?.points ?? 0),
        fetchMyRegionalPosition(profile?.points ?? 0, profile?.region ?? null),
        fetchLedger(100),
        fetchMyPacks(),
      ]);
      setPosition(pos);
      setRegionPosition(regPos);
      setRewards(ledger.filter((r) => isReward(r.reason)).length);
      setPacks(Object.values(myPacks).reduce((s, n) => s + n, 0));

      if (sb) {
        const { data } = await sb.from("pickem_scores")
          .select("points, correct, total").eq("user_id", user.id);
        const rows = (data as { points: number; correct: number; total: number }[]) ?? [];
        setPickems({
          events: rows.length,
          points: rows.reduce((s, r) => s + r.points, 0),
          correct: rows.reduce((s, r) => s + r.correct, 0),
          total: rows.reduce((s, r) => s + r.total, 0),
        });
      }
    } finally {
      setStatsLoading(false);
    }
  }, [user, profile?.points]);

  useEffect(() => { if (user) loadStats(); }, [user, loadStats]);

  async function setAvatar(avatar: string) {
    if (!user) return;
    setSavingAvatar(avatar);
    const { error } = await getSupabase()!.from("profiles").update({ avatar }).eq("id", user.id);
    await refreshProfile();
    setSavingAvatar(null);
    notify(error ? "No se pudo cambiar el avatar" : "Avatar actualizado", !error);
  }

  if (!configured) {
    return (
      <section className="animate-rise">
        <Header />
        <EmptyState
          icon="📦"
          title="Modo local"
          hint="Estás jugando con tu progreso guardado en este dispositivo. Para competir en torneos, Pick'ems y clasificación hace falta una cuenta online."
        />
      </section>
    );
  }

  // F69 · CLS: mientras carga, la página reserva la altura de la pantalla; si no, el pie («Instalar NEXUS») entraba en
  // pantalla y saltaba abajo al llegar la ficha (0,068 del CLS a 1440).
  if (loading) return <><Header /><div className="min-h-screen"><Loading label="Cargando tu perfil" /></div></>;

  // F67 · vuelta desde el correo de «recuperar contraseña»: primero se fija la nueva.
  if (recovering) {
    return (
      <section className="animate-rise">
        <Header />
        <PasswordRecoveryForm />
      </section>
    );
  }

  if (!user || !profile) {
    return (
      <section className="animate-rise">
        <Header signedOut />
        <AuthForms />
      </section>
    );
  }

  const distinct = groupCollection(ownedCards).size;
  const accuracy = pickems.total > 0 ? Math.round((pickems.correct / pickems.total) * 100) : null;

  const points = profile.points ?? 0;
  const rank = rankProgress(points);
  const display = rankDisplay(points, position);
  /*
   * EL NIVEL, DERIVADO DE LA XP con la función del dominio —la misma que usa la barra
   * superior del armazón—. Ver el comentario largo junto a «Nivel {nivel.level}».
   */
  const nivel = levelFromXp(profile.xp ?? 0);

  /*
   * Lo que el jugador lleva puesto. `profiles.equipped` lo escribe SOLO el servidor
   * (`app_equip_cosmetic`, migracion 0022) y el trigger guardian lo cierra al cliente, asi
   * que aqui basta con leerlo y traducirlo a algo que se pueda ver.
   */
  const look = equippedDefs(
    (profile as unknown as { equipped?: Record<string, string> } | null)?.equipped,
  );

  /*
   * Las cuatro mejores cartas: mayor rareza y, a igualdad, mayor media. Sale del store que
   * la pantalla ya tenia cargado -`ownedCards`-, asi que no hay ni una lectura nueva.
   */
  const showcase = (() => {
    const seen = new Set<string>();
    return ownedCards
      .map((o) => ({ owned: o, def: getCard(o.cardId) }))
      .filter((x): x is { owned: typeof ownedCards[number]; def: NonNullable<ReturnType<typeof getCard>> } => !!x.def)
      .filter((x) => (seen.has(x.def.id) ? false : (seen.add(x.def.id), true)))
      .sort((a, b) =>
        getVariant(b.def.variantId).rank - getVariant(a.def.variantId).rank || b.def.ovr - a.def.ovr)
      .slice(0, 4);
  })();

  return (
    <section className="animate-rise space-y-8">
      {/* ═══════════════ LA FICHA ═══════════════ */}
      <div
        className="nx-stage nx-stage-grid nx-clip relative overflow-hidden"
        style={{ ["--nx-tint" as string]: hexToRgbTriplet(display.color) }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background: `radial-gradient(680px 340px at 12% 116%, ${display.color}3a, transparent 66%)`,
          }}
        />

        <div className="relative flex flex-wrap items-center gap-x-7 gap-y-5 px-5 py-7 sm:px-9 sm:py-9">
          {/* Emblema de rango: la pieza grande de la ficha. */}
          <RankEmblem
            tierId={display.champion ? "nexus" : rank.tier.id}
            color={display.color}
            champion={display.champion}
            division={rank.division}
            divisions={rank.tier.divisions}
            size={112}
            className="shrink-0 drop-shadow-[0_10px_28px_rgba(0,0,0,0.75)]"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className="nx-clip-sm px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.14em]"
                style={{ background: `${display.color}22`, color: display.color }}
              >
                {display.label}
              </span>
              {profile.region && (
                <span className="nx-label">{REGION_LABEL[profile.region as RankRegion]}</span>
              )}
            </div>

            <h1 className="mt-2 flex flex-wrap items-center gap-3 break-words font-display text-[clamp(28px,6vw,52px)] font-bold uppercase leading-none text-white">
              {profile.username}
              {/*
                EL BANDERIN EQUIPADO (Fase 12). La Fase 11 dejo equipar cosmeticos y no
                habia donde verlos: un aspecto invisible es un producto que no existe, y el
                carril de pago del pase reparte exclusivamente aspecto.
              */}
              {look.banderin && (
                <span
                  className="nx-clip-sm inline-flex items-center gap-1.5 px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{ background: `${look.banderin.color}22`, color: look.banderin.color }}
                  title={`Banderín: ${look.banderin.label}`}
                >
                  <span aria-hidden>{look.banderin.glyph ?? "⬢"}</span>
                  {look.banderin.label}
                </span>
              )}
            </h1>

            {/* El titulo equipado, justo debajo del nombre: es donde se lee un titulo. */}
            {(look.titulo || look.insignia) && (
              <p className="mt-1 flex flex-wrap items-center gap-2.5">
                {look.titulo && (
                  <span
                    className="font-display text-[13px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: look.titulo.color }}
                  >
                    {look.titulo.label}
                  </span>
                )}
                {/*
                  LA INSIGNIA DE MAESTRIA (Fase 13). Es lo unico del perfil que dice algo
                  sobre la COLECCION y no sobre el rango: «tengo el equipo entero» es un
                  logro distinto de «he subido a Platino», y merece verse al lado.
                */}
                {look.insignia && (
                  <span
                    className="inline-flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.14em]"
                    style={{ color: look.insignia.color }}
                    title={`Insignia: ${look.insignia.label}`}
                  >
                    <span aria-hidden>{look.insignia.glyph ?? "◆"}</span>
                    {look.insignia.label}
                  </span>
                )}
              </p>
            )}

            <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[13px] text-white/50">
              {/*
                ═══ FASE 11 · EL NIVEL SALE DE LA XP, NO DE UNA COLUMNA MUERTA ═══

                Medido en la base: `profiles.level` vale 1 para TODO el mundo —incluido un
                perfil con 2.567 XP— porque nadie la escribe. La barra superior del armazón
                ya deriva el nivel de la XP con `levelFromXp`, así que en la misma pantalla
                se leía «NIVEL 11» arriba y «Nivel 1» en la ficha.

                Aquí NO se calcula nada nuevo: se llama a la MISMA función del dominio que
                usa el armazón. La columna se queda donde está —no se toca el esquema— y el
                arreglo del dato queda documentado como deuda.
              */}
              <span>Nivel {nivel.level}</span>
              <span aria-hidden>·</span>
              <span>{formatCredits(profile.xp)} XP</span>
              {/* F69 · F68-013: el puesto es de la clasificación por PUNTOS, no del ranked (rating). */}
              {position != null && (<><span aria-hidden>·</span><span>#{position} del mundo en puntos</span></>)}
              {regionPosition != null && profile.region && (
                <><span aria-hidden>·</span><span>#{regionPosition} de {REGION_LABEL[profile.region as RankRegion]}</span></>
              )}
            </p>

            {/*
              LAS DOS PROGRESIONES, UNA DEBAJO DE OTRA. Son cosas distintas y hasta ahora
              solo se veía una: el rango dice lo bien que compites, el nivel lo mucho que
              juegas. Las dos barras llevan `role="progressbar"` con su valor — la del rango
              era un `div` decorativo y un lector de pantalla no leía nada.
            */}
            <div className="mt-4 max-w-lg space-y-3">
              <Barra
                titulo="Nivel"
                valor={nivel.level}
                progreso={nivel.progress}
                color="var(--nx-cyan)"
                pie={`${formatCredits(nivel.xpIntoLevel)} / ${formatCredits(nivel.xpForNext)} XP para el nivel ${nivel.level + 1}`}
                etiqueta={`Progreso hacia el nivel ${nivel.level + 1}`}
              />

              {rank.unranked ? (
                <p className="max-w-md text-[13px] text-white/55">
                  Todavía no tienes puntos. Gana duelos contra el bot o acierta predicciones de Pick&apos;ems para entrar en los rangos de puntos.
                </p>
              ) : (
                <Barra
                  titulo="Rango de puntos"
                  valor={display.label}
                  progreso={rank.progress}
                  color={display.color}
                  pie={rank.next
                    ? `${rank.toNext} puntos para ${rank.next.label}`
                    : display.champion ? "Primero del mundo" : "Rango de puntos máximo alcanzado"}
                  etiqueta={rank.next ? `Progreso hacia ${rank.next.label}` : "Rango de puntos máximo"}
                />
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-3">
            {/*
              El avatar, con su MARCO equipado alrededor. El marco no sustituye al emoji
              elegido a mano: lo enmarca. Y si hay un avatar cosmetico equipado, ese manda
              sobre el emoji, porque es lo que el jugador ha desbloqueado y elegido.
            */}
            <span
              className="nx-plate nx-clip-sm grid h-16 w-16 place-items-center text-3xl"
              style={look.marco ? {
                boxShadow: `0 0 0 2px ${look.marco.color}, 0 0 18px ${look.marco.color}66`,
              } : undefined}
              aria-label={
                look.avatar
                  ? `Avatar: ${look.avatar.label}${look.marco ? ` con marco ${look.marco.label}` : ""}`
                  : `Avatar: ${profile.avatar}`
              }
            >
              {look.avatar
                ? <span style={{ color: look.avatar.color }} aria-hidden>{look.avatar.glyph ?? "◆"}</span>
                : profile.avatar}
            </span>
            {(look.marco || look.avatar) && (
              <span className="nx-label text-[9px]">
                {[look.avatar?.label, look.marco?.label].filter(Boolean).join(" · ")}
              </span>
            )}
            <button
              onClick={() => signOut()}
              className="nx-focus nx-clip-sm min-h-[44px] border border-white/15 px-3.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/60 transition hover:border-white/35 hover:text-white"
            >
              Cerrar sesión
            </button>
          </div>
        </div>

        {/*
          ═══ LAS CIFRAS ═══
          Esto eran ocho tarjetas de igual peso. Un dato de videojuego no vive en una caja:
          vive sobre la ficha, con su etiqueta encima. Mismos ocho datos y mismos destinos.
        */}
        {/* F69 · CLS: la tira se pinta siempre; mientras cargan, las cifras del servidor salen como «—» (nunca
            inventadas). Antes un cargador de otra altura ocupaba su sitio y empujaba todo lo de debajo al llegar. */}
        <div className="relative flex flex-wrap gap-x-8 gap-y-4 border-t border-edge bg-black/30 px-5 py-3 sm:px-9" aria-busy={statsLoading} data-testid="cuenta-stats">
          <Readout label="Puntos" value={String(points)} accent="#ffd35c" href="/ranking" />
          <Readout label="Torneos" value={statsLoading ? "—" : String(pickems.events)} href="/pickems" />
          <Readout
            label="Aciertos"
            value={!statsLoading && pickems.total > 0 ? `${pickems.correct}/${pickems.total}` : "—"}
            foot={!statsLoading && accuracy != null ? `${accuracy}% de acierto` : undefined}
          />
          <Readout label="Recompensas" value={statsLoading ? "—" : String(rewards)} href="/recompensas" />
          <Readout
            label="Colección" value={collectionReady ? String(distinct) : "—"} suffix={`/${TOTAL_CARDS}`}
            foot={collectionReady ? `${ownedCards.length} cartas` : undefined} accent="#7b5cff" href="/coleccion"
          />
          <Readout label="Sobres" value={statsLoading ? "—" : String(packs)} href={!statsLoading && packs > 0 ? "/inventario" : "/tienda"} />
          <Readout label="DRL Credits" value={formatCredits(profile.credits)} accent="#ffd35c" />
        </div>
      </div>

      {/* FASE 28 · resumen competitivo pequeño: rating, posición, récord y la puerta al hub. */}
      <CompetitiveSummary enabled={!!user} className="mt-4" />

      {/* FASE 29 · resumen social pequeño: amigos, en línea, pendientes y la puerta a /social. */}
      <SocialSummary enabled={!!user} className="mt-4" />

      {/* FASE 31 · cuenta ≠ perfil: aquí se ve cómo te ven los demás y se va a verlo o editarlo. */}
      <ProfilePreviewCard enabled={!!user} className="mt-4" />

      {/*
        VITRINA DE PRESTIGIO — entre la ficha y las cartas. Va aqui porque responde a
        «quien es este jugador», que es la pregunta de la parte de arriba, y no a «que
        tiene», que es la de abajo. Como mucho seis: una vitrina con veinte piezas deja
        de ser una vitrina.
      */}
      {prestige && prestige.owned.length > 0 && (
        <section aria-label="Prestigio">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 className="nx-label">Prestigio</h2>
            <span className="nx-label text-[9px]">
              {prestige.totals.purchased} de {prestige.totals.eligible} insignias mejoradas
            </span>
          </div>
          <ul className="flex flex-wrap gap-2">
            {prestige.owned.slice(0, 6).map((o) => (
              <li
                key={o.baseId}
                className="nx-clip-sm flex items-center gap-2 border px-3.5 py-2.5"
                style={{ borderColor: `${o.color}55`, background: `${o.color}14` }}
                title={`${o.label} · ${o.tierLabel}`}
              >
                <span aria-hidden className="text-[15px]" style={{ color: o.color }}>◈</span>
                <span>
                  <span className="block font-display text-[12.5px] font-bold uppercase tracking-[0.05em] text-white">
                    {o.label}
                  </span>
                  <span
                    className="block font-display text-[9px] font-bold uppercase tracking-[0.16em]"
                    style={{ color: o.color }}
                  >
                    {o.tierLabel}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ═══════════════ VITRINA ═══════════════ */}
      {showcase.length > 0 && (
        <section aria-label="Lo mejor de tu colección">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="nx-label">Lo mejor de tu colección</h2>
            <Link href="/coleccion" className="nx-action">Ver todas →</Link>
          </div>
          <div className="flex flex-wrap gap-4">
            {showcase.map((c, i) => {
              const v = getVariant(c.def.variantId);
              return (
                <Card3D
                  key={c.owned.uid}
                  /*
                    El halo continuo (`legendary`) solo lo lleva LA MEJOR. Con cuatro cartas
                    de rareza alta una al lado de otra, cuatro halos pulsando se funden en
                    una mancha: el efecto que debía decir «esta es especial» dejaba de
                    distinguir nada y ademas costaba cuatro repintados en bucle.
                  */
                  mode={i === 0 && v.rank >= 5 ? "legendary" : "hover"}
                  glow={v.palette.primary}
                  delay={card3DStagger(i, 0.07, 0.3)}
                  className="w-[132px] sm:w-[150px]"
                >
                  <PlayerCard card={c.def} size="sm" serial={c.owned.serial} interactive={false} />
                </Card3D>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══════════════ AJUSTES ═══════════════ */}
      {/*
        Avatar y región son CONFIGURACIÓN, y por eso van al final. Estaban por delante de
        las estadísticas —doce emoji desplegados nada más entrar— y eso es lo que hacía que
        el perfil se leyera como la pantalla de ajustes de una cuenta.
      */}
      <section aria-label="Ajustes del perfil">
        <Plate className="space-y-5 p-5">
        <SectionTitle as="h2">Ajustes</SectionTitle>

        {/* Fase 44 · sonido: general, efectos y silencio (solo en este dispositivo). */}
        <AudioSettingsPanel className="max-w-md" />

        {/* WALKOUT 0.8 · animaciones de apertura (solo en este dispositivo) */}
        <OpeningAnimationSettings className="max-w-md" />

        <div>
          <SectionTitle as="h3">Avatar</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                disabled={savingAvatar !== null}
                aria-label={`Elegir avatar ${a}`}
                aria-pressed={profile.avatar === a}
                /*
                  FASE 11 · 44 px, no 40, y chaflán en vez de `rounded-lg`. Doce avatares
                  puestos en fila son el control que más se pulsa de los ajustes.
                */
                className={cn(
                  "nx-clip-sm grid h-11 w-11 place-items-center text-xl transition duration-fast disabled:opacity-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl",
                  profile.avatar === a
                    ? "bg-drl/15 shadow-[inset_0_0_0_1px_rgb(255_46_99_/_0.8)]"
                    : "bg-white/5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:bg-white/10",
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/*
          ── Región competitiva ──
          La declara el usuario; el servidor no puede saberla y adivinarla sería inventar
          un dato. Sin región se compite en la clasificación global y no en la regional,
          y eso es exactamente lo que dice el texto de abajo.
        */}
        <div>
          <SectionTitle as="h3">Región competitiva</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {RANK_REGIONS.map((rg) => (
              <button
                key={rg}
                type="button"
                disabled={savingRegion}
                aria-pressed={profile.region === rg}
                onClick={async () => {
                  setSavingRegion(true);
                  try {
                    // Volver a pulsar la región activa la retira: es reversible.
                    const next: RankRegion | null = profile.region === rg ? null : rg;
                    await setMyRegion(next);
                    await refreshProfile();
                    notify(next ? `Región: ${REGION_LABEL[next]}` : "Región retirada", true);
                  } catch (e) {
                    notify(e instanceof Error ? playerMessage(e.message) : "No se pudo guardar", false);
                  } finally {
                    setSavingRegion(false);
                  }
                }}
                className={cn(
                  "nx-clip-sm min-h-[44px] px-3.5 font-display text-[12px] font-bold uppercase tracking-wide transition duration-fast disabled:opacity-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-drl-cyan",
                  profile.region === rg
                    ? "bg-drl-cyan/10 text-drl-cyan shadow-[inset_0_0_0_1px_rgb(25_227_255_/_0.6)]"
                    : "text-ink-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:text-white",
                )}
              >
                {REGION_LABEL[rg]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-white/45">
            {profile.region
              ? `Apareces en la clasificación de ${REGION_LABEL[profile.region]} y en la global.`
              : "Sin región solo apareces en la clasificación global. Elige una para entrar también en la regional."}
          </p>
        </div>
        </Plate>
      </section>

      {/*
        Solo se pinta para administradores, y lo decide el SERVIDOR
        (`/api/admin/session`). Para un jugador normal no existe: no ocupa sitio ni deja
        hueco. Va después de «Ajustes» a propósito — es lo último de la cuenta, no lo
        primero, porque no es parte del juego.
      */}
      <InternalTools />

      <p className="text-xs text-white/35">
        Tu saldo, tus cartas, tus puntos y tu rating ranked los guarda y los valida el servidor.
        Nada de esto se puede modificar desde este dispositivo.
      </p>

      <Toast toast={toast} />
    </section>
  );
}

/**
 * Un color hexadecimal a los tres componentes que espera `--nx-tint`. La ficha se tiñe con
 * el color del RANGO: el tinte de contexto de la sección («progreso», cian) valdría para
 * cualquier pantalla, y esta tiene que decir de qué rango es antes de leer la etiqueta.
 */
function hexToRgbTriplet(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** Un dato de la ficha. Etiqueta encima, cifra grande, pie opcional. Sin caja. */
/**
 * UNA CIFRA DE LA TIRA.
 *
 * FASE 11 · Se construye SOBRE `Readout`, la primitiva del sistema, en vez de repintar la
 * misma tipografía a mano: la cifra, su etiqueta en versalitas y el sufijo apagado los pone
 * la primitiva. Lo que esta pieza añade es lo que la primitiva no tiene y aquí hace falta:
 * un pie de línea y un destino.
 *
 * Cuando es un enlace, el objetivo táctil llega a 44 px. Eran 92 × 37 y la tira entera —
 * siete destinos— estaba por debajo del mínimo.
 */
function Readout({
  label, value, suffix, foot, accent, href,
}: {
  label: string;
  value: string;
  suffix?: string;
  foot?: string;
  accent?: string;
  href?: string;
}) {
  const body = (
    <>
      <NxReadout size="md" label={label} value={value} unit={suffix} tone={accent} />
      {foot && <span className="mt-0.5 block text-caption text-ink-faint">{foot}</span>}
    </>
  );
  return href
    ? (
      <Link href={href} className="nx-focus group flex min-h-[44px] min-w-[92px] flex-col justify-center">
        {body}
      </Link>
    )
    : <div className="flex min-h-[44px] min-w-[92px] flex-col justify-center">{body}</div>;
}

/**
 * UNA BARRA DE PROGRESIÓN DE LA FICHA.
 *
 * Lleva `role="progressbar"` con su `aria-valuenow`: la del rango era un `div` con un ancho
 * en línea, así que un lector de pantalla no leía ningún progreso. El color no sale de la
 * paleta de tonos sino del DATO —cada rango tiene el suyo—, y por eso la barra se dibuja
 * aquí en vez de usar `Meter`, que solo acepta tonos del sistema.
 */
function Barra({
  titulo, valor, progreso, color, pie, etiqueta,
}: {
  titulo: string;
  valor: string | number;
  progreso: number;
  color: string;
  pie: string;
  etiqueta: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progreso * 100)));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="nx-label">{titulo}</span>
        <b className="font-display text-[13px] font-bold uppercase tracking-wide" style={{ color }}>
          {valor}
        </b>
      </div>
      <Recessed
        depth="sm"
        className="h-2.5 overflow-hidden"
        role="progressbar"
        aria-label={etiqueta}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          className="block h-full origin-left transition-transform duration-slow ease-out motion-reduce:transition-none"
          style={{
            transform: `scaleX(${pct / 100})`,
            background: `linear-gradient(90deg, ${color}77, ${color})`,
            boxShadow: `0 0 14px ${color}aa`,
          }}
        />
      </Recessed>
      <p className="nx-label mt-1.5">{pie}</p>
    </div>
  );
}

function Header({ signedOut = false }: { signedOut?: boolean }) {
  // F64 · sin sesión esta pantalla es la PUERTA del juego, no «tu perfil».
  if (signedOut) {
    return (
      <header className="mb-6 text-center">
        <p className="nx-label text-drl">NEXUS</p>
        <h1 className="mt-1 font-display text-[clamp(30px,5vw,48px)] font-extrabold uppercase leading-none tracking-wide text-white">Tu cuenta de <span className="text-drl">jugador</span></h1>
      </header>
    );
  }
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-white">
        Mi <span className="text-drl">Perfil</span>
      </h1>
      <p className="mt-1 text-white/50">Tu progreso competitivo de un vistazo.</p>
    </header>
  );
}

/**
 * IA 2026-10-07 · `/cuenta` = MI CUENTA (icono de usuario, arriba a la derecha): PERFIL · PROGRESIÓN · CUENTA y DAR
 * FEEDBACK. Sin sesión (o sin Supabase, cargando, recuperando contraseña) manda la pantalla de siempre: entrar.
 * `useSearchParams` va bajo `Suspense` (si no, el build aborta en la generación estática).
 */
export default function CuentaPage() {
  return (
    <Suspense fallback={<div className="min-h-screen"><Loading label="Cargando tu cuenta" /></div>}>
      <CuentaRoute />
    </Suspense>
  );
}

function CuentaRoute() {
  const { configured, loading, user, profile, recovering } = useAuth();
  const params = useSearchParams();
  if (!configured || loading || recovering || !user || !profile) return <AccountSettings />;
  return <AccountHub userId={user.id} section={accountSectionOf(params.get("seccion"))} source={params.get("desde")} settings={<AccountSettings />} />;
}
