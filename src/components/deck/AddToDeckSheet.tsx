"use client";

/**
 * AÑADIR AL EQUIPO (Fase 25) — del sobre (o de la ficha) al mazo de duelo, sin salir.
 *
 *   carta ──► elegir mazo ──► `planDeckInsert` ──► hueco libre: confirmar
 *                                             ──► rol lleno / mazo lleno / mismo jugador:
 *                                                  elegir a quién sustituir, con comparación
 *                                                  NUEVA vs ACTUAL (OVR, SH/GS/EF, rareza)
 *                                             ──► `saveDuelDeck` (el servidor valida y persiste)
 *
 * Reglas intactas: 10 cartas, 2 por rol, jugador único. Nunca se quita una carta sin
 * confirmación. Con sesión, los mazos viven en el servidor; sin sesión se lleva al constructor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogLayer } from "@/components/ui/game/GameOverlay";
import { GameGlyph } from "@/components/ui/game/GameGlyph";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { fetchDuelDecks, saveDuelDeck } from "@/lib/duel/client";
import type { DuelDeckDTO } from "@/lib/duel/types";
import { planDeckInsert, type DeckCardLike, type InsertPlan, type ReplaceOption } from "@/domain/cardgame/deckInsert";
import { DUEL_DECK_SIZE } from "@/domain/cardgame/types";
import { getVariant } from "@/domain/cards/variants";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { trackFlow } from "@/lib/telemetry/client";
import { NxButton } from "@/components/ui/NxButton";
import { Badge } from "@/components/ui/Badge";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("deck");

export interface AddToDeckSheetProps {
  card: DeckCardLike;
  onClose: () => void;
  /** Se llama cuando el mazo queda guardado con la carta dentro. */
  onSaved?: (deck: DuelDeckDTO) => void;
  /** Origen para telemetría (`pack_summary`, `card_detail`). */
  origin?: string;
  /** Inyectable en pruebas/QA: por defecto, el servidor. */
  loadDecks?: () => Promise<{ decks: DuelDeckDTO[]; activeDeckId?: string | null }>;
  persist?: (input: { id?: string; name: string; cardUids: string[] }) => Promise<{ deck: DuelDeckDTO }>;
}

const toLike = (c: DuelDeckDTO["cards"][number]): DeckCardLike => ({
  uid: c.uid, cardId: c.cardId, playerId: c.playerId, nick: c.nick, role: c.role, variantId: c.variantId,
  ovr: c.ovr, combat: c.combat, serial: c.serial,
});

