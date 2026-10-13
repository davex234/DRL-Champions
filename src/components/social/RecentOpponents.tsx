"use client";

/**
 * JUGADORES RECIENTES (Fase 29 · F85): la gente contra la que has jugado de verdad (ranked y amistoso), únicos y por
 * última partida, derivados de `duel_matches` (solo partidas TUYAS). Puerta natural a «añadir amigo» tras un buen duelo.
 * La presencia solo aparece si ya sois amigos.
 */
import { SectionTitle } from "@/components/ui/SectionTitle";
import { RELATION_LABEL } from "@/domain/social/social";
import type { RecentOpponentView } from "@/server/services/social";
import { PlayerLine, RowButton, SocialTags, ago } from "./bits";
import type { SocialHandlers } from "./types";
import { ns, tdIn } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("social");

export function RecentOpponents({ opponents, now, handlers }: { opponents: RecentOpponentView[]; now: number; handlers: SocialHandlers }) {
  useLocale();
  return (
    <section aria-label={t("Jugadores recientes")} data-testid="recent-opponents" data-count={opponents.length}>
      <SectionTitle>{t("Jugadores recientes")}</SectionTitle>
      {opponents.length === 0 ? (
        <p className="nx-clip-sm border border-dashed border-white/12 px-4 py-4 text-center text-caption text-ink-muted">{t("Tras tu primer duelo ranked o amistoso, tus rivales aparecerán aquí para añadirlos o pedir la revancha.")}</p>
      ) : (
        <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
          {opponents.map((o) => (
            <li key={o.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-opponent={o.userId} data-relation={o.relation}>
              <PlayerLine player={o} presence={o.presence} size="sm" tags={<SocialTags rank={o.rank} team={o.team} />} sub={<span>{o.games} {o.games === 1 ? t("partida") : t("partidas")} {t("· última")} {ago(o.lastAt, now)}</span>} />
              <div className="flex gap-2">
                {o.relation === "NONE" && <RowButton tone="primary" onClick={() => handlers.onFriendRequest(o)}>{t("Añadir amigo")}</RowButton>}
                {o.relation === "OUTGOING" && <span className="nx-label self-center text-white/45">{tdIn("social", RELATION_LABEL.OUTGOING)}</span>}
                {o.relation === "INCOMING" && <RowButton tone="primary" onClick={() => handlers.onAcceptFriend(o)}>{t("Aceptar")}</RowButton>}
                {o.relation === "FRIENDS" && <RowButton tone="primary" onClick={() => handlers.onChallenge(o)}>{t("Retar")}</RowButton>}
                {o.relation === "BLOCKED_BY_ME" && <span className="nx-label self-center text-white/45">{tdIn("social", RELATION_LABEL.BLOCKED_BY_ME)}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
