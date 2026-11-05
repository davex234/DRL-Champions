/**
 * F79.2 · utilidades del E2E de producción (fuera de CI): cuentas QA de `multiplayer/_qa`, API pública real.
 * Ejecutar con cwd = carpeta con `.env.local` PÚBLICO (URL https + anon pública), nunca la cuenta del usuario.
 */
import { api, login, sleep, type Who } from "./multiplayer/_qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
export { api, login, sleep, type Who };
export const g = (tag = "x") => `f792-${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export interface Material { recipeId: string; inputQty: number; free: { uid: string; cardId: string; protectedBy: string[] }[]; usableByCard: Record<string, number> }

/** Material REAL de intercambio de la foto de la Forja (lo que el servidor considera entregable). */
export async function exchangeMaterial(who: Who): Promise<Material[]> {
  const r = await api(who, "/api/game/forge");
  if (r.status !== 200) throw new Error(`forge ${r.status}`);
  return ((r.json as any).exchange ?? []).map((e: any) => {
    const m = e.materials?.[0] ?? { candidates: [] };
    const free: Material["free"] = []; const usableByCard: Record<string, number> = {};
    for (const c of m.candidates ?? []) { usableByCard[c.cardId] = c.usable; for (const f of c.free) free.push({ uid: f.uid, cardId: c.cardId, protectedBy: f.protectedBy }); }
    return { recipeId: e.id, inputQty: e.inputQty, free, usableByCard };
  });
}

/** Elige `qty` copias SIN protección respetando el tope por carta (lo mismo que la auto-selección). */
export function pick(m: Material, qty: number, skip: Set<string> = new Set()): string[] | null {
  const used: Record<string, number> = {}; const out: string[] = [];
  for (const f of m.free) {
    if (out.length >= qty) break;
    if (skip.has(f.uid) || f.protectedBy.length) continue;
    if ((used[f.cardId] ?? 0) >= (m.usableByCard[f.cardId] ?? 0)) continue;
    used[f.cardId] = (used[f.cardId] ?? 0) + 1; out.push(f.uid);
  }
  return out.length === qty ? out : null;
}
