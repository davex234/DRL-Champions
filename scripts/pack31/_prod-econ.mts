/**
 * PACK OPENING 3.1 · QA ECONÓMICA Y DE CARRERAS EN PRODUCCIÓN, SOBRES ESPECIALES (instrumento de operador, fuera de CI).
 *
 *   BASE_URL=https://valorosters.com QA_CREDS_DIR=… QA_SB=https://valorosters.com QA_ANON=… npx tsx scripts/pack31/_prod-econ.mts M emea
 *
 * Persona QA temporal: precio NUEVO aplicado por el servidor (EWC 8.500 / China 9.500 rechazados con 6.000 de saldo, que
 * con los precios viejos —6.000/3.000— sí habrían pasado); compra exacta del especial (una vez aunque se repita el gesto);
 * apertura con el mismo gesto = mismo resultado; TODAS las cartas dentro del pool del sobre (región); doble apertura
 * simultánea sin sobres → una sola; saldo e inventario exactos.
 */
import { token, api } from "../_fase68-lib";
import { getPack } from "@/data/packs";
import { packClassPools } from "@/domain/packs/packPools";
import { PACK_CLASS_ORDER } from "@/domain/packs/packClass";

const P = process.argv[2] ?? "M", PACK = process.argv[3] ?? "emea";
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : " " + JSON.stringify(d)?.slice(0, 300)}`); };
const t = await token(P);
const state = async () => (await api(t, "/api/game/state")).json;
const s0 = await state();
const copies0 = (s0.ownedCards ?? []).length;
check("estado inicial: 6.000 créditos", s0.credits === 6000, s0.credits);

for (const id of ["ewc", "china"]) {
  const r = await api(t, "/api/game/packs", { action: "buy", packId: id, ref: `p31-${id}-${Date.now()}` }, true);
  check(`${id}: con 6.000 de saldo el servidor RECHAZA (precio nuevo ${getPack(id)!.price}); sin cobro`, r.status === 409 && (await state()).credits === 6000, { st: r.status, err: r.json?.error });
}
const g = `p31-buy-${Date.now()}`;
const b1 = await api(t, "/api/game/packs", { action: "buy", packId: PACK, ref: g }, true);
const b2 = await api(t, "/api/game/packs", { action: "buy", packId: PACK, ref: g }, true);
const s1 = await state();
const price = getPack(PACK)!.price;
check(`comprar ${PACK} cobra EXACTAMENTE ${price} una sola vez (mismo gesto repetido)`, b1.status === 200 && b2.status === 200 && s1.credits === 6000 - price && (s1.unopenedPacks?.[PACK] ?? 0) === 1, { b1: b1.status, b2: b2.status, c: s1.credits });
const og = `p31-open-${Date.now()}`;
const [o1, race] = await Promise.all([
  api(t, "/api/game/packs", { action: "open", packId: PACK, ref: og }, true),
  api(t, "/api/game/packs", { action: "open", packId: PACK, ref: `${og}-b` }, true),
]);
const winner = o1.status === 200 ? o1 : race;
check("doble apertura simultánea con 1 sobre: una gana, la otra 409", [o1.status, race.status].sort().join(",") === "200,409", [o1.status, race.status]);
const opened = (winner.json?.opened ?? []) as { uid: string; cardId: string }[];
check(`abrir ${PACK}: ${getPack(PACK)!.cardCount} cartas del servidor`, opened.length === getPack(PACK)!.cardCount, opened.length);
const pp = packClassPools(getPack(PACK)!);
const eligible = new Set(PACK_CLASS_ORDER.flatMap((k) => pp.pools[k].map((c) => c.id)));
check("TODAS las cartas pertenecen al pool del sobre (región/equipo)", opened.every((x) => eligible.has(x.cardId)), opened.map((x) => x.cardId));
const winRef = o1.status === 200 ? og : `${og}-b`;
const again = await api(t, "/api/game/packs", { action: "open", packId: PACK, ref: winRef }, true);
check("mismo gesto (F5/reintento): MISMAS cartas, marcado repetido", again.status === 200 && JSON.stringify((again.json?.opened ?? []).map((x: { uid: string }) => x.uid)) === JSON.stringify(opened.map((x) => x.uid)) && again.json?.repeated === true, { st: again.status, rep: again.json?.repeated });
const sEnd = await state();
check(`inventario y saldo exactos: +${opened.length} copias, ${6000 - price} créditos, 0 sobres de ${PACK}`, sEnd.ownedCards.length === copies0 + opened.length && sEnd.credits === 6000 - price && (sEnd.unopenedPacks?.[PACK] ?? 0) === 0, { copies: sEnd.ownedCards.length, c: sEnd.credits });
console.log("cartas:", opened.map((x) => x.cardId).join(", "));
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
