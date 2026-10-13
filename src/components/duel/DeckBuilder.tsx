"use client";

/**
 * NEXUS TEAM BUILDER — EL CONSTRUCTOR DE EQUIPOS (Fase 32; sustituye al de las Fases 8 · 9G · 9.6).
 *
 * Tres zonas, como una pantalla de alineación y no como un formulario:
 *
 *   COLECCIÓN (filtros + cartas)  →  TU EQUIPO (10 huecos por rol)  →  ANÁLISIS (estado · medias · lectura)
 *
 * 1440: las tres a la vez. 1024: tablero protagonista + análisis; la colección en hoja. 390: diseño
 * propio (tablero por filas de rol, colección en hoja inferior, comparador a pantalla completa y el
 * análisis debajo). Nada exige arrastrar: carta → «Añadir», o hueco → candidatas → «Elegir».
 *
 * LA VALIDACIÓN NO SE DUPLICA. Todo veredicto sale de `@/domain/deckBuilder/builder`, que envuelve al
 * validador canónico (`validateDuelDeck`) y a sus mutaciones (`addCard`/`replaceCard`/`removeCard`). La
 * composición de los huecos es `DUEL_ROLES` × `DUEL_COMPOSITION`. Guardar, activar y jugar vuelven a
 * validar en el servidor: el borrador de aquí es la vista, no la autoridad.
 *
 * EL BORRADOR NO SE PIERDE. Un guardado rechazado, un conflicto de versión («Este equipo cambió en otra
 * pestaña») o una salida con cambios mantienen la composición en pantalla hasta que el jugador decida.
 *
 * Este componente no hace red: recibe la colección y el equipo, y devuelve intenciones (`onSave`,
 * `onActivate`…). La página decide qué llamada hacer; el arnés QA lo monta con datos sintéticos.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/format";
import { DUEL_COMPOSITION, DUEL_DECK_SIZE, DUEL_ROLES } from "@/domain/cardgame";
import {
  autocomplete, buildBoard, candidatesForSlot, checkDeckName, checkDraft, compareForSlot, compatibleSlots,
  countLabel, describeIssues, draftCards, indexPool, moveInRole, readTeam, roleCount, sameUids, suggestForSlot,
  teamStats, tryAdd, tryPlace, tryRemove,
  type AutoResult, type BoardSlot, type BuilderCard, type CardAction,
} from "@/domain/deckBuilder/builder";
import { EMPTY_FILTER, type PoolFilter, type PoolSort } from "@/domain/deckBuilder/pool";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { trackDeck } from "@/lib/deckBuilder/telemetry";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { TeamBoard } from "./deck/TeamBoard";
import { CollectionPanel } from "./deck/CollectionPanel";
import { AnalysisPanel } from "./deck/AnalysisPanel";
import { ComparePanel } from "./deck/ComparePanel";
import { SlotSheet } from "./deck/SlotSheet";
import { Sheet } from "./deck/bits";
import { JourneyCoach } from "@/components/journey/JourneyCoach";
import { analyzeDeck, informativeImpact, swapAlternatives, swapImpact, type AlternativeSort, type Axis, type SuggestObjective, type SwapAlternative } from "@/domain/deckStrategy";
import { catalogCards, strategyContext } from "@/lib/deckStrategy/catalog";
import { StrategyLabPanel, IdentityBadge } from "./strategy/StrategyLabPanel";
import { CardFocusSection } from "./strategy/CardFocusSection";
import { SuggestSection } from "./strategy/SuggestSection";
import { StrategyImpact } from "./strategy/StrategyImpact";
import { getPlayer } from "@/data/catalog";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";
import { fill, slots } from "@/i18n/rich";

const t = ns("duel");

export type SaveOutcome =
  | { ok: true; deck: DuelDeckDTO }
  | { ok: false; kind: "conflict"; current: DuelDeckDTO | null; message: string }
  | { ok: false; kind: "error"; message: string };

export interface BuilderInitial {
  uids?: string[];
  name?: string;
  selectedUid?: string | null;
  slotSheet?: string | null;
  suggest?: boolean;
  compare?: { slotUid: string | null; candidateUid: string } | null;
  conflict?: DuelDeckDTO | null;
  reviewing?: boolean;
  saveError?: string | null;
  notice?: string | null;
  noticeTone?: "warn" | "info";
  collectionOpen?: boolean;
  confirmExit?: boolean;
  released?: string[];
  filter?: PoolFilter;
  sort?: PoolSort;
  autocomplete?: boolean;
  /** Fase 43 · eje de contexto (desde el resumen de una partida, `?eje=`). Ordena alternativas; nunca decide. */
  focusAxis?: Axis | null;
  /** Fase 43 · definición del catálogo que NO se posee (`?explorar=`): comparación solo informativa. */
  explore?: string | null;
  /** Fase 43 · arnés: objetivo de plantilla ya calculado / opciones Pareto abiertas / orden de alternativas. */
  suggestObjective?: SuggestObjective | null;
  pareto?: boolean;
  altSort?: AlternativeSort;
}

