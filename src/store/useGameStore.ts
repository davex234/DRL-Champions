"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CardDef, OwnedCard } from "@/domain/cards/types";
import { getVariant } from "@/domain/cards/variants";
import { getCard } from "@/data/catalog";
import { getPack } from "@/data/packs";
import { PackEngine, freshPity, type PityState, type OpenResult } from "@/pack";
import { CraftEngine, freshMaterials, migrateMaterials, addMaterials as addMats, type Materials, type CraftResult, type CraftIssue } from "@/craft";
import { runtimePackEngine, runtimeCraftEngine } from "@/publisher/runtime";
import { getRecipe } from "@/data/recipes";
import type { CardOrigin } from "@/collection";
import { useEventsStore } from "@/store/useEventsStore";
import { quickSellValue } from "@/domain/economy/pricing";
import { xpForCardRank } from "@/domain/progression/levels";
import { seedFrom } from "@/sim/rng";
import { ACHIEVEMENTS, type AchievementContext } from "@/domain/progression/achievements";

/** Resultado de revelar una carta al abrir un sobre. */
export interface OpenedResult {
  uid: string;
  card: CardDef;
  serial?: number;
  /** Si es la primera copia de esta carta que obtiene el usuario. */
  isNew: boolean;
  value: number;
}

/** Récord de carrera del entrenador (alimenta el hub y la ceremonia). */
export interface MatchRecord {
  played: number;
  won: number;
  lost: number;
  /** Racha de victorias actual (0 al perder). */
  streak: number;
  /** Mejor racha histórica. */
  best: number;
}
const ZERO_RECORD: MatchRecord = { played: 0, won: 0, lost: 0, streak: 0, best: 0 };

interface GameState {
  hydrated: boolean;
  credits: number;
  xp: number;
  ownedCards: OwnedCard[];
  /** Sobres sin abrir en el inventario. packId -> cantidad. */
  unopenedPacks: Record<string, number>;
  /** Contador de acuñación por carta serializada (para nº de serie). */
  mintCounts: Record<string, number>;
  /** Estado de pity del Pack/Drop Engine (garantías por acumulación). */
  pityState: PityState;
  /** Origen de cada instancia (uid -> origen). Sellado por el Pack/Drop Engine. */
  cardOrigins: Record<string, CardOrigin>;
  /** Materiales de crafting (polvo por rareza). Único recurso nuevo del Craft Engine. */
  materials: Materials;
  /** uids bloqueados (anti-venta / anti-salvage). */
  lockedUids: string[];
  /** Cosméticos de cuenta (títulos/iconos/avatares/marcos…). Ids con prefijo. Battle Pass. */
  cosmetics: string[];
  packsOpened: number;
  /** Nº de operaciones de crafting realizadas (métrica real para misiones del Battle Pass). */
  craftedCount: number;
  claimedAchievements: string[];
  /** Récord de carrera del entrenador (partidos jugados/ganados/racha). */
  record: MatchRecord;
  /** Resultado de la última apertura (transitorio, para la pantalla de reveal). */
  lastOpened: OpenedResult[] | null;

