"use client";

/**
 * `/duelos/mazos` — MIS EQUIPOS + NEXUS TEAM BUILDER (Fase 32). La ruta canónica de equipos
 * (`/equipo` redirige aquí). Sustituye a «Mis mazos» de la Fase 8 sin cambiar ni una regla.
 *
 *   ?deck=<id>   → abre ese equipo en el constructor (enlaces de pre-partida, vestíbulo, colección).
 *   ?nuevo=1     → abre un equipo nuevo, sin guardar.
 *   &add=<uid>   → llega con esa carta elegida (desde la colección): se iluminan sus huecos.
 *   &eje=<eje>   → Fase 43 · contexto del resumen de una partida (stronghold|gamesense|entryfrag): ordena alternativas.
 *   &explorar=<cardId> → Fase 43 · comparación INFORMATIVA con una carta del catálogo que no posees (sin aplicar).
 *
 * Todo pasa por `/api/game/duels`: la foto (equipos + colección resuelta + equipo activo) en una lectura
 * y cada cambio validado en el servidor. Con cambios sin guardar, salir de la pantalla —cerrar la
 * pestaña o pulsar cualquier enlace— pide confirmación.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { useAuth } from "@/lib/supabase/auth";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { Loading, ErrorState, NeedsAccount } from "@/components/ui/States";
import { useToast } from "@/lib/useToast";
import { Toast } from "@/components/ui/Toast";
import { useGameMoment } from "@/components/ui/game/GameMoment";
import { deckActiveMoment, deckReadyMoment } from "@/lib/gameExperience/deckMoments";
import { NxButton } from "@/components/ui/NxButton";
import { DeckBuilder, type SaveOutcome } from "@/components/duel/DeckBuilder";
import { TeamHub } from "@/components/duel/deck/TeamHub";
import { NameSheet } from "@/components/duel/deck/NameSheet";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { fetchMyPacks } from "@/lib/game/client";
import {
  fetchDuelDecks, saveDuelDeck, saveTeamDeck, createTeamDeck, renameTeamDeck, duplicateTeamDeck, deleteTeamDeck,
  activateTeamDeck, DuelError,
} from "@/lib/duel/client";
import type { DeckWorkspaceDTO, DuelDeckDTO } from "@/lib/duel/types";
import { nextTeamName } from "@/domain/deckBuilder/builder";
import { UUID_RE } from "@/domain/deckBuilder/request";
import { isAxis } from "@/lib/deckStrategy/presentation";
import { DeckCompareView } from "@/components/duel/strategy/DeckCompareView";
import { Sheet } from "@/components/duel/deck/bits";
import { trackCreateStart, trackDeck } from "@/lib/deckBuilder/telemetry";
import { AUTO_ACTIVATED_NOTICE, AUTO_ACTIVATE_FAILED_NOTICE, isFirstTeamContext, shouldAutoActivate } from "@/lib/journey/deck";
import { playerMessage } from "@/components/ui/game/GameStates";
import { ns, td } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("duelos");

export default function MazosPage() {
  useLocale();
  const { user, loading } = useAuth();
  if (loading) return <Loading kind="deck" label={t("Cargando tus equipos…")} />;
  if (!isSupabaseConfigured() || !user) return <NeedsAccount what={t("Tu equipo de duelo")} />;
  return (
    <Suspense fallback={<Loading kind="deck" label={t("Cargando tus equipos…")} />}>
      <MotionConfig reducedMotion="user">
        <Teams />
      </MotionConfig>
    </Suspense>
  );
}

type View = { kind: "hub" } | { kind: "builder"; deckId: string | null; addUid: string | null };

const urlOf = (v: View) =>
  v.kind === "hub" ? "/duelos/mazos" : v.deckId ? `/duelos/mazos?deck=${v.deckId}` : "/duelos/mazos?nuevo=1";

const messageOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function Teams() {
  useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { toast, notify } = useToast();
  /* Fase 44 · PLANTILLA LISTA / EQUIPO ACTIVO como momento de juego (con el hecho del servidor), además del aviso. */
  const moment = useGameMoment();

  const [ws, setWs] = useState<DeckWorkspaceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packs, setPacks] = useState(0);
  const [view, setView] = useState<View>(() => {
    const deck = params.get("deck");
    const add = params.get("add");
    const addUid = add && UUID_RE.test(add) ? add.toLowerCase() : null;
    if (deck && UUID_RE.test(deck)) return { kind: "builder", deckId: deck.toLowerCase(), addUid };
    if (params.get("nuevo") === "1") return { kind: "builder", deckId: null, addUid };
    return { kind: "hub" };
  });
  const [builderKey, setBuilderKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"activate" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DuelDeckDTO | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DuelDeckDTO | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  // Fase 43 · contexto opcional: validado contra listas cerradas (nunca texto libre del enlace en pantalla).
  const [labInit] = useState(() => {
    const eje = params.get("eje");
    const explorar = params.get("explorar");
    return { focusAxis: isAxis(eje) ? eje : null, explore: explorar && /^[a-z0-9_-]{1,80}$/i.test(explorar) ? explorar : null };
  });

  const load = useCallback(async () => {
    try {
      const w = await fetchDuelDecks();
      setWs(w);
      setError(null);
      return w;
    } catch (e) {
      // Si ya había foto se CONSERVA: vaciarla enseñaría «no tienes equipos» cuando lo que falló es la red.
      setError(messageOf(e, t("No se pudieron cargar tus equipos")));
      return null;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let alive = true;
    fetchMyPacks()
      .then((p) => { if (alive) setPacks(Object.values(p).reduce((n, q) => n + q, 0)); })
      .catch(() => { if (alive) setPacks(0); });
    return () => { alive = false; };
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", urlOf(v));
      window.scrollTo({ top: 0 });
    }
  }, []);

  const editing = view.kind === "builder" && view.deckId && ws ? ws.decks.find((d) => d.id === view.deckId) ?? null : null;

  // Un `?deck=` que no es tuyo (o ya no existe) no abre nada: vuelve al hub y lo dice.
  useEffect(() => {
    if (!ws || view.kind !== "builder" || !view.deckId || editing) return;
    notify(t("Ese equipo no existe o no es tuyo"), false);
    go({ kind: "hub" });
  }, [ws, view, editing, go, notify]);

  // Guarda de navegación con cambios sin guardar: cerrar pestaña o pulsar un enlace.
  useEffect(() => {
    if (!dirty || view.kind !== "builder") return;
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(href);
    };
    window.addEventListener("beforeunload", onBefore);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, view.kind]);

  const replaceDeck = useCallback((d: DuelDeckDTO) => {
    setWs((w) => (w ? { ...w, decks: w.decks.map((x) => (x.id === d.id ? { ...d, active: d.id === w.activeDeckId } : x)) } : w));
  }, []);

  /*
   * FASE 40 · PRIMER EQUIPO. Si este guardado deja al jugador con su PRIMER equipo legal y no tiene ninguno activo, se
   * activa con la acción existente (`set_active`, validada en el servidor) y se dice en pantalla. Nada oculto.
   */
  const autoActivate = useCallback(async (deck: DuelDeckDTO): Promise<boolean> => {
    if (!ws || !shouldAutoActivate({ savedValid: deck.valid, activeSupported: ws.activeSupported, activeDeckId: ws.activeDeckId, otherValidDecks: ws.decks.filter((d) => d.valid && d.id !== deck.id).length })) return false;
    try {
      await activateTeamDeck(deck.id, deck.version ?? null);
      trackDeck("deck_activated");
      notify(AUTO_ACTIVATED_NOTICE, true);
      await load();
    } catch {
      notify(AUTO_ACTIVATE_FAILED_NOTICE, false);
    }
    return true;
  }, [ws, notify, load]);

  const onSave = useCallback(async (draft: { name: string; cardUids: string[] }): Promise<SaveOutcome> => {
    try {
      if (!editing) {
        const r = await createTeamDeck({ name: draft.name, cardUids: draft.cardUids });
        trackDeck("deck_created");
        setWs((w) => (w ? { ...w, decks: [r.deck, ...w.decks] } : w));
        setView({ kind: "builder", deckId: r.deck.id, addUid: null });
        window.history.replaceState(null, "", urlOf({ kind: "builder", deckId: r.deck.id, addUid: null }));
        { const m = deckReadyMoment(null, r.deck); if (m) moment(m); }
        if (!(await autoActivate(r.deck))) notify(r.deck.valid ? t("Equipo creado y listo para duelo") : t("Equipo creado (incompleto)"), r.deck.valid);
        return { ok: true, deck: r.deck };
      }
      // Servidor anterior a la Fase 32 (sin versión): guardado de siempre.
      const r = editing.version
        ? await saveTeamDeck({ id: editing.id, name: draft.name, cardUids: draft.cardUids, version: editing.version })
        : await saveDuelDeck({ id: editing.id, name: draft.name, cardUids: draft.cardUids });
      replaceDeck(r.deck);
      { const m = deckReadyMoment(editing.valid, r.deck); if (m) moment(m); }
      if (!(await autoActivate(r.deck))) notify(r.deck.valid ? t("Equipo guardado y listo para duelo") : t("Equipo guardado (incompleto)"), r.deck.valid);
      return { ok: true, deck: r.deck };
    } catch (e) {
      if (e instanceof DuelError && e.code === "CONFLICT") {
        const current = (e.payload?.deck as DuelDeckDTO | undefined) ?? null;
        if (current) replaceDeck(current);
        return { ok: false, kind: "conflict", current, message: e.message };
      }
      return { ok: false, kind: "error", message: messageOf(e, t("No se pudo guardar el equipo")) };
    }
  }, [editing, notify, replaceDeck, autoActivate, moment]);

  const onActivate = useCallback(async (d: DuelDeckDTO) => {
    setBusy("activate");
    setBusyId(d.id);
    try {
      await activateTeamDeck(d.id, d.version ?? null);
      trackDeck("deck_activated");
      notify(t("«{name}» es tu equipo activo", { name: d.name }), true);
      moment(deckActiveMoment(d, Date.now()));
      await load();
    } catch (e) {
      notify(messageOf(e, t("No se pudo activar el equipo")), false);
      if (e instanceof DuelError && (e.code === "CONFLICT" || e.code === "DECK_NOT_READY")) await load();
    } finally {
      setBusy(null);
      setBusyId(null);
    }
  }, [load, notify, moment]);

  const onDuplicate = useCallback(async (d: DuelDeckDTO) => {
    setBusyId(d.id);
    try {
      const r = await duplicateTeamDeck(d.id);
      notify(t("Creado «{name}»", { name: r.deck.name }), true);
      await load();
    } catch (e) {
      notify(messageOf(e, t("No se pudo duplicar el equipo")), false);
    } finally {
      setBusyId(null);
    }
  }, [load, notify]);

  const onRename = useCallback(async (name: string) => {
    if (!renaming) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      if (!renaming.version) throw new DuelError("Recarga la página para renombrar este equipo.", 409);
      await renameTeamDeck(renaming.id, name, renaming.version);
      notify(t("Nombre guardado"), true);
      setRenaming(null);
      await load();
    } catch (e) {
      setRenameError(messageOf(e, t("No se pudo renombrar")));
      if (e instanceof DuelError && e.code === "CONFLICT") await load();
    } finally {
      setRenameBusy(false);
    }
  }, [renaming, load, notify]);

  const onDelete = useCallback(async () => {
    if (!toDelete) return;
    setDeleteBusy(true);
    try {
      const r = await deleteTeamDeck(toDelete.id, toDelete.version ?? null, !!toDelete.active);
      notify(r.wasActive ? t("Equipo eliminado. Ya no tienes equipo activo: elige otro.") : t("Equipo eliminado"), true);
      setToDelete(null);
      if (view.kind === "builder") { setDirty(false); go({ kind: "hub" }); }
      await load();
    } catch (e) {
      notify(messageOf(e, t("No se pudo eliminar")), false);
      setToDelete(null);
      if (e instanceof DuelError && e.code === "CONFLICT") await load();
    } finally {
      setDeleteBusy(false);
    }
  }, [toDelete, view.kind, go, load, notify]);

  const openBuilder = useCallback((deckId: string | null) => {
    setBuilderKey((k) => k + 1);
    go({ kind: "builder", deckId, addUid: null });
  }, [go]);

  const onCreate = useCallback(() => {
    if (!ws || ws.decks.length >= ws.maxDecks) return;
    trackCreateStart(ws.decks.length > 0);
    openBuilder(null);
  }, [ws, openBuilder]);

  if (error && !ws) return <ErrorState message={td(error)} onRetry={() => void load()} />;
  if (!ws) return <Loading kind="deck" label={t("Cargando tus equipos…")} />;

  const deleteBody = toDelete?.active
    ? t("Es tu equipo activo. Si lo borras te quedarás sin equipo activo hasta que elijas otro. Tus cartas no se tocan.")
    : t("Se borra la composición de este equipo. Tus cartas no se tocan.");

  return (
    <>
      <Toast toast={toast} />
      {error && (
        <div role="alert" className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center gap-2 rounded-lg border border-bad/40 bg-bad/[0.08] px-4 py-2 text-[13px] text-white">
          <span className="flex-1">{playerMessage(error)}</span>
          <NxButton variant="ghost" size="sm" onClick={() => void load()}>{t("Reintentar")}</NxButton>
        </div>
      )}

      {view.kind === "builder" && (!view.deckId || editing) ? (
        <DeckBuilder
          key={`${builderKey}`}
          deck={editing}
          collection={ws.collection}
          activeSupported={ws.activeSupported}
          defaultName={nextTeamName(ws.decks.map((d) => d.name))}
          unopenedPacks={packs}
          firstTeam={isFirstTeamContext(ws.decks)}
          onSave={onSave}
          onActivate={editing ? () => void onActivate(editing) : undefined}
          onDuplicate={editing ? () => void onDuplicate(editing) : undefined}
          onDelete={editing ? () => setToDelete(editing) : undefined}
          onExit={() => { setDirty(false); go({ kind: "hub" }); }}
          onDirtyChange={setDirty}
          busy={busy}
          initial={{ ...(view.addUid ? { selectedUid: view.addUid } : {}), focusAxis: labInit.focusAxis, explore: labInit.explore }}
        />
      ) : view.kind === "builder" ? (
        <Loading label={t("Abriendo el equipo…")} />
      ) : (
        <TeamHub
          decks={ws.decks}
          activeDeckId={ws.activeDeckId}
          activeSupported={ws.activeSupported}
          maxDecks={ws.maxDecks}
          collectionCount={ws.collection.length}
          unopenedPacks={packs}
          now={ws.serverNow}
          busyId={busyId}
          onCreate={onCreate}
          onEdit={(d) => openBuilder(d.id)}
          onActivate={(d) => void onActivate(d)}
          onDuplicate={(d) => void onDuplicate(d)}
          onRename={(d) => { setRenameError(null); setRenaming(d); }}
          onDelete={(d) => setToDelete(d)}
          onCompare={ws.decks.length >= 2 ? () => setComparing(true) : undefined}
        />
      )}

      <Sheet open={comparing} size="lg" scene="deck-compare" eyebrow={t("Mis equipos")} title={t("Comparar equipos")} onClose={() => setComparing(false)}>
        {comparing && <DeckCompareView decks={ws.decks} />}
      </Sheet>

      <NameSheet
        open={!!renaming}
        title={renaming ? t("Renombrar «{name}»", { name: renaming.name }) : t("Renombrar")}
        initial={renaming?.name ?? ""}
        busy={renameBusy}
        error={td(renameError)}
        onSubmit={(n) => void onRename(n)}
        onClose={() => { if (!renameBusy) setRenaming(null); }}
      />
      <ConfirmSheet
        open={!!toDelete}
        title={toDelete ? t("¿Eliminar «{name}»?", { name: toDelete.name }) : t("Eliminar")}
        body={deleteBody}
        confirmLabel={toDelete?.active ? t("Eliminar equipo activo") : t("Eliminar equipo")}
        busy={deleteBusy}
        onConfirm={() => void onDelete()}
        onClose={() => { if (!deleteBusy) setToDelete(null); }}
      />
      <ConfirmSheet
        open={!!leaveTo}
        title={t("Tienes cambios sin guardar")}
        body={t("Si sales ahora, perderás los cambios de este equipo.")}
        confirmLabel={t("Salir sin guardar")}
        onConfirm={() => { const to = leaveTo; setLeaveTo(null); setDirty(false); if (to) router.push(to); }}
        onClose={() => setLeaveTo(null)}
      />
    </>
  );
}
