/**
 * FASE 55 · preparación de las cuentas QA para el E2E ranked (fuera de CI). Por la API NORMAL del juego, como un
 * jugador: abre los sobres que tenga sin abrir, compra y abre Sobres Estándar con los créditos PROPIOS de la cuenta
 * QA hasta cubrir la composición (2 por rol, jugadores distintos) y guarda un mazo legal. Nada de SQL ni de
 * regalos: economía real de la cuenta QA. Nunca toca la cuenta demo.
 *
 *   npx tsx scripts/_fase55-qa-prep.ts <creds.json> [<creds.json>…]
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DUEL_ROLES, DUEL_COMPOSITION } from "@/domain/cardgame";

const BASE = "http://127.0.0.1:3005";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const DEMO = "2f86cbe8-f663-40fb-a87c-4896b9a45b62";
const MAX_PACKS = 8;

async function call(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}

function pickDeck(collection: { uid: string; role: string; playerId?: string; cardId: string; ovr?: number }[]): string[] | null {
  const used = new Set<string>(); const out: string[] = [];
  for (const role of DUEL_ROLES) {
    const pool = collection.filter((c) => c.role === role).sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0));
    let n = 0;
    for (const c of pool) { const p = c.playerId ?? c.cardId; if (used.has(p)) continue; used.add(p); out.push(c.uid); if (++n === DUEL_COMPOSITION[role]) break; }
    if (n < DUEL_COMPOSITION[role]) return null;
  }
  return out;
}

(async () => {
  for (const f of process.argv.slice(2)) {
    const c = JSON.parse(readFileSync(f, "utf8")) as { email: string; password: string; userId: string };
    if (c.userId === DEMO) throw new Error("nunca la cuenta demo");
    const t = await (await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ email: c.email, password: c.password }) })).json();
    const token = t.access_token as string;
    const log: string[] = [];
    let w = (await call(token, "GET", "/api/game/duels")).json;
    let picks = pickDeck(w.collection ?? []);
    for (let i = 0; i < MAX_PACKS && !picks; i++) {
      const r = await call(token, "POST", "/api/game/packs", { action: "buy_and_open", packId: "estandar", ref: `f55-buy-${randomUUID()}` });
      log.push(`buy_and_open estandar → ${r.status} cartas=${r.json.opened?.length ?? "-"} créditos=${r.json.credits ?? "-"} ${r.json.error ?? ""}`);
      if (r.status !== 200) break;
      w = (await call(token, "GET", "/api/game/duels")).json;
      picks = pickDeck(w.collection ?? []);
    }
    if (!picks) { console.log(c.userId.slice(0, 8), "SIN COMPOSICIÓN", log); continue; }
    const s = await call(token, "POST", "/api/game/duels", { action: "save", name: "QA F55 Ranked", cardUids: picks });
    console.log(c.userId.slice(0, 8), log, `save → ${s.status} valid=${s.json.deck?.valid} ${s.json.error ?? ""}`);
  }
})();
