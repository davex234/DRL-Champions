/**
 * PRESENTACIÓN DE MODOS Y CAMPAÑA (Fase 35). Pura: sin red, sin estado, sin autoridad.
 *
 * Traduce lo que ya dijo el servidor (foto de campaña, equipos, partida en curso, ranked) a textos, estados y
 * llamadas a la acción. Ningún estado se inventa: si un dato no llegó, el modo lo dice («NO DISPONIBLE»),
 * no lo supone.
 */
import type { CampaignChapterView, CampaignNodeView, CampaignSnapshot } from "@/domain/campaign/snapshot";
import type { CampaignOutcome, NodeStatus } from "@/domain/campaign/types";
import type { MetaObjective } from "@/domain/progression/meta";
import { DRAFT_MATCH_HREF, DRAFT_ROUTE } from "@/domain/draft/rules";
import { ns, td } from "@/i18n/runtime";

const t = ns("campaign");

export const STATUS_LABEL: Record<NodeStatus, string> = { LOCKED: "Bloqueado", AVAILABLE: "Disponible", COMPLETED: "Completado" };
export const OUTCOME_LABEL: Record<CampaignOutcome, string> = { WIN: "Victoria", DRAW: "Empate", LOSS: "Derrota" };

export const CAMPAIGN_ROUTE = "/jugar/road-to-champions";
export const campaignNodeHref = (nodeId: string) => `${CAMPAIGN_ROUTE}?node=${encodeURIComponent(nodeId)}`;
export const campaignPlayHref = (nodeId: string) => `/duelos/jugar?campaign=${encodeURIComponent(nodeId)}`;
export const NODE_ID_PATTERN = /^c[0-9]{1,2}-n[0-9]{1,2}$/;

export function nodeCode(n: Pick<CampaignNodeView, "chapterOrder" | "order">): string {
  return `${n.chapterOrder}-${n.order}`;
}

export function nodeAriaLabel(n: CampaignNodeView): string {
  const rival = n.opponent.playable ? n.opponent.name : t("rival no disponible");
  const extra = n.isNext ? (" " + t("· Siguiente")) : "";
  return t("Nodo {code} · {type} · {name} · contra {rival} · dificultad {tier} · {status}{extra}", { code: nodeCode(n), type: td(n.typeLabel), name: td(n.name), rival: td(rival), tier: td(n.tierLabel), status: td(STATUS_LABEL[n.status]), extra });
}

export function allNodeViews(s: CampaignSnapshot): CampaignNodeView[] {
  return s.chapters.flatMap((c) => c.nodes);
}

export function chapterOf(s: CampaignSnapshot, nodeId: string): CampaignChapterView | null {
  return s.chapters.find((c) => c.nodes.some((n) => n.id === nodeId)) ?? null;
}

/** Por qué está bloqueado, con el nombre del nodo que falta. Nunca «sube de nivel» ni «paga». */
export function lockReason(s: CampaignSnapshot, n: CampaignNodeView): string | null {
  if (!s.available) return t("Road to Champions todavía no está disponible.");
  if (n.status !== "LOCKED") return null;
  const nodes = allNodeViews(s);
  const pending = n.requirements.map((id) => nodes.find((x) => x.id === id)).filter((x): x is CampaignNodeView => !!x && x.status !== "COMPLETED");
  if (pending.length === 0) return t("Completa el nodo anterior para desbloquearlo.");
  return t("Gana «{name}» ({v}) para desbloquearlo.", { name: td(pending[0].name), v: nodeCode(pending[0]) });
}

export interface DeckLite { id: string; name: string; valid: boolean; sumOvr: number }

export type NodeCtaKind = "PLAY" | "REPLAY" | "RESUME" | "EDIT_TEAM" | "CREATE_TEAM" | "LOCKED" | "UNAVAILABLE" | "SIGN_IN" | "OFFLINE" | "BUSY_ELSEWHERE";

