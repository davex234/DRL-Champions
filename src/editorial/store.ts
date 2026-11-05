"use client";

/**
 * EDITORIAL STORE — persistencia del circuito editorial para la app (dashboard). Envuelve el
 * motor puro (submit/decide/publishApproved) sin lógica propia: un caso por generación, el
 * último activo para el dashboard. Solo estados editoriales + historial; jamás catálogo.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CardGenerationResult } from "@/card-generator";
import { submitGeneration } from "./review";
import { decide } from "./approvals";
import { approveTournament } from "./approvals";
import { publishApproved, type PublishApprovedCtx } from "./engine";
import type { DecisionMeta, EditorialAction, EditorialCase, PublishApprovedResult } from "./types";

interface EditorialStoreState {
  /** Casos por generationId (el dashboard muestra el de la generación grabada). */
  cases: Record<string, EditorialCase>;
  lastGenerationId: string | null;

  submit: (gen: CardGenerationResult, meta: DecisionMeta & { tournamentName?: string }) => void;
  decideCards: (generationId: string, cardIds: string[], action: EditorialAction, meta: DecisionMeta) => void;
  approveAll: (generationId: string, meta: DecisionMeta) => void;
  publishApprovedCards: (generationId: string, ctx: PublishApprovedCtx) => Promise<PublishApprovedResult | null>;
  clear: () => void;
}

export const useEditorialStore = create<EditorialStoreState>()(
  persist(
    (set, get) => ({
      cases: {},
      lastGenerationId: null,

      submit: (gen, meta) => {
        const c = submitGeneration(gen, meta);
        set((s) => ({ cases: { ...s.cases, [c.generationId]: c }, lastGenerationId: c.generationId }));
      },

      decideCards: (generationId, cardIds, action, meta) => {
        const c = get().cases[generationId];
        if (!c) return;
        const r = decide(c, cardIds, action, meta);
        set((s) => ({ cases: { ...s.cases, [generationId]: r.case } }));
      },

      approveAll: (generationId, meta) => {
        const c = get().cases[generationId];
        if (!c) return;
        const r = approveTournament(c, meta);
        set((s) => ({ cases: { ...s.cases, [generationId]: r.case } }));
      },

      publishApprovedCards: async (generationId, ctx) => {
        const c = get().cases[generationId];
        if (!c) return null;
        const r = await publishApproved(c, ctx);
        if (r.ok) set((s) => ({ cases: { ...s.cases, [generationId]: r.case } }));
        return r;
      },

      clear: () => set({ cases: {}, lastGenerationId: null }),
    }),
    {
      name: "drl-champions-editorial",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ cases: s.cases, lastGenerationId: s.lastGenerationId }),
    },
  ),
);
