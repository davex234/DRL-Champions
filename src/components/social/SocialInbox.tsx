"use client";

/**
 * BANDEJA SOCIAL (Fase 29). No es un «sistema de notificaciones»: es la lista DERIVADA de
 * solicitudes recibidas y retos que esperan mi respuesta (más «tu reto fue aceptado»). Cada fila
 * trae sus acciones; el número de la navegación es este mismo recuento en el servidor.
 */
import { Plate } from "@/components/ui/Surface";
import type { InboxItem } from "@/domain/social/social";
import type { ChallengeView } from "@/server/services/social";
import { PlayerLine, RowButton, ago, remainingText } from "./bits";
import type { SocialHandlers } from "./types";

const TEXT: Record<InboxItem["kind"], string> = {
  FRIEND_REQUEST: "quiere ser tu amigo",
  CHALLENGE: "te reta a un duelo amistoso",
  CHALLENGE_ACCEPTED: "aceptó tu reto",
  FRIEND_ACCEPTED: "aceptó tu solicitud",
};

export function SocialInbox({ items, challenges, now, handlers }: { items: InboxItem[]; challenges: ChallengeView[]; now: number; handlers: SocialHandlers }) {
  const byId = new Map(challenges.map((c) => [c.id, c]));
  return (
    <ol className="space-y-2" data-testid="social-inbox" data-count={items.length}>
      {items.map((it) => {
        const ch = it.challengeId ? byId.get(it.challengeId) ?? null : null;
        return (
          <li key={it.id}>
            <Plate tone={it.kind === "CHALLENGE" ? "cyan" : "neutral"} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-kind={it.kind}>
              <PlayerLine
                player={it.who}
                size="sm"
                sub={<span>{TEXT[it.kind]} · {ago(it.at, now)}{ch && ch.status === "PENDING" ? ` · ${remainingText(ch.expiresAt, now)}` : ""}</span>}
              />
              <div className="flex flex-wrap gap-2">
                {it.kind === "FRIEND_REQUEST" && (
                  <>
                    <RowButton tone="primary" onClick={() => handlers.onAcceptFriend(it.who)}>Aceptar</RowButton>
                    <RowButton onClick={() => handlers.onDeclineFriend(it.who)}>Rechazar</RowButton>
                  </>
                )}
                {it.kind === "CHALLENGE" && ch && (
                  <>
                    <RowButton tone="primary" onClick={() => handlers.onAcceptChallenge(ch)}>Aceptar reto</RowButton>
                    <RowButton onClick={() => handlers.onDeclineChallenge(ch)}>Rechazar</RowButton>
                  </>
                )}
                {it.kind === "CHALLENGE_ACCEPTED" && it.matchId && (
                  <RowButton tone="primary" onClick={() => handlers.onOpenMatch(it.matchId!)}>Entrar en la arena</RowButton>
                )}
              </div>
            </Plate>
          </li>
        );
      })}
    </ol>
  );
}