export interface NodeCta { kind: NodeCtaKind; label: string; href: string | null; enabled: boolean; note: string | null }

export function nodeCta(input: {
  snapshot: CampaignSnapshot; node: CampaignNodeView; signedIn: boolean; online: boolean; deck: DeckLite | null; decksKnown: boolean;
}): NodeCta {
  const { snapshot: s, node: n, deck } = input;
  if (!input.online) return { kind: "OFFLINE", label: t("Sin conexión"), href: null, enabled: false, note: t("SIN CONEXIÓN · Tu progreso está seguro.") };
  if (!s.available) return { kind: "UNAVAILABLE", label: t("Todavía no disponible"), href: null, enabled: false, note: t("ROAD TO CHAMPIONS TODAVÍA NO DISPONIBLE") };
  if (!input.signedIn) return { kind: "SIGN_IN", label: t("Inicia sesión para jugar"), href: "/cuenta", enabled: true, note: null };
  if (!n.opponent.playable) return { kind: "UNAVAILABLE", label: t("Rival no disponible"), href: null, enabled: false, note: t("El catálogo actual no permite un equipo válido para este rival.") };
  const open = s.activeAttempt;
  if (open && open.nodeId === n.id) return { kind: "RESUME", label: t("Retomar partida"), href: campaignPlayHref(n.id), enabled: true, note: t("Tienes esta partida en marcha.") };
  if (open && open.nodeId !== n.id) {
    const other = allNodeViews(s).find((x) => x.id === open.nodeId);
    return { kind: "BUSY_ELSEWHERE", label: t("Retomar el nodo en marcha"), href: campaignPlayHref(open.nodeId), enabled: true, note: t("Tienes «{v}» en marcha. Termínalo o abandónalo primero.", { v: other?.name ?? open.nodeId }) };
  }
  if (n.status === "LOCKED") return { kind: "LOCKED", label: t("Bloqueado"), href: null, enabled: false, note: lockReason(s, n) };
  if (input.decksKnown && !deck) return { kind: "CREATE_TEAM", label: t("Crear equipo"), href: "/duelos/mazos?nuevo=1", enabled: true, note: t("Necesitas un equipo de diez cartas, dos por rol.") };
  if (deck && !deck.valid) return { kind: "EDIT_TEAM", label: t("Editar equipo"), href: `/duelos/mazos?deck=${deck.id}`, enabled: true, note: t("«{name}» no es un equipo válido todavía.", { name: deck.name }) };
  if (n.status === "COMPLETED") return { kind: "REPLAY", label: t("Rejugar"), href: campaignPlayHref(n.id), enabled: true, note: t("Ya lo superaste: rejugar no vuelve a dar la recompensa de primera victoria.") };
  return { kind: "PLAY", label: t("Jugar"), href: campaignPlayHref(n.id), enabled: true, note: null };
}

export type ResultTone = "win" | "loss" | "draw" | "pending";

export interface ResultCopy { title: string; detail: string; tone: ResultTone }

