/**
 * FASE 35 · VERIFICADOR DE ROAD TO CHAMPIONS — `npm run campaign:verify` (todo) o
 *   `campaign-content:verify` · `campaign-security:verify` · `campaign-economy:verify`.
 *
 * Sin base de datos real: dominio puro sobre el catálogo REAL + servicio contra `MemorySupabase` (aplica
 * escrituras y simula índices únicos). Lo que requiere Postgres (índices parciales reales, RLS, PostgREST,
 * `app_grant_reward`, `app_rate_take`): NO EJECUTADO — REQUIERE BD DE PRUEBAS.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CardRegistry } from "../src/collection/registry";
import { ROAD_TO_CHAMPIONS } from "../src/data/roadToChampions";
import { currentTeamIdentity, teamIdentityById } from "../src/data/teamIdentities";
import { DUEL_ROLES, createDuelDeck, validateDuelDeck, makeDeckResolver, ownershipFromList } from "../src/domain/cardgame";
import { DIFFICULTY_PROFILE } from "../src/domain/cardgame/opponent/bots";
import { DAILY_DUEL_AWARD_CAP } from "../src/domain/progression/duelRewards";
import {
  validateCampaign, allNodes, nodeCardTier, buildOpponentPlan, botDifficultyOf, campaignRewardTotal, CAMPAIGN_FIRST_CLEAR_CAP,
  FIRST_CLEAR_CREDITS, DRAW_COMPLETES_NODE,
} from "../src/domain/campaign";
import { MemorySupabase } from "../src/server/services/testing/memorySupabase";
import { getCampaign, startCampaignNode, settleCampaignMatch, reconcileCampaign, type CampaignLauncher } from "../src/server/services/campaign";
import type { DuelMatchView } from "../src/lib/duel/types";

const section = process.argv[2] ?? "all";
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const want = (s: string) => section === "all" || section === s;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const DEF = ROAD_TO_CHAMPIONS;
const REG = new CardRegistry();
const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const USER = "00000000-0000-4000-8000-0000000000aa";
const DECK = "00000000-0000-4000-8000-0000000000dd";

function world() {
  const db = new MemorySupabase();
  db.unique.campaign_attempts = [
    { cols: ["user_id"], where: (r) => r.status === "STARTED" },
    { cols: ["match_id"], where: (r) => r.match_id != null },
    { cols: ["user_id", "campaign_id", "node_id"], where: (r) => r.first_clear === true },
  ];
  db.unique.campaign_progress = [{ cols: ["user_id", "campaign_id", "node_id"] }];
  let n = 0;
  db.defaults.campaign_attempts = () => ({ id: `att-${++n}`, status: "STARTED", match_id: null, result: null, first_clear: false, reward_granted: false, created_at: new Date(NOW).toISOString(), settled_at: null });
  db.tables.duel_matches = [];
  const ledger = new Map<string, number>();
  let fail = 0;
  db.rpcHandlers.app_grant_reward = (a) => {
    if (fail > 0) { fail--; return { data: null, error: { message: "down" } }; }
    if (ledger.has(String(a.p_ref))) return { data: { applied: false }, error: null };
    ledger.set(String(a.p_ref), Number(a.p_credits));
    return { data: { applied: true }, error: null };
  };
  let launches = 0;
  const launch: CampaignLauncher = async (_sb, userId, _deck, level) => {
    launches++;
    const id = randomUUID();
    db.rows("duel_matches").push({ id, user_id: userId, mode: "PVE", status: "IN_PROGRESS", state: { result: null } });
    return { ok: true, status: 200, data: { view: { matchId: id, difficulty: level } as unknown as DuelMatchView } };
  };
  return { db, sb: db.client, ledger, opts: { catalog: REG, now: NOW, launch }, launches: () => launches, failRewards: (k: number) => { fail = k; } };
}

async function win(w: ReturnType<typeof world>, nodeId: string, winner: "A" | "B" | null = "A") {
  const r = await startCampaignNode(w.sb, USER, { nodeId, deckId: DECK }, w.opts);
  if (!r.ok) return null;
  const id = r.data!.view.matchId;
  const m = w.db.rows("duel_matches").find((x) => x.id === id)!;
  m.status = winner === null ? "DRAW" : "COMPLETED"; m.state = { result: { winner, isDraw: winner === null } };
  await settleCampaignMatch(w.sb, USER, id, null, w.opts);
  return id;
}

async function main() {
  console.log(`# Road to Champions · sección ${section}\n`);

  if (want("content")) {
    console.log("## Contenido (definición y rivales reales)");
    const v = validateCampaign(DEF);
    check("definición rtc-2 válida", v.ok, v.issues.map((i) => `${i.code}:${i.ref}`).join(", "));
    check("3 capítulos, 15 nodos (12–18)", DEF.chapters.length === 3 && allNodes(DEF).length === 15);
    check("cada capítulo acaba en jefe", DEF.chapters.every((c) => [...c.nodes].sort((a, b) => b.order - a.order)[0].type === "BOSS"));
    let legal = 0; let real = 0; let unique = 0; let core = 0;
    for (const n of allNodes(DEF)) {
      const p = buildOpponentPlan(REG, n.opponent.teamId, nodeCardTier(DEF, n.id)!);
      if (!p.ok) { console.log(`    ${n.id}: ${p.reason}`); continue; }
      const owned = p.cards.map((c, i) => ({ uid: `bot-${n.id}-${i}`, cardId: c.cardId, obtainedAt: 0 }));
      const deck = createDuelDeck({ id: `bot-${n.id}`, name: p.teamName, cards: owned.map((o) => o.uid), now: 0 });
      if (validateDuelDeck(deck, makeDeckResolver(REG, ownershipFromList(owned))).valid && DUEL_ROLES.every((r) => p.cards.filter((c) => c.role === r).length === 2)) legal++;
      if (p.cards.every((c) => REG.card(c.cardId)?.combat && REG.player(c.playerId))) real++;
      if (new Set(p.cards.map((c) => c.playerId)).size === 10) unique++;
      if (p.cards.filter((c) => c.source === "TEAM").every((c) => currentTeamIdentity(REG.player(c.playerId)!.team)?.canonicalId === p.teamId) && p.coreCount >= 3) core++;
      console.log(`    ${n.id} ${n.type.padEnd(5)} ${botDifficultyOf(n.difficulty).padEnd(6)} ${p.tier.padEnd(4)} ${p.teamName.padEnd(14)} ${p.region.padEnd(8)} núcleo ${p.coreCount} + ${10 - p.coreCount} refuerzos · Σ ${p.sumOvr}`);
    }
    check("15/15 mazos rivales legales con el validador canónico", legal === 15, `${legal}/15`);
    check("15/15 solo cartas y jugadores reales del catálogo", real === 15, `${real}/15`);
    check("15/15 sin jugadores repetidos", unique === 15, `${unique}/15`);
    check("15/15 núcleo = roster ACTUAL del equipo (sin alias ambiguos), ≥ 3", core === 15, `${core}/15`);
    check("todos los rivales son identidades verificadas", allNodes(DEF).every((n) => teamIdentityById(n.opponent.teamId)?.status === "verified"));
    check("sin resultados VCT inventados en la definición", !/gan[óo]|campe[óo]n de|final de (masters|champions)|vct \d{4}/i.test(read("src/data/roadToChampions.ts").replace(/\/\*[\s\S]*?\*\//g, "")));
  }

  if (want("security")) {
    console.log("\n## Seguridad");
    const route = read("src/app/api/game/campaign/route.ts");
    check("POST con lista cerrada de claves (action, nodeId, deckId)", route.includes('start: ["action", "nodeId", "deckId"]') && route.includes('"FIELD_NOT_ALLOWED"'));
    check("GET sin parámetros; usuario del token", route.includes('if ([...q.keys()].length > 0) return bad("Parámetro no válido");') && route.includes("getCampaign(admin, session.userId)"));
    check("5xx enmascarado", route.includes('"Road to Champions no responde ahora mismo"'));
    const w = world();
    const locked = await startCampaignNode(w.sb, USER, { nodeId: "c2-n1", deckId: DECK }, w.opts);
    check("nodo bloqueado → 409 LOCKED", locked.status === 409 && locked.code === "LOCKED");
    const unknown = await startCampaignNode(w.sb, USER, { nodeId: "c9-n9", deckId: DECK }, w.opts);
    check("nodo inexistente → 404", unknown.status === 404);
    const [a, b] = await Promise.all([
      startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts),
      startCampaignNode(w.sb, USER, { nodeId: "c1-n1", deckId: DECK }, w.opts),
    ]);
    check("doble lanzamiento simultáneo → una sola partida", [a, b].filter((r) => r.ok).length === 1 && w.launches() === 1);
    const id = (a.ok ? a : b).data!.view.matchId;
    const m = w.db.rows("duel_matches").find((x) => x.id === id)!;
    m.status = "COMPLETED"; m.state = { result: { winner: "A", isDraw: false } };
    const [s1, s2] = await Promise.all([settleCampaignMatch(w.sb, USER, id, null, w.opts), settleCampaignMatch(w.sb, USER, id, null, w.opts)]);
    check("liquidación concurrente → una sola", Number(s1.settled) + Number(s2.settled) === 1);
    const writesBefore = w.db.writes().length;
    await getCampaign(w.sb, USER, w.opts);
    check("GET no escribe", w.db.writes().length === writesBefore);
    const tables = new Set(w.db.writes().filter((l) => !l.startsWith("rpc:")).map((l) => l.split(":")[1]));
    check("solo escribe tablas de campaña (nada de rating/partidas)", [...tables].every((t) => t === "campaign_attempts" || t === "campaign_progress"), [...tables].join(","));
    const mw = world(); mw.db.missing.add("campaign_progress"); mw.db.missing.add("campaign_attempts");
    const ms = await startCampaignNode(mw.sb, USER, { nodeId: "c1-n1", deckId: DECK }, mw.opts);
    const mg = await getCampaign(mw.sb, USER, mw.opts);
    check("sin 0051: lanzar 503 MIGRATION_PENDING y leer «no disponible»", ms.status === 503 && ms.code === "MIGRATION_PENDING" && mg.data?.available === false);
    const sql = read("supabase/migrations/0051_campaign_road_to_champions.sql");
    check("0051: aplicada en la Fase 35.1 (cabecera), RLS, sin políticas", sql.includes("— APLICADA (VPS 2026-09-15, Fase 35.1).") && sql.includes("enable row level security") && !/create policy/i.test(sql));
    check("sin segundo motor en el servicio", !/CampaignCombatEngine|RoadToChampionsEngine|ChallengeCombatResolver|AdventureBattleEngine|PvEEngine2/.test(read("src/server/services/campaign.ts")));
    check("bots canónicos sin información perfecta", Object.values(DIFFICULTY_PROFILE).every((p) => p.perfectInformation === false));
  }

  if (want("economy")) {
    console.log("\n## Economía");
    check("tabla de primera victoria 50/100/200", JSON.stringify(FIRST_CLEAR_CREDITS) === JSON.stringify({ MATCH: 50, ELITE: 100, BOSS: 200 }));
    check("total acotado", campaignRewardTotal(DEF) <= CAMPAIGN_FIRST_CLEAR_CAP, `${campaignRewardTotal(DEF)} ≤ ${CAMPAIGN_FIRST_CLEAR_CAP}`);
    check("empate no completa (no se cobra por empatar)", DRAW_COMPLETES_NODE === false);
    const w = world();
    await win(w, "c1-n1");
    await win(w, "c1-n1");
    await win(w, "c1-n1", "B");
    check("rejugar no repaga: 1 asiento para c1-n1", w.ledger.size === 1 && w.ledger.get("campaign:road-to-champions:c1-n1") === 50);
    const d = world();
    await win(d, "c1-n1", null);
    check("empate: 0 asientos", d.ledger.size === 0);
    const f = world();
    f.failRewards(1);
    await win(f, "c1-n1");
    await reconcileCampaign(f.sb, USER, f.opts);
    await reconcileCampaign(f.sb, USER, f.opts);
    check("pago fallido se reintenta y cobra UNA vez", f.ledger.size === 1);
    const full = world();
    for (const n of allNodes(DEF)) await win(full, n.id);
    const paid = [...full.ledger.values()].reduce((s, x) => s + x, 0);
    check("campaña completa paga exactamente el total de la tabla", paid === campaignRewardTotal(DEF), `${paid}`);
    for (const n of allNodes(DEF)) await win(full, n.id);
    check("rejugarla entera no añade nada", [...full.ledger.values()].reduce((s, x) => s + x, 0) === paid);
    check("la partida paga lo de siempre: tope diario PvE 20", DAILY_DUEL_AWARD_CAP === 20);
    const svc = read("src/server/services/campaign.ts").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    check("sin moneda/stamina/tickets/sobres de campaña", !/stamina|ticket|currency|packId|campaign_pack/i.test(svc));
    check("concesión solo por award()", /award\(sb, \{ userId, ref: firstClearRef\(/.test(svc) && !/credit_transactions/.test(svc));
  }

  console.log(`\n━━━ Resultado: ${ok} ✓ / ${ko} ✗ ━━━`);
  if (ko > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
