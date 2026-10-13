// F79.2 · aislamiento en producción: perfil PÚBLICO de otro (sin datos privados), colección propia, RLS de inventario/Forja.
import { readFileSync } from "node:fs";
import { api, login } from "./_f79-2-lib";
/* eslint-disable @typescript-eslint/no-explicit-any */
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
let ok = 0, n = 0; const check = (id: string, c: boolean, d: unknown = "") => { n++; if (c) ok++; console.log(`${c ? "PASS" : "FAIL"} ${id} ${JSON.stringify(d).slice(0, 180)}`); };
(async () => {
  const [C, A] = [await login("C"), await login("A")];
  const pub = await api(C, `/api/game/player?id=${A.userId}`);
  const txt = JSON.stringify(pub.json);
  check("PERFIL PÚBLICO de otro: 200 y SIN bloque self, créditos, email ni is_admin", pub.status === 200 && !(pub.json as any).self && !/"credits"|@example\.invalid|"is_admin"|"email"/.test(txt), { status: pub.status, keys: Object.keys(pub.json as any) });
  const rest = (path: string) => fetch(`${process.env.BASE_URL}/rest/v1/${path}`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${C.token}` } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => null) }));
  const uc = await rest(`user_cards?select=uid&user_id=eq.${A.userId}&limit=5`);
  check("RLS · C no ve el inventario de A por REST", uc.s === 200 ? Array.isArray(uc.j) && uc.j.length === 0 : uc.s >= 400, uc.s);
  const ops = await rest(`economy_ops?select=ref&user_id=eq.${A.userId}&limit=5`);
  check("RLS · C no ve el libro mayor de A", ops.s === 200 ? Array.isArray(ops.j) && ops.j.length === 0 : ops.s >= 400, ops.s);
  const fc = await rest("forge_config?select=id");
  check("RLS · forge_config cerrada al navegador (sesión de jugador)", fc.s >= 400, fc.s);
  const favs = await rest(`user_card_favorites?select=card_id&user_id=eq.${A.userId}`);
  check("RLS · favoritas de A invisibles para C", favs.s === 200 ? Array.isArray(favs.j) && favs.j.length === 0 : favs.s >= 400, favs.s);
  const rpc = await fetch(`${process.env.BASE_URL}/rest/v1/rpc/app_salvage_cards_guarded`, { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${C.token}`, "content-type": "application/json" }, body: JSON.stringify({ p_user: A.userId, p_uids: [], p_total: 0, p_ref: "x", p_confirm: [] }) });
  check("RLS · un jugador NO puede llamar a la RPC guardada (solo service_role)", rpc.status === 401 || rpc.status === 403 || rpc.status === 404, rpc.status);
  const forgeOther = await api(C, `/api/game/forge?userId=${A.userId}`);
  const fj = JSON.stringify(forgeOther.json);
  check("Forja · la foto es SIEMPRE la del token (un userId en la URL no cambia nada)", forgeOther.status === 200 && !fj.includes(A.userId), forgeOther.status);
  console.log(`\n${ok}/${n}`);
})();