/** Lo que dice el resultado sobre el NODO. El resultado de la partida lo sigue contando `ResultScreen`. */
export function resultCopy(input: {
  outcome: CampaignOutcome | null; firstClear: boolean; wasCompleted: boolean; chapterClosed: CampaignChapterView | null;
  campaignComplete: boolean; credits: number; nodeName: string;
}): ResultCopy {
  if (!input.outcome) return { title: t("Sincronizando progreso"), detail: t("El resultado ya es definitivo; el mapa se actualiza en cuanto responda el servidor."), tone: "pending" };
  if (input.outcome === "WIN") {
    if (input.campaignComplete && input.firstClear) return { title: t("Road to Champions completado"), detail: t("Has superado todos los nodos. «{nodeName}» era el último.{v}", { nodeName: td(input.nodeName), v: input.credits > 0 ? t(" +{credits} créditos de primera victoria.", { credits: input.credits }) : "" }), tone: "win" };
    if (input.chapterClosed && input.firstClear) return { title: t("Capítulo {order} completado", { order: input.chapterClosed.order }), detail: t("«{name}» superado.{bonus}", { name: td(input.chapterClosed.name), bonus: input.credits > 0 ? t(" +{credits} créditos de primera victoria.", { credits: input.credits }) : "" }), tone: "win" };
    if (input.firstClear) return { title: t("Nodo completado"), detail: input.credits > 0 ? t("Primera victoria en «{nodeName}»: +{credits} créditos.", { nodeName: td(input.nodeName), credits: input.credits }) : t("Primera victoria en «{nodeName}».", { nodeName: td(input.nodeName) }), tone: "win" };
    return { title: t("Victoria · nodo ya completado"), detail: t("Rejugar no vuelve a dar la recompensa de primera victoria."), tone: "win" };
  }
  if (input.outcome === "DRAW") {
    return input.wasCompleted
      ? { title: t("Empate"), detail: t("El nodo sigue completado."), tone: "draw" }
      : { title: t("Empate · nodo pendiente"), detail: t("Un empate no supera el nodo. Sigue disponible para volver a intentarlo."), tone: "draw" };
  }
  return input.wasCompleted
    ? { title: t("Derrota"), detail: t("El nodo sigue completado. Puedes rejugarlo cuando quieras."), tone: "loss" }
    : { title: t("Inténtalo de nuevo"), detail: t("El nodo sigue disponible. Sin coste por reintentar."), tone: "loss" };
}

/** El siguiente nodo que abre este (para «SIGUIENTE NODO» tras completar). */
export function nextNodeAfter(s: CampaignSnapshot, nodeId: string): CampaignNodeView | null {
  const nodes = allNodeViews(s);
  const n = nodes.find((x) => x.id === nodeId);
  if (!n) return null;
  return nodes.find((x) => n.nextNodes.includes(x.id) && x.status !== "LOCKED") ?? null;
}

/* ───────────────────────────── hub de modos ───────────────────────────── */

export type ModeId = "ROAD_TO_CHAMPIONS" | "QUICK" | "RANKED" | "FRIEND" | "DRAFT_GAUNTLET";

/** Fase 39 · lo que el hub sabe de Draft Gauntlet (una lectura del servidor). */
export interface DraftModeFacts {
  available: boolean;
  /** Estado de la run ACTIVA; `null` = no hay run activa. */
  status: "DRAFTING" | "READY" | "IN_MATCH" | null;
  pick: number;
  stage: number;
  /** Estado de la última run terminada, si la hay. */
  lastStatus: "COMPLETED" | "FAILED" | "ABANDONED" | null;
  /** F72 · victorias de la run activa (servidor). */
  wins?: number;
  /** F72 · la run activa tiene la entrada sin cobrar (volver a ENTRAR la completa, nunca cobra dos veces). */
  entryPending?: boolean;
}
export type ModeStatus = "DISPONIBLE" | "EN PARTIDA" | "EQUIPO NO VÁLIDO" | "PROVISIONAL" | "NO DISPONIBLE" | "INICIA SESIÓN" | "COMPLETADA" | "CARGANDO";

export interface ModeFacts {
  signedIn: boolean;
  /** `null` = aún no se sabe / no se pudo leer (no se afirma nada). */
  hasValidDeck: boolean | null;
  activePve: boolean;
  activePvp: boolean;
  rankedProvisional: boolean | null;
  campaign: { available: boolean; completed: number; total: number; complete: boolean; nextName: string | null; chapter: string | null } | null | "loading";
  /** Fase 39 · ausente o `null` = no se pudo leer (no se afirma nada). No depende de tener equipo válido. */
  draft?: DraftModeFacts | null | "loading";
}

export interface GameModeCard {
  id: ModeId;
  title: string;
  kicker: string;
  line: string;
  status: ModeStatus;
  detail: string | null;
  cta: { label: string; href: string };
}

