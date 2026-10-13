"use client";

/**
 * LISTA DE AMIGOS (Fase 29 · F85). Ya viene ORDENADA por el servidor (en partida → en cola → en línea → desconectado →
 * nombre); aquí se agrupa por presencia para leerla de un vistazo. Cada fila: presencia (palabra + punto), rango F84,
 * equipo favorito, RETAR (no si está en partida) y el menú de amistad (eliminar / bloquear, con confirmación).
 * El estado vacío es la primera pantalla de un jugador sin amigos: le lleva a buscar. Con > 100 amigos, «Ver más».
 */
import { useState } from "react";
import { EmptyState } from "@/components/ui/States";
import { PRESENCE_LABEL, type Presence } from "@/domain/social/social";
import type { FriendView } from "@/server/services/social";
import { PlayerLine, RowButton, SocialTags } from "./bits";
import type { SocialHandlers } from "./types";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("social");

const GROUPS: Presence[] = ["IN_MATCH", "IN_QUEUE", "ONLINE", "OFFLINE"];

export function FriendsList({ friends, now, handlers, firstTime, onSearch, total, onMore, limit }: { friends: FriendView[]; now: number; handlers: SocialHandlers; firstTime: boolean; onSearch: () => void; total?: number; onMore?: () => void; limit?: number }) {
  useLocale();
  if (friends.length === 0) {
    return (
      <div data-testid="friends-empty">
        <EmptyState
          icon="👥"
          title={firstTime ? t("Tu primer amigo está a una búsqueda") : t("Sin amigos todavía")}
          hint={t("Busca a alguien por su nombre de usuario o añade a un rival reciente. Cuando acepte, veréis si estáis conectados y podréis retaros a duelos amistosos.")}
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <RowButton tone="primary" onClick={onSearch}>{t("Buscar jugadores")}</RowButton>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-5" data-testid="friends-list" data-count={friends.length}>
      {GROUPS.map((g) => {
        const rows = friends.filter((f) => f.presence === g);
        if (rows.length === 0) return null;
        return (
          <section key={g} aria-label={td(PRESENCE_LABEL[g])}>
            <p className="nx-label mb-2">{td(PRESENCE_LABEL[g])} · {rows.length}</p>
            <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]">
              {rows.map((f) => <FriendRow key={f.userId} f={f} now={now} handlers={handlers} />)}
            </ol>
          </section>
        );
      })}
      {total !== undefined && total > friends.length && onMore && (
        <div className="flex justify-center"><RowButton onClick={onMore} data-testid="friends-more">{t("Ver más amigos ({n} de {total})", { n: friends.length, total })}</RowButton></div>
      )}
      {limit !== undefined && <p className="text-center text-[11px] text-white/35">{t("Hasta {n} amigos. Tu lista es privada: nadie más la ve.", { n: limit })}</p>}
    </div>
  );
}

function FriendRow({ f, handlers }: { f: FriendView; now: number; handlers: SocialHandlers }) {
  useLocale();
  const [menu, setMenu] = useState(false);
  const busy = f.presence === "IN_MATCH";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-friend={f.userId} data-presence={f.presence}>
      <PlayerLine player={f} presence={f.presence} tags={<SocialTags rank={f.rank} team={f.team} />} />
      <div className="flex items-center gap-2">
        <RowButton tone="primary" onClick={() => handlers.onChallenge(f)} disabled={busy} title={busy ? t("Está en una partida") : undefined} data-testid="friend-challenge">{busy ? t("En partida") : t("Retar")}</RowButton>
        <a href={`/social/comparar?id=${f.userId}`} className="nx-focus nx-clip-sm hidden min-h-[44px] items-center border border-white/15 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/70 hover:bg-white/[0.08] sm:inline-flex" data-action="compare">{t("Comparar")}</a>
        <div className="relative">
          <RowButton aria-haspopup="menu" aria-expanded={menu} aria-label={t("Más opciones con {username}", { username: f.username })} onClick={() => setMenu((m) => !m)} className="w-11 px-0">…</RowButton>
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-[180px] border border-white/12 bg-[#0b0e17] p-1 shadow-2xl">
              <button role="menuitem" type="button" className="nx-focus block min-h-[44px] w-full px-3 py-2 text-left text-[13px] text-white/80 hover:bg-white/[0.06]" onClick={() => { setMenu(false); handlers.onUnfriend(f); }}>{t("Eliminar amigo")}</button>
              <button role="menuitem" type="button" className="nx-focus block min-h-[44px] w-full px-3 py-2 text-left text-[13px] text-drl-red hover:bg-drl-red/10" onClick={() => { setMenu(false); handlers.onBlock(f); }}>{t("Bloquear")}</button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
