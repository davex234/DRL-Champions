/**
 * PACK OPENING 3.0 · QA ECONÓMICA Y DE CARRERAS EN PRODUCCIÓN (instrumento de operador, fuera de CI y de la release).
 *
 *   BASE_URL=https://valorosters.com QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… npx tsx scripts/pack3/_prod-econ.mts M
 *
 * Persona QA temporal (nunca davex ni ValoRosters). Compra un Sobre Plata (cobro EXACTO del precio, una vez aunque se
 * repita el gesto), lo abre (6 cartas), repite el MISMO gesto (mismo resultado, ninguna carta nueva), intenta abrir otro
 * sin sobres (409 sin efectos), dos aperturas simultáneas del Bronce con gestos distintos (una gana) y comprueba saldo e
 * inventario exactos al final. Las cartas salen del motor real con el plan Pack Opening 3.0.
 */
import { token, api } from "../_fase68-lib";

const P = process.argv[2] ?? "M";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + JSON.stringify(d)?.slice(0, 300)}`); };
const t = await token(P);
const state = async () => (await api(t, "/api/game/state")).json;
const s0 = await state();
const copies0 = (s0.ownedCards ?? []).length;
check("estado inicial: 6.000 créditos, Sobre Inicial y Bronce de bienvenida", s0.credits === 6000 && (s0.unopenedPacks?.estandar ?? 0) >= 1, { c: s0.credits, p: s0.unopenedPacks });

// 1 · compra exacta y repetición del mismo gesto.
const g = `p3-buy-${Date.now()}`;
const b1 = await api(t, "/api/game/packs", { action: "buy", packId: "premium", ref: g }, true);
const b2 = await api(t, "/api/game/packs", { action: "buy", packId: "premium", ref: g }, true);
const s1 = await state();
check("comprar Plata cobra EXACTAMENTE 6.000 una sola vez (mismo gesto repetido)", b1.status === 200 && b2.status === 200 && s1.credits === 0 && (s1.unopenedPacks?.premium ?? 0) === 1, { b1: b1.status, b2: b2.status, c: s1.credits, p: s1.unopenedPacks });
const poor = await api(t, "/api/game/packs", { action: "buy", packId: "premium", ref: `${g}-2` }, true);
check("sin saldo: 409 y ni cobro ni sobre", poor.status === 409 && (await state()).credits === 0, { st: poor.status });

// 2 · apertura y repetición del mismo gesto: mismo resultado, ninguna carta nueva.
const og = `p3-open-${Date.now()}`;
const o1 = await api(t, "/api/game/packs", { action: "open", packId: "premium", ref: og }, true);
const uids1 = (o1.json?.opened ?? []).map((x: { uid: string }) => x.uid);
const o2 = await api(t, "/api/game/packs", { action: "open", packId: "premium", ref: og }, true);
const uids2 = (o2.json?.opened ?? []).map((x: { uid: string }) => x.uid);
check("abrir Plata: 6 cartas del servidor", o1.status === 200 && uids1.length === 6, { st: o1.status, n: uids1.length, err: o1.json?.error });
check("mismo gesto (F5/reintento): MISMAS cartas, marcado como repetido", o2.status === 200 && JSON.stringify(uids2) === JSON.stringify(uids1) && o2.json?.repeated === true, { st: o2.status, rep: o2.json?.repeated });
const s2 = await state();
check("inventario exacto: +6 copias, 0 Platas sin abrir", (s2.ownedCards ?? []).length === copies0 + 6 && (s2.unopenedPacks?.premium ?? 0) === 0, { copies: (s2.ownedCards ?? []).length, p: s2.unopenedPacks });
const none = await api(t, "/api/game/packs", { action: "open", packId: "premium", ref: `${og}-x` }, true);
check("sin sobres: 409 y nada cambia", none.status === 409 && (await state()).ownedCards.length === copies0 + 6, { st: none.status });
const cards = (o1.json?.opened ?? []).map((x: { cardId: string }) => x.cardId);
console.log("cartas del Plata:", cards.join(", "));

// 3 · dos aperturas simultáneas del Bronce (gestos distintos): con 1 sobre, solo una gana.
const bronze = s2.unopenedPacks?.estandar ?? 0;
if (bronze === 1) {
  const [x, y] = await Promise.all([
    api(t, "/api/game/packs", { action: "open", packId: "estandar", ref: `p3-race-a-${Date.now()}` }, true),
    api(t, "/api/game/packs", { action: "open", packId: "estandar", ref: `p3-race-b-${Date.now()}` }, true),
  ]);
  const s3 = await state();
  check("doble clic simultáneo (1 Bronce): una apertura, la otra 409; +5 copias exactas", [x.status, y.status].sort().join(",") === "200,409" && s3.ownedCards.length === copies0 + 11 && (s3.unopenedPacks?.estandar ?? 0) === 0, { st: [x.status, y.status], copies: s3.ownedCards.length });
} else console.log(`(Bronce disponibles: ${bronze}; carrera omitida)`);
const sEnd = await state();
check("saldo final exacto: 0 créditos (solo se gastaron los 6.000 del Plata)", sEnd.credits === 0, sEnd.credits);
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
