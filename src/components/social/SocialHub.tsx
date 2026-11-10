"use client";

/**
 * CUERPO DEL HUB SOCIAL — `/social` (Fase 29). Recibe UN `SocialSnapshot` (del servidor o QA
 * SYNTHETIC en el arnés) y manejadores por id. Orden pensado para móvil: hero con cifras reales →
 * bandeja (lo que espera MI acción) → pestañas AMIGOS · SOLICITUDES · BUSCAR · RETOS · RIVALES.
 * Aquí no se decide ninguna relación: cada botón pide algo al servidor y se vuelve a leer.
 */
import Link from "next/link";
import type { SocialSnapshot } from "@/server/services/social";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { SocialHero } from "./SocialHero";
import { SocialInbox } from "./SocialInbox";
import { FriendsList } from "./FriendsList";
import { RequestsList } from "./RequestsList";
import { PlayerSearch } from "./PlayerSearch";
import { ChallengesList } from "./ChallengesList";
import { RecentOpponents } from "./RecentOpponents";
import { ActivityList } from "./ActivityList";
import { AccountTag } from "@/components/player/AccountTag";
import { SOCIAL_TABS, type SocialHandlers, type SearchState, type SocialTab } from "./types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const tr = ns("social");

export interface SocialHubProps {
  /** F85 · amigos más allá de la primera página (si se pidieron) y su lector. */
  moreFriends?: SocialSnapshot["friends"];
  onMoreFriends?: () => void;
  snap: SocialSnapshot;
  now: number;
  tab: SocialTab;
  onTab: (t: SocialTab) => void;
  handlers: SocialHandlers;
  search: SearchState;
}

export function SocialHub({ snap, now, tab, onTab, handlers, search, moreFriends = [], onMoreFriends }: SocialHubProps) {
  useLocale();
  const counts: Partial<Record<SocialTab, number>> = {
    amigos: snap.counts.friends,
    solicitudes: snap.counts.incoming,
    retos: snap.counts.challengesIn,
  };
  const empty = snap.counts.friends === 0 && snap.counts.incoming === 0 && snap.counts.outgoing === 0;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6" data-scene="social-hub">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="font-display text-label uppercase tracking-wide2 text-drl">{tr("Social")}</span>
          <h1 className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">{tr("Amigos y duelos amistosos")}</h1>
          <p className="mt-1 max-w-lg text-sm text-ink-muted">{tr("Encuentra jugadores, hazte amigos, mira quién está conectado y rétalos a duelos amistosos: misma arena, mismas reglas, sin rating en juego.")}</p>
        </div>
        <Link href="/duelos" className="nx-action">{tr("‹ Duelos")}</Link>
      </header>

      {/* F86.2 · mi #TAG a la vista, copiable y con su para qué (antes solo vivía en el perfil, sin explicación). */}
      {snap.selfTag && (
        <section aria-label={tr("Tu tag de jugador")} data-testid="social-self-tag" className="nx-clip-sm flex flex-wrap items-center gap-x-4 gap-y-1 border border-white/[0.08] bg-white/[0.03] px-4 py-3">
          <span className="font-display text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">{tr("Tu tag")}</span>
          <AccountTag tag={snap.selfTag} />
          <p className="min-w-0 flex-1 text-[13px] text-ink-muted">{tr("Pásaselo a un amigo: buscándolo en «Buscar jugadores» te encontrará al instante.")}</p>
        </section>
      )}

      <SocialHero snap={snap} onSearch={() => onTab("buscar")} />

      {snap.inbox.length > 0 && (
        <section aria-label={tr("Bandeja")}>
          <SectionTitle>{tr("Esperan tu respuesta")}</SectionTitle>
          <SocialInbox items={snap.inbox} challenges={snap.challenges} now={now} handlers={handlers} />
        </section>
      )}

      <nav aria-label={tr("Secciones sociales")} className="-mx-1 overflow-x-auto px-1">
        <div role="tablist" className="flex min-w-max gap-1 border-b border-white/[0.08]">
          {SOCIAL_TABS.map((t) => {
            const on = t.id === tab;
            const n = counts[t.id] ?? 0;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`social-panel-${t.id}`}
                id={`social-tab-${t.id}`}
                onClick={() => onTab(t.id)}
                data-tab={t.id}
                className={`nx-focus relative inline-flex min-h-[44px] items-center gap-2 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] transition ${on ? "text-white" : "text-white/50 hover:text-white/80"}`}
              >
                {td(t.label)}
                {n > 0 && <span className="rounded-full bg-drl/20 px-1.5 text-[10px] text-drl">{n}</span>}
                {on && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 bg-drl" />}
              </button>
            );
          })}
        </div>
      </nav>

      <section role="tabpanel" id={`social-panel-${tab}`} aria-labelledby={`social-tab-${tab}`} className="min-h-[200px]">
        {tab === "amigos" && (
          <FriendsList friends={[...snap.friends, ...moreFriends]} now={now} handlers={handlers} firstTime={empty} onSearch={() => onTab("buscar")} total={snap.counts.friends} onMore={onMoreFriends} limit={snap.friendsLimit} />
        )}
        {tab === "solicitudes" && (
          <RequestsList incoming={snap.incoming} outgoing={snap.outgoing} blocked={snap.blocked} now={now} handlers={handlers} />
        )}
        {tab === "buscar" && <PlayerSearch state={search} handlers={handlers} />}
        {tab === "retos" && (
          <ChallengesList challenges={snap.challenges} now={now} handlers={handlers} friends={snap.friends} />
        )}
        {tab === "actividad" && (
          <div className="space-y-6">
            <RecentOpponents opponents={snap.recentOpponents} now={now} handlers={handlers} />
            <section aria-label={tr("Actividad")}>
              <SectionTitle>{tr("Actividad reciente")}</SectionTitle>
              <ActivityList items={snap.activity} now={now} />
            </section>
          </div>
        )}
      </section>
    </div>
  );
}
