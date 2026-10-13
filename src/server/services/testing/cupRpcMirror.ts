/**
 * F86 · ESPEJO EN MEMORIA DE LAS RPC DE 0069 (solo pruebas). Reproduce el contrato de `cup_register`, `cup_withdraw`,
 * `cup_generate`, `cup_ready`, `cup_mark_active`, `cup_start_failed`, `cup_settle_game` y `cup_admin_*` sobre
 * `MemSupabase`, con la misma semántica que la SQL (cerrojo = cada RPC es síncrona dentro de su `await`). NO sustituye a
 * la BD: las carreras reales, los CHECK, las guardias de escritura y la paridad SQL ⇄ dominio se prueban en el ENSAYO de
 * 0069 sobre una copia del backup (`scripts/ops/_cups-dryrun.sh`).
 */
import { createHash, randomUUID } from "node:crypto";
import type { MemSupabase, Row } from "./memSupabase";
import { placementForRound, seedPositions } from "@/domain/cups/bracket";

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
const t = (v: unknown) => Date.parse(String(v));

export function installCupRpcs(db: MemSupabase, clock: () => number = () => Date.now()): void {
  const T = (n: string) => db.table(n);
  const cupOf = (id: unknown) => T("cups").find((c) => c.id === id);
  const matchOf = (id: unknown) => T("cup_matches").find((m) => m.id === id);
  const regOf = (cup: unknown, user: unknown) => T("cup_registrations").find((r) => r.cup_id === cup && r.user_id === user);
  const isAdmin = (u: unknown) => !!u && T("profiles").some((p) => p.id === u && p.is_admin);
  const audit = (actor: unknown, action: string, cup: unknown, detail: Row) => {
    const a = T("content_audit_log");
    a.push({ id: a.length + 1, at: iso(clock()), actor: actor ?? null, action, entity_type: "cup", entity_id: String(cup), card_id: null, pool_id: null, detail });
  };
  const tagOf = (u: unknown) => (T("profiles").find((p) => p.id === u)?.public_tag as string | undefined) ?? null;
  const active = (u: unknown) => T("duel_matches").some((m) => (m.mode === "PVP" || m.mode === "PVP_PRIVATE") && (m.closed_reason ?? null) === null
    && (m.status === "WAITING" || m.status === "IN_PROGRESS") && (m.user_id === u || m.player_b_id === u));
  const inQueue = (u: unknown) => T("duel_pvp_queue").some((q) => q.user_id === u && (q.state === "QUEUED" || q.state === "PAIRING") && t(q.expires_at) > clock());
  const reserved = (u: unknown) => T("duel_challenges").some((c) => c.status === "ACCEPTED" && (c.challenger_id === u || c.challenged_id === u) && t(c.responded_at) > clock() - 120_000);

  function complete(cupId: unknown, champion: string | null) {
    const c = cupOf(cupId)!;
    if (c.status !== "IN_PROGRESS") throw new Error("CUP_INTEGRITY");
    Object.assign(c, { status: "COMPLETED", completed_at: iso(clock()), champion_id: champion, updated_at: iso(clock()) });
    if (champion) {
      const r = regOf(cupId, champion); if (r) Object.assign(r, { placement: "CHAMPION", eliminated_round: null });
      const id = `insignia:torneo:${c.slug}`;
      if (T("user_cosmetics").some((x) => x.cosmetic_id === id && x.user_id !== champion)) throw new Error("user_cosmetics_cup_trophy_once");
      if (!T("user_cosmetics").some((x) => x.cosmetic_id === id && x.user_id === champion)) T("user_cosmetics").push({ user_id: champion, cosmetic_id: id, source: `cup:${String(cupId)}`, granted_at: iso(clock()) });
    }
    audit(null, "cup_completed", cupId, { slug: c.slug, champion_tag: tagOf(champion), no_champion: champion === null });
  }
  function finish(matchId: unknown, winner: string | null, status: string, resolution: string | null, actor: unknown, reason: string | null) {
    const m = matchOf(matchId)!;
    const c = cupOf(m.cup_id)!;
    Object.assign(m, { status, winner_id: winner, resolution, resolved_at: iso(clock()), resolved_by: actor ?? null, resolution_reason: reason, ready_a_until: null, ready_b_until: null });
    for (const p of [m.player_a, m.player_b]) {
      if (p && p !== winner) { const r = regOf(m.cup_id, p); if (r) Object.assign(r, { eliminated_round: m.round, placement: placementForRound(m.round as number, c.rounds as number) }); }
    }
    if (!m.next_match_id) { complete(m.cup_id, winner); return; }
    const n = matchOf(m.next_match_id)!;
    const seed = winner === m.player_a ? m.seed_a : winner === m.player_b ? m.seed_b : null;
    if (m.next_side === "A") {
      if (n.player_a || n.a_empty) throw new Error("CUP_INTEGRITY: lado A ya resuelto");
      Object.assign(n, { player_a: winner, seed_a: seed, a_empty: winner === null });
    } else {
      if (n.player_b || n.b_empty) throw new Error("CUP_INTEGRITY: lado B ya resuelto");
      Object.assign(n, { player_b: winner, seed_b: seed, b_empty: winner === null });
    }
    auto(n.id);
  }
  function auto(matchId: unknown) {
    const m = matchOf(matchId)!;
    if ((!m.player_a && !m.a_empty) || (!m.player_b && !m.b_empty)) return;
    if (m.player_a && m.player_b) { m.status = "READY"; return; }
    if (m.player_a || m.player_b) { finish(matchId, (m.player_a ?? m.player_b) as string, "BYE", "BYE", null, null); return; }
    finish(matchId, null, "VOID", null, null, null);
  }

  const rpcs: Record<string, (a: Row) => unknown> = {
    cup_register(a) {
      const c = cupOf(a.p_cup);
      if (!c || c.status === "DRAFT") return { code: "NOT_FOUND" };
      if (c.status === "CANCELLED") return { code: "CANCELLED" };
      if (c.status !== "PUBLISHED" || c.started_at) return { code: "CLOSED" };
      if (clock() < t(c.registration_open_at)) return { code: "NOT_OPEN" };
      if (clock() >= t(c.registration_close_at)) return { code: "CLOSED" };
      if (!T("profiles").some((p) => p.id === a.p_user)) return { code: "NO_PROFILE" };
      if (T("user_sanctions").some((s) => s.user_id === a.p_user && !s.revoked_at && (!s.expires_at || t(s.expires_at) > clock()))) return { code: "SANCTIONED" };
      const r = regOf(a.p_cup, a.p_user);
      if (r?.status === "REGISTERED") return { code: "ALREADY_REGISTERED", count: c.participant_count };
      if ((c.participant_count as number) >= (c.max_participants as number)) return { code: "FULL", count: c.participant_count };
      if (r) Object.assign(r, { status: "REGISTERED", withdrawn_at: null, registered_at: iso(clock()) });
      else T("cup_registrations").push({ cup_id: a.p_cup, user_id: a.p_user, status: "REGISTERED", registered_at: iso(clock()), withdrawn_at: null, seed: null, seed_rating: null, seed_rated: null, username_snapshot: null, tag_snapshot: null, eliminated_round: null, placement: null });
      c.participant_count = (c.participant_count as number) + 1;
      return { code: "REGISTERED", count: c.participant_count };
    },
    cup_withdraw(a) {
      const c = cupOf(a.p_cup);
      if (!c || c.status === "DRAFT") return { code: "NOT_FOUND" };
      const r = regOf(a.p_cup, a.p_user);
      if (r?.status !== "REGISTERED") return { code: "NOT_REGISTERED", count: c.participant_count };
      if (c.status !== "PUBLISHED" || c.started_at || clock() >= t(c.registration_close_at)) return { code: "CLOSED" };
      Object.assign(r, { status: "WITHDRAWN", withdrawn_at: iso(clock()) });
      c.participant_count = (c.participant_count as number) - 1;
      return { code: "WITHDRAWN", count: c.participant_count };
    },
    cup_generate(a) {
      if (a.p_actor && !isAdmin(a.p_actor)) throw new Error("NOT_ADMIN");
      const c = cupOf(a.p_cup);
      if (!c) return { code: "NOT_FOUND" };
      if (c.started_at) return { code: "ALREADY", size: c.bracket_size, rounds: c.rounds };
      if (c.status === "CANCELLED") return { code: "CANCELLED" };
      if (c.status !== "PUBLISHED") return { code: "NOT_PUBLISHED" };
      if (clock() < t(c.registration_close_at)) return { code: "REGISTRATION_OPEN" };
      const regs = T("cup_registrations").filter((r) => r.cup_id === c.id && r.status === "REGISTERED");
      const n = regs.length;
      if (n < (c.min_participants as number)) {
        Object.assign(c, { status: "CANCELLED", cancelled_at: iso(clock()), cancel_reason: "NOT_ENOUGH_PARTICIPANTS" });
        audit(a.p_actor, "cup_cancelled", c.id, { reason: "NOT_ENOUGH_PARTICIPANTS", registered: n });
        return { code: "UNDERFILLED", registered: n, min: c.min_participants };
      }
      let size = 4, rounds = 2;
      while (size < n) { size *= 2; rounds++; }
      const rated = regs.map((r) => { const pr = T("duel_pvp_ratings").find((x) => x.user_id === r.user_id); return { r, rating: pr ? Number(pr.rating) : 1000, rated: !!pr, tie: md5(`${String(c.id)}:${String(r.user_id)}`) }; });
      rated.sort((x, y) => (y.rating - x.rating) || (x.tie < y.tie ? -1 : x.tie > y.tie ? 1 : 0) || (String(x.r.user_id) < String(y.r.user_id) ? -1 : 1));
      rated.forEach((k, i) => { const p = T("profiles").find((q) => q.id === k.r.user_id); Object.assign(k.r, { seed: i + 1, seed_rating: k.rating, seed_rated: k.rated, username_snapshot: p?.username ?? null, tag_snapshot: p?.public_tag ?? null }); });
      const w = (c.round_window_minutes as number) * 60_000, start = t(c.starts_at);
      for (let r = rounds; r >= 1; r--) {
        for (let s = 0; s < size >> r; s++) {
          const next = r < rounds ? T("cup_matches").find((m) => m.cup_id === c.id && m.round === r + 1 && m.slot === s >> 1) : undefined;
          T("cup_matches").push({ id: randomUUID(), cup_id: c.id, round: r, slot: s, player_a: null, player_b: null, seed_a: null, seed_b: null, a_empty: false, b_empty: false,
            next_match_id: next?.id ?? null, next_side: next ? (s % 2 === 0 ? "A" : "B") : null, status: "PENDING", winner_id: null, resolution: null, game_match_id: null,
            ready_a_until: null, ready_b_until: null, deck_a: null, deck_b: null, available_at: iso(start + (r - 1) * w), deadline_at: iso(start + r * w), score_a: null, score_b: null });
        }
      }
      const pos = seedPositions(size);
      const bySeed = new Map(regs.map((r) => [r.seed as number, r.user_id as string]));
      for (let s = 0; s < size / 2; s++) {
        const m = T("cup_matches").find((x) => x.cup_id === c.id && x.round === 1 && x.slot === s)!;
        const sa = pos[2 * s], sb = pos[2 * s + 1];
        const pa = sa <= n ? bySeed.get(sa)! : null, pb = sb <= n ? bySeed.get(sb)! : null;
        Object.assign(m, { player_a: pa, seed_a: pa ? sa : null, a_empty: !pa, player_b: pb, seed_b: pb ? sb : null, b_empty: !pb });
      }
      Object.assign(c, { status: "IN_PROGRESS", started_at: iso(clock()), bracket_size: size, rounds });
      for (const m of T("cup_matches").filter((x) => x.cup_id === c.id && x.round === 1)) auto(m.id);
      audit(a.p_actor, "cup_bracket_generated", c.id, { participants: n, size, rounds, system: !a.p_actor });
      return { code: "GENERATED", participants: n, size, rounds };
    },
    cup_ready(a) {
      const m = matchOf(a.p_match);
      if (!m) return { code: "NOT_FOUND" };
      const c = cupOf(m.cup_id)!;
      if (!a.p_user || (a.p_user !== m.player_a && a.p_user !== m.player_b)) return { code: "NOT_FOUND" };
      if (c.status === "CANCELLED") return { code: "CANCELLED" };
      if (c.status !== "IN_PROGRESS") return { code: "CLOSED" };
      if (m.game_match_id && (m.status === "READY" || m.status === "ACTIVE")) return { code: "ALREADY", gameMatchId: m.game_match_id, status: m.status, playerA: m.player_a, deckA: m.deck_a, playerB: m.player_b, deckB: m.deck_b };
      if (m.status !== "READY") return { code: "NOT_READY", status: m.status };
      if (clock() < t(m.available_at)) return { code: "NOT_YET", availableAt: m.available_at };
      if (clock() >= t(m.deadline_at)) return { code: "DEADLINE_PASSED" };
      if (!a.p_deck) return { code: "DECK_REQUIRED" };
      if (active(a.p_user) || reserved(a.p_user)) return { code: "BUSY" };
      if (inQueue(a.p_user)) return { code: "IN_QUEUE" };
      const ttl = Math.min(Math.max(Number(a.p_ttl_seconds ?? 30), 10), 120) * 1000;
      const side = a.p_user === m.player_a ? "A" : "B";
      const other = side === "A" ? m.player_b : m.player_a;
      const otherUntil = side === "A" ? m.ready_b_until : m.ready_a_until;
      if (side === "A") Object.assign(m, { ready_a_until: iso(clock() + ttl), deck_a: a.p_deck }); else Object.assign(m, { ready_b_until: iso(clock() + ttl), deck_b: a.p_deck });
      if (otherUntil && t(otherUntil) > clock()) {
        if (active(other) || reserved(other) || inQueue(other)) { if (side === "A") m.ready_b_until = null; else m.ready_a_until = null; }
        else {
          m.game_match_id = randomUUID();
          return { code: "START", gameMatchId: m.game_match_id, playerA: m.player_a, deckA: m.deck_a, playerB: m.player_b, deckB: m.deck_b };
        }
      }
      return { code: "WAITING", readyUntil: iso(clock() + ttl) };
    },
    cup_mark_active(a) {
      const m = matchOf(a.p_match);
      if (!m) return { code: "NOT_FOUND" };
      if (m.game_match_id !== a.p_game) return { code: "MISMATCH" };
      if (m.status === "ACTIVE") return { code: "ALREADY_ACTIVE" };
      if (m.status !== "READY") return { code: "NOT_READY", status: m.status };
      if (!T("duel_matches").some((d) => d.id === a.p_game && d.mode === "PVP_PRIVATE")) return { code: "NO_GAME" };
      m.status = "ACTIVE";
      return { code: "ACTIVE" };
    },
    cup_start_failed(a) {
      const m = matchOf(a.p_match);
      if (!m) return { code: "NOT_FOUND" };
      if (m.status !== "READY" || m.game_match_id !== a.p_game || T("duel_matches").some((d) => d.id === a.p_game)) return { code: "NOOP" };
      m.game_match_id = null;
      if (!a.p_offender || a.p_offender === m.player_a) Object.assign(m, { ready_a_until: null, deck_a: null });
      if (!a.p_offender || a.p_offender === m.player_b) Object.assign(m, { ready_b_until: null, deck_b: null });
      return { code: "RELEASED" };
    },
    cup_settle_game(a) {
      const m = T("cup_matches").find((x) => x.game_match_id === a.p_game);
      if (!m) return { code: "NOT_CUP" };
      const c = cupOf(m.cup_id)!;
      if (m.status !== "ACTIVE") return { code: "ALREADY", status: m.status };
      const d = T("duel_matches").find((x) => x.id === a.p_game);
      if (!d) return { code: "NO_GAME" };
      if (!((d.user_id === m.player_a && d.player_b_id === m.player_b) || (d.user_id === m.player_b && d.player_b_id === m.player_a))) throw new Error("CUP_INTEGRITY");
      let winner: string | null = null; let res: string;
      if (d.closed_reason === "ABANDONED" && d.closed_by) { winner = (d.closed_by === d.user_id ? d.player_b_id : d.user_id) as string; res = "ABANDON"; }
      else if (d.closed_reason) res = "HOLD";
      else if (d.status === "COMPLETED" && (d.winner === "A" || d.winner === "B")) { winner = (d.winner === "A" ? d.user_id : d.player_b_id) as string; res = "PLAYED"; }
      else if (d.status === "COMPLETED" || d.status === "DRAW" || d.status === "UNRESOLVED") res = "HOLD";
      else return { code: "NOT_FINISHED" };
      const result = ((d.state as Row | undefined)?.result ?? null) as Row | null;
      const sa = result ? Number(result.scoreA) : null, sb = result ? Number(result.scoreB) : null;
      Object.assign(m, { score_a: d.user_id === m.player_a ? sa : sb, score_b: d.user_id === m.player_a ? sb : sa });
      if (c.status === "CANCELLED") { Object.assign(m, winner ? { status: "COMPLETED", winner_id: winner, resolution: res } : { status: "CANCELLED" }); return { code: "RECORDED_CANCELLED" }; }
      if (res === "HOLD") { m.status = "ACTION_REQUIRED"; audit(null, "cup_match_held", c.id, { round: m.round, slot: m.slot }); return { code: "HELD" }; }
      finish(m.id, winner, "COMPLETED", res, null, null);
      return { code: "SETTLED", resolution: res, champion: cupOf(m.cup_id)!.champion_id !== null };
    },
    cup_admin_publish(a) {
      if (!isAdmin(a.p_actor)) throw new Error("NOT_ADMIN");
      const c = cupOf(a.p_cup);
      if (!c) throw new Error("CUP_NOT_FOUND");
      if (c.status !== "DRAFT") throw new Error("NOT_A_DRAFT");
      if (a.p_version !== c.version) throw new Error("STALE_CUP");
      if (t(c.registration_close_at) <= clock()) throw new Error("CUP_DATES_PAST");
      if (String(c.rules ?? "").trim().length < 10) throw new Error("CUP_RULES_REQUIRED");
      Object.assign(c, { status: "PUBLISHED", published_at: iso(clock()), version: (c.version as number) + 1 });
      audit(a.p_actor, "cup_published", c.id, { slug: c.slug });
      return { code: "PUBLISHED" };
    },
    cup_admin_cancel(a) {
      if (!isAdmin(a.p_actor)) throw new Error("NOT_ADMIN");
      const reason = String(a.p_reason ?? "").trim();
      if (reason.length < 8) throw new Error("REASON_REQUIRED");
      const c = cupOf(a.p_cup);
      if (!c) throw new Error("CUP_NOT_FOUND");
      if (c.status === "COMPLETED" || c.status === "CANCELLED") throw new Error("CUP_FINAL");
      if (c.status === "IN_PROGRESS" && String(a.p_confirm ?? "").trim().toLowerCase() !== c.slug) throw new Error("CONFIRM_MISMATCH");
      const before = c.status;
      Object.assign(c, { status: "CANCELLED", cancelled_at: iso(clock()), cancel_reason: reason });
      let k = 0;
      for (const m of T("cup_matches").filter((x) => x.cup_id === c.id && ["PENDING", "READY", "ACTION_REQUIRED"].includes(x.status as string))) { m.status = "CANCELLED"; k++; }
      audit(a.p_actor, "cup_cancelled", c.id, { slug: c.slug, reason, status_before: before });
      return { code: "CANCELLED", matchesCancelled: k };
    },
    cup_admin_resolve(a) {
      if (!isAdmin(a.p_actor)) throw new Error("NOT_ADMIN");
      const reason = String(a.p_reason ?? "").trim();
      if (reason.length < 8) throw new Error("REASON_REQUIRED");
      if (!["A", "B", "NONE"].includes(String(a.p_decision))) throw new Error("BAD_DECISION");
      const m = matchOf(a.p_match);
      if (!m) throw new Error("CUP_MATCH_NOT_FOUND");
      const c = cupOf(m.cup_id)!;
      if (c.status !== "IN_PROGRESS") throw new Error("CUP_NOT_IN_PROGRESS");
      if (!(m.status === "ACTION_REQUIRED" || (m.status === "READY" && !m.game_match_id && clock() >= t(m.deadline_at)))) throw new Error("CUP_NOT_RESOLVABLE");
      const confirm = String(a.p_confirm ?? "").trim().toUpperCase();
      let winner: string | null = null;
      if (a.p_decision === "NONE") { if (confirm !== "ELIMINAR A LOS DOS") throw new Error("CONFIRM_MISMATCH"); }
      else {
        winner = (a.p_decision === "A" ? m.player_a : m.player_b) as string;
        const tag = tagOf(winner);
        if (!tag || confirm.replace(/^#+/, "") !== tag) throw new Error("CONFIRM_MISMATCH");
      }
      const res = a.p_decision === "NONE" ? "ADMIN_DOUBLE_NO_SHOW" : m.status === "ACTION_REQUIRED" ? "ADMIN_DECISION" : "ADMIN_NO_SHOW";
      audit(a.p_actor, "cup_match_resolved", c.id, { round: m.round, slot: m.slot, decision: a.p_decision, resolution: res, reason, winner_tag: winner ? tagOf(winner) : null });
      finish(m.id, winner, winner ? "COMPLETED" : "VOID", res, a.p_actor, reason);
      return { code: "RESOLVED", resolution: res, completed: cupOf(m.cup_id)!.status === "COMPLETED" };
    },
  };
  for (const [name, fn] of Object.entries(rpcs)) (db as unknown as Record<string, unknown>)[`rpc_${name}`] = fn;
}
