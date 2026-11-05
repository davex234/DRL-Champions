"use client";

/**
 * CONTROL STORE — persistencia del ControlLedger para la app (/admin/tournament-control).
 * Envuelve el motor puro sin lógica propia: cada acción delega en engine/publish y sustituye
 * el ledger devuelto; una acción rechazada deja el ledger intacto y expone `lastError`.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { OrchestratorResult } from "@/tournament-orchestrator";
import type { RawSnapshot } from "@/importer";
import type { EditorialAction, PublishApprovedCtx, PublishApprovedResult } from "@/editorial";
import type { PublishResult } from "@/publisher";
import {
  createLedger, ingestRun, generateForReview, openReview, decideRecordCards,
  approveGenerationRecord, reopenReview, duplicateForReview, type GenerateForReviewCtx,
} from "./engine";
import { publishRecord, rollbackRecord, type RollbackCtx } from "./publish";
import type { ControlActionMeta, ControlActionResult, ControlLedger } from "./types";

interface ControlStoreState {
  ledger: ControlLedger;
  lastError: string | null;

  ingest: (run: OrchestratorResult, meta: ControlActionMeta) => void;
  generate: (snapshot: RawSnapshot, ctx: GenerateForReviewCtx, meta: ControlActionMeta) => void;
  open: (recordId: string, meta: ControlActionMeta) => void;
  decide: (recordId: string, cardIds: string[], action: EditorialAction, meta: ControlActionMeta) => void;
  approveAll: (recordId: string, meta: ControlActionMeta) => void;
  reopen: (recordId: string, meta: ControlActionMeta) => void;
  duplicate: (recordId: string, meta: ControlActionMeta) => void;
  publish: (recordId: string, ctx: PublishApprovedCtx) => Promise<PublishApprovedResult | null>;
  rollback: (recordId: string, ctx: RollbackCtx) => PublishResult | null;
  clear: () => void;
}

export const useControlStore = create<ControlStoreState>()(
  persist(
    (set, get) => {
      const apply = <T>(r: ControlActionResult<T>): T | null => {
        set({ ledger: r.ledger, lastError: r.error ?? null });
        return r.value ?? null;
      };
      return {
        ledger: createLedger(),
        lastError: null,

        ingest: (run, meta) => { apply(ingestRun(get().ledger, run, meta)); },
        generate: (snapshot, ctx, meta) => { apply(generateForReview(get().ledger, snapshot, ctx, meta)); },
        open: (recordId, meta) => { apply(openReview(get().ledger, recordId, meta)); },
        decide: (recordId, cardIds, action, meta) => { apply(decideRecordCards(get().ledger, recordId, cardIds, action, meta)); },
        approveAll: (recordId, meta) => { apply(approveGenerationRecord(get().ledger, recordId, meta)); },
        reopen: (recordId, meta) => { apply(reopenReview(get().ledger, recordId, meta)); },
        duplicate: (recordId, meta) => { apply(duplicateForReview(get().ledger, recordId, meta)); },
        publish: async (recordId, ctx) => apply(await publishRecord(get().ledger, recordId, ctx)),
        rollback: (recordId, ctx) => apply(rollbackRecord(get().ledger, recordId, ctx)),
        clear: () => set({ ledger: createLedger(), lastError: null }),
      };
    },
    {
      name: "drl-champions-tournament-control",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ ledger: s.ledger }),
    },
  ),
);
