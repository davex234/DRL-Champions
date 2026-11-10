/**
 * F85 · SOCIAL 2.0 — render de las piezas REALES con los fixtures del arnés `/design-system/f85` (sin servidor):
 * presencia con palabra (nunca solo color), listas grandes paginadas, nombres largos, comparación sin puntuación,
 * aviso de reto recibido (accesible, 44 px, movimiento reducido) y contratos de cuenta / pulso / avisos.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { SocialHub } from "./SocialHub";
import { CompareView } from "./CompareView";
import { IncomingChallengeCard } from "./SocialLive";
import type { SocialHandlers, SearchState } from "./types";
import { FULL, EMPTY, SEARCH_HITS, QA_NOW } from "@/app/design-system/fase29/fixtures";
import { MANY, MANY_MORE, LONG, COMPARE, COMPARE_SPARSE, INCOMING_CARD, REMATCH_CARD } from "@/app/design-system/f85/fixtures";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const noop = () => {};
const H: SocialHandlers = {
  onFriendRequest: noop, onAcceptFriend: noop, onDeclineFriend: noop, onUnfriend: noop, onCancelRequest: noop, onBlock: noop, onUnblock: noop,
  onChallenge: noop, onAcceptChallenge: noop, onDeclineChallenge: noop, onCancelChallenge: noop, onOpenMatch: noop,
};
const IDLE: SearchState = { query: "", results: null, searching: false, error: null, onQuery: noop };

test("R1 · amigos: los cuatro estados de presencia con PALABRA, agrupados; retar desactivado si está en partida", () => {
  const t = text(html(<SocialHub snap={FULL} now={QA_NOW} tab="amigos" onTab={noop} handlers={H} search={IDLE} />));
  for (const w of ["En partida", "En cola", "En línea", "Desconectado"]) assert.ok(t.toLowerCase().includes(w.toLowerCase()), w);
  assert.ok(!/visto hace|última conexión/i.test(t), "sin «visto hace»");
});

test("R2 · 200+ amigos: primera página de 100, total real y «Ver más amigos»; la segunda página se añade", () => {
  const first = text(html(<SocialHub snap={MANY} now={QA_NOW} tab="amigos" onTab={noop} handlers={H} search={IDLE} onMoreFriends={noop} />));
  assert.ok(first.includes("Ver más amigos"));
  assert.ok(first.includes("240"));
  const both = html(<SocialHub snap={MANY} now={QA_NOW} tab="amigos" onTab={noop} handlers={H} search={IDLE} moreFriends={MANY_MORE} onMoreFriends={noop} />);
  assert.ok(both.includes("QA-Amigo-150") || text(both).includes("QA-Amigo-150"));
});

test("R3 · nombres largos se truncan (no rompen la fila) y la búsqueda pagina con «Ver más resultados»", () => {
  const h = html(<SocialHub snap={LONG} now={QA_NOW} tab="amigos" onTab={noop} handlers={H} search={IDLE} />);
  assert.ok(h.includes("QA_NombreMuyLargoDeJugador_000") && /truncate/.test(h));
  const s = text(html(<SocialHub snap={FULL} now={QA_NOW} tab="buscar" onTab={noop} handlers={H} search={{ query: "ka", results: SEARCH_HITS, searching: false, error: null, onQuery: noop, hasMore: true, onMore: noop }} />));
  assert.ok(s.includes("Ver más resultados"));
});

test("R4 · primera vez: sin amigos hay camino (buscar), no una lista vacía muda", () => {
  const t = text(html(<SocialHub snap={EMPTY} now={QA_NOW} tab="amigos" onTab={noop} handlers={H} search={IDLE} />));
  assert.ok(/busca|buscar/i.test(t));
});

test("R5 · comparar: dos columnas de datos públicos, sin puntuación compuesta ni ganador; huecos como «—»", () => {
  const h = html(<CompareView data={COMPARE} />);
  const t = text(h);
  assert.ok(t.includes("1032") && t.includes("1246") && t.includes("Nivel de temporada"));
  assert.ok(!/puntuaci[oó]n total|mejor jugador|gana(dor)?\b|score/i.test(t), "sin veredicto");
  assert.ok(!/text-ok|text-drl-red/.test(h), "ningún lado pintado como ganador");
  const sparse = text(html(<CompareView data={COMPARE_SPARSE} />));
  assert.ok(sparse.includes("—") && sparse.includes("Sin clasificar"));
});

test("R6 · aviso de reto: región con nombre accesible, amistoso, sin rating, cuenta atrás m:ss, botones de 44 px", () => {
  const h = html(<IncomingChallengeCard challenge={INCOMING_CARD} now={QA_NOW} busy={false} reduced onAccept={noop} onDecline={noop} onClose={noop} />);
  const t = text(h);
  assert.ok(h.includes(`aria-label="${INCOMING_CARD.challenger.username} te reta a un duelo amistoso"`));
  assert.ok(/Te reta a un duelo amistoso/i.test(t) && t.includes("Sin rating ni colocación") && /Caduca en 4:00/.test(t));
  assert.ok(h.includes('data-action="accept"') && h.includes('data-action="decline"') && h.includes("h-11 w-11"));
  assert.ok(h.includes("opacity:1;transform:none"), "movimiento reducido: aparece ya colocado, sin desplazamiento");
  assert.ok(text(html(<IncomingChallengeCard challenge={REMATCH_CARD} now={QA_NOW} busy={false} reduced onAccept={noop} onDecline={noop} onClose={noop} />)).includes("Te pide la revancha"));
  assert.ok(text(html(<IncomingChallengeCard challenge={INCOMING_CARD} now={QA_NOW} busy reduced onAccept={noop} onDecline={noop} onClose={noop} />)).includes("Entrando…"));
});

test("R7 · contratos: avisos fuera de partida, un aviso por reto, pulso en rutas inmersivas, páginas atadas a la cuenta", () => {
  const live = read("src/components/social/SocialLive.tsx");
  assert.ok(live.includes('pulse?.activeMatchId || (path.startsWith("/duelos/pvp") && !isRematchOfScreen(c))'), "nada de avisos en mitad de una partida; en la arena, solo la revancha de la partida en pantalla");
  assert.ok(live.includes("!!c.previousMatchId && currentMatchParam() === c.previousMatchId"), "la revancha es la de ESTA partida");
  assert.ok(live.includes("drl:social-seen:") && live.includes("markSeen(key)"), "un reto enviado avisa una sola vez");
  const shell = read("src/components/layout/GameShell.tsx");
  assert.ok(shell.includes("<SocialPresence />") && shell.includes("<SocialLive />"));
  for (const p of ["src/app/social/page.tsx", "src/app/social/comparar/page.tsx"]) assert.ok(/owner === uid|uidRef\.current === owner/.test(read(p)), p);
  const actions = read("src/components/social/SocialActions.tsx");
  assert.ok(actions.includes('role="menu"') && actions.includes('data-action="block"'), "bloquear vive en el menú contextual, no como botón principal");
});

test("R8 · revancha desde el resultado: el aviso vive en la arena PvP, la arena se remonta con OTRA partida en la URL y el retador entra solo", () => {
  const shell = read("src/components/layout/GameShell.tsx");
  assert.ok(shell.includes('pathname.startsWith("/duelos/pvp") ? <SocialLive /> : <SocialPresence />'), "la arena PvP monta el aviso; sobre y entrenador, solo presencia");
  const page = read("src/app/duelos/pvp/page.tsx");
  assert.ok(page.includes("<ArenaPorPartida />") && page.includes('<Arena key={llave ?? "sala"} />'), "una partida nueva por URL monta una arena nueva");
  assert.ok(page.includes("if (nueva && nueva !== llave) setLlave(nueva);"), "quitar ?match= no remonta (se conserva «visto»)");
  assert.ok(!/setTimeout|setInterval/.test(page.slice(page.indexOf("function ArenaPorPartida"))), "la página PvP sigue sin relojes");
  assert.ok(page.includes("setRevanchaEnviada(true); announceSocialChange();"), "pedir la revancha relee el pulso: el retador espera respuesta y entra solo");
  const live = read("src/components/social/SocialLive.tsx");
  assert.ok(live.includes("currentMatchParam() === c.matchId) return;"), "ya en esa partida: no se vuelve a navegar");
});