  // --- Acciones ---
  buyPack: (packId: string) => { ok: boolean; error?: string };
  openPackFromInventory: (packId: string) => OpenedResult[] | null;
  buyAndOpen: (packId: string) => OpenedResult[] | null;
  quickSell: (uid: string) => void;
  quickSellMany: (uids: string[]) => void;
  /*
   * `claimAchievement` se RETIRÓ en la Fase 9E. Sumaba créditos en `localStorage`, que es
   * justo lo que prohíbe §25 —la economía no puede depender del navegador— y además se
   * revertía en la siguiente sincronización con el servidor. Los logros los concede ahora
   * `/api/game/progression`, con su asiento en `credit_transactions`.
   * `claimedAchievements` se conserva: es progreso ya guardado de partidas anteriores y
   * borrarlo perdería historial.
   */
  addCredits: (amount: number) => void;
  /** Resta créditos si hay saldo suficiente. Devuelve true si se cobró. */
  spendCredits: (amount: number) => boolean;
  /** Añade una carta a la colección (compras de mercado), sellando su origen. Devuelve el uid. */
  addOwnedCard: (cardId: string, serial?: number, origin?: CardOrigin) => string;
  /** Quita una instancia por uid y la devuelve (al poner en venta). */
  removeOwnedCard: (uidToRemove: string) => OwnedCard | null;
  /** Devuelve una instancia exacta a la colección (uid preservado). */
  restoreOwnedCard: (owned: OwnedCard) => void;
  /** Otorga sobres al inventario (recompensas de eventos). */
  grantPack: (packId: string, count?: number) => void;
  /** Suma XP de cuenta (recompensas de eventos/misiones). */
  addXp: (amount: number) => void;
  /** Suma materiales de crafting (recompensas del Battle Pass). */
  addMaterials: (delta: Partial<Materials>) => void;
  /** Otorga cosméticos de cuenta (Battle Pass). Ignora duplicados. */
  addCosmetics: (ids: string[]) => void;
  /** Registra el resultado de un partido jugado (récord/racha). */
  recordMatch: (won: boolean) => void;
  /** Otorga una carta concreta (misma ruta de acuñación que los sobres), sellando su origen. */
  grantCard: (cardId: string, origin?: CardOrigin) => string | null;
  clearLastOpened: () => void;
  resetGame: () => void;

  /**
   * Vuelca el estado REAL del servidor sobre el store (Fase B).
   *
   * Con sesión iniciada, el servidor es la autoridad: este store pasa a ser una
   * CACHÉ de UI. Las acciones locales de economía (`buyPack`, `openPackFromInventory`,
   * `quickSell`…) siguen existiendo para el modo local sin cuenta, pero la UI online
   * no las usa: llama a `/api/game/*` y refresca con esta función.
   */
  applyServerState: (s: {
    credits: number; xp: number; ownedCards: OwnedCard[];
    origins: Record<string, CardOrigin>; lockedUids: string[];
    unopenedPacks: Record<string, number>; pityState: PityState;
    packsOpened: number; mintCounts: Record<string, number>;
  }) => void;
  /** Marca el resultado de una apertura de servidor para la pantalla de revelado. */
  setLastOpened: (results: OpenedResult[]) => void;

  // ── Crafting / Evolution (Collection Fase 4/7) ──
  /** Bloquea/desbloquea una instancia (evita venta/salvage accidental). */
  lockCard: (uid: string) => void;
  unlockCard: (uid: string) => void;
  isLocked: (uid: string) => boolean;
  /** Ejecuta una receta de crafting (evoluciona cartas). Aplica el PLAN puro del Craft Engine. */
  craft: (recipeId: string, selection?: string[]) => { ok: boolean; issues?: CraftIssue[]; result?: CraftResult; error?: string };
}

const STARTER_CREDITS = 6000;
const STARTER_PACKS: Record<string, number> = { inicial: 3, estandar: 1 };

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * ÚNICO motor de apertura/drop y de crafting. Antes eran singletons congelados en
 * import-time (su CardRegistry quedaba obsoleto tras rebuildCatalog); desde el Publisher
 * (Card Generator F7) se obtienen del runtime, que los recrea automáticamente cuando el
 * catálogo vivo cambia — publicaciones, rollbacks e imports del admin incluidos.
 */
const packEngine = (): PackEngine => runtimePackEngine();
const craftEngine = (): CraftEngine => runtimeCraftEngine();

/**
 * RUTA ÚNICA de entrada de cartas al store. Toda instancia acuñada por el Pack Engine (abriendo un
 * sobre O concedida por grant) se persiste AQUÍ: asigna uid + obtainedAt en el borde, funde
 * mintCounts/pity y sella el origen. Devuelve el parche de estado + los resultados (para el reveal).
 * Tanto `openPackFromInventory` como `grantCard` pasan por esta función (sin lógica duplicada).
 */
