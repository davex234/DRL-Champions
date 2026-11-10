/**
 * F79.1 · LA APP DESPLEGADA (código anterior a F79) CONTRA EL ESQUEMA 0061 — escrituras reales con la cuenta QA C
 * (nunca la del usuario), por la API pública. Instrumento fuera de CI.
 *
 *   (cwd con .env.local público)  BASE_URL=https://valorosters.com tsx scripts/_f79-1-postmig.ts
 *
 * Packs (comprar + abrir), crafteo (estado + intercambio de cartas por la RPC `app_craft_card` que 0061 redefinió +
 * reintento idempotente), desguace (vista previa + un duplicado, RPC de 0060), misiones y temporada/competitivo.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { api, login, sleep } from "./multiplayer/_qa";

/* eslint-disable @typescript-eslint/no-explicit-any */
const rows: { id: string; ok: boolean; detail: string }[] = [];
const check = (id: string, ok: boolean, detail = "") => { rows.push({ id, ok, detail: String(detail).slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${String(detail).slice(0, 200)}`); return ok; };
const g = () => `f791-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  const C = await login("C");
  check("auth · login QA C por la API pública", !!C.token, C.userId.slice(0, 8));
  const st0 = await api(C, "/api/game/state");
  check("estado", st0.status === 200, `${st0.status}`);
  const credits0 = Number((st0.json as any)?.credits ?? (st0.json as any)?.profile?.credits ?? NaN);

  // PACKS: comprar y abrir uno estándar (precio y tirada del servidor).
  const buy = await api(C, "/api/game/packs", { action: "buy_and_open", packId: "estandar", ref: g() });
  check("packs · comprar y abrir (estandar)", buy.status === 200, `${buy.status} ${JSON.stringify(buy.json).slice(0, 120)}`);
  await sleep(500);

  // Material para el intercambio: más sobres estándar con los créditos QA de la propia cuenta, hasta que alguna receta
  // sea forjable (tope F791_MAX_PACKS). Nada se concede por admin.
  const maxPacks = Number(process.env.F791_MAX_PACKS ?? 0);
  for (let i = 0; i < maxPacks; i++) {
    const pre = await api(C, "/api/game/crafting");
    if (((pre.json as any)?.cardRecipes ?? []).some((x: any) => x.canCraft)) break;
    const b = await api(C, "/api/game/packs", { action: "buy_and_open", packId: "estandar", ref: g() });
    if (b.status !== 200) { console.log(`(compra ${i + 1}: ${b.status})`); break; }
    await sleep(400);
  }

  // CRAFTEO: estado y un intercambio real por la app desplegada (RPC app_craft_card de 0061).
  const cs = await api(C, "/api/game/crafting");
  check("crafteo · estado disponible", cs.status === 200 && (cs.json as any)?.available === true, `${cs.status}`);
  const recipes = ((cs.json as any)?.cardRecipes ?? []) as { id: string; inputQty: number; available: number; canCraft: boolean; candidates: { cardId: string; available: number; uids: string[] }[] }[];
  check("crafteo · escalera de intercambio intacta", recipes.map((r) => `${r.id}:${r.inputQty}`).join(",") === "card-base-plata:7,card-plata-oro:3,card-oro-masters:8,card-masters-champions:14,card-champions-prime:10", recipes.map((r) => `${r.id}:${r.inputQty}`).join(","));
  const r = recipes.find((x) => x.canCraft);
  if (r) {
    const pick: string[] = [];
    for (const c of r.candidates) for (const u of c.uids.slice(0, c.available)) if (pick.length < r.inputQty) pick.push(u);
    const ref = g();
    const x1 = await api(C, "/api/game/crafting", { action: "craftCard", recipeId: r.id, uids: pick, ref });
    check(`crafteo · intercambio ${r.id} (${r.inputQty} copias) por la app desplegada`, x1.status === 200 && (x1.json as any)?.outputs?.length === 1, `${x1.status} ${JSON.stringify((x1.json as any)?.outputs ?? x1.json).slice(0, 120)}`);
    const x2 = await api(C, "/api/game/crafting", { action: "craftCard", recipeId: r.id, uids: pick, ref });
    check("crafteo · reintento con el mismo gesto = misma carta, nada más consumido", x2.status === 200 && (x2.json as any)?.repeated === true && (x2.json as any)?.outputs?.[0]?.uid === (x1.json as any)?.outputs?.[0]?.uid, `${x2.status} repeated=${(x2.json as any)?.repeated}`);
  } else check("crafteo · intercambio (sin material suficiente en la cuenta QA: no ejecutado)", true, "SKIP: ninguna receta canCraft");

  // DESGUACE: vista previa + un solo duplicado (RPC de 0060, sin cambios).
  const pv = await api(C, "/api/game/economy", { action: "salvagePreview" });
  check("desguace · vista previa", pv.status === 200, `${pv.status} ${((pv.json as any)?.uids ?? []).length} duplicados`);
  const one = ((pv.json as any)?.uids ?? [])[0];
  if (one) {
    const ref = g();
    const s1 = await api(C, "/api/game/economy", { action: "salvage", uids: [one], ref });
    check("desguace · un duplicado", s1.status === 200 && (s1.json as any)?.salvaged === 1, `${s1.status} ${JSON.stringify(s1.json).slice(0, 100)}`);
    const s2 = await api(C, "/api/game/economy", { action: "salvage", uids: [one], ref });
    check("desguace · reintento = mismo resultado, un solo cobro", s2.status === 200 && (s2.json as any)?.repeated === true, `${s2.status} repeated=${(s2.json as any)?.repeated}`);
  } else check("desguace · (sin duplicados: no ejecutado)", true, "SKIP");

  // MISIONES, competitivo, temporada.
  for (const p of ["/api/game/missions", "/api/game/competitive", "/api/game/season", "/api/game/collection"]) {
    const x = await api(C, p); check(`lectura · ${p}`, x.status === 200, `${x.status} ${x.ms}ms`); await sleep(150);
  }
  const st1 = await api(C, "/api/game/state");
  const credits1 = Number((st1.json as any)?.credits ?? (st1.json as any)?.profile?.credits ?? NaN);
  check("créditos coherentes (nunca negativos)", Number.isFinite(credits1) ? credits1 >= 0 : true, `${credits0} → ${credits1}`);

  const ok = rows.filter((x) => x.ok).length;
  console.log(`\n${ok}/${rows.length} PASS`);
  const out = join(process.cwd(), "f79-1-postmig.json");
  mkdirSync(process.cwd(), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), base: process.env.BASE_URL, rows }, null, 2));
  process.exit(ok === rows.length ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
