"use client";

/**
 * SOLICITUDES (Fase 29): recibidas (aceptar / rechazar), enviadas («Solicitud enviada» +
 * retirar) y bloqueados (desbloquear). Todo por id; el servidor decide.
 */
import { EmptyState } from "@/components/ui/States";
import { SectionTitle } from "@/components/ui/SectionTitle";
import type { RequestView, SocialPlayer } from "@/server/services/social";
import { PlayerLine, RowButton, SocialTags, ago } from "./bits";
import type { SocialHandlers } from "./types";

export function RequestsList({ incoming, outgoing, blocked, now, handlers }: { incoming: RequestView[]; outgoing: RequestView[]; blocked: SocialPlayer[]; now: number; handlers: SocialHandlers }) {
  const nada = incoming.length === 0 && outgoing.length === 0 && blocked.length === 0;
  if (nada) return <EmptyState icon="📨" title="Sin solicitudes pendientes" hint="Las solicitudes que recibas y las que envíes aparecerán aquí." />;
  return (
    <div className="space-y-6" data-testid="requests">
      <section aria-label="Solicitudes recibidas">
        <SectionTitle>Recibidas · {incoming.length}</SectionTitle>
        {incoming.length === 0 ? <p className="text-caption text-ink-muted">Nadie espera tu respuesta.</p> : (
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
            {incoming.map((r) => (
              <li key={r.player.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-request="incoming">
                <PlayerLine player={r.player} size="sm" tags={<SocialTags rank={r.rank} team={r.team} />} sub={<span>recibida {ago(r.at, now)}</span>} />
                <div className="flex gap-2">
                  <RowButton tone="primary" onClick={() => handlers.onAcceptFriend(r.player)}>Aceptar</RowButton>
                  <RowButton onClick={() => handlers.onDeclineFriend(r.player)}>Rechazar</RowButton>
                  <RowButton onClick={() => handlers.onBlock(r.player)} aria-label={`Bloquear a ${r.player.username}`} className="text-white/50">Bloquear</RowButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section aria-label="Solicitudes enviadas">
        <SectionTitle>Enviadas · {outgoing.length}</SectionTitle>
        {outgoing.length === 0 ? <p className="text-caption text-ink-muted">No has enviado ninguna solicitud pendiente.</p> : (
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
            {outgoing.map((r) => (
              <li key={r.player.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-request="outgoing">
                <PlayerLine player={r.player} size="sm" tags={<SocialTags rank={r.rank} team={r.team} />} sub={<span>enviada {ago(r.at, now)}</span>} />
                <div className="flex items-center gap-2">
                  <span className="nx-label text-white/45" data-testid="request-sent">Solicitud enviada</span>
                  <RowButton onClick={() => handlers.onCancelRequest(r.player)}>Retirar</RowButton>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      {blocked.length > 0 && (
        <section aria-label="Bloqueados">
          <SectionTitle>Bloqueados · {blocked.length}</SectionTitle>
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
            {blocked.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-blocked={p.userId}>
                <PlayerLine player={p} size="sm" sub={<span>no puede enviarte solicitudes ni retos</span>} />
                <RowButton onClick={() => handlers.onUnblock(p)}>Desbloquear</RowButton>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