function ingestAcquired(s: GameState, r: OpenResult, now: number): { patch: Partial<GameState>; results: OpenedResult[] } {
  const newOwned: OwnedCard[] = [];
  const origins: Record<string, CardOrigin> = { ...s.cardOrigins };
  const results: OpenedResult[] = r.instances.map((ins) => {
    const u = uid();
    newOwned.push({ uid: u, cardId: ins.cardId, serial: ins.serial ?? undefined, obtainedAt: now });
    origins[u] = ins.origin;
    return { uid: u, card: ins.card, serial: ins.serial ?? undefined, isNew: ins.isNew, value: ins.value };
  });
  return {
    patch: {
      ownedCards: [...s.ownedCards, ...newOwned],
      mintCounts: { ...s.mintCounts, ...r.mintDelta },
      pityState: r.pityAfter,
      cardOrigins: origins,
    },
    results,
  };
}

/**
 * Versión de esquema de persistencia de la economía (créditos/cartas/pity/materiales/origins).
 * Los saves antiguos NO tenían versión → zustand los trata como versión 0 y pasan por `migrateGameState`.
 */
export const GAME_SCHEMA_VERSION = 1;

/**
 * Normaliza CUALQUIER estado persistido previo (incl. saves sin versión = 0) rellenando defaults sin
 * descartar datos del usuario. Es idempotente y defensivo: nunca rompe un save existente ni pierde cartas.
 */
