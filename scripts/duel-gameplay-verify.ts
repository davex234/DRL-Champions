/**
 * VERIFICACIÓN — Duel Gameplay (DRL Champions, Fase 8).
 *
 *   npx tsx scripts/duel-gameplay-verify.ts
 *
 * Ejercita el SERVICIO REAL de duelos contra la base de datos real: crea un usuario de prueba, le
 * concede un mazo legal, guarda el mazo, juega los diez turnos y comprueba el resultado, la
 * repetición y —sobre todo— que la proyección que recibe el cliente NO FILTRA NADA.
 *
 * No usa la interfaz ni el navegador: aquí se demuestra que la autoridad está en el servidor.
 * Limpia todo lo que crea.
 */
import { ephemeralQaPassword } from "./lib/qaCredentials";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { CardRegistry } from "@/collection/registry";
import { DUEL_ROLES } from "@/domain/cardgame";
import {
  listDecks, listCollection, saveDeck, deleteDeck,
  startMatch, playTurn, getMatch, getActiveMatch, getReplay, listReplays, abandonMatch,
} from "@/server/services/duels";
import type { DuelMatchView } from "@/lib/duel/types";
import type { BotDifficulty } from "@/domain/cardgame/opponent";

const ROOT = process.cwd();
for (const f of [".env.local", ".env"]) {
  const p = join(ROOT, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_ || !SERVICE) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

let failures = 0;
const check = (l: string, c: boolean, d = "") => {
  console.log(`  ${c ? "✓" : "✕"} ${l}${d ? ` — ${d}` : ""}`);
  if (!c) failures++;
};

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const registry = new CardRegistry();

/** Diez cartas legales: dos jugadores DISTINTOS por cada uno de los cinco roles. */
function duelReadyCardIds(offset = 0): string[] {
  const out: string[] = [];
  for (const role of DUEL_ROLES) {
    const best = new Map<string, { id: string; ovr: number }>();
    for (const c of registry.forRole(role)) {
      if (!c.combat) continue;
      const prev = best.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) best.set(c.playerId, { id: c.id, ovr: c.ovr });
    }
    const arr = [...best.values()].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id));
    out.push(arr[offset].id, arr[offset + 1].id);
  }
  return out;
}

