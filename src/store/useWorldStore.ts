"use client";

/**
 * LIVING ESPORTS WORLD STORE — el universo PERSISTENTE.
 *
 * Guarda el `WorldState` y lo avanza con el motor puro `@/world` (cero lógica aquí). Al
 * avanzar temporadas, empuja las noticias del mundo al buzón `useNewsStore` (sink único,
 * sin duplicar el sistema de noticias). El usuario puede "irse N temporadas" y volver a un
 * universo distinto. Determinista por semilla.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createWorld, advanceWorld, worldBroadcast, type WorldState, type WorldBroadcast } from "@/world";
import { runAiMarket, marketNews } from "@/market";
import { useNewsStore } from "@/store/useNewsStore";

const DEFAULT_SEED = 20260630;

interface WorldStoreState {
  world: WorldState | null;
  ensure: () => WorldState;
  advance: () => void;
  simulate: (seasons: number) => void;
  view: () => WorldBroadcast | null;
  reset: (seed?: number) => void;
}

// El Timeline usa un Set (cardKeys); JSON.stringify lo pierde. Lo rehidratamos al cargar.
function reviveWorld(w: WorldState | null): WorldState | null {
  if (w && w.timeline && !(w.timeline.cardKeys instanceof Set)) {
    w.timeline.cardKeys = new Set<string>(Array.isArray(w.timeline.cardKeys) ? (w.timeline.cardKeys as string[]) : []);
  }
  return w;
}

/**
 * Serializa el WorldState para persistir: convierte el Set `cardKeys` a array. Sin esto,
 * JSON.stringify(Set) → "{}" y la garantía anti-duplicados del Timeline se PERDÍA en cada recarga.
 * `reviveWorld` reconstruye el Set (array → Set) al cargar. Backward-compatible con saves antiguos.
 */
function worldForPersist(w: WorldState | null): unknown {
  if (!w) return null;
  const keys = w.timeline?.cardKeys;
  if (keys instanceof Set) return { ...w, timeline: { ...w.timeline, cardKeys: Array.from(keys) } };
  return w;
}

/**
 * MERCADO ÚNICO (Consolidation F1.1): avanzar el mundo desde CUALQUIER pantalla ejecuta el
 * MISMO mercado completo que la carrera del manager — `runAiMarket` (cesiones + retornos +
 * eventos notables, que REUTILIZA `runTransferMarket` como mecanismo) y después la temporada
 * con `skipTransferMarket`. Antes `/mundo` corría solo el mercado básico y el universo
 * evolucionaba distinto según la pantalla de entrada. Sin club de usuario aquí ⇒ sin blindaje.
 */
function advanceOneSeason(w: WorldState) {
  const at = Date.now();
  const mktEvents = runAiMarket(w, null, at);
  const { news } = advanceWorld(w, { skipTransferMarket: true });
  return [...news, ...marketNews(mktEvents.map((e) => ({ ...e, at })))];
}

export const useWorldStore = create<WorldStoreState>()(
  persist(
    (set, get) => ({
      world: null,

      ensure: () => {
        let w = reviveWorld(get().world);
        if (!w) { w = createWorld(DEFAULT_SEED); set({ world: w }); }
        return w;
      },

      advance: () => {
        const w = get().ensure();
        const news = advanceOneSeason(w);
        if (news.length) useNewsStore.getState().add(news);
        set({ world: { ...w } });
      },

      simulate: (seasons) => {
        const w = get().ensure();
        const news: ReturnType<typeof advanceOneSeason> = [];
        for (let i = 0; i < Math.max(0, seasons); i++) news.push(...advanceOneSeason(w));
        if (news.length) useNewsStore.getState().add(news.slice(-60)); // últimas, evita inundar el buzón
        set({ world: { ...w } });
      },

      view: () => {
        const w = reviveWorld(get().world);
        return w ? worldBroadcast(w) : null;
      },

      reset: (seed = DEFAULT_SEED) => set({ world: createWorld(seed) }),
    }),
    {
      name: "drl-world-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ world: worldForPersist(s.world) }),
      onRehydrateStorage: () => (state) => { if (state?.world) reviveWorld(state.world); },
    },
  ),
);