function migrateGameState(persisted: unknown): Partial<GameState> {
  const p = (persisted && typeof persisted === "object" ? persisted : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const rec = <T,>(v: unknown): Record<string, T> => (v && typeof v === "object" ? { ...(v as Record<string, T>) } : {});
  return {
    credits: num(p.credits, STARTER_CREDITS),
    xp: num(p.xp, 0),
    ownedCards: arr<OwnedCard>(p.ownedCards),
    unopenedPacks: rec<number>(p.unopenedPacks),
    mintCounts: rec<number>(p.mintCounts),
    pityState: p.pityState && typeof p.pityState === "object" ? (p.pityState as PityState) : freshPity(),
    cardOrigins: rec<CardOrigin>(p.cardOrigins),
    materials: migrateMaterials(p.materials),
    cosmetics: arr<string>(p.cosmetics),
    lockedUids: arr<string>(p.lockedUids),
    packsOpened: num(p.packsOpened, 0),
    craftedCount: num(p.craftedCount, 0),
    claimedAchievements: arr<string>(p.claimedAchievements),
    record: p.record && typeof p.record === "object" ? { ...ZERO_RECORD, ...(p.record as Partial<MatchRecord>) } : { ...ZERO_RECORD },
  };
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      credits: STARTER_CREDITS,
      xp: 0,
      ownedCards: [],
      unopenedPacks: { ...STARTER_PACKS },
      mintCounts: {},
      pityState: freshPity(),
      cardOrigins: {},
      materials: freshMaterials(),
      lockedUids: [],
      cosmetics: [],
      packsOpened: 0,
      craftedCount: 0,
      claimedAchievements: [],
      record: { ...ZERO_RECORD },
      lastOpened: null,

      buyPack: (packId) => {
        const pack = getPack(packId);
        if (!pack) return { ok: false, error: "Sobre no encontrado" };
        const { credits } = get();
        if (credits < pack.price) return { ok: false, error: "Créditos insuficientes" };
        set((s) => ({
          credits: s.credits - pack.price,
          unopenedPacks: {
            ...s.unopenedPacks,
            [packId]: (s.unopenedPacks[packId] ?? 0) + 1,
          },
        }));
        return { ok: true };
      },

      openPackFromInventory: (packId) => {
        const pack = getPack(packId);
        const state = get();
        if (!pack || (state.unopenedPacks[packId] ?? 0) <= 0) return null;

        // El Drop Engine DECIDE qué cae (determinista); el store solo persiste el resultado.
        const now = Date.now();
        const seed = seedFrom(`${packId}|${state.packsOpened}|${state.ownedCards.length}`);
        const result = packEngine().open(pack, {
          seed, owned: state.ownedCards, mintCounts: state.mintCounts, pity: state.pityState, now,
        });

        set((s) => {
          const { patch, results } = ingestAcquired(s, result, now);
          const gainedXp = result.instances.reduce((sum, ins) => sum + xpForCardRank(getVariant(ins.card.variantId).rank), 0);
          return {
            ...patch,
            unopenedPacks: { ...s.unopenedPacks, [packId]: s.unopenedPacks[packId] - 1 },
            packsOpened: s.packsOpened + 1,
            xp: s.xp + gainedXp,
            lastOpened: results,
          };
        });
        return get().lastOpened;
      },

      buyAndOpen: (packId) => {
        const res = get().buyPack(packId);
        if (!res.ok) return null;
        return get().openPackFromInventory(packId);
      },

      quickSell: (uidToSell) => {
        const { ownedCards } = get();
        const card = ownedCards.find((o) => o.uid === uidToSell);
        if (!card) return;
        const def = getCard(card.cardId);
        if (!def) return;
        const value = quickSellValue(def, card.serial);
        set((s) => ({
          credits: s.credits + value,
          ownedCards: s.ownedCards.filter((o) => o.uid !== uidToSell),
        }));
      },

      quickSellMany: (uids) => {
        const set_ = new Set(uids);
        const { ownedCards } = get();
        let gained = 0;
        for (const o of ownedCards) {
          if (!set_.has(o.uid)) continue;
          const def = getCard(o.cardId);
          if (def) gained += quickSellValue(def, o.serial);
        }
        set((s) => ({
          credits: s.credits + gained,
          ownedCards: s.ownedCards.filter((o) => !set_.has(o.uid)),
        }));
      },

      addCredits: (amount) => set((s) => ({ credits: s.credits + amount })),

      spendCredits: (amount) => {
        if (get().credits < amount) return false;
        set((s) => ({ credits: s.credits - amount }));
        return true;
      },

      addOwnedCard: (cardId, serial, origin = "market") => {
        const newUid = uid();
        set((s) => ({
          ownedCards: [
            ...s.ownedCards,
            { uid: newUid, cardId, serial, obtainedAt: Date.now() },
          ],
          // Sella el origen: mantiene el invariante "toda instancia de la colección tiene origen"
          // (igual que sobres/grant/craft vía ingestAcquired). Antes las compras de mercado no lo hacían.
          cardOrigins: { ...s.cardOrigins, [newUid]: origin },
        }));
        return newUid;
      },

      removeOwnedCard: (uidToRemove) => {
        const card = get().ownedCards.find((o) => o.uid === uidToRemove) ?? null;
        if (card) set((s) => ({ ownedCards: s.ownedCards.filter((o) => o.uid !== uidToRemove) }));
        return card;
      },

      /** Devuelve una instancia EXACTA a la colección (uid preservado) — cancelar/expirar un listado. */
      restoreOwnedCard: (owned) =>
        set((s) => (s.ownedCards.some((o) => o.uid === owned.uid) ? s : { ownedCards: [...s.ownedCards, owned] })),

      grantPack: (packId, count = 1) =>
        set((s) => ({
          unopenedPacks: {
            ...s.unopenedPacks,
            [packId]: (s.unopenedPacks[packId] ?? 0) + count,
          },
        })),

      addXp: (amount) => set((s) => ({ xp: s.xp + amount })),

      addMaterials: (delta) => set((s) => ({ materials: addMats(s.materials, delta) })),
      addCosmetics: (ids) => set((s) => ({ cosmetics: [...s.cosmetics, ...ids.filter((id) => !s.cosmetics.includes(id))] })),

      recordMatch: (won) =>
        set((s) => {
          const streak = won ? s.record.streak + 1 : 0;
          return {
            record: {
              played: s.record.played + 1,
              won: s.record.won + (won ? 1 : 0),
              lost: s.record.lost + (won ? 0 : 1),
              streak,
              best: Math.max(s.record.best, streak),
            },
          };
        }),

      grantCard: (cardId, origin = "reward") => {
        if (!getCard(cardId)) return null;
        // MISMA ruta de acuñación (packEngine.grant → Minter) e ingreso (ingestAcquired) que los sobres.
        const now = Date.now();
        const s0 = get();
        const r = packEngine().grant([cardId], origin, {
          seed: 0, owned: s0.ownedCards, mintCounts: s0.mintCounts, pity: s0.pityState, now,
        });
        if (!r.instances.length) return null;
        let newUid: string | null = null;
        set((s) => {
          const { patch, results } = ingestAcquired(s, r, now);
          newUid = results[0].uid;
          return patch;   // no toca lastOpened/xp: un grant no es una apertura de sobre
        });
        return newUid;
      },

      clearLastOpened: () => set({ lastOpened: null }),

      applyServerState: (s) =>
        set({
          credits: s.credits,
          xp: s.xp,
          ownedCards: s.ownedCards,
          cardOrigins: s.origins,
          lockedUids: s.lockedUids,
          unopenedPacks: s.unopenedPacks,
          pityState: s.pityState,
          packsOpened: s.packsOpened,
          mintCounts: s.mintCounts,
        }),

      setLastOpened: (results) => set({ lastOpened: results }),

      lockCard: (uid) => set((s) => (s.lockedUids.includes(uid) ? s : { lockedUids: [...s.lockedUids, uid] })),
      unlockCard: (uid) => set((s) => ({ lockedUids: s.lockedUids.filter((u) => u !== uid) })),
      isLocked: (uid) => get().lockedUids.includes(uid),

      craft: (recipeId, selection) => {
        const recipe = getRecipe(recipeId);
        if (!recipe) return { ok: false, error: "Receta inexistente" };
        const s0 = get();
        const now = Date.now();
        const tokens = (useEventsStore.getState() as { tokens: number }).tokens;
        const seed = seedFrom(`craft|${recipeId}|${s0.ownedCards.length}|${s0.credits}`);
        // El Craft Engine DECIDE y ACUÑA (vía el único Minter); el store solo aplica el plan puro.
        const res = craftEngine().craft(recipe, {
          owned: s0.ownedCards, materials: s0.materials, credits: s0.credits, tokens,
          mintCounts: s0.mintCounts, locks: new Set(s0.lockedUids), selection, seed, now,
        });
        if (!res.ok) return { ok: false, issues: res.issues };

        const removed = new Set(res.removedUids);
        set((s) => {
          const survived = s.ownedCards.filter((o) => !removed.has(o.uid));
          // Reutiliza la MISMA ruta de ingreso que sobres/grant (sin duplicar); pity intacto.
          const { patch } = ingestAcquired(
            { ...s, ownedCards: survived },
            { packId: `craft:${recipeId}`, instances: res.instances, events: [], pityAfter: s.pityState, mintDelta: res.mintDelta },
            now,
          );
          const origins = { ...(patch.cardOrigins ?? s.cardOrigins) };
          for (const uid of res.removedUids) delete origins[uid];
          return {
            ...patch,
            cardOrigins: origins,
            materials: res.materialsAfter,
            credits: res.creditsAfter,
            lockedUids: s.lockedUids.filter((u) => !removed.has(u)),
            craftedCount: s.craftedCount + 1,
          };
        });
        // Tokens (si la receta los cuesta) por la economía existente (events store).
        if (res.tokensAfter !== tokens) useEventsStore.setState({ tokens: res.tokensAfter } as never);
        return { ok: true, result: res };
      },

      resetGame: () =>
        set({
          credits: STARTER_CREDITS,
          xp: 0,
          ownedCards: [],
          unopenedPacks: { ...STARTER_PACKS },
          mintCounts: {},
          pityState: freshPity(),
          cardOrigins: {},
          materials: freshMaterials(),
          lockedUids: [],
          cosmetics: [],
          packsOpened: 0,
          craftedCount: 0,
          claimedAchievements: [],
          record: { ...ZERO_RECORD },
          lastOpened: null,
        }),
    }),
    {
      name: "drl-champions",
      version: GAME_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      migrate: (persisted) => migrateGameState(persisted),
      partialize: (s) => ({
        credits: s.credits,
        xp: s.xp,
        ownedCards: s.ownedCards,
        unopenedPacks: s.unopenedPacks,
        mintCounts: s.mintCounts,
        pityState: s.pityState,
        cardOrigins: s.cardOrigins,
        materials: s.materials,
        cosmetics: s.cosmetics,
        lockedUids: s.lockedUids,
        packsOpened: s.packsOpened,
        craftedCount: s.craftedCount,
        claimedAchievements: s.claimedAchievements,
        record: s.record,
      }),
    },
  ),
);

export function buildAchievementContext(state: GameState): AchievementContext {
  return {
    packsOpened: state.packsOpened,
    ownedCardIds: new Set(state.ownedCards.map((o) => o.cardId)),
  };
}