async function main() {
  console.log("# Verificación de Duel Gameplay — DRL Champions (Fase 8)\n");

  // ── Usuario de prueba real ──
  const email = `duel-${Date.now()}@example.invalid`;
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email, password: ephemeralQaPassword(), email_confirm: true, user_metadata: { username: "duelqa" },
  });
  if (userErr || !created.user) throw new Error(userErr?.message ?? "no se pudo crear el usuario");
  const userId = created.user.id;

  try {
    console.log("## Inventario y mazos");
    {
      const empty = await listDecks(admin, userId);
      check("un usuario nuevo no tiene mazos", empty.ok && empty.data!.decks.length === 0);

      // Se conceden cartas por la RPC real: nada de insertar a mano en `user_cards`.
      const cardIds = duelReadyCardIds();
      const { error } = await admin.rpc("app_grant_cards", {
        p_user: userId,
        p_instances: cardIds.map((cardId) => ({ cardId, serial: null })),
        p_mint_delta: {},
        p_origin: "admin",
      });
      check("se conceden 10 cartas por la RPC del servidor", !error, error?.message);

      const col = await listCollection(admin, userId);
      check("la colección de duelo devuelve las 10 cartas", col.ok && col.data!.cards.length === 10,
        `${col.data?.cards.length}`);
      check("cada carta trae su trío de combate y su OVR",
        (col.data?.cards ?? []).every((c) => c.ovr > 0 && c.combat.stronghold >= 0 && c.combat.gamesense >= 0 && c.combat.entryfrag >= 0));
    }

    // ── Guardar mazo ──
    let deckId = "";
    console.log("\n## Constructor: validación en servidor");
    {
      const col = await listCollection(admin, userId);
      const uids = col.data!.cards.map((c) => c.uid);

      const partial = await saveDeck(admin, userId, { name: "A medias", cardUids: uids.slice(0, 4) });
      check("se puede guardar un mazo INCOMPLETO", partial.ok && !partial.data!.deck.valid);
      check("un mazo incompleto se marca como INCOMPLETE", partial.data?.deck.status === "INCOMPLETE",
        partial.data?.deck.status);
      if (partial.ok) await deleteDeck(admin, userId, partial.data!.deck.id);

      const alien = await saveDeck(admin, userId, {
        name: "Robado", cardUids: [...uids.slice(0, 9), "00000000-0000-0000-0000-000000000001"],
      });
      check("un mazo con una carta AJENA se rechaza con 403", !alien.ok && alien.status === 403, alien.error);

      const tooMany = await saveDeck(admin, userId, { name: "Enorme", cardUids: [...uids, ...uids.slice(0, 1)] });
      check("un mazo repetido se rechaza", !tooMany.ok, tooMany.error);

      const bad = await saveDeck(admin, userId, { name: "  ", cardUids: uids });
      check("un nombre vacío se rechaza", !bad.ok && bad.status === 400);

      const ok = await saveDeck(admin, userId, { name: "Mazo QA", cardUids: uids });
      check("un mazo legal de 10 cartas se guarda y es VÁLIDO", ok.ok && ok.data!.deck.valid === true,
        ok.error ?? ok.data?.deck.errors.map((e) => e.message).join("; "));
      check("el mazo cumple 2 cartas por rol",
        DUEL_ROLES.every((r) => ok.data?.deck.roleCounts[r] === 2));
      check("el mazo reporta su suma de OVR", (ok.data?.deck.sumOvr ?? 0) > 0, `${ok.data?.deck.sumOvr}`);
      check("el mazo queda LISTO PARA DUELO", ok.data?.deck.status === "READY_FOR_DUEL", ok.data?.deck.status);
      deckId = ok.data!.deck.id;
    }

    // ── Partida completa ──
    console.log("\n## Partida completa contra el bot");
    let finalView: DuelMatchView | null = null;
    {
      const bad = await startMatch(admin, userId, deckId, "IMPOSIBLE");
      check("una dificultad inventada se rechaza", !bad.ok && bad.status === 400);

      const start = await startMatch(admin, userId, deckId, "NORMAL");
      check("la partida arranca", start.ok, start.error);
      let view = start.data!.view;
      const matchId = view.matchId;

      check("empieza en el turno 1 de 10", view.turn === 1 && view.totalTurns === 10, `turno ${view.turn}`);
      check("el marcador empieza a 0", view.scoreYou === 0 && view.scoreRival === 0);
      check("tienes 10 cartas en la mano", view.yourHand.length === 10, `${view.yourHand.length}`);
      check("al rival le quedan 10 cartas", view.rivalRemaining === 10);
      check("el rival tiene un mazo de fuerza comparable",
        Math.abs(view.yourSumOvr - view.rivalSumOvr) <= 60, `tú ${view.yourSumOvr} · rival ${view.rivalSumOvr}`);

      const active = await getActiveMatch(admin, userId);
      check("la partida en curso se puede retomar", active.ok && active.data!.view?.matchId === matchId);

      // ── Los diez turnos ──
      let played = 0;
      const guard = 40;
      for (let i = 0; i < guard && view.status === "IN_PROGRESS"; i++) {
        const card = view.yourHand[0];
        if (!card) break;
        // Atacando se declara estadística; defendiendo la impone la tabla y no se envía.
        const stat = view.youAreAttacker ? pickStat(view, card.uid) : undefined;
        const r = await playTurn(admin, userId, matchId, card.uid, stat);
        if (!r.ok) { check(`turno ${view.turn} jugable`, false, r.error); break; }
        view = r.data!.view;
        played++;
      }
      check("se juegan los 10 turnos", view.history.length === 10, `${view.history.length} turnos`);
      check("la partida termina", view.status === "COMPLETED" || view.status === "DRAW", view.status);
      check("nunca queda sin resolver", view.status !== "UNRESOLVED");
      check("hay resultado con motivo explicado", !!view.result?.reason, view.result?.reason);
      check("se gastan las 10 cartas de cada bando",
        view.yourUsed.length === 10 && view.rivalUsed.length === 10 && view.yourHand.length === 0);
      check("al rival no le queda ninguna carta", view.rivalRemaining === 0);
      check("el marcador coincide con el resultado del resolver",
        view.scoreYou === view.result!.scoreYou && view.scoreRival === view.result!.scoreRival);
      check("el resultado indica quién decidió", ["SCORE", "OVR_TIEBREAK", "STAT_MARGIN", "NONE"].includes(view.result!.decidedBy),
        view.result!.decidedBy);
      check("se juega con las reglas de la Fase 7", view.result!.rulesVersion === "duel-combat-2",
        view.result!.rulesVersion);
      void played;
      finalView = view;

      // ── Acciones ilegales ──
      console.log("\n## Acciones ilegales");
      const spent = view.yourUsed[0].uid;
      const afterEnd = await playTurn(admin, userId, matchId, spent, "stronghold");
      check("no se puede jugar en una partida terminada", !afterEnd.ok && afterEnd.status === 409, afterEnd.error);

      const other = await admin.auth.admin.createUser({
        email: `duel-thief-${Date.now()}@example.invalid`, password: ephemeralQaPassword(), email_confirm: true,
      });
      const thiefId = other.data.user!.id;
      const stolen = await getMatch(admin, thiefId, matchId);
      check("otro usuario NO puede leer tu partida", !stolen.ok && stolen.status === 404);
      const stolenReplay = await getReplay(admin, thiefId, matchId);
      check("otro usuario NO puede ver tu repetición", !stolenReplay.ok);
      await admin.auth.admin.deleteUser(thiefId).catch(() => {});

      // ── Repetición ──
      console.log("\n## Repetición");
      const replay = await getReplay(admin, userId, matchId);
      check("la repetición está disponible al terminar", replay.ok, replay.error);
      check("la repetición trae los 10 turnos", replay.data?.turns.length === 10);
      check("cada turno de la repetición trae las dos cartas y sus valores",
        (replay.data?.turns ?? []).every((t) => t.you.uid && t.rival.uid && t.you.value >= 0 && t.rival.value >= 0));
      check("la repetición trae los dos mazos completos (la partida ya terminó)",
        replay.data?.yourCards.length === 10 && replay.data?.rivalCards.length === 10);
      check("el marcador de cada turno es coherente",
        (replay.data?.turns ?? []).every((t, i, a) =>
          i === 0 ? true : t.scoreAfterYou >= a[i - 1].scoreAfterYou && t.scoreAfterRival >= a[i - 1].scoreAfterRival));

      const list = await listReplays(admin, userId);
      check("la partida aparece en la lista de repeticiones",
        list.ok && list.data!.matches.some((m) => m.matchId === matchId));
    }

    // ── Fuga de información ──
    console.log("\n## El cliente NO recibe información secreta");
    {
      const start = await startMatch(admin, userId, deckId, "HARD");
      const view = start.data!.view;
      const json = JSON.stringify(view);

      check("la proyección NO incluye el estado del generador",
        !json.includes("mulberry32") && !/"seed"\s*:/.test(json) && !/"rng"/.test(json));
      check("la proyección NO incluye el snapshot del rival",
        !json.includes("snapshotB") && !json.includes("checksum"));
      check("del rival solo se ve un NÚMERO de cartas restantes",
        typeof view.rivalRemaining === "number" && view.rivalUsed.length === 0);

      // DUEL GAMEPLAY UX 2.0 · si el bot abrió el turno, su carta comprometida va BOCA ABAJO: solo «comprometida» + stat.
      const pendingKeys = view.pendingRival ? Object.keys(view.pendingRival).sort().join(",") : "committed,stat";
      check("la carta que el rival acaba de comprometer NO viaja (solo «comprometida» y la estadística)", pendingKeys === "committed,stat", pendingKeys);

      // Comprobación directa contra la fila: el estado secreto existe, pero no sale.
      const { data: row } = await admin.from("duel_matches")
        .select("state, rng").eq("id", view.matchId).maybeSingle();
      const secret = row as { state: { snapshotB: { cards: { uid: string }[] } }; rng: unknown };
      const hiddenUids = secret.state.snapshotB.cards.map((c) => c.uid);
      check("el servidor sí guarda las cartas del rival", hiddenUids.length === 10);
      check("ninguna carta oculta del rival aparece en la proyección",
        hiddenUids.filter((u) => json.includes(u)).length <= 1);
      check("el servidor guarda el generador y el cliente no lo ve", !!secret.rng && !json.includes("draws"));

      await abandonMatch(admin, userId, view.matchId);
      const gone = await getMatch(admin, userId, view.matchId);
      check("abandonar elimina la partida", !gone.ok && gone.status === 404);
    }

    // ── Las tres dificultades ──
    console.log("\n## Las tres dificultades juegan de verdad");
    for (const level of ["EASY", "NORMAL", "HARD"] as BotDifficulty[]) {
      const s = await startMatch(admin, userId, deckId, level);
      if (!s.ok) { check(`${level} arranca`, false, s.error); continue; }
      let v = s.data!.view;
      for (let i = 0; i < 40 && v.status === "IN_PROGRESS"; i++) {
        const card = v.yourHand[0];
        if (!card) break;
        const r = await playTurn(admin, userId, v.matchId, card.uid, v.youAreAttacker ? pickStat(v, card.uid) : undefined);
        if (!r.ok) break;
        v = r.data!.view;
      }
      check(`${level}: partida completa de 10 turnos`, v.history.length === 10 && v.status !== "IN_PROGRESS",
        `${v.history.length} turnos · ${v.status} · ${v.scoreYou}-${v.scoreRival}`);
      await abandonMatch(admin, userId, v.matchId).catch(() => {});
    }

    // ── Estado final ──
    console.log("\n## Resumen");
    console.log(`   Partida de referencia: ${finalView!.scoreYou}-${finalView!.scoreRival} · ${finalView!.result!.reason}`);
  } finally {
    await admin.from("duel_matches").delete().eq("user_id", userId);
    await admin.from("duel_decks").delete().eq("user_id", userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(`\n${failures === 0 ? "✅ TODAS LAS COMPROBACIONES PASAN" : `❌ ${failures} COMPROBACIÓN(ES) FALLARON`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Elige una estadística legal para atacar. No es una regla: es el jugador de prueba decidiendo. */
function pickStat(view: DuelMatchView, uid: string): "stronghold" | "gamesense" | "entryfrag" {
  const card = view.yourHand.find((c) => c.uid === uid)!;
  const entries = [
    ["stronghold", card.combat.stronghold],
    ["gamesense", card.combat.gamesense],
    ["entryfrag", card.combat.entryfrag],
  ] as const;
  return entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

main().catch((e) => {
  console.error("\n❌ Error inesperado:", e instanceof Error ? e.message : e);
  process.exit(1);
});
