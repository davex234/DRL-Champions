"use client";

/**
 * ARNÉS QA · FASE 32 — `/design-system/fase32?scene=<escena>` (solo capturas y revisión).
 *
 * Monta las piezas REALES del hub de equipos y del constructor (`TeamHub`, `DeckBuilder`, `NameSheet`) y
 * las integraciones (pre-partida, reto social, perfil propio) con fotos **QA SYNTHETIC** (`./fixtures`):
 * ejemplares y equipos inventados sobre cartas reales, validados con el validador canónico. Sin sesión y
 * sin red: el guardado del arnés recalcula en memoria.
 */
import { useEffect, useMemo, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { NxButton } from "@/components/ui/NxButton";
import { ErrorState, NeedsAccount } from "@/components/ui/States";
import { Toast } from "@/components/ui/Toast";
import { HydrationGate } from "@/components/layout/HydrationGate";
import { DeckBuilder, type BuilderInitial, type SaveOutcome } from "@/components/duel/DeckBuilder";
import { TeamHub } from "@/components/duel/deck/TeamHub";
import { NameSheet } from "@/components/duel/deck/NameSheet";
import { PreMatch } from "@/components/duel/PreMatch";
import { ConfirmSheet } from "@/components/social/ConfirmSheet";
import { ChallengeSheet } from "@/components/social/ChallengeSheet";
import { PlayerIdentityView } from "@/components/player/PlayerIdentityView";
import { EMPTY_FILTER } from "@/domain/deckBuilder/pool";
import type { DeckBuilderCardDTO, DuelDeckDTO } from "@/lib/duel/types";
import { RIVAL } from "../fase29/fixtures";
import { OWN_FULL } from "../fase31/fixtures";
import {
  COLLECTION, CONFLICT_DECK, DECK_FULL, DECK_INVALID, DECK_LOST, DECK_NINE, DECK_PARTIAL, DECK_SECOND, FILTER_RARITY,
  FILTER_TEAM, FILTER_TEXT, FULL_UIDS, HUB_DECKS, MIXED, PARTIAL_UIDS, QA_NOW, SCARCE, deckDto, pick,
} from "./fixtures";

export const SCENES = [
  "hub", "no-decks", "multiple", "active", "no-active",
  "builder-empty", "builder-partial", "builder-nine", "builder-complete", "builder-invalid",
  "slots-duelista", "slots-controlador", "slots-iniciador", "slots-centinela", "slots-flex",
  "collection", "collection-sheet", "search", "role-filter", "team-filter", "rarity-filter", "ovr-sort",
  "add-card", "remove-card", "replace-card", "compatible", "illegal-slot", "duplicate-player",
  "compare", "deltas", "team-stats", "strength", "suggest", "auto-ok", "auto-fail",
  "rename", "duplicate", "delete", "set-active", "cannot-activate", "unsaved", "save-error", "stale", "lost",
  "prematch", "collection-to-builder", "profile-to-builder", "challenge", "ftue", "backend-error",
  "reduced-motion", "keyboard", "no-session",
] as const;

const noop = () => {};

export default function Fase32QaPage() {
  return <HydrationGate><Harness /></HydrationGate>;
}

function Harness() {
  const [scene, setScene] = useState("");
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    setScene(new URLSearchParams(window.location.search).get("scene") ?? "");
    setNarrow(window.innerWidth < 1280);
  }, []);

  // Escenas de sección: se desplaza a la zona que se revisa (en móvil queda fuera del primer pantallazo).
  useEffect(() => {
    const anchor: Record<string, string> = {
      "team-stats": "[data-testid=analysis-panel]", strength: "[data-testid=team-reading]", "auto-ok": "[data-testid=autocomplete-result]",
      "auto-fail": "[data-testid=autocomplete-result]", "duplicate-player": "[data-testid=team-board]", lost: "[data-testid=lost-cards]",
      "cannot-activate": "[data-testid=activate-hint]", "profile-to-builder": "[data-testid=hero-actions]", active: "[data-testid=active-team]",
      "no-active": "[data-testid=no-active]", "builder-invalid": "[data-testid=team-board]",
    };
    const sel = anchor[scene];
    if (!sel) return;
    const id = window.setTimeout(() => document.querySelector(sel)?.scrollIntoView({ block: "center" }), 800);
    return () => window.clearTimeout(id);
  }, [scene]);

  useEffect(() => {
    if (scene !== "keyboard") return;
    const id = window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-slot="Controlador-2"] button')?.focus(), 900);
    return () => window.clearTimeout(id);
  }, [scene]);

  const save = useMemo(() => (mode: "ok" | "error") => async (draft: { name: string; cardUids: string[] }): Promise<SaveOutcome> =>
    mode === "error"
      ? { ok: false, kind: "error", message: "Ese equipo contiene una carta que no es tuya o que ya no está disponible." }
      : { ok: true, deck: deckDto(99, draft.name, draft.cardUids) }, []);

  const builder = (o: { deck?: DuelDeckDTO | null; initial?: BuilderInitial; collection?: DeckBuilderCardDTO[]; saveMode?: "ok" | "error"; supported?: boolean } = {}) => (
    <DeckBuilder
      key={scene}
      deck={o.deck ?? null}
      collection={o.collection ?? COLLECTION}
      activeSupported={o.supported ?? true}
      defaultName="Equipo 6"
      unopenedPacks={2}
      onSave={save(o.saveMode ?? "ok")}
      onActivate={noop}
      onDuplicate={noop}
      onDelete={noop}
      onExit={noop}
      initial={o.initial}
    />
  );

  const hub = (decks: DuelDeckDTO[], activeDeckId: string | null = DECK_FULL.id, extra: { collectionCount?: number; packs?: number; supported?: boolean } = {}) => (
    <TeamHub
      decks={decks}
      activeDeckId={activeDeckId}
      activeSupported={extra.supported ?? true}
      maxDecks={8}
      collectionCount={extra.collectionCount ?? COLLECTION.length}
      unopenedPacks={extra.packs ?? 0}
      now={QA_NOW}
      busyId={null}
      onCreate={noop}
      onEdit={noop}
      onActivate={noop}
      onDuplicate={noop}
      onRename={noop}
      onDelete={noop}
    />
  );

  const filtered = (filter: Partial<typeof EMPTY_FILTER>, sort: BuilderInitial["sort"] = "ovr") =>
    builder({ deck: DECK_PARTIAL, initial: { filter: { ...EMPTY_FILTER, ...filter }, sort, collectionOpen: narrow } });

  const body = () => {
    switch (scene) {
      case "hub": return hub(HUB_DECKS);
      case "no-decks": return hub([], null, { collectionCount: COLLECTION.length });
      case "multiple": return hub(HUB_DECKS);
      case "active": return hub(HUB_DECKS);
      case "no-active": return hub(HUB_DECKS.map((d) => ({ ...d, active: false })), null);
      case "builder-empty": return builder();
      case "builder-partial": return builder({ deck: DECK_PARTIAL });
      case "builder-nine": return builder({ deck: DECK_NINE });
      case "builder-complete": return builder({ deck: DECK_FULL });
      case "builder-invalid": return builder({ deck: DECK_INVALID });
      case "slots-duelista": return builder({ deck: DECK_PARTIAL, initial: { slotSheet: "Duelista-2" } });
      case "slots-controlador": return builder({ deck: DECK_PARTIAL, initial: { slotSheet: "Controlador-2" } });
      case "slots-iniciador": return builder({ deck: DECK_PARTIAL, initial: { slotSheet: "Iniciador-2" } });
      case "slots-centinela": return builder({ deck: DECK_PARTIAL, initial: { slotSheet: "Centinela-1" } });
      case "slots-flex": return builder({ deck: DECK_PARTIAL, initial: { slotSheet: "Flex-1" } });
      case "collection": return builder({ deck: DECK_PARTIAL, initial: { collectionOpen: narrow } });
      case "collection-sheet": return builder({ deck: DECK_PARTIAL, initial: { collectionOpen: true } });
      case "search": return filtered({ text: FILTER_TEXT });
      case "role-filter": return filtered({ role: "Flex" });
      case "team-filter": return filtered({ team: FILTER_TEAM });
      case "rarity-filter": return filtered({ rarity: FILTER_RARITY });
      case "ovr-sort": return filtered({ minOvr: 0 }, "ovr");
      case "add-card": return builder({ deck: DECK_PARTIAL, initial: { uids: [...PARTIAL_UIDS, pick("Controlador", 1).uid], notice: `${pick("Controlador", 1).nick} añadida al equipo como Controlador.`, noticeTone: "info", collectionOpen: narrow } });
      case "remove-card": return builder({ deck: DECK_PARTIAL, initial: { slotSheet: "Duelista-1" } });
      case "replace-card": return builder({ deck: DECK_FULL, initial: { compare: { slotUid: pick("Duelista", 1).uid, candidateUid: pick("Duelista", 2).uid } } });
      case "compatible": return builder({ deck: DECK_PARTIAL, initial: { selectedUid: pick("Controlador", 1).uid } });
      case "illegal-slot": return builder({ deck: DECK_PARTIAL, initial: { selectedUid: pick("Duelista", 2).uid, notice: "Los 2 huecos de Duelista están ocupados. Sustituye una carta. Pulsa el hueco resaltado que quieres cambiar." } });
      case "duplicate-player": return builder({ deck: DECK_INVALID });
      case "compare": return builder({ deck: DECK_FULL, initial: { compare: MIXED } });
      case "deltas": return builder({ deck: DECK_FULL, initial: { compare: MIXED } });
      case "team-stats": return builder({ deck: DECK_FULL });
      case "strength": return builder({ deck: DECK_NINE });
      case "suggest": return builder({ deck: DECK_PARTIAL, initial: { slotSheet: "Flex-1", suggest: true } });
      case "auto-ok": return builder({ deck: DECK_PARTIAL, initial: { autocomplete: true } });
      case "auto-fail": return builder({ deck: null, collection: SCARCE, initial: { uids: [pick("Duelista", 0).uid], autocomplete: true } });
      case "rename": return <>{hub(HUB_DECKS)}<NameSheet open title={`Renombrar «${DECK_PARTIAL.name}»`} initial={DECK_PARTIAL.name} busy={false} error={null} onSubmit={noop} onClose={noop} /></>;
      case "duplicate": return <>{hub([DECK_FULL, deckDto(8, "Equipo principal copia", FULL_UIDS, { ageDays: 0 }), ...HUB_DECKS.slice(1)])}<Toast toast={{ id: 1, msg: "Creado «Equipo principal copia»", ok: true }} /></>;
      case "delete": return <>{hub(HUB_DECKS)}<ConfirmSheet open title={`¿Eliminar «${DECK_FULL.name}»?`} body="Es tu equipo activo. Si lo borras te quedarás sin equipo activo hasta que elijas otro. Tus cartas no se tocan." confirmLabel="Eliminar equipo activo" onConfirm={noop} onClose={noop} /></>;
      case "set-active": return <>{hub([{ ...DECK_SECOND, active: true }, { ...DECK_FULL, active: false }, ...HUB_DECKS.slice(2)], DECK_SECOND.id)}<Toast toast={{ id: 2, msg: `«${DECK_SECOND.name}» es tu equipo activo`, ok: true }} /></>;
      case "cannot-activate": return builder({ deck: DECK_PARTIAL });
      case "unsaved": return builder({ deck: DECK_NINE, initial: { uids: FULL_UIDS, confirmExit: true } });
      case "save-error": return builder({ deck: null, saveMode: "error", initial: { uids: PARTIAL_UIDS, name: "Equipo 6", saveError: "No se pudo guardar: Ese equipo contiene una carta que no es tuya o que ya no está disponible." } });
      case "stale": return builder({ deck: CONFLICT_DECK, initial: { uids: [...PARTIAL_UIDS, pick("Controlador", 1).uid], conflict: CONFLICT_DECK, reviewing: true } });
      case "lost": return builder({ deck: DECK_LOST });
      case "prematch": return <PreMatch decks={HUB_DECKS} deckId={DECK_FULL.id} onDeck={noop} difficulty="NORMAL" onDifficulty={noop} onStart={noop} busy={false} error={null} activeDeckId={DECK_FULL.id} />;
      case "collection-to-builder": return builder({ deck: DECK_PARTIAL, initial: { selectedUid: pick("Flex", 2).uid } });
      case "profile-to-builder": return <PlayerIdentityView snap={OWN_FULL} onEdit={noop} />;
      case "challenge": return <ChallengeSheet open mode="send" target={RIVAL} decks={HUB_DECKS} activeDeckId={DECK_FULL.id} busy={false} error={null} onConfirm={noop} onClose={noop} />;
      case "ftue": return hub([], null, { collectionCount: 6, packs: 3 });
      case "backend-error": return <ErrorState message="No se pudieron cargar tus equipos" onRetry={noop} />;
      case "reduced-motion": return builder({ deck: DECK_FULL });
      case "keyboard": return builder({ deck: DECK_PARTIAL });
      case "no-session": return <NeedsAccount what="Tu equipo de duelo" />;
      default:
        return <div className="flex flex-wrap gap-2">{SCENES.map((s) => <NxButton key={s} variant="secondary" size="sm" href={`/design-system/fase32?scene=${s}`}>{s}</NxButton>)}</div>;
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1480px] px-4 py-5" data-qa-scene={scene || "index"}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="warn" solid>QA SYNTHETIC</Badge>
          <span className="font-display text-[13px] font-bold uppercase text-white">Arnés Fase 32 · {scene || "índice"}</span>
          <span className="text-caption text-ink-faint">ejemplares y equipos inventados · cartas y estadísticas del catálogo real · validador canónico · sin servidor</span>
        </div>
        {body()}
      </div>
    </MotionConfig>
  );
}
