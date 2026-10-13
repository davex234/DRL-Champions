"use client";

/**
 * RETOS (Fase 29): recibidos pendientes (aceptar / rechazar, con lo que les queda), enviados
 * pendientes (cancelar), en partida (entrar en la arena) y los últimos cerrados. Los estados son
 * EFECTIVOS: un pendiente caducado ya llega como «Caducado» desde el servidor.
 */
import { CHALLENGE_LABEL, type ChallengeStatus } from "@/domain/social/social";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { ChallengeView, FriendView } from "@/server/services/social";
import { PlayerLine, RowButton, SocialTags, ago, remainingText } from "./bits";
import type { SocialHandlers } from "./types";

const TONE: Record<ChallengeStatus, "key" | "ok" | "warn" | "bad" | "muted" | "info"> = {
  PENDING: "warn", ACCEPTED: "ok", MATCHED: "ok", DECLINED: "muted", EXPIRED: "muted", CANCELLED: "muted",
};

export function ChallengesList({ challenges, now, handlers, friends }: { challenges: ChallengeView[]; now: number; handlers: SocialHandlers; friends: FriendView[] }) {
  const incoming = challenges.filter((c) => c.status === "PENDING" && c.direction === "INCOMING");
  const outgoing = challenges.filter((c) => c.status === "PENDING" && c.direction === "OUTGOING");
  // F85 · «en partida» solo si la partida del reto sigue VIVA (un MATCHED antiguo ya se jugó).
  const live = challenges.filter((c) => (c.status === "MATCHED" || c.status === "ACCEPTED") && c.matchId && c.matchLive !== false);
  const closed = challenges.filter((c) => c.status === "DECLINED" || c.status === "EXPIRED" || c.status === "CANCELLED" || (c.status === "MATCHED" && c.matchLive === false)).slice(0, 6);

  if (challenges.length === 0) {
    return (
      <div data-testid="challenges-empty">
        <EmptyState icon="⚔️" title="Sin retos" hint="Reta a un amigo a un duelo amistoso: misma arena y mismas reglas que el ranked, sin rating, sin colocación y sin Top en juego." />
        {friends.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <RowButton tone="primary" onClick={() => handlers.onChallenge(friends[0])}>Retar a {friends[0].username}</RowButton>
          </div>
        )}
      </div>
    );
  }

  const other = (c: ChallengeView) => (c.direction === "INCOMING" ? c.challenger : c.challenged);

  return (
    <div className="space-y-6" data-testid="challenges">
      {live.length > 0 && (
        <section aria-label="En partida">
          <SectionTitle>En partida</SectionTitle>
          <ol className="space-y-2">
            {live.map((c) => (
              <li key={c.id} className="nx-clip-sm flex flex-wrap items-center justify-between gap-3 border border-drl-cyan/40 bg-drl-cyan/[0.06] px-3 py-2" data-challenge={c.id} data-status={c.status}>
                <PlayerLine player={other(c)} size="sm" sub={<span>duelo amistoso en curso</span>} />
                <RowButton tone="primary" onClick={() => handlers.onOpenMatch(c.matchId!)}>Entrar en la arena</RowButton>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-label="Retos recibidos">
        <SectionTitle>Recibidos · {incoming.length}</SectionTitle>
        {incoming.length === 0 ? <p className="text-caption text-ink-muted">Nadie te ha retado todavía.</p> : (
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
            {incoming.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-challenge={c.id} data-status={c.status}>
                <PlayerLine player={c.challenger} size="sm" tags={c.rivalRank ? <SocialTags rank={c.rivalRank} /> : undefined} sub={<><span>{c.previousMatchId ? "pide revancha" : "te reta a un duelo amistoso"} · {ago(c.createdAt, now)}</span><span>{remainingText(c.expiresAt, now)}</span></>} />
                <div className="flex gap-2">
                  <RowButton tone="primary" onClick={() => handlers.onAcceptChallenge(c)}>Aceptar</RowButton>
                  <RowButton onClick={() => handlers.onDeclineChallenge(c)}>Rechazar</RowButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Retos enviados">
        <SectionTitle>Enviados · {outgoing.length}</SectionTitle>
        {outgoing.length === 0 ? <p className="text-caption text-ink-muted">No tienes retos enviados pendientes.</p> : (
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
            {outgoing.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-challenge={c.id} data-status={c.status}>
                <PlayerLine player={c.challenged} size="sm" sub={<><span data-testid="challenge-waiting">Esperando respuesta…</span><span>{remainingText(c.expiresAt, now)}</span></>} />
                <RowButton onClick={() => handlers.onCancelChallenge(c)}>Cancelar reto</RowButton>
              </li>
            ))}
          </ol>
        )}
      </section>

      {closed.length > 0 && (
        <section aria-label="Retos cerrados">
          <SectionTitle>Últimos cerrados</SectionTitle>
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
            {closed.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-challenge={c.id} data-status={c.status}>
                <PlayerLine player={other(c)} size="sm" sub={<span>{c.direction === "INCOMING" ? "te retó" : "lo retaste"} · {ago(c.respondedAt ?? c.createdAt, now)}</span>} />
                <div className="flex items-center gap-2">
                  <Badge tone={TONE[c.status]}>{c.status === "MATCHED" ? "Jugado" : CHALLENGE_LABEL[c.status]}</Badge>
                  {c.direction === "OUTGOING" && c.status !== "DECLINED" && <RowButton onClick={() => handlers.onChallenge(c.challenged)}>Retar de nuevo</RowButton>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