export function AddToDeckSheet({ card, onClose, onSaved, origin = "card", loadDecks = fetchDuelDecks, persist = saveDuelDeck }: AddToDeckSheetProps) {
  useLocale();
  const router = useRouter();
  const { user } = useAuth();
  // Con `loadDecks`/`persist` inyectados (pruebas, arnés QA) no hace falta sesión: el servidor es el inyectado.
  const injected = loadDecks !== fetchDuelDecks || persist !== saveDuelDeck;
  const online = injected || (isSupabaseConfigured() && !!user);
  const [decks, setDecks] = useState<DuelDeckDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [replaceUid, setReplaceUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<DuelDeckDTO | null>(null);

  useEffect(() => {
    if (!online) return;
    trackFlow("deck_builder", `add_from_card:${origin}`);
    // FASE 32 · se propone el equipo ACTIVO si existe; si no, el primero, como antes.
    loadDecks().then((r) => { setDecks(r.decks); setDeckId(r.decks.find((d) => d.id === r.activeDeckId)?.id ?? r.decks[0]?.id ?? null); }).catch((e) => setError(e instanceof Error ? e.message : t("No se pudieron cargar tus mazos")));
  }, [online, loadDecks, origin]);

  const deck = useMemo(() => decks?.find((d) => d.id === deckId) ?? null, [decks, deckId]);
  const plan: InsertPlan | null = useMemo(() => (deck ? planDeckInsert({ cards: deck.cards.map(toLike) }, card) : null), [deck, card]);

  useEffect(() => { setReplaceUid(null); }, [deckId]);
  /* F64 · la hoja era la única capa sin Escape ni foco: mismo contrato que el resto de capas del juego. */
  const layer = useRef<HTMLDivElement>(null);
  useDialogLayer(true, onClose, !busy, layer);

  async function confirm() {
    if (!deck || !plan || busy) return;
    const uids = plan.kind === "free" ? plan.apply() : plan.apply(replaceUid ?? undefined);
    if (!uids) { setError(t("Elige a quién sustituir.")); return; }
    setBusy(true); setError(null);
    try {
      const r = await persist({ id: deck.id, name: deck.name, cardUids: uids });
      setDone(r.deck);
      onSaved?.(r.deck);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("El servidor no aceptó el equipo"));
    } finally {
      setBusy(false);
    }
  }

  const variant = getVariant(card.variantId);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-modal flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        role="dialog" aria-modal="true" aria-labelledby="add-to-deck-title"
        ref={layer} tabIndex={-1}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <motion.div
          className="nx-clip w-full max-w-lg bg-base-800 p-5 shadow-2xl sm:p-6"
          style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="nx-label">{t("Añadir al equipo")}</p>
              <h2 id="add-to-deck-title" className="mt-1 truncate font-display text-h3 font-bold uppercase leading-none text-white">{card.nick}</h2>
              <p className="mt-1 text-caption" style={{ color: variant.palette.primary }}>
                {td(variant.label)} {t("· OVR")} <span className="nx-readout text-white">{card.ovr}</span> · {td(card.role)}
                {card.serial != null && <span className="text-ink-faint"> {t("· Nº")} {card.serial}</span>}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label={t("Cerrar")} className="nx-focus nx-press nx-clip-sm grid h-11 w-11 min-h-[44px] place-items-center border border-white/15 text-white/70 hover:text-white"><GameGlyph name="close" className="h-4 w-4" /></button>
          </div>

          {!online && (
            <div className="mt-5 space-y-3">
              <p className="text-sm text-ink-muted">{t("Los equipos se guardan con tu cuenta. Entra para añadir esta carta a un equipo, o ábrela en el constructor.")}</p>
              <div className="flex flex-wrap gap-2">
                <NxButton variant="primary" size="md" onClick={() => router.push("/duelos/mazos")}>{t("Ir al constructor")}</NxButton>
                <NxButton variant="secondary" size="md" onClick={() => router.push("/cuenta")}>{t("Entrar")}</NxButton>
              </div>
            </div>
          )}

          {online && done && (
            <div className="mt-5 space-y-3" role="status" aria-live="polite">
              <p className="font-display text-caption font-bold uppercase tracking-wide text-drl-cyan">{t("Guardado en «{nombre}»", { nombre: done.name })}</p>
              <p className="text-sm text-ink-muted">
                {t("{n}/{total} cartas · {estado}", { n: done.cards.length, total: DUEL_DECK_SIZE, estado: done.valid ? t("listo para jugar") : td(done.errors[0]?.message) ?? t("aún incompleto") })}
              </p>
              <div className="flex flex-wrap gap-2">
                <NxButton variant="primary" size="md" onClick={() => router.push(`/duelos/mazos?deck=${done.id}`)}>{t("Ver el equipo")}</NxButton>
                <NxButton variant="secondary" size="md" onClick={onClose}>{t("Seguir")}</NxButton>
              </div>
            </div>
          )}

          {online && !done && (
            <div className="mt-5 space-y-4">
              {decks === null && !error && <p className="text-sm text-ink-muted" role="status">{t("Cargando tus equipos…")}</p>}
              {decks && decks.length === 0 && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-muted">{t("Todavía no tienes ningún equipo. Créalo con esta carta dentro.")}</p>
                  <NxButton variant="primary" size="md" disabled={busy} onClick={async () => {
                    setBusy(true); setError(null);
                    try { const r = await persist({ name: t("Mi equipo"), cardUids: [card.uid] }); setDone(r.deck); onSaved?.(r.deck); }
                    catch (e) { setError(e instanceof Error ? e.message : t("No se pudo crear el equipo")); }
                    finally { setBusy(false); }
                  }}>{t("Crear equipo con esta carta")}</NxButton>
                </div>
              )}
              {decks && decks.length > 0 && (
                <>
                  <label className="block">
                    <span className="nx-label">{t("Equipo")}</span>
                    <select
                      value={deckId ?? ""}
                      onChange={(e) => setDeckId(e.target.value)}
                      className="nx-focus mt-1 w-full rounded-lg border border-white/15 bg-base-900 px-3 py-2.5 text-sm text-white"
                    >
                      {decks.map((d) => (
                        <option key={d.id} value={d.id}>{d.name} · {d.cards.length}/{DUEL_DECK_SIZE}{d.valid ? "" : (" " + t("· incompleto"))}</option>
                      ))}
                    </select>
                  </label>
                  {deckId && (
                    <button
                      type="button"
                      onClick={() => router.push(`/duelos/mazos?deck=${deckId}&add=${card.uid}`)}
                      className="nx-action inline-flex min-h-[44px] items-center text-[12px]"
                    >
                      {t("Abrir en el constructor con esta carta →")}
                    </button>
                  )}

                  {plan && (
                    <div className="space-y-3">
                      <p className="text-sm text-ink-secondary">
                        {plan.kind === "free" && <><Badge tone="ok">{t("Hueco libre")}</Badge> {td(plan.reason)} {t("Se añade sin quitar ninguna carta.")}</>}
                        {plan.kind === "replace" && <><Badge tone="warn">{t("Sustituir")}</Badge> {td(plan.reason)} {t("Elige a quién sustituye.")}</>}
                        {plan.kind === "upgrade" && <><Badge tone="info">{t("Misma identidad")}</Badge> {td(plan.reason)}</>}
                        {plan.kind === "blocked" && <><Badge tone="muted">{t("Sin cambios")}</Badge> {td(plan.reason)}</>}
                      </p>
                      {plan.options.length > 0 && (
                        <ul className="space-y-2" role="radiogroup" aria-label={t("Carta a sustituir")}>
                          {plan.options.map((o) => (
                            <CompareRow key={o.current.uid} option={o} next={card} selected={replaceUid === o.current.uid} onSelect={() => setReplaceUid(o.current.uid)} />
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {error && <p className="text-caption text-bad" role="alert">{playerMessage(error)}</p>}

                  <div className="flex flex-wrap gap-2">
                    <NxButton
                      variant="primary" size="md" onClick={confirm}
                      disabled={busy || !plan || plan.kind === "blocked" || (plan.kind !== "free" && !replaceUid)}
                      aria-busy={busy}
                    >
                      {busy ? t("Guardando…") : plan?.kind === "free" ? t("Añadir al equipo") : t("Sustituir y guardar")}
                    </NxButton>
                    <NxButton variant="ghost" size="md" onClick={onClose}>{t("Cancelar")}</NxButton>
                  </div>
                </>
              )}
              {error && decks === null && <p className="text-caption text-bad" role="alert">{playerMessage(error)}</p>}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function CompareRow({ option, next, selected, onSelect }: { option: ReplaceOption; next: DeckCardLike; selected: boolean; onSelect: () => void }) {
  useLocale();
  const cur = option.current;
  const cv = getVariant(cur.variantId);
  return (
    <li>
      <button
        type="button" role="radio" aria-checked={selected} onClick={onSelect}
        className={"nx-focus nx-clip-sm w-full p-3 text-left transition " + (selected ? "bg-drl/15 shadow-[inset_0_0_0_1px_var(--nx-key)]" : "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)] hover:bg-white/[0.06]")}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-display text-caption font-bold uppercase tracking-wide text-white">
            {next.nick} <span className="text-ink-faint">{t("vs")}</span> {cur.nick}
          </span>
          <span className="shrink-0 text-caption text-ink-faint">{t("{sube} suben · {baja} bajan", { sube: option.up, baja: option.down })}</span>
        </div>
        <div className="mt-2 grid grid-cols-5 gap-1 text-center">
          {option.compare.map((r) => (
            <div key={r.key} className="nx-clip-sm bg-black/30 px-1 py-1">
              <p className="text-[10px] uppercase tracking-wide text-ink-faint">{td(r.label)}</p>
              <p className="nx-readout text-[13px] text-white">
                {r.key === "rank" ? td(getVariant(next.variantId).label.split(" ")[0]) : r.next}
              </p>
              <p className="text-[11px]" style={{ color: r.delta > 0 ? "var(--nx-ok)" : r.delta < 0 ? "var(--nx-bad)" : "var(--nx-ink-faint, #6b7280)" }}>
                {r.key === "rank" ? td(cv.label.split(" ")[0]) : r.current} {r.delta > 0 ? "▲" : r.delta < 0 ? "▼" : "="}
              </p>
            </div>
          ))}
        </div>
      </button>
    </li>
  );
}
