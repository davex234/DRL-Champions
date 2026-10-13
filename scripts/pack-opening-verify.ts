/**
 * FASE 38 · VERIFICADOR DE LA APERTURA — `npm run pack-opening:verify` (todo) o
 *   `pack-opening-presentation:verify` · `pack-opening-security:verify`.
 *
 * Sin base de datos real: motor de sobres REAL (catálogo del código) para producir resultados autoritativos con
 * semillas, dominio de presentación puro, servicio contra `MemorySupabase` con una RPC que imita `app_apply_pack_open`
 * y el código fuente de ruta, cliente y UI. RLS/Postgres reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { CARDS, getCard, getPlayer } from "../src/data/catalog";
import { PACKS, getPack } from "../src/data/packs";
import { PackEngine } from "../src/pack/engine";
import { freshPity } from "../src/domain/packs/pity";
import { isPurchasable } from "../src/domain/packs/lifecycle";
import { buildRevealPlan, INITIAL_REVEAL, revealReducer, REVEAL_HOLD_MS, type OpenedInstance } from "../src/domain/packs/reveal";
import type { OwnedInstanceFact } from "../src/domain/collection/room";
import { MemorySupabase, type Row } from "../src/server/services/testing/memorySupabase";
import { openPackForUser } from "../src/server/services/packs";
import { MAX_BURST, rarityCeremony } from "../src/components/packs/ceremony";

const section = process.argv[2] ?? "all";
let ok = 0; let ko = 0;
const check = (label: string, cond: boolean, detail = "") => { if (cond) ok++; else ko++; console.log(`  ${cond ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`); };
const want = (s: string) => section === "all" || section === s;
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const CAT = { cards: CARDS, getCard, getPlayer };

function simulate(packId: string, seed: number, owned: OwnedInstanceFact[]) {
  const engine = new PackEngine();
  const res = engine.open(getPack(packId)!, {
    seed, owned: owned.map((o) => ({ uid: o.uid, cardId: o.cardId, serial: o.serial ?? undefined, obtainedAt: 0 })), mintCounts: {}, pity: freshPity(), now: 1,
  });
  const opened: OpenedInstance[] = res.instances.map((ins, i) => ({ uid: `sim-${seed}-${i}`, cardId: ins.cardId, serial: ins.serial ?? null, mintedVersion: 1 }));
  return { res, opened };
}

async function main() {
  if (want("presentation")) {
    console.log("\n· PRESENTACIÓN (resultados reales del motor, 400 aperturas con semilla)");
    const packs = PACKS.filter((p) => isPurchasable(p)).slice(0, 8);
    let statusMatches = 0; let statusTotal = 0; let orderOk = true; let countOk = true; let deltaOk = true; let sameTwice = 0; let sameTwiceOk = true;
    for (let s = 0; s < 400; s++) {
      const pack = packs[s % packs.length];
      const owned: OwnedInstanceFact[] = CARDS.filter((_, i) => (i * 7 + s) % 5 === 0).slice(0, 60 + (s % 90)).map((c, i) => ({ uid: `own-${s}-${i}`, cardId: c.id, serial: null, mintedVersion: 1 }));
      const { res, opened } = simulate(pack.id, 1000 + s, owned);
      const plan = buildRevealPlan(opened, owned, CAT);
      countOk &&= plan.items.length === pack.cardCount && plan.summary.total === pack.cardCount;
      orderOk &&= plan.items.every((it, i) => it.uid === opened[i].uid && it.cardId === opened[i].cardId && it.serial === opened[i].serial);
      res.instances.forEach((ins, i) => { statusTotal++; if ((plan.items[i].status === "new") === ins.isNew) statusMatches++; });
      const distinctNew = new Set(opened.map((o) => o.cardId).filter((id) => !owned.some((f) => f.cardId === id))).size;
      deltaOk &&= plan.summary.collection!.gainedUnique === distinctNew && plan.summary.newCount === distinctNew;
      const ids = opened.map((o) => o.cardId);
      if (new Set(ids).size < ids.length) {
        sameTwice++;
        for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) sameTwiceOk &&= plan.items.filter((it) => it.cardId === id && it.status === "new").length <= 1;
      }
    }
    check("«nueva» coincide con el motor en todas las cartas (antes = propiedad previa)", statusMatches === statusTotal, `${statusMatches}/${statusTotal}`);
    check("número de cartas = el del sobre (el plan no añade ni quita)", countOk);
    check("orden autoritativo y mapeo uid ↔ carta ↔ serial intactos", orderOk);
    check("delta de colección = definiciones realmente nuevas", deltaOk);
    check("misma definición dos veces en un sobre: como mucho una «nueva»", sameTwiceOk, `${sameTwice} sobres con repetición`);
    const common = CARDS.find((c) => c.variantId === "bronze") ?? CARDS[0];
    const allDup = buildRevealPlan([0, 1, 2].map((i) => ({ uid: `d-${i}`, cardId: common.id, serial: null, mintedVersion: 1 })), [{ uid: "o", cardId: common.id, serial: null, mintedVersion: 1 }], CAT).summary;
    check("todas duplicadas: X → X y 0 nuevas", allDup.collection!.gainedUnique === 0 && allDup.newCount === 0 && allDup.duplicateCount === 3);
    const noBefore = buildRevealPlan([{ uid: "x", cardId: common.id, serial: null, mintedVersion: 1 }], null, CAT);
    check("sin foto previa no se afirma nueva/duplicada ni progreso", noBefore.items[0].status === "unknown" && noBefore.summary.collection === null);
    let s = INITIAL_REVEAL;
    s = revealReducer(revealReducer(s, { type: "OPEN_REQUESTED" }), { type: "OPEN_REQUESTED" });
    check("máquina de estados: doble clic = una petición", s.requests === 1);
    const failed = revealReducer(s, { type: "OPEN_FAILED", failure: { kind: "SERVER", title: "", message: "", retrySameKey: true } });
    check("máquina de estados: error sin revelado", failed.phase === "error" && revealReducer(failed, { type: "ADVANCE" }) === failed && revealReducer(failed, { type: "INTRO_DONE" }) === failed);
    check("ritmo monótono y común rápida", REVEAL_HOLD_MS.common < REVEAL_HOLD_MS.uncommon && REVEAL_HOLD_MS.uncommon < REVEAL_HOLD_MS.rare && REVEAL_HOLD_MS.rare < REVEAL_HOLD_MS.epic && REVEAL_HOLD_MS.epic < REVEAL_HOLD_MS.legendary && REVEAL_HOLD_MS.common <= 400);
    const reveal = read("src/domain/packs/reveal.ts");
    check("dominio de presentación puro: sin RNG, fechas, motor ni obtained_at", !/Math\.random|Date\.now|obtained|PackEngine|openPack\(|weights/.test(code(reveal)));
  }

  if (want("security")) {
    console.log("\n· SEGURIDAD");
    const route = read("src/app/api/game/packs/route.ts");
    const service = read("src/server/services/packs.ts");
    const ui = ["PackOpeningExperience.tsx", "CardReveal.tsx", "PackStage.tsx", "PackSummary.tsx", "PackStatus.tsx"].map((f) => read(`src/components/packs/${f}`)).join("\n");
    check("ruta: solo POST", /export async function POST\(/.test(route) && !/export (async )?function (GET|PUT|PATCH|DELETE)/.test(route));
    check("ruta: usuario del token", route.includes("openPackForUser(session.admin, session.userId, packId, ref)") && !/body\.userId/.test(code(route)));
    check("ruta: campos cerrados (action, packId, ref) y cuerpo ≤ 2 KB", route.includes('const ALLOWED = ["action", "packId", "ref"];') && route.includes("const MAX_BODY = 2_000;"));
    check("ruta: sobre y clave con formato cerrado", route.includes("/^[\\w-]{1,64}$/.test(packId)") && route.includes("/^[\\w:-]{1,128}$/.test(body.ref)"));
    check("ruta: 5xx genérico", route.includes("if (result.status >= 500)") && !/error: e instanceof Error \? e\.message/.test(code(route)));
    check("servicio: semilla criptográfica y precio del catálogo", service.includes("randomInt(") && service.includes("p_price: pack.price"));
    check("servicio: DRAFT no se abre / RETIRED poseído sí (guardPublicOpen) y compra solo ACTIVE (guardPurchase)", service.includes("guardPublicOpen(pack)") && service.includes("guardPurchase(pack)"));
    check("servicio: reintento con clave → lo guardado del PROPIO usuario, sin volver a sortear", service.includes('.eq("ref", ref).eq("user_id", userId)') && service.includes("if (prior) return prior;"));
    check("servicio: las cartas devueltas se releen de user_cards por uid", service.includes('select("uid, card_id, serial, minted_version").eq("user_id", userId).in("uid", uids)'));
    check("servicio: la clave de la RPC sigue siendo la del gesto", service.includes('p_ref: packOpRef(userId, "open", gesture ?? anonymousGesture()),'));
    check("UI: sin RNG, motor, precios, pity ni pesos", !/Math\.random|PackEngine|\.price\b|weights|pity/.test(code(ui)));
    check("UI: sin venta, valor ni mercado", !/quickSell|\bvender\b|\bventa\b|🪙|formatCredits|\bmercado\b/i.test(code(ui)));
    check("UI: ningún «garantizado»", !/garantiz/i.test(code(ui)));
    const migrations = readdirSync(join(process.cwd(), "supabase", "migrations"));
    // Fase 39 · 0053 existe, pero es Draft Gauntlet: la apertura sigue sin migración ni tablas propias.
    check("sin migración de apertura (0053 solo es Draft Gauntlet) ni tablas de animación", migrations.filter((f) => f.startsWith("0053")).every((f) => f.includes("draft_gauntlet")) && !/pack_opening_sessions|reveal_state|animation_state/.test(migrations.join(",")));
    check("mercado cerrado", /GLOBAL_MARKET_ENABLED\s*=\s*false/.test(read("src/config/features.ts")));
    console.log("  · RLS / Postgres reales: NO EJECUTADO — REQUIERE BD DE PRUEBAS AISLADA");
  }

  if (want("economy")) {
    console.log("\n· ECONOMÍA (servicio real, BD en memoria con la RPC de apertura)");
    const U = "aaaaaaaa-0000-4000-8000-00000000f038";
    const db = new MemorySupabase();
    db.tables = { profiles: [{ id: U, credits: 900, xp: 10 }], user_cards: [], user_packs: [{ user_id: U, pack_id: "estandar", qty: 2 }], user_game: [{ user_id: U, pity: freshPity(), packs_opened: 3 }], card_mints: [], economy_ops: [], credit_transactions: [] };
    db.rpcHandlers.app_apply_pack_open = (a: Row) => {
      const prev = db.rows("economy_ops").find((r) => r.ref === a.p_ref);
      if (prev) return { data: { ...(prev.result as Row), repeated: true }, error: null };
      const pk = db.rows("user_packs")[0];
      if ((pk.qty as number) < 1) return { data: null, error: { code: "P0001", message: "No tienes ese sobre" } };
      pk.qty = (pk.qty as number) - 1;
      const uids = (a.p_instances as Row[]).map((ins) => { const uid = randomUUID(); db.rows("user_cards").push({ uid, user_id: U, card_id: ins.cardId, serial: ins.serial ?? null, origin: "pack", locked: false, obtained_at: "x", minted_version: 1 }); return uid; });
      db.rows("user_game")[0].packs_opened = (db.rows("user_game")[0].packs_opened as number) + 1;
      db.rows("profiles")[0].xp = (db.rows("profiles")[0].xp as number) + (a.p_xp as number);
      db.rows("economy_ops").push({ ref: a.p_ref, user_id: U, kind: "open_pack", result: { uids, packId: a.p_pack_id } });
      return { data: { uids, packId: a.p_pack_id }, error: null };
    };
    const first = await openPackForUser(db.client, U, "estandar", "verify-g");
    const snap = JSON.stringify({ c: db.rows("profiles")[0].credits, p: db.rows("user_packs")[0].qty, o: db.rows("user_game")[0].packs_opened, n: db.rows("user_cards").length, x: db.rows("profiles")[0].xp });
    check("abrir: −1 sobre, +1 abierto, +5 cartas, créditos iguales, 0 movimientos de créditos", first.ok && db.rows("user_packs")[0].qty === 1 && db.rows("user_game")[0].packs_opened === 4 && db.rows("user_cards").length === 5 && db.rows("profiles")[0].credits === 900 && db.rows("credit_transactions").length === 0);
    const again = await openPackForUser(db.client, U, "estandar", "verify-g");
    check("reintento misma clave: +0 en todo y mismas cartas", again.ok && again.data.repeated && JSON.stringify({ c: db.rows("profiles")[0].credits, p: db.rows("user_packs")[0].qty, o: db.rows("user_game")[0].packs_opened, n: db.rows("user_cards").length, x: db.rows("profiles")[0].xp }) === snap && first.ok && JSON.stringify(again.data.opened.map((c) => c.uid)) === JSON.stringify(first.data.opened.map((c) => c.uid)));
    check("ninguna escritura fuera de la RPC de apertura (sin ledger por rareza, serial ni set)", !db.writes().some((w) => /^(insert|update|upsert|delete):/.test(w)), db.writes().filter((w) => !w.startsWith("rpc:")).join(","));
    const ceremony = code(read("src/components/packs/PackOpeningExperience.tsx"));
    check("la ceremonia no incrementa objetivos ni contadores en cliente", !/packs_opened|packsOpened\s*\+|incrementObjective|app_grant/.test(ceremony));
  }

  if (want("performance")) {
    console.log("\n· RENDIMIENTO");
    const before: OwnedInstanceFact[] = Array.from({ length: 20_000 }, (_, i) => ({ uid: `b${i}`, cardId: CARDS[i % CARDS.length].id, serial: null, mintedVersion: 1 }));
    const opened: OpenedInstance[] = CARDS.slice(0, 6).map((c, i) => ({ uid: `n${i}`, cardId: c.id, serial: null, mintedVersion: 1 }));
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) buildRevealPlan(opened, before, CAT);
    const ms = (performance.now() - t0) / 5;
    check("plan + resumen con 20 000 copias previas < 60 ms (dos fotos de colección, sin refetch)", ms < 60, `${ms.toFixed(1)} ms`);
    check("partículas por estallido ≤ 40 en todas las rarezas", (["common", "uncommon", "rare", "epic", "legendary"] as const).every((r) => rarityCeremony(r).burst <= MAX_BURST));
    const ui = ["PackOpeningExperience.tsx", "CardReveal.tsx", "PackStage.tsx", "PackSummary.tsx"].map((f) => read(`src/components/packs/${f}`)).join("\n");
    check("ninguna ráfaga escrita supera 40", [...ui.matchAll(/count=\{(\d+)\}/g)].every((m) => Number(m[1]) <= MAX_BURST));
    check("el resumen pinta cartas estáticas (sin Card3D interactivas por carta)", !/mode="(hover|legendary|selected|showcase)"/.test(read("src/components/packs/PackSummary.tsx")));
  }

  console.log(`\n${ok} ✓ · ${ko} ✗`);
  if (ko > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
