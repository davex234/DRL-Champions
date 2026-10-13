"use client";

/**
 * NEXUS · VESTÍBULO — DAILY GAME LOOP 2.0 (Fase 36).
 *
 * ══════════════════════════ DE DÓNDE VIENE ══════════════════════════
 *
 * El vestíbulo de las Fases 4–35 componía cinco piezas (escenario, tira del bucle, NextUp, temporada,
 * evento, modos, circuito) con ~12 lecturas desde el navegador y TRES ideas distintas de «qué hacer»:
 * la acción del escenario (decidida en esta página), `continueCta` sobre `todayActions` y el orden
 * numérico de `loop.ts`. Además `GET /api/game/loop` escribía al leer (`ensureRating` creaba la ficha
 * ranked 1000/0 y `getProgression` rotaba misiones y abría el carril competitivo).
 *
 * ══════════════════════════ QUÉ HACE AHORA ══════════════════════════
 *
 * UNA lectura personal (`GET /api/game/daily-loop`, sin escrituras) trae la foto con la acción principal
 * ya decidida por la prioridad única (`orderToday`). Esta página no decide nada: estima el reloj del
 * servidor, pasa la foto a `DailyLobby` y enseña el esqueleto mientras no hay nada que enseñar.
 *
 *   · Sin Supabase configurado (modo local): la foto anónima calculada con el mismo dominio puro.
 *   · Sin respuesta y sin foto previa: un vestíbulo degradado honesto (todo marcado como no disponible,
 *     acción «Jugar» al hub de modos, que funciona sin esta lectura). Con foto previa: se conserva.
 *
 * ══════════════════════════ FASE 46 · LA HOME ES UN MENÚ PRINCIPAL ══════════════════════════
 *
 * La composición cambia, la lectura NO. `DailyLobby` —seis bloques apilados— se sustituye por
 * `MainMenu`: tres acciones (JUGAR, INVENTARIO, TIENDA) sobre una escena a pantalla completa. Se
 * sigue usando exactamente la misma foto de `GET /api/game/daily-loop`, que sigue siendo de sólo
 * lectura: esta página no decide nada y no escribe nada, igual que antes.
 *
 * `DailyLobby` NO se borra: sigue siendo la vista del arnés de QA de la Fase 36 y la referencia de
 * la composición anterior.
 */
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { useGameStore } from "@/store/useGameStore";
import { useEconomyView } from "@/lib/game/serverEconomy";
import { economyVisible } from "@/lib/game/localEconomy";
import { CARDS, getCard, getPlayer, TOTAL_CARDS } from "@/data/catalog";
import { getVariant } from "@/domain/cards/variants";
import { levelFromXp } from "@/domain/progression/levels";
import { estimateServerNow } from "@/domain/season/time";
import { buildDailyLoop, type DailyLoopFacts } from "@/domain/dailyLoop";
import { useDailyLoop } from "@/lib/dailyLoop/client";
import { useJourneyDismissed } from "@/lib/journey/preference";
import { welcomeCards } from "@/lib/journey/presentation";
import { DailyLobbySkeleton, type LobbyNetwork } from "@/components/dailyLoop/DailyLobby";
import { MainMenu } from "@/components/home/MainMenu";
import { pickHallCards, pickHeroCard } from "@/lib/home/selection";
import { publish as publishOnboarding } from "@/lib/onboarding/client";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("app");

/** Hechos cuando no se sabe nada del servidor: nada personal, nada inventado. */
function unknownFacts(signedIn: boolean): DailyLoopFacts {
  return {
    now: 0, signedIn, catalogSize: TOTAL_CARDS, matches: null, social: null, progression: null, pickems: null, packs: null,
    decks: null, campaign: null, competitive: null, live: signedIn ? null : [], season: null,
  };
}

export default function HomePage() {
  useLocale();
  const configured = isSupabaseConfigured();
  const { user, loading: authLoading } = useAuth();
  const loop = useDailyLoop({ enabled: configured && !authLoading, userKey: user?.id ?? null });
  /*
   * F81.2 · el store solo cuenta cuando es DE ESTA CUENTA (o la demo de un visitante confirmado): mientras tanto, ni
   * saldo, ni nivel, ni «la mejor carta que posees» sacados de la caché o de la demo.
   */
  const economy = useEconomyView();
  const visible = economyVisible(economy);
  const storeCards = useGameStore((s) => s.ownedCards);
  const ownedCards = useMemo(() => (visible ? storeCards : []), [visible, storeCards]);
  const storeCredits = useGameStore((s) => s.credits);
  const storeXp = useGameStore((s) => s.xp);
  const credits = visible ? storeCredits : null;
  const xp = visible ? storeXp : null;

  // Repinta la cuenta atrás cada 30 s desde el reloj del servidor (no decide nada).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  /*
   * LA CARTA DESTACADA Y LAS QUE VUELAN.
   *
   * No existe un sistema «Héroe del día» en el producto, así que NO se inventa uno: ni rotación, ni
   * recompensa, ni nada que prometa algo. La regla es determinista y sale de datos reales —la mejor
   * carta que el jugador POSEE (rareza, y a igualdad, media); si aún no tiene ninguna, la mejor del
   * catálogo—, de modo que la misma cuenta ve siempre la misma carta hasta que su colección cambie.
   */
  const hero = useMemo(() => pickHeroCard(ownedCards, getCard, getVariant, CARDS), [ownedCards]);
  const hallCards = useMemo(() => pickHallCards(ownedCards, getCard, getVariant, CARDS, hero), [ownedCards, hero]);
  const heroOwned = useMemo(
    () => (hero && ownedCards.some((o) => o.cardId === hero.id) ? tr("En tu colección") : null),
    [hero, ownedCards],
  );

  const local = useMemo(() => (configured ? null : buildDailyLoop(unknownFacts(false))), [configured]);

  /* F63 · la guía llega en la misma foto: se comparte con el resto de pantallas (cero lecturas extra al salir de aquí). */
  useEffect(() => {
    if (user && loop.snap?.onboarding) publishOnboarding(loop.snap.onboarding, user.id);
  }, [user, loop.snap?.onboarding]);

  if (configured && (authLoading || economy === "unknown" || (loop.status === "loading" && !loop.snap))) return <DailyLobbySkeleton />;

  const snap = local ?? loop.snap ?? buildDailyLoop(unknownFacts(!!user));
  const network: LobbyNetwork = !configured ? "online" : loop.status === "offline" ? "offline" : loop.status === "error" ? "error" : "online";
  const nivel = xp != null ? levelFromXp(xp).level : null;

  return (
    <MainMenu
      snap={snap}
      cards={hallCards}
      hero={hero}
      heroOwnedLabel={heroOwned}
      username={(user?.user_metadata?.username as string | undefined) ?? null}
      level={nivel}
      credits={user || !configured ? credits ?? null : null}
      signedIn={!!user}
      network={network}
    />
  );
}
