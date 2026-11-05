/**
 * IMAGEN DE UNA VERSIÓN DE CARTA — `npm run card-artwork:verify`
 *
 * Lo que hay que demostrar no es que «salga un PNG», sino las cuatro cosas que podrían
 * romperse sin que nadie lo note:
 *
 *   1. Que la imagen sale de una carta REAL del panel, no de un fixture.
 *   2. Que la v2 NO pisa la v1. Es el requisito duro del encargo.
 *   3. Que generar dos veces no rehace nada (idempotencia), porque si rehiciera, cada
 *      pulsación cambiaría ficheros que alguien podría haber distribuido ya.
 *   4. Que los binarios están protegidos: viven fuera de `public/` y solo los sirve el panel.
 *
 * Y una quinta que es de honestidad: se CUENTA cuántos elementos se han sustituido por el
 * marcador oficial. Sin fotos de jugador el render se hace igual, pero decir «disponible»
 * sin decir «a medio vestir» sería vender un artefacto que no está terminado.
 *
 * Lo que crea, lo borra.
 */
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });

const ARTWORK_ROOT = join(ROOT, "output", "artwork", "admin");

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`);

const cuentas: string[] = [];
const cartas: string[] = [];

async function cuenta(tag: string, esAdmin: boolean) {
  const email = `artwork-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  if (esAdmin) await db.from("profiles").update({ is_admin: true }).eq("id", data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, token: s.data.session.access_token };
}

const post = <T,>(action: string, body: Record<string, unknown>, token: string) =>
  fetch(`${BASE}/api/admin/cards`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }), cache: "no-store",
  }).then(async (r) => ({ status: r.status, data: (await r.json().catch(() => ({}))) as T }));

const bajar = (cardId: string, version: number, artifact: string | null, token: string | null) =>
  fetch(`${BASE}/api/admin/cards?cardId=${encodeURIComponent(cardId)}&version=${version}`
        + (artifact ? `&artifact=${artifact}` : ""),
    { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });

const sha = (b: Buffer | Uint8Array): string => createHash("sha256").update(b).digest("hex");

