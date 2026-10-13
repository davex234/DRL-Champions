"use client";

/**
 * BUSCAR JUGADORES (Fase 29). Solo por nombre de usuario: mínimo 2 letras, debounce de 300 ms,
 * ≤ 10 resultados que ya vienen con la relación y la presencia. No hay «lista de todos los
 * usuarios»: sin consulta no hay resultados, y nunca se busca por correo.
 */
import { useEffect, useState } from "react";
import { SEARCH_MIN } from "@/domain/social/social";
import { RELATION_LABEL } from "@/domain/social/social";
import type { SearchHit } from "@/server/services/social";
import { formatTag, tagAriaLabel } from "@/domain/account/tag";
import { PlayerLine, RowButton, SocialTags } from "./bits";
import type { SearchState, SocialHandlers } from "./types";

export const SEARCH_DEBOUNCE_MS = 300;

export function PlayerSearch({ state, handlers }: { state: SearchState; handlers: SocialHandlers }) {
  const [text, setText] = useState(state.query);

  // Debounce: la consulta sale cuando el jugador deja de teclear, no con cada letra.
  useEffect(() => {
    const t = text.trim();
    if (t === state.query) return;
    const id = window.setTimeout(() => state.onQuery(t), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text, state]);

  const corto = text.trim().length > 0 && text.trim().length < SEARCH_MIN;

  return (
    <div data-testid="player-search">
      <label htmlFor="social-search" className="nx-label">Nombre de usuario o #TAG</label>
      <input
        id="social-search"
        type="search"
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Nombre (2 letras) o #TAG exacto…"
        aria-describedby="social-search-hint"
        className="nx-focus nx-clip-sm mt-2 block min-h-[48px] w-full border border-white/12 bg-white/[0.04] px-4 text-body text-white placeholder:text-white/30"
      />
      <p id="social-search-hint" className="mt-1 text-[11px] text-white/35">Por nombre de usuario o por #TAG exacto de la cuenta. Nunca por correo.</p>

      <div className="mt-4" aria-live="polite">
        {corto && <p className="text-caption text-ink-muted">Escribe al menos {SEARCH_MIN} letras.</p>}
        {state.searching && <p className="text-caption text-ink-muted" role="status">Buscando…</p>}
        {state.error && <p role="alert" className="text-caption text-drl-red">{state.error}</p>}
        {!state.searching && state.results && state.results.length === 0 && (
          <p className="text-caption text-ink-muted" data-testid="search-empty">{text.trim().startsWith("#") ? "Ningún jugador con ese tag." : "Nadie se llama así (o empieza así). Prueba con otras letras."}</p>
        )}
        {state.results && state.results.length > 0 && (
          <ol className="nx-clip-sm divide-y divide-white/[0.06] border border-white/[0.09] bg-white/[0.02]" data-testid="search-results" data-count={state.results.length}>
            {state.results.map((p) => <Hit key={p.userId} p={p} handlers={handlers} />)}
          </ol>
        )}
        {state.hasMore && state.onMore && !state.searching && (
          <div className="mt-3 flex justify-center"><RowButton onClick={state.onMore} data-testid="search-more">Ver más resultados</RowButton></div>
        )}
      </div>
    </div>
  );
}

function Hit({ p, handlers }: { p: SearchHit; handlers: SocialHandlers }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-3 py-2" data-hit={p.userId} data-relation={p.relation}>
      <div className="min-w-0">
        <PlayerLine player={p} presence={p.presence} size="sm" tags={<SocialTags rank={p.rank} team={p.team} />} />
        {/* 0068 · el tag, secundario: distingue dos cuentas de nombre parecido. */}
        {p.tag && <span className="ml-1 font-mono text-[11px] tracking-[0.12em] text-white/40" data-field="hit-tag" aria-label={tagAriaLabel(p.tag)}>{formatTag(p.tag)}</span>}
      </div>
      <div className="flex gap-2">
        {p.relation === "NONE" && <RowButton tone="primary" onClick={() => handlers.onFriendRequest(p)}>Añadir amigo</RowButton>}
        {p.relation === "OUTGOING" && <span className="nx-label self-center text-white/45">{RELATION_LABEL.OUTGOING}</span>}
        {p.relation === "INCOMING" && <RowButton tone="primary" onClick={() => handlers.onAcceptFriend(p)}>Aceptar</RowButton>}
        {p.relation === "FRIENDS" && (
          <>
            <span className="nx-label self-center text-drl-cyan">{RELATION_LABEL.FRIENDS}</span>
            <RowButton tone="primary" onClick={() => handlers.onChallenge(p)}>Retar</RowButton>
          </>
        )}
        {p.relation === "BLOCKED_BY_ME" && <RowButton onClick={() => handlers.onUnblock(p)}>Desbloquear</RowButton>}
      </div>
    </li>
  );
}
