"use client";

/**
 * SEASON HUB (Fase 34) — el centro de operaciones de la temporada. Compone piezas que resumen sistemas
 * reales sobre UNA foto del servidor (`SeasonHubSnapshot`). Sin sesión: calendario y eventos públicos.
 *
 * Orden (móvil y escritorio): héroe → [resumen final si terminó] → ¿qué hago ahora? + pase → objetivos +
 * ranked → eventos + colección + logros → calendario → «hasta ahora» → archivo.
 *
 * FASE 52 · SEASON COMMAND CENTER. Con sesión y temporada en curso: héroe (nivel de TEMPORADA, XP de pase,
 * siguiente recompensa) → siguiente objetivo (cifras exactas) → CAMINO DE RECOMPENSAS (los dos carriles
 * reales, centrado en tu nivel) → MISIONES (por tipo real) → acciones + ranked → eventos + colección +
 * logros → calendario. Misma foto del servidor; nada se reclama aquí (sigue en /logros).
 */
import Link from "next/link";
import type { SeasonHubSnapshot } from "@/server/services/season";
import type { ServerClock } from "@/domain/season/time";
import { SeasonHero } from "./SeasonHero";
import { SeasonActionBoard } from "./SeasonActionBoard";
import { CompetitivePanel, EventsPanel, CollectionPanel, AchievementsPanel } from "./SeasonPanels";
import { SeasonRewardTrack } from "./SeasonRewards";
import { SeasonMissions, SeasonNextSteps } from "./SeasonMissions";
import { SeasonCalendar } from "./SeasonCalendar";
import { SeasonRecap } from "./SeasonRecap";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("season");

/** Una foto se considera vieja pasados 10 minutos sin refrescar (presentación: se ofrece actualizar). */
export const STALE_AFTER_MS = 10 * 60_000;

export function SeasonHub({ snap, clock, onRefresh, clientNow }: { snap: SeasonHubSnapshot; clock: ServerClock | null; onRefresh: () => void; clientNow?: number }) {
  useLocale();
  const p = snap.personal;
  const ended = snap.season.status === "ENDED";
  const stale = clock && clientNow !== undefined ? clientNow - clock.receivedAt > STALE_AFTER_MS : false;

  return (
    <div className="space-y-5" data-testid="season-hub" data-season={snap.season.id} data-status={snap.season.status} data-signed-in={!!p}>
      {stale && (
        <p role="status" className="nx-clip-sm flex flex-wrap items-center justify-between gap-2 border-l-2 border-l-drl-gold bg-white/[0.03] px-3 py-2 text-caption text-drl-gold" data-testid="season-stale">
          {t("Estos datos son de hace más de 10 minutos.")}
          <button type="button" onClick={onRefresh} className="nx-focus min-h-[44px] rounded-control border border-drl-gold/50 px-3 font-display text-[11px] font-bold uppercase tracking-[0.1em]">{t("Actualizar")}</button>
        </p>
      )}

      <SeasonHero snap={snap} clock={clock} onExpire={onRefresh} />

      {snap.calendar.phase === "OFF_SEASON" && snap.isCurrent === false && !snap.calendar.next && snap.season.status === "ENDED" && (
        <p className="nx-clip-sm border border-white/10 bg-white/[0.03] px-4 py-3 text-body text-ink-secondary" data-testid="off-season">
          {t("Entre temporadas. La próxima temporada aún no está anunciada; tu progreso, tus cartas y tu rating se conservan.")}
        </p>
      )}

      {p && ended && <SeasonRecap recap={p.recap} />}

      {!ended && (
        <>
          {p && <SeasonNextSteps personal={p} />}
          {p?.pass && <SeasonRewardTrack pass={p.pass} />}
          {p?.objectives && <SeasonMissions objectives={p.objectives} serverNow={snap.serverNow} />}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <SeasonActionBoard actions={p?.actions ?? []} signedIn={!!p} />
            {p ? <CompetitivePanel competitive={p.competitive} /> : <SignedOutPanel />}
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            <EventsPanel events={snap.events} pickems={p?.pickems ?? null} />
            {p && <CollectionPanel collection={p.collection} />}
            {p && <AchievementsPanel achievements={p.achievements} />}
          </div>
        </>
      )}

      <SeasonCalendar snap={snap} />

      {p && !ended && <SeasonRecap recap={p.recap} />}

      <p className="text-center text-caption">
        <Link href="/temporadas" className="nx-focus nx-action inline-flex min-h-[44px] items-center">{t("Archivo de temporadas →")}</Link>
      </p>
    </div>
  );
}

function SignedOutPanel() {
  useLocale();
  return (
    <section className="nx-clip-sm border border-white/10 bg-[#0a0d16]/90 p-5" aria-label={t("Pase de temporada")}>
      <span className="nx-label">{t("Pase de temporada")}</span>
      <p className="mt-1 font-display text-[20px] font-bold uppercase text-white">{t("Carril libre y carril competitivo")}</p>
      <p className="mt-2 text-body text-ink-muted">{t("Cada nivel del pase da recompensas. Entra para ver tu nivel, tu XP de pase y lo que puedes reclamar.")}</p>
    </section>
  );
}