export function gameModes(f: ModeFacts): GameModeCard[] {
  const noTeam = f.hasValidDeck === false;
  const signIn = { label: t("Inicia sesión"), href: "/cuenta" };

  const c = f.campaign;
  const rtc: GameModeCard = {
    id: "ROAD_TO_CHAMPIONS", title: t("Road to Champions"), kicker: t("Campaña PvE"),
    line: t("Quince nodos contra rosters reales del circuito. Tres capítulos, un jefe al final de cada uno."),
    status: "DISPONIBLE", detail: null, cta: { label: t("Abrir mapa"), href: CAMPAIGN_ROUTE },
  };
  if (!f.signedIn) { rtc.status = /* i18n-id */ "INICIA SESIÓN"; rtc.cta = { label: t("Ver el mapa"), href: CAMPAIGN_ROUTE }; }
  else if (c === "loading") { rtc.status = "CARGANDO"; }
  else if (!c || !c.available) { rtc.status = /* i18n-id */ "NO DISPONIBLE"; rtc.detail = t("Todavía no disponible"); rtc.cta = { label: t("Ver el mapa"), href: CAMPAIGN_ROUTE }; }
  else {
    rtc.detail = t("{completed}/{total} nodos{chapter}", { completed: c.completed, total: c.total, chapter: c.chapter ? ` · ${td(c.chapter)}` : "" });
    if (c.complete) { rtc.status = "COMPLETADA"; rtc.cta = { label: t("Rejugar nodos"), href: CAMPAIGN_ROUTE }; }
    else if (f.activePve) { rtc.status = /* i18n-id */ "EN PARTIDA"; rtc.cta = { label: t("Retomar partida"), href: "/duelos/jugar" }; }
    else if (noTeam) { rtc.status = /* i18n-id */ "EQUIPO NO VÁLIDO"; rtc.cta = { label: t("Completar equipo"), href: "/duelos/mazos" }; }
    else rtc.cta = { label: c.completed === 0 ? t("Empezar campaña") : t("Continuar"), href: CAMPAIGN_ROUTE };
    if (!c.complete && c.nextName && rtc.status === "DISPONIBLE") rtc.detail += t(" · Siguiente: {nextName}", { nextName: td(c.nextName) });
  }

  const quick: GameModeCard = {
    id: "QUICK", title: t("Partida rápida"), kicker: t("PvE"),
    line: t("Tu equipo contra un bot con la dificultad que elijas. Diez turnos."),
    status: "DISPONIBLE", detail: null, cta: { label: t("Jugar"), href: "/duelos/jugar" },
  };
  if (!f.signedIn) { quick.status = /* i18n-id */ "INICIA SESIÓN"; quick.cta = signIn; }
  else if (f.activePve) { quick.status = /* i18n-id */ "EN PARTIDA"; quick.detail = t("Tienes una partida sin terminar"); quick.cta = { label: t("Retomar"), href: "/duelos/jugar" }; }
  else if (noTeam) { quick.status = /* i18n-id */ "EQUIPO NO VÁLIDO"; quick.cta = { label: t("Completar equipo"), href: "/duelos/mazos" }; }

  const ranked: GameModeCard = {
    id: "RANKED", title: t("Competitivo"), kicker: t("PvP ranked"),
    line: t("Contra otra persona por rating. Tu posición en la escalera de NEXUS."),
    status: "DISPONIBLE", detail: null, cta: { label: t("Ir a competitivo"), href: "/duelos/competitivo" },
  };
  if (!f.signedIn) { ranked.status = /* i18n-id */ "INICIA SESIÓN"; ranked.cta = signIn; }
  else if (f.activePvp) { ranked.status = /* i18n-id */ "EN PARTIDA"; ranked.detail = t("Partida contra otra persona en curso"); ranked.cta = { label: t("Retomar"), href: "/duelos/pvp" }; }
  else if (noTeam) { ranked.status = /* i18n-id */ "EQUIPO NO VÁLIDO"; ranked.cta = { label: t("Completar equipo"), href: "/duelos/mazos" }; }
  else if (f.rankedProvisional) { ranked.status = "PROVISIONAL"; ranked.detail = t("Rating provisional: aún se está calibrando"); }

  const friend: GameModeCard = {
    id: "FRIEND", title: t("Retar a un amigo"), kicker: t("Privado"),
    line: t("Un duelo privado contra alguien de tu lista. No cuenta para el rating."),
    status: "DISPONIBLE", detail: null, cta: { label: t("Retar"), href: "/social" },
  };
  if (!f.signedIn) { friend.status = /* i18n-id */ "INICIA SESIÓN"; friend.cta = signIn; }
  else if (f.activePvp) { friend.status = /* i18n-id */ "EN PARTIDA"; friend.cta = { label: t("Retomar"), href: "/duelos/pvp" }; }
  else if (noTeam) { friend.status = /* i18n-id */ "EQUIPO NO VÁLIDO"; friend.cta = { label: t("Completar equipo"), href: "/duelos/mazos" }; }

  /* Fase 39 · DRAFT GAUNTLET. No usa tu equipo: un equipo inválido no lo bloquea. Estados solo del servidor. */
  const d = f.draft;
  const draft: GameModeCard = {
    id: "DRAFT_GAUNTLET", title: t("Draft Gauntlet"), kicker: t("PvE · Draft"),
    line: t("Construye un equipo carta a carta y supera cinco rivales."),
    status: "DISPONIBLE", detail: t("Nueva run"), cta: { label: t("Empezar draft"), href: DRAFT_ROUTE },
  };
  if (!f.signedIn) { draft.status = /* i18n-id */ "INICIA SESIÓN"; draft.detail = null; draft.cta = signIn; }
  else if (d === "loading") { draft.status = "CARGANDO"; draft.detail = null; }
  else if (!d || !d.available) { draft.status = /* i18n-id */ "NO DISPONIBLE"; draft.detail = t("Todavía no disponible"); draft.cta = { label: t("Ver el modo"), href: DRAFT_ROUTE }; }
  else if (d.status === "DRAFTING") { draft.detail = t("Draft {pick}/10", { pick: d.pick }); draft.cta = { label: t("Continuar draft"), href: DRAFT_ROUTE }; }
  else if (d.status === "READY") { draft.detail = t("Combate {stage}/5", { stage: d.stage }); draft.cta = { label: t("Continuar run"), href: DRAFT_ROUTE }; }
  else if (d.status === "IN_MATCH") { draft.status = /* i18n-id */ "EN PARTIDA"; draft.detail = t("Combate {stage}/5", { stage: d.stage }); draft.cta = { label: t("Retomar combate"), href: DRAFT_MATCH_HREF }; }
  else { draft.detail = d.lastStatus === "COMPLETED" ? t("Última run: completada") : t("Nueva run"); draft.cta = { label: t("Nueva run"), href: DRAFT_ROUTE }; }

  return [rtc, quick, ranked, friend, draft];
}

