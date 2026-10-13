/*
 * F73 final · CONTROL del test de 0060 (fuera de CI): el MISMO escenario de la carrera real (desguace del sobrante Y
 * + intercambio que consume la copia conservada X, con las dos peticiones validadas en Node antes de escribir), pero
 * con la RPC de desguace ANTERIOR a 0060 (cuerpo de 0019, sin guardia). Si aquí no quedan 0 copias, el test no prueba nada.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { CARDS } from "../src/data/catalog";
import { packCardClass } from "../src/domain/packs/packClass";
import { MemSupabase } from "../src/server/services/testing/memSupabase";
import { salvageCards } from "../src/server/services/economy";
import { craftCard, getCraftingState } from "../src/server/services/crafting";
import { resetF73Cache } from "../src/server/services/f73Config";

const A = "aaaaaaaa-0000-4000-8000-0000000060cc";
const proto = MemSupabase.prototype as any;
proto.rpc_app_salvage_cards = function (a: any) { // cuerpo de 0019: solo bloquea/borra los elegidos, sin «última copia»
  const prev = this.storedOp(a.p_ref); if (prev) return { ...prev, repeated: true };
  const cards = this.table("user_cards"); const uids = a.p_uids as string[];
  const mine = cards.filter((r: any) => uids.includes(String(r.uid)) && r.user_id === a.p_user && r.locked === false);
  if (mine.length !== uids.length) throw new Error("Alguna de esas cartas no es tuya o está bloqueada");
  this.tables.user_cards = cards.filter((r: any) => !mine.includes(r));
  const balance = this.ledgerApply(a.p_user, Number(a.p_total), "salvage", String(a.p_ref), "credit");
  const result = { credits: balance, salvaged: mine.length, paid: Number(a.p_total) }; this.putOp(a.p_ref, a.p_user, "salvage", result); return result;
};
(async () => {
  resetF73Cache();
  const db = new MemSupabase();
  db.table("profiles").push({ id: A, username: "ctrl", credits: 0, xp: 0, level: 1, points: 0 });
  const sql = readFileSync("supabase/migrations/0059_crafting_missions.sql", "utf8");
  const v = (s: string) => (s === "null" ? null : s.slice(1, -1));
  for (const m of sql.matchAll(/\('([a-z0-9-]+)',\s*'(PACK|CARD)',\s*'([^']+)',\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(null|'[a-z]+'),\s*(\d+),\s*'(ACTIVE|DISABLED)',\s*(\d+)\)/g)) {
    db.table("craft_recipes").push({ id: m[1], kind: m[2], name: m[3], input_pack_id: v(m[4]), output_pack_id: v(m[5]), input_class: v(m[6]), output_class: v(m[7]), input_qty: Number(m[8]), status: m[9], sort_order: Number(m[10]), available_from: null, available_to: null, version: 1 });
  }
  const give = (cardId: string) => [randomUUID(), randomUUID()].map((uid) => { db.table("user_cards").push({ uid, user_id: A, card_id: cardId, serial: null, origin: "pack", locked: false, minted_version: null, obtained_at: new Date(0).toISOString() }); return uid; });
  const basics = CARDS.filter((c) => packCardClass(c) === "base");
  const target = basics[2].id;
  const [kept, surplus] = give(target).sort((a, b) => a.localeCompare(b));
  const others = basics.slice(3, 9).map((c) => give(c.id)[0]);
  await getCraftingState(db.client, A);
  const client: any = db.client; const orig = client.rpc.bind(client); let n = 0; let rel: any; const g = new Promise<void>((r) => { rel = r; });
  setTimeout(() => rel(), 1500);
  client.rpc = async (fn: string, args: any) => { if (fn === "app_salvage_cards" || fn === "app_craft_card") { n++; if (n >= 2) rel(); await g; } return orig(fn, args); };
  const [sv, cr] = await Promise.all([salvageCards(db.client, A, [surplus], "c-salv"), craftCard(db.client, A, "card-base-plata", [kept, ...others], "c-craft-0000000")]);
  console.log(`SIN 0060 → llegaron a la RPC: ${n} · desguace ${sv.ok ? "OK" : sv.status} · intercambio ${cr.ok ? "OK" : cr.status} · copias finales de la carta: ${db.table("user_cards").filter((r) => r.card_id === target).length}`);
})();