async function main(): Promise<void> {
  console.log("\n═══ IMAGEN DE UNA VERSIÓN DE CARTA ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const jugador = await cuenta("jugador", false);

  // ── Una carta REAL, creada por el panel ──
  title("UNA CARTA CREADA DESDE EL PANEL");
  const { data: cands } = await db.from("content_cards").select("player_id, variant_id");
  const por = new Map<string, Set<string>>();
  for (const r of ((cands ?? []) as { player_id: string; variant_id: string }[])) {
    const s = por.get(r.player_id) ?? new Set<string>(); s.add(r.variant_id); por.set(r.player_id, s);
  }
  const pid = [...por.entries()].find(([, v]) => !v.has("icon-series"))?.[0];
  if (!pid) throw new Error("no hay jugador libre");

  const alta = await post<{ cardId: string; error?: string }>("create",
    { playerId: pid, variantId: "icon-series", reason: "verificación de artwork" }, admin.token);
  check("se crea la carta", alta.status === 200, alta.data.error ?? alta.data.cardId);
  if (alta.status !== 200) throw new Error("sin carta no hay artwork");
  const CARTA = alta.data.cardId;
  cartas.push(CARTA);
  await post("lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "publicar" }, admin.token);

  // ── Antes de generar, no hay nada ──
  // `artworkStatus` devuelve por versión el artwork MANUAL y, aparte, el render técnico.
  // Aquí solo interesa el render: este verificador cubre el renderizador, no la subida.
  const estado0 = await post<{ versions: { version: number; render: { generated: boolean } }[] }>(
    "artworkStatus", { cardId: CARTA }, admin.token);
  check("antes de generar, la v1 figura como NO generada",
    estado0.data.versions[0]?.render.generated === false, "sin imagen");
  check("y descargar el PNG da 404, no un fichero vacío",
    (await bajar(CARTA, 1, "png", admin.token)).status === 404, "404");

  // ── Generar la v1 ──
  title("GENERAR LA IMAGEN DE LA v1");
  const t0 = Date.now();
  const g1 = await post<{ files: { kind: string }[]; substituted: number; cached: boolean; error?: string }>(
    "renderArtwork", { cardId: CARTA, version: 1 }, admin.token);
  const ms1 = Date.now() - t0;
  check("la generación responde 200", g1.status === 200, g1.data.error ?? `${ms1} ms`);
  const kinds = (g1.data.files ?? []).map((f) => f.kind);
  check("produce PNG", kinds.includes("png"), kinds.join(" · "));
  check("produce WEBP", kinds.includes("webp"), kinds.join(" · "));
  check("produce miniatura y vista previa",
    kinds.includes("thumbnail") && kinds.includes("preview"), kinds.join(" · "));
  check("y deja manifest.json en la carpeta de la versión",
    existsSync(join(ARTWORK_ROOT, CARTA, "v1", "manifest.json")), "manifest.json");
  check("se declara cuántos elementos usan el marcador oficial",
    typeof g1.data.substituted === "number",
    `${g1.data.substituted} sustituidos (sin fotos de jugador en public/players)`);

  // ── Descarga real ──
  title("DESCARGA");
  const rPng = await bajar(CARTA, 1, "png", admin.token);
  const png1 = Buffer.from(await rPng.arrayBuffer());
  check("el PNG se descarga", rPng.status === 200, `${Math.round(png1.length / 1024)} KB`);
  check("y es un PNG de verdad (firma en la cabecera)",
    png1.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "‰PNG");
  check("llega con nombre de fichero por versión",
    (rPng.headers.get("content-disposition") ?? "").includes(`${CARTA}.v1.png.png`),
    rPng.headers.get("content-disposition") ?? "");

  const rWebp = await bajar(CARTA, 1, "webp", admin.token);
  const webp1 = Buffer.from(await rWebp.arrayBuffer());
  check("el WEBP se descarga y es WEBP",
    rWebp.status === 200 && webp1.subarray(0, 4).toString("ascii") === "RIFF"
    && webp1.subarray(8, 12).toString("ascii") === "WEBP",
    `${Math.round(webp1.length / 1024)} KB`);

  check("el JSON de la definición sigue funcionando",
    (await bajar(CARTA, 1, null, admin.token)).status === 200, "sin regresión");

  // ── Idempotencia ──
  title("IDEMPOTENCIA");
  const antes = statSync(join(ARTWORK_ROOT, CARTA, "v1", "cards", `${CARTA}.png`)).mtimeMs;
  const t1 = Date.now();
  const g1b = await post<{ cached: boolean }>("renderArtwork", { cardId: CARTA, version: 1 }, admin.token);
  const ms2 = Date.now() - t1;
  check("generar otra vez se reconoce como ya hecho", g1b.data.cached === true,
    `${ms1} ms → ${ms2} ms`);
  const png1b = Buffer.from(await (await bajar(CARTA, 1, "png", admin.token)).arrayBuffer());
  check("y el PNG es EXACTAMENTE el mismo fichero", sha(png1) === sha(png1b), "sha256 idéntico");
  check("no se ha reescrito en disco",
    statSync(join(ARTWORK_ROOT, CARTA, "v1", "cards", `${CARTA}.png`)).mtimeMs === antes, "mtime intacto");

  // ── LA v2 NO PISA A LA v1 ──
  title("LA v2 NO PISA A LA v1");
  const { data: defRow } = await db.from("content_cards").select("combat").eq("card_id", CARTA).maybeSingle();
  const c = (defRow as { combat: { stronghold: number; gamesense: number; entryfrag: number } }).combat;
  const pub = await post<{ version?: number }>("publish", {
    cardId: CARTA, combat: { ...c, entryfrag: Math.max(1, c.entryfrag - 8) },
    reason: "v2 para artwork", expectedVersion: 1,
  }, admin.token);
  check("se publica la v2", pub.status === 200, `v${pub.data.version}`);

  const g2 = await post<{ files: unknown[]; cached: boolean }>("renderArtwork",
    { cardId: CARTA, version: 2 }, admin.token);
  check("se genera la imagen de la v2", g2.status === 200 && (g2.data.files ?? []).length > 0,
    `${(g2.data.files ?? []).length} ficheros`);

  const png2 = Buffer.from(await (await bajar(CARTA, 2, "png", admin.token)).arrayBuffer());
  const png1c = Buffer.from(await (await bajar(CARTA, 1, "png", admin.token)).arrayBuffer());
  check("la v1 sigue descargándose y NO ha cambiado", sha(png1c) === sha(png1),
    "sha256 idéntico al de antes de existir la v2");
  check("la v2 es un fichero DISTINTO", sha(png2) !== sha(png1), "otro sha256");
  check("cada versión vive en su propia carpeta",
    existsSync(join(ARTWORK_ROOT, CARTA, "v1", "cards", `${CARTA}.png`))
    && existsSync(join(ARTWORK_ROOT, CARTA, "v2", "cards", `${CARTA}.png`)),
    `v1/ y v2/`);

  // ── Seguridad ──
  title("SEGURIDAD");
  check("sin sesión no se descarga la imagen",
    (await bajar(CARTA, 1, "png", null)).status === 401, "401");
  check("un jugador normal tampoco",
    (await bajar(CARTA, 1, "png", jugador.token)).status === 401, "401");
  check("un jugador normal no puede generar",
    (await post("renderArtwork", { cardId: CARTA, version: 1 }, jugador.token)).status === 401, "401");
  check("los binarios NO están en public/: el servidor web no los sirve",
    !existsSync(join(ROOT, "public", "artwork")) && ARTWORK_ROOT.includes(join("output", "artwork")),
    "output/artwork/admin/");
  const directo = await fetch(`${BASE}/artwork/admin/${CARTA}/v1/cards/${CARTA}.png`, { cache: "no-store" });
  check("y pedirlos por URL pública da 404", directo.status === 404, `${directo.status}`);
  check("un artefacto inexistente da 404",
    (await bajar(CARTA, 9, "png", admin.token)).status === 404, "404");
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];
  for (const cardId of cartas) {
    try { rmSync(join(ARTWORK_ROOT, cardId), { recursive: true, force: true }); }
    catch (e) { restos.push(`artwork ${cardId}: ${String(e)}`); }
    await db.from("card_mints").delete().eq("card_id", cardId);
    const { error } = await db.rpc("app_content_purge_card", { p_card_id: cardId });
    if (error) restos.push(`purgar ${cardId}: ${error.message}`);
    await db.from("content_audit_log").delete().eq("card_id", cardId);
  }
  await db.rpc("_bump_catalog");
  for (const id of cuentas) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) restos.push(`cuenta ${id}: ${error.message}`);
  }
  const { count } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  const quedan = cartas.filter((c) => existsSync(join(ARTWORK_ROOT, c)));
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${cartas.length} cartas · ${count} definiciones`);
  check("no deja ni ficheros ni filas suyas", restos.length === 0 && quedan.length === 0 && count === 773,
    restos.length ? restos.join(" | ") : `${count} definiciones · 0 carpetas de artwork`);
}

main()
  .catch((e) => { console.error("\n✕ Verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => { console.error("  ✕ limpieza:", e); fail++; });
    console.log("\n" + "─".repeat(64));
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0
      ? "  ✅ CADA VERSIÓN TIENE SU IMAGEN, Y NINGUNA PISA A LA ANTERIOR"
      : "  ❌ LA EXPORTACIÓN DE IMAGEN TIENE FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