/** Fase 39 · hechos del hub a partir de la foto de Draft Gauntlet. */
export function draftModeFacts(s: { available: boolean; run: { status: string; pickIndex: number; stage: number; wins?: number; entry?: { paid: boolean } | null } | null; history: { status: string }[] } | null): DraftModeFacts | null {
  if (!s) return null;
  const active = s.run && ["DRAFTING", "READY", "IN_MATCH"].includes(s.run.status) ? s.run : null;
  const last = s.history[0]?.status;
  return {
    available: s.available,
    status: (active?.status as DraftModeFacts["status"]) ?? null,
    pick: active?.pickIndex ?? 0,
    stage: active?.stage ?? 0,
    lastStatus: last === "COMPLETED" || last === "FAILED" || last === "ABANDONED" ? last : null,
    wins: active?.wins ?? 0,
    entryPending: !!active?.entry && !active.entry.paid,
  };
}

/* ───────────── F71 · Play Experience 2.0: VER → ELEGIR → JUGAR ───────────── */

/** Las tres áreas de `/jugar`. Duelos agrupa los cuatro modos de `gameModes()` que no son la campaña. */
export type PlayAreaId = "RTC" | "DUELS" | "COACH";
export const DUELS_ROUTE = "/duelos";
export const COACH_ROUTE = "/entrenador";

