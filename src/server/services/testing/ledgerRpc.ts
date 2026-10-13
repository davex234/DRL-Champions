/**
 * F72 · LIBRO MAYOR EN MEMORIA PARA `MemorySupabase` — reproduce, sobre sus tablas, el contrato de dos RPC vigentes:
 *
 *   · `app_adjust_credits` (0019): si `(user_id, ref)` ya existe → devuelve el saldo SIN mover nada; si no,
 *     `_ledger_apply`: suelo 0 («Saldo insuficiente», nada cambia) y asiento con `balance_after`.
 *   · `app_grant_reward` (0026): puerta `(user_id, ref)` en el libro mayor → `{ applied:false }`; si no, créditos
 *     (sin suelo), sobres (`user_packs`), cosméticos (`on conflict do nothing`) y el asiento SIEMPRE.
 *
 * `credit_tx_ref_uniq (user_id, ref)` (0011) es real: un segundo asiento con la misma ref da 23505.
 * Cada handler es síncrono ⇒ equivale a una transacción. `failNext(name)` simula una caída de la BD en la siguiente
 * llamada (sin tocar nada), para probar reintentos.
 */
import { randomUUID } from "node:crypto";
import type { MemorySupabase } from "./memorySupabase";

type Row = Record<string, unknown>;

export function installLedger(db: MemorySupabase, seed: { userId: string; credits: number }[] = []) {
  const fails = new Map<string, number>();
  const tx = () => db.rows("credit_transactions");
  const profile = (id: unknown) => db.rows("profiles").find((p) => p.id === id) as Row | undefined;
  for (const s of seed) db.rows("profiles").push({ id: s.userId, credits: s.credits, xp: 0, points: 0 });

  const failing = (name: string) => {
    const n = fails.get(name) ?? 0;
    if (n > 0) { fails.set(name, n - 1); return true; }
    return false;
  };
  const insertTx = (row: Row) => {
    if (row.ref != null && tx().some((r) => r.user_id === row.user_id && r.ref === row.ref)) {
      return { code: "23505", message: "duplicate key value violates unique constraint \"credit_tx_ref_uniq\"" };
    }
    tx().push({ id: randomUUID(), created_at: new Date().toISOString(), ...row });
    db.log.push("insert:credit_transactions");
    return null;
  };

  db.rpcHandlers.app_adjust_credits = (a) => {
    if (failing("app_adjust_credits")) return { data: null, error: { code: "08006", message: "connection failure" } };
    const p = profile(a.p_user);
    if (!p) return { data: null, error: { code: "P0001", message: "Perfil inexistente" } };
    if (a.p_ref != null && tx().some((r) => r.user_id === a.p_user && r.ref === a.p_ref)) return { data: p.credits, error: null };
    const delta = Number(a.p_delta);
    if (Number(p.credits) + delta < 0) return { data: null, error: { code: "P0001", message: "Saldo insuficiente" } };
    const after = Number(p.credits) + delta;
    const err = insertTx({ user_id: a.p_user, delta, reason: a.p_reason, ref: a.p_ref ?? null, balance_after: after, kind: delta >= 0 ? "credit" : "debit" });
    if (err) return { data: null, error: err };
    p.credits = after;
    db.log.push("update:profiles");
    return { data: after, error: null };
  };

  db.rpcHandlers.app_grant_reward = (a) => {
    if (failing("app_grant_reward")) return { data: null, error: { code: "08006", message: "connection failure" } };
    if (!a.p_ref) return { data: null, error: { code: "P0001", message: "La recompensa necesita una clave de idempotencia" } };
    const p = profile(a.p_user);
    if (!p) return { data: null, error: { code: "P0001", message: "Perfil inexistente" } };
    if (tx().some((r) => r.user_id === a.p_user && r.ref === a.p_ref)) return { data: { applied: false, credits: p.credits }, error: null };
    const credits = Number(a.p_credits ?? 0);
    const after = Number(p.credits) + credits;
    const err = insertTx({ user_id: a.p_user, delta: credits, reason: a.p_reason, ref: a.p_ref, balance_after: after, kind: "credit" });
    if (err) return { data: null, error: err };
    p.credits = after;
    p.xp = Number(p.xp ?? 0) + Number(a.p_xp ?? 0);
    db.log.push("update:profiles");
    if (a.p_pack_id && Number(a.p_pack_count ?? 0) > 0) {
      const packs = db.rows("user_packs");
      const row = packs.find((r) => r.user_id === a.p_user && r.pack_id === a.p_pack_id);
      if (row) row.qty = Number(row.qty) + Number(a.p_pack_count); else packs.push({ user_id: a.p_user, pack_id: a.p_pack_id, qty: Number(a.p_pack_count) });
      db.log.push("upsert:user_packs");
    }
    for (const c of (a.p_cosmetics as string[] | null) ?? []) {
      const cos = db.rows("user_cosmetics");
      if (!cos.some((r) => r.user_id === a.p_user && r.cosmetic_id === c)) { cos.push({ user_id: a.p_user, cosmetic_id: c, source: a.p_ref }); db.log.push("insert:user_cosmetics"); }
    }
    return { data: { applied: true, credits: after, cardUids: [] }, error: null };
  };

  return {
    failNext: (name: "app_adjust_credits" | "app_grant_reward", times = 1) => { fails.set(name, times); },
    credits: (userId: string) => Number(profile(userId)?.credits ?? NaN),
    ledger: (userId: string) => tx().filter((r) => r.user_id === userId),
    packs: (userId: string, packId: string) => Number(db.rows("user_packs").find((r) => r.user_id === userId && r.pack_id === packId)?.qty ?? 0),
    cosmetics: (userId: string) => db.rows("user_cosmetics").filter((r) => r.user_id === userId).map((r) => r.cosmetic_id as string),
  };
}
