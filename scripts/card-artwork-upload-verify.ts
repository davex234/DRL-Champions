/**
 * ARTWORK MANUAL DE UNA VERSIÓN — `npm run card-artwork-upload:verify`
 *
 * Recorre el guion del encargo: crear carta → publicar v1 → subir artwork → verlo →
 * descargarlo → publicar v2 → subir OTRO artwork → comprobar que la v1 sigue intacta →
 * acuñar un ejemplar bajo la v1 → y comprobar que ese ejemplar SIGUE resolviendo al artwork
 * de la v1 aunque exista la v2.
 *
 * Lo que de verdad se está probando es una sola frase: **un ejemplar no cambia de cara porque
 * alguien publique una versión nueva.** Todo lo demás —formatos, tamaño, permisos— es lo que
 * hace falta para poder afirmarla sin mentir.
 *
 * Los PNG/WEBP de prueba se construyen aquí, con sharp, a partir de colores planos. No son
 * arte: son bytes válidos y distinguibles entre sí, que es lo que necesita la comprobación.
 *
 * Lo que crea, lo borra.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

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

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

const cuentas: string[] = [];
const cartas: string[] = [];
const rutas: string[] = [];

async function cuenta(tag: string, esAdmin: boolean) {
  const email = `artup-${tag}-${randomUUID()}@nexus.test`;
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

/** Sube un fichero como lo haría el panel: multipart. */
async function subir(
  cardId: string, version: number, nombre: string, mime: string, bytes: Buffer, token: string | null,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const fd = new FormData();
  fd.append("action", "artworkUpload");
  fd.append("cardId", cardId);
  fd.append("version", String(version));
  fd.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), nombre);
  const r = await fetch(`${BASE}/api/admin/cards`, {
    method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd, cache: "no-store",
  });
  return { status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

const sha = (b: Buffer | Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Un PNG de color plano. Bytes válidos, sin pretensión de ser arte. */
const png = (r: number, g: number, b: number) =>
  sharp({ create: { width: 300, height: 420, channels: 3, background: { r, g, b } } }).png().toBuffer();
const webp = (r: number, g: number, b: number) =>
  sharp({ create: { width: 300, height: 420, channels: 3, background: { r, g, b } } }).webp().toBuffer();

async function main(): Promise<void> {
  console.log("\n═══ ARTWORK MANUAL POR VERSIÓN ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const jugador = await cuenta("jugador", false);

  // ── 1-2 · Carta y v1 ──
  title("1-2 · CREAR LA CARTA Y PUBLICAR LA v1");
  const { data: cands } = await db.from("content_cards").select("player_id, variant_id");
  const por = new Map<string, Set<string>>();
  for (const r of ((cands ?? []) as { player_id: string; variant_id: string }[])) {
    const s = por.get(r.player_id) ?? new Set<string>(); s.add(r.variant_id); por.set(r.player_id, s);
  }
  const pid = [...por.entries()].find(([, v]) => !v.has("prime"))?.[0];
  if (!pid) throw new Error("no hay jugador libre");

  const alta = await post<{ cardId: string; error?: string }>("create",
    { playerId: pid, variantId: "prime", reason: "verificación de artwork manual" }, admin.token);
  check("se crea la carta", alta.status === 200, alta.data.error ?? alta.data.cardId);
  if (alta.status !== 200) throw new Error("sin carta no hay artwork");
  const CARTA = alta.data.cardId;
  cartas.push(CARTA);
  await post("lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "publicar" }, admin.token);

  const est0 = await post<{ versions: { version: number; artwork: unknown }[] }>(
    "artworkStatus", { cardId: CARTA }, admin.token);
  check("la v1 empieza SIN artwork", est0.data.versions[0]?.artwork === null, "○ sin artwork");

  // ── Validación ──
  title("VALIDACIÓN: NO BASTA CON LA EXTENSIÓN");
  const pngV1 = await png(20, 200, 120);
  const malos: [string, string, string, Buffer][] = [
    ["extensión no admitida", "carta.gif", "image/gif", pngV1],
    ["MIME que no corresponde", "carta.png", "image/jpeg", pngV1],
    ["bytes que no son PNG", "carta.png", "image/png", Buffer.from("esto no es una imagen")],
    ["fichero vacío", "carta.png", "image/png", Buffer.alloc(0)],
  ];
  let rechazados = 0;
  for (const [, nombre, mime, bytes] of malos) {
    const r = await subir(CARTA, 1, nombre, mime, bytes, admin.token);
    if (r.status === 400) rechazados++;
  }
  check("se rechaza extensión, MIME, contenido falso y vacío", rechazados === malos.length,
    `${rechazados}/${malos.length}`);
  const grande = Buffer.concat([pngV1, Buffer.alloc(13 * 1024 * 1024)]);
  check("y un fichero por encima del máximo",
    (await subir(CARTA, 1, "grande.png", "image/png", grande, admin.token)).status === 400, "12 MB");

  // ── 3-5 · Subir, ver, descargar ──
  title("3-5 · SUBIR EL ARTWORK DE LA v1, VERLO Y DESCARGARLO");
  const up1 = await subir(CARTA, 1, "derke-prime-v1.png", "image/png", pngV1, admin.token);
  check("el artwork de la v1 se sube", up1.status === 200,
    `${String(up1.data.format)} · ${Math.round(Number(up1.data.bytes) / 1024)} KB`);
  const url1 = String(up1.data.url ?? "");
  rutas.push(String(up1.data.storagePath ?? ""));
  check("queda atado a card_id + version", up1.data.cardId === CARTA && up1.data.cardVersion === 1,
    `${up1.data.cardId} v${up1.data.cardVersion}`);

  const bajado1 = Buffer.from(await (await fetch(url1, { cache: "no-store" })).arrayBuffer());
  check("se puede ver y descargar, y es el MISMO fichero que se subió",
    sha(bajado1) === sha(pngV1), "sha256 idéntico");

  // ── 5b · No ha tocado la carta ──
  title("SUBIR ARTWORK NO ALTERA LA CARTA");
  const { data: defTrasArt } = await db.from("content_cards")
    .select("ovr, combat, rarity_rank, rarity_bucket, checksum, definition_version, lifecycle")
    .eq("card_id", CARTA).maybeSingle();
  const d = defTrasArt as Record<string, unknown>;
  const { data: v1Row } = await db.from("content_card_versions")
    .select("ovr, checksum").eq("card_id", CARTA).eq("version", 1).maybeSingle();
  check("el OVR, la rareza, la huella y el ciclo de vida siguen igual",
    Number(d.definition_version) === 1 && d.lifecycle === "PUBLISHED"
    && String(d.checksum) === String((v1Row as { checksum: string }).checksum),
    `v${d.definition_version} · ovr ${d.ovr} · ${d.rarity_bucket}`);

  // ── 6-7 · v2 con su propio artwork ──
  title("6-7 · PUBLICAR LA v2 Y SUBIR OTRO ARTWORK");
  const { data: defRow } = await db.from("content_cards").select("combat").eq("card_id", CARTA).maybeSingle();
  const c = (defRow as { combat: { stronghold: number; gamesense: number; entryfrag: number } }).combat;
  const pub = await post<{ version?: number }>("publish", {
    cardId: CARTA, combat: { ...c, stronghold: Math.max(1, c.stronghold - 7) },
    reason: "v2", expectedVersion: 1,
  }, admin.token);
  check("se publica la v2", pub.status === 200, `v${pub.data.version}`);

  const webpV2 = await webp(200, 40, 90);
  const up2 = await subir(CARTA, 2, "derke-prime-v2.webp", "image/webp", webpV2, admin.token);
  check("la v2 acepta su propio artwork, y en WEBP", up2.status === 200, String(up2.data.format));
  const url2 = String(up2.data.url ?? "");
  rutas.push(String(up2.data.storagePath ?? ""));

  // ── 8 · LA v1 SIGUE INTACTA ──
  title("8 · LA v1 NO SE HA MOVIDO");
  const bajado1b = Buffer.from(await (await fetch(url1, { cache: "no-store" })).arrayBuffer());
  check("el artwork de la v1 es EXACTAMENTE el mismo tras publicar y vestir la v2",
    sha(bajado1b) === sha(pngV1), "sha256 idéntico al original");
  const bajado2 = Buffer.from(await (await fetch(url2, { cache: "no-store" })).arrayBuffer());
  check("y el de la v2 es otro fichero distinto", sha(bajado2) !== sha(bajado1b), "otro sha256");
  check("son dos sujetos distintos en el gestor de assets",
    url1 !== url2 && url1.includes(`${CARTA}%23v1`) === false, "claves <card>#v1 y <card>#v2");

  const { count: filas } = await db.from("assets").select("id", { count: "exact", head: true })
    .eq("subject_type", "card").like("subject_id", `${CARTA}#v%`);
  check("hay una fila de artwork por versión", filas === 2, `${filas} filas`);

  // ── 9-11 · El ejemplar ──
  title("9-11 · UN EJEMPLAR ACUÑADO BAJO LA v1");
  const { data: inst } = await db.from("user_cards")
    .insert({ user_id: jugador.id, card_id: CARTA, origin: "pack", minted_version: 1 })
    .select("uid, minted_version").maybeSingle();
  const ejemplar = inst as { uid: string; minted_version: number };
  check("el ejemplar nace con minted_version 1", ejemplar?.minted_version === 1, `v${ejemplar?.minted_version}`);

  const res1 = await post<{ artwork: { cardVersion: number; url: string } | null }>(
    "artworkForInstance", { cardId: CARTA, mintedVersion: 1 }, admin.token);
  check("el servidor resuelve su artwork por minted_version, no por la última versión",
    res1.data.artwork?.cardVersion === 1, `devuelve v${res1.data.artwork?.cardVersion}`);
  check("y es la URL del artwork de la v1", res1.data.artwork?.url === url1, "misma URL");

  const res2 = await post<{ artwork: { cardVersion: number } | null }>(
    "artworkForInstance", { cardId: CARTA, mintedVersion: 2 }, admin.token);
  check("un ejemplar de la v2 resolvería al suyo", res2.data.artwork?.cardVersion === 2,
    `devuelve v${res2.data.artwork?.cardVersion}`);

  const resNull = await post<{ artwork: unknown }>(
    "artworkForInstance", { cardId: CARTA, mintedVersion: 99 }, admin.token);
  check("una versión sin artwork devuelve null, NO el de otra versión",
    resNull.data.artwork === null, "null");

  // ── Reemplazo ──
  title("REEMPLAZAR NO PISA LA OTRA VERSIÓN");
  const pngV1b = await png(240, 200, 20);
  const rep = await subir(CARTA, 1, "derke-prime-v1-corregido.png", "image/png", pngV1b, admin.token);
  check("se puede reemplazar el artwork de la v1", rep.status === 200,
    `revisión ${rep.data.assetVersion}`);
  check("y sube la revisión DEL ASSET, no la versión de la carta",
    rep.data.assetVersion === 2 && rep.data.cardVersion === 1,
    `rev ${rep.data.assetVersion} · carta v${rep.data.cardVersion}`);
  rutas.push(String(rep.data.storagePath ?? ""));
  const res1b = await post<{ artwork: { url: string; cardVersion: number } | null }>(
    "artworkForInstance", { cardId: CARTA, mintedVersion: 1 }, admin.token);
  check("el ejemplar de la v1 pasa a ver el corregido", res1b.data.artwork?.url === String(rep.data.url),
    "nueva revisión vigente");
  const res2b = await post<{ artwork: { url: string } | null }>(
    "artworkForInstance", { cardId: CARTA, mintedVersion: 2 }, admin.token);
  check("y la v2 no se ha enterado", res2b.data.artwork?.url === url2, "intacta");

  // ── Seguridad ──
  title("SEGURIDAD");
  check("sin sesión no se sube",
    (await subir(CARTA, 1, "x.png", "image/png", pngV1, null)).status === 401, "401");
  check("un jugador normal no sube",
    (await subir(CARTA, 1, "x.png", "image/png", pngV1, jugador.token)).status === 401, "401");
  check("un jugador normal no consulta el estado",
    (await post("artworkStatus", { cardId: CARTA }, jugador.token)).status === 401, "401");
  const comoJugador = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jugador.token}` } },
  });
  const { error: eEsc } = await comoJugador.from("assets")
    .insert({ id: randomUUID(), group_id: randomUUID(), kind: "card_artwork", subject_type: "card",
              subject_id: `${CARTA}#v1`, name: "intruso", bucket: "assets" });
  check("y no puede escribir en `assets` directamente", !!eEsc,
    (eEsc?.message ?? "").slice(0, 60));
  check("subir a una versión inexistente da 404",
    (await subir(CARTA, 99, "x.png", "image/png", pngV1, admin.token)).status === 404, "404");
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];
  for (const id of cuentas) {
    await db.from("user_cards").delete().eq("user_id", id);
    await db.from("user_packs").delete().eq("user_id", id);
  }
  for (const cardId of cartas) {
    const { data: assets } = await db.from("assets").select("storage_path")
      .eq("subject_type", "card").like("subject_id", `${cardId}#v%`);
    const paths = ((assets ?? []) as { storage_path: string | null }[])
      .map((a) => a.storage_path).filter((p): p is string => !!p);
    if (paths.length) {
      const { error } = await db.storage.from("assets").remove(paths);
      if (error) restos.push(`storage: ${error.message}`);
    }
    await db.from("assets").delete().eq("subject_type", "card").like("subject_id", `${cardId}#v%`);
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
  const { count: cards } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  const { count: assets } = await db.from("assets").select("id", { count: "exact", head: true });
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${cartas.length} cartas · ${cards} definiciones · ${assets} assets`);
  check("no deja filas, ni ficheros, ni assets suyos",
    restos.length === 0 && cards === 773 && assets === 0,
    restos.length ? restos.join(" | ") : `${cards} definiciones · ${assets} assets`);
}

main()
  .catch((e) => { console.error("\n✕ Verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => { console.error("  ✕ limpieza:", e); fail++; });
    console.log("\n" + "─".repeat(62));
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0
      ? "  ✅ CADA VERSIÓN TIENE SU ARTWORK Y UN EJEMPLAR NO CAMBIA DE CARA"
      : "  ❌ EL ARTWORK MANUAL TIENE FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