/** Los cuatro modos de `/duelos`, en el orden de `gameModes()`. */
export const DUEL_MODE_IDS = ["QUICK", "RANKED", "FRIEND", "DRAFT_GAUNTLET"] as const;
export type DuelModeId = (typeof DUEL_MODE_IDS)[number];

const DUEL_CTA: Record<DuelModeId, string> = { QUICK: "Jugar", RANKED: "Jugar", FRIEND: "Retar", DRAFT_GAUNTLET: "Jugar" };
/** Estados «en reposo»: el CTA corto y fijo. En cualquier otro (retomar, completar equipo, iniciar sesión…) manda el de `gameModes()`. */
const RESTING: ReadonlySet<ModeStatus> = new Set(["DISPONIBLE", "PROVISIONAL"]);

export function duelModes(cards: readonly GameModeCard[]): GameModeCard[] {
  return DUEL_MODE_IDS.map((id) => cards.find((c) => c.id === id)).filter((c): c is GameModeCard => !!c);
}

/** CTA de un modo de duelo: JUGAR / JUGAR / RETAR / JUGAR en reposo; si no, el que ya calculó `gameModes()` (mismo destino siempre). */
export function duelModeCta(card: GameModeCard): { label: string; href: string } {
  const label = RESTING.has(card.status) && card.id in DUEL_CTA ? DUEL_CTA[card.id as DuelModeId] : card.cta.label;
  return { label, href: card.cta.href };
}

/** CTA de Road to Champions en `/jugar`: JUGAR en reposo; retomar / completar equipo / ver el mapa… tal cual. */
export function campaignAreaCta(card: GameModeCard): { label: string; href: string } {
  return card.status === "DISPONIBLE" ? { label: t("Jugar"), href: card.cta.href } : card.cta;
}

/**
 * Micro-línea de un modo de duelo (una sola, corta, o nada). Solo datos que ya existen: el estado de la run de
 * draft («Combate 2/5»), el rating y la posición del competitivo, o la palabra de estado si no está en reposo.
 */
export function duelModeNote(card: GameModeCard, ranked?: { rating: number | null; position: number | null; provisional: boolean } | null): string | null {
  if (card.id === "DRAFT_GAUNTLET" && card.detail && /^(Draft|Combate) \d+\/\d+$/.test(card.detail)) return card.detail;
  if (card.id === "RANKED" && ranked && RESTING.has(card.status) && ranked.rating !== null) {
    return ranked.position ? `#${ranked.position} · ${ranked.rating}` : `${ranked.rating}${ranked.provisional ? " · Provisional" : ""}`;
  }
  return RESTING.has(card.status) ? null : card.status;
}

/**
 * Desafíos PvE del día = los objetivos DIARIOS que ya existen y que se cumplen jugando duelos. No hay tabla ni
 * modificadores nuevos: es el mismo sistema de misiones, filtrado.
 */
export function dailyPveObjectives(objectives: readonly MetaObjective[]): MetaObjective[] {
  return objectives.filter((o) => o.kind === "daily" && /^duels?_/.test(o.metric) && !o.claimed);
}

/** Posiciones (en %) de los nodos de un capítulo en escritorio: una línea que ondula, sin scroll horizontal. */
export function chapterLayout(count: number): { x: number; y: number }[] {
  const WAVE = [62, 30, 58, 26, 50, 34, 60, 28];
  if (count <= 1) return [{ x: 50, y: 46 }];
  return Array.from({ length: count }, (_, i) => ({ x: 8 + (84 * i) / (count - 1), y: WAVE[i % WAVE.length] }));
}