export interface DeckBuilderProps {
  /** Equipo guardado que se edita; `null` = equipo nuevo, todavía sin guardar. */
  deck: DuelDeckDTO | null;
  /** Ejemplares poseídos, resueltos por el servidor. */
  collection: BuilderCard[];
  activeSupported: boolean;
  /** Nombre para un equipo nuevo («Equipo N»). */
  defaultName: string;
  unopenedPacks?: number;
  /** Fase 40 · aún no tiene ningún equipo legal guardado: coach de la primera sesión (una sola línea de ayuda). */
  firstTeam?: boolean;
  onSave: (draft: { name: string; cardUids: string[] }) => Promise<SaveOutcome>;
  onActivate?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onExit: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  busy?: "activate" | null;
  /** Arnés QA / enlaces profundos (`?add=<uid>`): estado inicial. */
  initial?: BuilderInitial;
}

type Notice = { text: string; tone: "warn" | "info" };

const focusSlot = (key: string) => {
  if (typeof document === "undefined") return;
  document.querySelector<HTMLButtonElement>(`[data-slot="${key}"] button`)?.focus();
};

export function DeckBuilder(props: DeckBuilderProps) {
  useLocale();
  const { deck, collection, activeSupported, onDirtyChange } = props;
  const init = props.initial ?? {};
  const nameId = useId();
  const nameErrId = useId();

  const [baseline, setBaseline] = useState(() => ({ name: deck?.name ?? props.defaultName, uids: deck?.cardUids ?? [] }));
  const [name, setName] = useState(init.name ?? deck?.name ?? props.defaultName);
  const [uids, setUids] = useState<string[]>(init.uids ?? deck?.cardUids ?? []);
  const [released, setReleased] = useState<Set<string>>(() => new Set(init.released ?? []));
  const [selectedUid, setSelectedUid] = useState<string | null>(init.selectedUid ?? null);
  const [slotKeyOpen, setSlotKeyOpen] = useState<string | null>(init.slotSheet ?? null);
  const [compare, setCompare] = useState<{ slotUid: string | null; candidateUid: string } | null>(init.compare ?? null);
  const [collectionOpen, setCollectionOpen] = useState(!!init.collectionOpen);
  const [conflict, setConflict] = useState<DuelDeckDTO | null>(init.conflict ?? null);
  const [reviewing, setReviewing] = useState(!!init.reviewing);
  const [saveError, setSaveError] = useState<string | null>(init.saveError ?? null);
  const [notice, setNotice] = useState<Notice | null>(init.notice ? { text: init.notice, tone: init.noticeTone ?? "warn" } : null);
  const [auto, setAuto] = useState<AutoResult | null>(null);
  const [confirmExit, setConfirmExit] = useState(!!init.confirmExit);
  const [freshUid, setFreshUid] = useState<string | null>(null);
  const [filter, setFilter] = useState<PoolFilter>(init.filter ?? EMPTY_FILTER);
  const [sort, setSort] = useState<PoolSort>(init.sort ?? "ovr");
  const [saving, setSaving] = useState(false);
  /** F68 · guardia SÍNCRONA del guardado: dos clics en la misma tarea leían `saving=false` y creaban DOS equipos nuevos. */
  const savingRef = useRef(false);
  const [announce, setAnnounce] = useState("");
  const [contextAxis, setContextAxis] = useState<Axis | null>(init.focusAxis ?? null);
  const [altSort, setAltSort] = useState<AlternativeSort>(init.altSort ?? init.focusAxis ?? "ovr");
  const [explore, setExplore] = useState<string | null>(init.explore ?? null);

  useEffect(() => { trackDeck("deck_builder_view"); }, []);

  const pool = useMemo(() => indexPool(collection), [collection]);
  const check = useMemo(() => checkDraft(uids, pool), [uids, pool]);
  const board = useMemo(() => buildBoard(uids, pool, check), [uids, pool, check]);
  const issues = useMemo(() => describeIssues(check, uids, pool), [check, uids, pool]);
  const stats = useMemo(() => teamStats(draftCards(uids, pool)), [uids, pool]);
  // Fase 43 · laboratorio: análisis descriptivo del borrador, en vivo, sin red.
  const strategyCtx = useMemo(() => strategyContext(), []);
  const analysis = useMemo(() => analyzeDeck(draftCards(uids, pool), strategyCtx), [uids, pool, strategyCtx]);
  const reading = useMemo(() => readTeam(stats), [stats]);
  const nameCheck = checkDeckName(name);
  const dirty = name.trim() !== baseline.name || !sameUids(uids, baseline.uids);
  const selectedCard = selectedUid ? pool.get(selectedUid) ?? null : null;
  const fits = useMemo(
    () => new Map(selectedCard ? compatibleSlots(selectedCard, uids, pool, board, check).map((f) => [f.key, f.mode] as const) : []),
    [selectedCard, uids, pool, board, check],
  );
  const slotOpen = slotKeyOpen ? board.slots.find((s) => s.key === slotKeyOpen) ?? null : null;
  const candidates = useMemo(() => (slotOpen ? candidatesForSlot(slotOpen, uids, pool) : []), [slotOpen, uids, pool]);
  const suggestion = useMemo(() => (slotOpen ? suggestForSlot(slotOpen, uids, pool) : null), [slotOpen, uids, pool]);
  const compareView = useMemo(() => (compare ? compareForSlot(uids, pool, compare.slotUid, compare.candidateUid) : null), [compare, uids, pool]);
  const alternatives: SwapAlternative[] = useMemo(
    () => (slotOpen?.uid && pool.has(slotOpen.uid) ? swapAlternatives(uids, slotOpen.uid, pool, strategyCtx, { sort: altSort }) : []),
    [slotOpen, uids, pool, strategyCtx, altSort],
  );
  const compareImpact = useMemo(() => {
    if (!compare?.slotUid || !compareView?.legal) return null;
    const cand = pool.get(compare.candidateUid);
    return cand ? swapImpact(draftCards(uids, pool), compare.slotUid, cand, strategyCtx, analysis) : null;
  }, [compare, compareView, pool, uids, strategyCtx, analysis]);
  const exploreView = useMemo(() => {
    if (!explore) return null;
    const def = catalogCards().find((c) => c.cardId === explore);
    if (!def) return null;
    const cards = draftCards(uids, pool);
    const target = cards.find((c) => c.role === def.role) ?? null;
    const nick = getPlayer(def.playerId)?.nick ?? def.playerId;
    return { def, nick, target, impact: target ? informativeImpact(cards, target.uid, { ...def, uid: `def:${def.cardId}`, nick }, strategyCtx) : null };
  }, [explore, uids, pool, strategyCtx]);
  const compareSlotLabel = compare?.slotUid
    ? board.slots.find((s) => s.uid === compare.slotUid)?.label ?? t("Hueco")
    : compareView ? t("{role} · hueco libre", { role: td(compareView.role) }) : t("Hueco");

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // La autocompletación inicial del arnés QA (escena «autocompletar»): se ejecuta una vez.
  useEffect(() => {
    if (!init.autocomplete) return;
    runAutocomplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useCallback((next: string[], message: string, fresh: string | null = null) => {
    setUids(next);
    setAuto(null);
    setSaveError(null);
    setFreshUid(fresh);
    setAnnounce(message);
  }, []);

  function openCompare(slotUid: string | null, candidateUid: string) {
    setCompare({ slotUid, candidateUid });
    trackDeck("deck_compare");
  }

  function onCard(card: BuilderCard, action: CardAction) {
    setNotice(null);
    if (action.kind === "add") {
      const r = tryAdd(uids, card.uid, pool, check);
      if (r.ok) { apply(r.uids, t("{nick} añadida al equipo como {role}.", { nick: card.nick, role: td(card.role) }), card.uid); setSelectedUid(null); }
      else setNotice({ tone: "warn", text: r.reason });
      return;
    }
    if (action.kind === "replace") {
      setSelectedUid(card.uid);
      setCollectionOpen(false);
      setNotice({ tone: "warn", text: t("{reason} Pulsa el hueco resaltado que quieres cambiar.", { reason: td(action.reason) }) });
      return;
    }
    if (action.kind === "in_deck") {
      setSelectedUid(null);
      setCollectionOpen(false);
      if (action.slotKey) focusSlot(action.slotKey);
      return;
    }
    setNotice({ tone: "warn", text: action.reason });
  }

  function onSlot(slot: BoardSlot) {
    setNotice(null);
    if (selectedCard) {
      const r = tryPlace(uids, slot, selectedCard.uid, pool, check);
      if (!r.ok) { setNotice({ tone: "warn", text: r.reason }); return; }
      if (slot.uid) { openCompare(slot.uid, selectedCard.uid); return; }
      apply(r.uids, t("{nick} colocada en {label}.", { nick: selectedCard.nick, label: td(slot.label) }), selectedCard.uid);
      setSelectedUid(null);
      return;
    }
    setSlotKeyOpen(slot.key);
  }

  function removeSlot(slot: BoardSlot) {
    if (!slot.uid) return;
    const r = tryRemove(uids, slot.uid);
    if (!r.ok) return;
    apply(r.uids, t("{v} quitada de {label}.", { v: slot.card?.nick ?? t("La carta"), label: td(slot.label) }));
    setReleased((cur) => { const n = new Set(cur); n.delete(slot.uid!); return n; });
    setSlotKeyOpen(null);
    requestAnimationFrame(() => focusSlot(slot.key));
  }

  function removeUid(uid: string) {
    const r = tryRemove(uids, uid);
    if (r.ok) apply(r.uids, t("Carta no disponible quitada del equipo."));
  }

  function moveSlot(slot: BoardSlot, dir: -1 | 1) {
    if (!slot.uid) return;
    const next = moveInRole(uids, slot.uid, dir, pool);
    if (sameUids(next, uids)) return;
    apply(next, t("{v} movida {v2} en {role}.", { v: slot.card?.nick ?? t("La carta"), v2: dir < 0 ? t("arriba") : t("abajo"), role: td(slot.role) }));
    const uid = slot.uid;
    requestAnimationFrame(() => {
      const key = buildBoard(next, pool).slots.find((s) => s.uid === uid)?.key;
      if (key) { setSlotKeyOpen((open) => (open ? key : open)); focusSlot(key); }
    });
  }

  function runAutocomplete() {
    const pinned = new Set(uids.filter((u) => !released.has(u)));
    const r = autocomplete(uids, pool, { pinned });
    trackDeck("deck_autocomplete");
    setAuto(r);
    setSaveError(null);
    if (r.ok) {
      setUids(r.uids);
      setReleased(new Set());
      setAnnounce(t("Autocompletado: {length} cartas añadidas. Revisa y guarda.", { length: r.added.length }));
    } else {
      setAnnounce(r.reason);
    }
  }

  async function save(): Promise<boolean> {
    if (saving || savingRef.current) return false;
    setNotice(null);
    if (!nameCheck.ok) { setSaveError(nameCheck.reason); return false; }
    if (check.lostUids.length) { setSaveError(t("Quita las cartas que ya no están disponibles para poder guardar.")); return false; }
    const hard = issues.find((i) => i.kind === "conflict" || i.kind === "excess");
    if (hard) { setSaveError(t("No se puede guardar así: {message}", { message: td(hard.message) })); return false; }
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const out = await props.onSave({ name: nameCheck.name, cardUids: uids });
      if (out.ok) {
        setBaseline({ name: out.deck.name, uids: out.deck.cardUids });
        setName(out.deck.name);
        setConflict(null);
        setReviewing(false);
        setAnnounce(out.deck.valid ? t("Equipo guardado y listo para duelo.") : t("Equipo guardado, todavía incompleto."));
        trackDeck("deck_saved");
        return true;
      }
      if (out.kind === "conflict") { setConflict(out.current); return false; }
      setSaveError(out.message);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function reloadTheirs() {
    const theirs = conflict ?? deck;
    if (!theirs) return;
    setUids(theirs.cardUids);
    setName(theirs.name);
    setBaseline({ name: theirs.name, uids: theirs.cardUids });
    setConflict(null);
    setReviewing(false);
    setAnnounce(t("Cargada la versión guardada del equipo."));
  }

  /** Fase 43 · deshacer los cambios locales: vuelve a lo guardado (sin tocar la base de datos). */
  function revert() {
    setUids(baseline.uids);
    setName(baseline.name);
    setAuto(null);
    setSaveError(null);
    setNotice(null);
    setAnnounce(t("Cambios deshechos: el borrador vuelve a la versión guardada."));
  }

  function exit() {
    if (dirty) setConfirmExit(true);
    else props.onExit();
  }

  const extras = board.extras;
  const theirsOnly = conflict ? conflict.cards.filter((c) => !uids.includes(c.uid)) : [];
  const mineOnly = conflict ? draftCards(uids, pool).filter((c) => !conflict.cardUids.includes(c.uid)) : [];
  const rules = t("{DUEL_DECK_SIZE} cartas · {v} · sin repetir jugador", { DUEL_DECK_SIZE, v: DUEL_ROLES.map((r) => roleCount(DUEL_COMPOSITION[r], r)).join(" · ") });

  const collectionPanel = (
    <CollectionPanel
      cards={collection}
      uids={uids}
      pool={pool}
      board={board}
      check={check}
      filter={filter}
      sort={sort}
      onFilter={setFilter}
      onSort={setSort}
      selectedUid={selectedUid}
      onCard={onCard}
      unopenedPacks={props.unopenedPacks}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-8" data-scene="team-builder" data-dirty={dirty} data-ready={check.ready}>
      <div aria-live="polite" className="sr-only" data-testid="announce">{td(announce)}</div>
      {props.firstTeam && (
        <JourneyCoach eyebrow={t("Tu inicio · 4/6 · Tu primer equipo")} title={t("Tu primer equipo")} testId="journey-deck-coach" className="mb-3">
          {fill(t("Diez cartas: dos por rol (Duelista, Controlador, Iniciador, Centinela y Flex), sin repetir jugador. Elige tú o pulsa «Autocompletar equipo» (rellena con tus cartas de mayor OVR que cumplen las reglas). Cuenta cuando está {estado}; si es tu primer equipo legal, se activa al guardarlo.", slots("estado")), { estado: <b className="text-white">{t("guardado y completo")}</b> })}
        </JourneyCoach>
      )}

      {/* ══ Cabecera ══ */}
      <div className="flex flex-wrap items-center gap-x-3">
        <button
          type="button"
          onClick={exit}
          className="nx-focus -ml-2 inline-flex min-h-[44px] items-center rounded-control px-2 font-display text-label uppercase tracking-wide2 text-ink-muted transition hover:bg-white/[0.06] hover:text-white"
        >
          {t("‹ Mis equipos")}
        </button>
        <span className="nx-label hidden sm:inline">{t("Nexus Team Builder")}</span>
      </div>

      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={nameId} className="sr-only">{t("Nombre del equipo")}</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            autoComplete="off"
            aria-invalid={!nameCheck.ok}
            aria-describedby={nameCheck.ok ? undefined : nameErrId}
            className="nx-focus w-full max-w-[560px] rounded-control border border-transparent bg-transparent px-1 font-display text-[clamp(26px,4vw,42px)] font-bold uppercase leading-tight text-white outline-none transition hover:border-white/10 focus:border-drl/60 focus:bg-white/[0.04]"
          />
          {!nameCheck.ok && <p id={nameErrId} role="alert" className="mt-0.5 text-caption text-bad">{td(nameCheck.reason)}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              data-testid="deck-count"
              className={cn("nx-readout rounded-full border px-2.5 py-1 text-[13px] tabular-nums", check.ready ? "border-ok/50 text-ok" : "border-white/15 text-white")}
            >
              {countLabel(check.count)}
            </span>
            {deck ? (
              <Badge tone={deck.valid ? "ok" : "warn"}>{deck.valid ? t("Listo para duelo") : t("Guardado incompleto")}</Badge>
            ) : (
              <Badge tone="muted">{t("Sin guardar")}</Badge>
            )}
            {deck?.active && <Badge tone="info" solid>{t("Equipo activo")}</Badge>}
            {analysis.count > 0 && <IdentityBadge analysis={analysis} />}
            {dirty && <Badge tone="warn" data-testid="unsaved">{t("Cambios sin guardar")}</Badge>}
          </div>
          <p className="mt-1.5 text-[12px] text-ink-faint">{td(rules)}</p>
        </div>

        <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
          <div className="flex flex-wrap gap-2">
            <NxButton
              variant="primary"
              size="md"
              onClick={() => void save()}
              disabled={saving || !nameCheck.ok || (deck ? !dirty : uids.length === 0)}
              aria-busy={saving}
              data-testid="save-team"
            >
              {saving ? t("Guardando…") : deck && !dirty ? t("Guardado") : t("Guardar equipo")}
            </NxButton>
            {deck && activeSupported && !deck.active && props.onActivate && (
              <NxButton variant="secondary" size="md" onClick={props.onActivate} disabled={dirty || !deck.valid || props.busy === "activate"} aria-busy={props.busy === "activate"} data-testid="activate-team">
                {t("Activar")}
              </NxButton>
            )}
            {dirty && <NxButton variant="ghost" size="md" onClick={revert} data-testid="revert-draft">{t("Deshacer cambios")}</NxButton>}
            {deck && props.onDuplicate && <NxButton variant="ghost" size="md" onClick={props.onDuplicate} disabled={dirty}>{t("Duplicar")}</NxButton>}
            {deck && props.onDelete && <NxButton variant="ghost" size="md" onClick={props.onDelete}>{t("Eliminar")}</NxButton>}
          </div>
          {deck && activeSupported && !deck.active && (!deck.valid || dirty) && (
            <p className="text-[11px] text-ink-faint" data-testid="activate-hint">
              {dirty ? t("Guarda los cambios antes de activarlo.") : t("Solo un equipo completo y legal puede ser el activo.")}
            </p>
          )}
        </div>
      </div>

      {/* ══ Avisos: conflicto, error de guardado, cartas perdidas, pocas cartas ══ */}
      <div className="mt-3 space-y-2">
        {conflict && (
          <div role="alert" className="nx-clip-sm border border-drl-gold/50 bg-drl-gold/[0.08] px-4 py-3" data-testid="stale-version">
            <p className="font-display text-body font-bold uppercase tracking-wide text-drl-gold">{t("Este equipo cambió en otra pestaña.")}</p>
            <p className="mt-0.5 text-caption text-ink-secondary">{t("Tu borrador sigue aquí. Recarga la versión guardada o revisa las diferencias antes de decidir.")}</p>
            {reviewing && (
              <div className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2">
                <div><p className="nx-label">{t("Solo en la versión guardada")}</p><p className="text-white/80">{theirsOnly.map((c) => c.nick).join(", ") || "—"}{conflict.name !== name.trim() && t(" · nombre «{name}»", { name: conflict.name })}</p></div>
                <div><p className="nx-label">{t("Solo en tu borrador")}</p><p className="text-white/80">{mineOnly.map((c) => c.nick).join(", ") || "—"}</p></div>
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <NxButton variant="secondary" size="sm" onClick={reloadTheirs}>{t("Recargar")}</NxButton>
              {!reviewing ? (
                <NxButton variant="ghost" size="sm" onClick={() => setReviewing(true)}>{t("Revisar")}</NxButton>
              ) : (
                <NxButton variant="primary" size="sm" onClick={() => void save()} disabled={saving}>{t("Guardar mi versión")}</NxButton>
              )}
            </div>
          </div>
        )}
        {saveError && (
          <p role="alert" className="rounded-lg border border-bad/40 bg-bad/[0.08] px-4 py-2.5 text-[13px] text-white" data-testid="save-error">
            {td(saveError)} <span className="text-ink-muted">{t("Tu borrador no se ha perdido.")}</span>
          </p>
        )}
        {extras.length > 0 && (
          <div className="nx-clip-sm border border-drl-gold/40 bg-drl-gold/[0.06] px-4 py-3" data-testid="lost-cards">
            <p className="text-[13px] font-semibold text-white">
              {extras.length === 1 ? t("Una carta de este equipo no puede estar en él.") : t("{length} cartas de este equipo no pueden estar en él.", { length: extras.length })} {t("El equipo no es legal hasta que las quites o las cambies.")}
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {extras.map((x) => (
                <li key={x.uid} className="flex items-center gap-2 rounded-lg bg-black/30 px-2 py-1 text-[12px] text-ink-secondary">
                  <span>{x.card?.nick ?? t("Carta")} · {td(x.issue)}</span>
                  <button type="button" onClick={() => removeUid(x.uid)} className="nx-action min-h-[32px] text-[11px]">{t("Quitar")}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {collection.length < DUEL_DECK_SIZE && (
          <div className="nx-clip-sm flex flex-wrap items-center gap-x-3 gap-y-1 border border-drl-cyan/35 bg-drl-cyan/[0.07] px-4 py-2.5" data-testid="few-cards">
            <span className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-drl-cyan">{t("Tienes {n} de {total}", { n: collection.length, total: DUEL_DECK_SIZE })}</span>
            <span className="text-[12px] text-white/60">{t("Un equipo necesita {n} cartas tuyas.", { n: DUEL_DECK_SIZE })}</span>
            <Link href={(props.unopenedPacks ?? 0) > 0 ? "/inventario" : "/tienda"} className="nx-action ml-auto inline-flex min-h-[40px] items-center !text-drl-cyan">
              {(props.unopenedPacks ?? 0) > 0 ? t("Abrir mis sobres →") : t("Conseguir un sobre →")}
            </Link>
          </div>
        )}
        {selectedCard && (
          <div className="nx-clip-sm flex flex-wrap items-center gap-x-3 gap-y-1 border border-drl-gold/40 bg-drl-gold/[0.07] px-4 py-2.5" role="status" data-testid="selection-banner">
            <span className="font-display text-[12px] font-bold uppercase tracking-[0.12em] text-drl-gold">{t("Colocar {nick}", { nick: selectedCard.nick })}</span>
            <span className="text-[12px] text-white/70">
              {fits.size ? t("Elige uno de los {size} huecos resaltados de {role}.", { size: fits.size, role: td(selectedCard.role) }) : t("No hay ningún hueco de {role} donde pueda entrar ahora.", { role: td(selectedCard.role) })}
            </span>
            <button type="button" onClick={() => { setSelectedUid(null); setNotice(null); }} className="nx-action ml-auto min-h-[40px]">{t("Cancelar")}</button>
          </div>
        )}
        {notice && (
          <p role="status" className={cn("rounded-lg border px-4 py-2 text-[13px]", notice.tone === "warn" ? "border-drl-gold/40 bg-drl-gold/[0.06] text-white" : "border-white/10 bg-white/[0.04] text-white/85")} data-testid="notice">
            {td(notice.text)}
          </p>
        )}
      </div>

      {/* ══ Colección · Tablero · Análisis ══ */}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[300px_minmax(0,1fr)_300px]">
        <aside className="hidden xl:block" aria-label={t("Tu colección")}>
          <div className="nx-clip max-h-[calc(100vh-140px)] overflow-y-auto border border-white/10 bg-white/[0.02] p-3">{collectionPanel}</div>
        </aside>

        <section aria-label={t("Tu equipo")} className="min-w-0">
          <div className="nx-stage nx-clip relative overflow-hidden p-3 sm:p-4">
            <span aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "radial-gradient(760px 320px at 50% 120%, rgba(63,210,255,0.12), transparent 70%)" }} />
            <TeamBoard
              board={board}
              selectedSlot={slotKeyOpen}
              fits={fits}
              released={released}
              freshUid={freshUid}
              onSlot={onSlot}
              onRemove={removeSlot}
              onMove={moveSlot}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 xl:hidden">
            <NxButton variant="secondary" size="md" onClick={() => setCollectionOpen(true)} data-testid="open-collection">{t("+ Añadir cartas")}</NxButton>
            <span className="text-[12px] text-ink-faint">{t("o toca un hueco para ver sus candidatas")}</span>
          </div>
          <p className="mt-2 hidden text-[11px] text-ink-faint lg:block">
            {t("Teclado: Tab para moverte · Enter abre el hueco · Supr quita la carta · Alt+↑/↓ la mueve dentro de su rol.")}
          </p>
        </section>

        <aside aria-label={t("Análisis del equipo")} className="min-w-0">
          <AnalysisPanel
            check={check}
            issues={issues}
            stats={stats}
            reading={reading}
            keptCount={uids.filter((u) => !released.has(u)).length}
            auto={auto}
            onAutocomplete={runAutocomplete}
            onIssue={(uid) => { const key = board.slots.find((s) => s.uid === uid)?.key; if (key) focusSlot(key); }}
            saved={!!deck && !dirty}
            strategy={
              <StrategyLabPanel
                analysis={analysis}
                contextAxis={contextAxis}
                onDismissContext={() => { setContextAxis(null); setAltSort("ovr"); }}
                onFocusCard={(uid) => { const s = board.slots.find((x) => x.uid === uid); if (s) setSlotKeyOpen(s.key); }}
              />
            }
            extra={
              <SuggestSection
                pool={pool}
                currentUids={uids}
                initialObjective={init.suggestObjective ?? null}
                initialPareto={init.pareto}
                onApply={(next, label) => { apply(next, t("Plantilla «{label}» aplicada al borrador. Revisa y guarda.", { label: td(label) })); setNotice({ tone: "info", text: t("Plantilla «{label}» aplicada al borrador. No se ha guardado: revisa y pulsa «Guardar equipo».", { label: td(label) }) }); }}
              />
            }
          />
        </aside>
      </div>

      {/* ══ Hojas ══ */}
      <Sheet open={collectionOpen} size="lg" scene="collection-sheet" eyebrow={countLabel(check.count)} title={t("Añadir cartas")} onClose={() => setCollectionOpen(false)}>
        {collectionPanel}
      </Sheet>

      <SlotSheet
        open={!!slotOpen && !compare}
        slot={slotOpen}
        candidates={candidates}
        suggestion={suggestion}
        released={!!slotOpen?.uid && released.has(slotOpen.uid)}
        canMoveUp={!!slotOpen?.uid && slotOpen.index > 0}
        canMoveDown={!!slotOpen?.uid && !!board.byRole[slotOpen.role][slotOpen.index + 1]?.uid}
        initialSuggest={init.suggest}
        onClose={() => setSlotKeyOpen(null)}
        onPick={(card) => {
          if (!slotOpen) return;
          if (slotOpen.uid) { openCompare(slotOpen.uid, card.uid); return; }
          const r = tryAdd(uids, card.uid, pool, check);
          if (r.ok) { apply(r.uids, t("{nick} colocada en {label}.", { nick: card.nick, label: td(slotOpen.label) }), card.uid); setSlotKeyOpen(null); }
          else setNotice({ tone: "warn", text: r.reason });
        }}
        onCompare={(card) => slotOpen && openCompare(slotOpen.uid, card.uid)}
        onRemove={() => slotOpen && removeSlot(slotOpen)}
        onMove={(dir) => slotOpen && moveSlot(slotOpen, dir)}
        focus={slotOpen?.uid ? (
          <CardFocusSection
            contribution={analysis.contributions.find((c) => c.uid === slotOpen.uid) ?? null}
            partnerNick={(() => { const c = analysis.contributions.find((x) => x.uid === slotOpen.uid); return c?.partnerUid ? pool.get(c.partnerUid)?.nick ?? null : null; })()}
            alternatives={alternatives}
            sort={altSort}
            onSort={setAltSort}
            onPreview={(alt) => openCompare(slotOpen.uid, alt.card.uid)}
          />
        ) : null}
        onToggleRelease={() => {
          const uid = slotOpen?.uid;
          if (!uid) return;
          setReleased((cur) => { const n = new Set(cur); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
        }}
      />

      <ComparePanel
        open={!!compare}
        view={compareView}
        strategy={compareImpact}
        slotLabel={compareSlotLabel}
        onClose={() => setCompare(null)}
        onConfirm={(next) => {
          const cand = compare ? pool.get(compare.candidateUid) : undefined;
          apply(next, t("{v} entra en el equipo.", { v: cand?.nick ?? t("La carta") }), cand?.uid ?? null);
          setCompare(null);
          setSlotKeyOpen(null);
          setSelectedUid(null);
          setNotice(null);
        }}
      />

      <Sheet open={!!exploreView} size="lg" scene="explore-card" eyebrow={t("Carta que no tienes")} title={exploreView ? exploreView.nick : t("Carta")} onClose={() => setExplore(null)}>
        {exploreView && (
          <div data-testid="explore-card">
            <p className="text-caption text-ink-secondary">
              {td(exploreView.def.role)} {t("· OVR")} <b className="nx-readout text-white">{exploreView.def.ovr}</b> {t("· SH")} {exploreView.def.combat.stronghold} {t("· GS")} {exploreView.def.combat.gamesense} {t("· EF")} {exploreView.def.combat.entryfrag}
            </p>
            {exploreView.impact && exploreView.target ? (
              <>
                <p className="mt-2 text-[12.5px] text-white">{fill(t("Comparada con tu {role} {nick}:", { role: td(exploreView.def.role), ...slots("nick") }), { nick: <b>{exploreView.target.nick}</b> })}</p>
                <StrategyImpact impact={exploreView.impact} informative />
              </>
            ) : (
              <p className="mt-2 text-caption text-ink-muted">{t("Tu borrador no tiene ninguna carta de {rol} con la que compararla.", { rol: td(exploreView.def.role) })}</p>
            )}
            <p className="mt-3 text-[12px] text-ink-muted">{t("No la tienes: esta comparación es solo informativa y no se puede aplicar al equipo.")}</p>
          </div>
        )}
      </Sheet>

      <Sheet
        open={confirmExit}
        scene="unsaved-exit"
        eyebrow={t("Cambios sin guardar")}
        title={t("¿Salir del constructor?")}
        onClose={() => setConfirmExit(false)}
        footer={
          <div className="flex flex-wrap gap-2">
            <NxButton variant="primary" size="md" onClick={async () => { if (await save()) { setConfirmExit(false); props.onExit(); } else setConfirmExit(false); }} disabled={saving}>{t("Guardar y salir")}</NxButton>
            <NxButton variant="danger" size="md" onClick={() => { setConfirmExit(false); props.onExit(); }}>{t("Salir sin guardar")}</NxButton>
            <NxButton variant="ghost" size="md" onClick={() => setConfirmExit(false)}>{t("Seguir editando")}</NxButton>
          </div>
        }
      >
        <p className="text-body text-ink-secondary">{t("Tienes cambios en «{nombre}» que no se han guardado. Si sales sin guardar, se pierden.", { nombre: name.trim() || baseline.name })}</p>
      </Sheet>
    </div>
  );
}
