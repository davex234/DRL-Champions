"use client";

/**
 * REVIEW STORE — persistencia mínima del ÚLTIMO ReviewModel publicado para que el dashboard
 * (/admin/card-review) pueda mostrarlo entre sesiones. Solo guarda la proyección de solo
 * lectura; jamás toca catálogo, colección ni economía. `record` sustituye siempre al anterior
 * (el dashboard muestra únicamente la última generación publicada).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ReviewModel } from "./types";

interface ReviewState {
  model: ReviewModel | null;
  record: (model: ReviewModel) => void;
  clear: () => void;
}

export const useReviewStore = create<ReviewState>()(
  persist(
    (set) => ({
      model: null,
      record: (model) => set({ model }),
      clear: () => set({ model: null }),
    }),
    {
      name: "drl-champions-card-review",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ model: s.model }),
    },
  ),
);
