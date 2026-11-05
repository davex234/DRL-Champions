/**
 * PRE-F70 · 0058 — contrato de `profiles` por REST (solo lectura, fuera de CI). Imprime SOLO estado HTTP, nº de filas
 * y NOMBRES de columnas; nunca valores. Cuentas QA (C actor, B víctima). Uso: npx tsx scripts/_pre70-0058-rest.ts <etiqueta>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { creds, token } from "./_fase68-lib";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_0-9]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const SB = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
async function rest(t: string | null, path: string) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: ANON, ...(t ? { authorization: `Bearer ${t}` } : {}), Prefer: "count=exact" } });
  const body = await r.json().catch(() => null);
  const rows = Array.isArray(body) ? body : [];
  return { status: r.status, rows: rows.length, total: r.headers.get("content-range")?.split("/")[1] ?? null, columns: rows[0] ? Object.keys(rows[0]).sort() : [], code: Array.isArray(body) ? null : (body as { code?: string } | null)?.code ?? null };
}
/** Claves CON VALOR (no nulo) a cualquier profundidad de una respuesta JSON; nunca los valores. */
function keysDeep(v: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, acc));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (x !== null && x !== undefined) acc.add(k); keysDeep(x, acc); }
  return acc;
}
const PRIVATE = ["credits", "is_admin", "isAdmin", "last_seen_at", "lastSeenAt", "tokens", "taxes_paid", "equipped", "market_volume", "email"];
async function apiContract(tC: string, B: string, C: string) {
  const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3005";
  const get = async (t: string | null, path: string) => {
    const r = await fetch(`${BASE}${path}`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
    const j = await r.json().catch(() => null);
    const keys = [...keysDeep(j)];
    return { status: r.status, privateKeys: PRIVATE.filter((k) => keys.includes(k)), keyCount: keys.length };
  };
  const me = await fetch(`${BASE}/api/game/me`, { headers: { authorization: `Bearer ${tC}` } });
  const mej = (await me.json().catch(() => null)) as { profile?: Record<string, unknown> } | null;
  return {
    selfMe: { status: me.status, ownRow: mej?.profile?.id === C, columns: Object.keys(mej?.profile ?? {}).sort(), hasPrivateOwn: ["credits", "xp", "is_admin"].every((k) => k in (mej?.profile ?? {})) },
    meAnon: (await fetch(`${BASE}/api/game/me`)).status,
    publicProfileOfB_byC: await get(tC, `/api/game/player?id=${B}`),
    publicProfileOfB_anon: await get(null, `/api/game/player?id=${B}`),
    socialOfB_byC: await get(tC, `/api/game/social?player=${B}`),
  };
}

(async () => {
  const label = process.argv[2] ?? "run";
  const tC = await token("C"); const B = creds("B").userId; const C = creds("C").userId;
  const out = {
    label, at: new Date().toISOString(),
    anon: {
      selectAll: await rest(null, "profiles?select=*&limit=1"),
      selectPublic: await rest(null, "profiles?select=id,username&limit=1"),
      selectCredits: await rest(null, "profiles?select=credits&limit=1"),
      rankingPoints: await rest(null, "ranking_points?select=*&limit=1"),
      legacyRankingCollection: await rest(null, "ranking_collection?select=*&limit=1"),
    },
    otherUser: {
      selectAllOfB: await rest(tC, `profiles?select=*&id=eq.${B}`),
      publicOfB: await rest(tC, `profiles?select=id,username,avatar,level,points,region&id=eq.${B}`),
      creditsOfB: await rest(tC, `profiles?select=credits&id=eq.${B}`),
      isAdminOfB: await rest(tC, `profiles?select=is_admin&id=eq.${B}`),
      lastSeenOfB: await rest(tC, `profiles?select=last_seen_at&id=eq.${B}`),
      xpOfB: await rest(tC, `profiles?select=xp&id=eq.${B}`),
      countByPoints: await rest(tC, "profiles?select=id&points=gt.0&limit=1"),
    },
    selfRest: { ownPrivateByRest: await rest(tC, `profiles?select=credits,is_admin&id=eq.${C}`), ownPublic: await rest(tC, `profiles?select=id,username,points,region&id=eq.${C}`) },
    api: await apiContract(tC, B, C),
  };
  const f = `docs/product/qa/pre-f70-0058/raw/rest-${label}.json`;
  writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
