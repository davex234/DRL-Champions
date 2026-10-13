/**
 * ARTEFACTOS DE CARTA — `npm run card-artifacts:verify`
 *
 * La exportación que este bloque añade es pequeña a propósito: sirve la fila de
 * `content_card_versions` como fichero. Lo que hay que demostrar, entonces, no es que
 * «funcione un botón», sino las tres cosas que podrían salir mal sin que se note:
 *
 *   1. Que la descarga es de UNA VERSIÓN, y que publicar una v2 **no cambia** el fichero de
 *      la v1. Es el requisito explícito del encargo: los artefactos históricos no se
 *      sobrescriben en silencio.
 *   2. Que solo entra un administrador. Conocer la URL no puede bastar.
 *   3. Que no se ha inventado un generador: lo servido es EXACTAMENTE lo guardado.
 *
 * Lo que crea, lo borra.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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

let pass = 0, fail = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const title = (t: string): void => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 62 - t.length))}`);

const cuentas: string[] = [];
const cartas: string[] = [];

async function cuenta(tag: string, esAdmin: boolean) {
  const email = `artefacto-${tag}-${randomUUID()}@nexus.test`;
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

const bajar = (cardId: string, version: number, token: string | null) =>
  fetch(`${BASE}/api/admin/cards?cardId=${encodeURIComponent(cardId)}&version=${version}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store",
  });

async function main(): Promise<void> {
  console.log("\n═══ ARTEFACTOS DE CARTA ═══");
  console.log(`  servidor: ${BASE}`);
  const ping = await fetch(`${BASE}/`, { cache: "no-store" }).then((r) => r.status).catch(() => 0);
  if (ping === 0) { console.error(`\n  ✕ No hay servidor en ${BASE}.\n`); process.exit(1); }

  const admin = await cuenta("admin", true);
  const jugador = await cuenta("jugador", false);

  // ── Una carta con DOS versiones, que es donde está el riesgo ──
  title("UNA CARTA CON DOS VERSIONES");
  const { data: cands } = await db.from("content_cards").select("player_id, variant_id");
  const porJugador = new Map<string, Set<string>>();
  for (const r of ((cands ?? []) as { player_id: string; variant_id: string }[])) {
    const s = porJugador.get(r.player_id) ?? new Set<string>();
    s.add(r.variant_id); porJugador.set(r.player_id, s);
  }
  const elegido = [...porJugador.entries()].find(([, vs]) => !vs.has("gold"))?.[0];
  if (!elegido) throw new Error("no hay jugador sin variante gold");

  const alta = await post<{ cardId: string; error?: string }>("create",
    { playerId: elegido, variantId: "gold", reason: "verificación de artefactos" }, admin.token);
  check("se crea una carta desde el panel", alta.status === 200, alta.data.error ?? alta.data.cardId);
  if (alta.status !== 200) throw new Error("sin carta no hay artefacto");
  const CARTA = alta.data.cardId;
  cartas.push(CARTA);
  await post("lifecycle", { cardId: CARTA, state: "PUBLISHED", reason: "publicar" }, admin.token);

  const { data: def1 } = await db.from("content_cards").select("combat, ovr").eq("card_id", CARTA).maybeSingle();
  const base = (def1 as { combat: { stronghold: number; gamesense: number; entryfrag: number }; ovr: number });
  const ovrV1 = base.ovr;

  // La descarga de la v1, ANTES de que exista la v2.
  const r1Antes = await bajar(CARTA, 1, admin.token);
  const jsonV1Antes = await r1Antes.text();
  check("la definición de la v1 se descarga", r1Antes.status === 200, `${jsonV1Antes.length} bytes`);
  check("y llega como fichero con su nombre",
    (r1Antes.headers.get("content-disposition") ?? "").includes(`${CARTA}.v1.json`),
    r1Antes.headers.get("content-disposition") ?? "(sin cabecera)");

  // Se publica la v2.
  const pub = await post<{ version?: number }>("publish", {
    cardId: CARTA, combat: { ...base.combat, gamesense: Math.max(1, base.combat.gamesense - 6) },
    reason: "segunda versión", expectedVersion: 1,
  }, admin.token);
  check("se publica una segunda versión", pub.status === 200, `v${pub.data.version}`);

  // ── EL REQUISITO: la v1 no se ha movido ──
  title("PUBLICAR UNA v2 NO REESCRIBE EL ARTEFACTO DE LA v1");
  const r1Despues = await bajar(CARTA, 1, admin.token);
  const jsonV1Despues = await r1Despues.text();
  check("la v1 se sigue pudiendo descargar", r1Despues.status === 200);
  /*
   * LA COMPROBACIÓN, DICHA CON PRECISIÓN.
   *
   * La primera versión de esto exigía que el fichero de la v1 fuera idéntico byte a byte, y
   * fallaba. El motivo NO era una sobrescritura: al publicar la v2, la v1 cierra su ventana
   * de vigencia y `effective_to` pasa de `null` a una fecha. Eso es registrar historia, no
   * perderla — y el trigger de inmutabilidad de 8.2 lo dice explícitamente: protege 16 de las
   * 19 columnas, todas las definitorias, y deja fuera `effective_to`, `created_by` y `reason`.
   *
   * Lo que el encargo pide es que no se sobrescriba el ARTEFACTO: que lo que describe a la
   * carta —OVR, trío, estadísticas, rareza, calibración, huella— siga siendo lo que era. Eso
   * es lo que se comprueba, campo a campo, y aparte se comprueba que lo ÚNICO que se movió
   * fue la ventana.
   */
  const a = JSON.parse(jsonV1Antes) as Record<string, unknown>;
  const b = JSON.parse(jsonV1Despues) as Record<string, unknown>;
  const DEFINITORIAS = [
    "card_id", "version", "player_id", "variant_id", "ovr", "combat", "stats",
    "stat_boost", "rarity_rank", "rarity_bucket", "data_version", "source",
    "generated_at", "checksum", "effective_from", "created_at",
  ] as const;
  const movidas = DEFINITORIAS.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  check("la definición de la v1 no se ha movido ni un campo", movidas.length === 0,
    movidas.length ? `cambiaron: ${movidas.join(", ")}` : `${DEFINITORIAS.length} campos idénticos`);

  const distintas = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  check("y lo único que cambia es que su ventana de vigencia se cierra",
    distintas.length === 1 && distintas[0] === "effective_to",
    `${distintas.join(", ") || "nada"} · ${a.effective_to ?? "null"} → ${String(b.effective_to).slice(0, 19)}`);

  const r2 = await bajar(CARTA, 2, admin.token);
  const jsonV2 = await r2.text();
  check("la v2 tiene su propio artefacto", r2.status === 200,
    (r2.headers.get("content-disposition") ?? "").includes(`${CARTA}.v2.json`) ? `${CARTA}.v2.json` : "");
  check("y son distintos: dos versiones, dos ficheros", jsonV1Despues !== jsonV2,
    `v1 ovr ${JSON.parse(jsonV1Despues).ovr} · v2 ovr ${JSON.parse(jsonV2).ovr}`);
  check("el OVR de la v1 sigue siendo el original", JSON.parse(jsonV1Despues).ovr === ovrV1,
    `${JSON.parse(jsonV1Despues).ovr}`);

  // ── No se ha inventado nada: lo servido es lo guardado ──
  title("NO SE GENERA NADA: SE SIRVE LO QUE HAY");
  const { data: fila } = await db.from("content_card_versions")
    .select("*").eq("card_id", CARTA).eq("version", 1).maybeSingle();
  check("el fichero es la fila de content_card_versions, campo a campo",
    JSON.stringify(fila) === JSON.stringify(JSON.parse(jsonV1Despues)), "idéntico");

  // ── Seguridad ──
  title("SEGURIDAD");
  check("sin sesión, la descarga se rechaza", (await bajar(CARTA, 1, null)).status === 401, "401");
  check("con sesión de jugador normal, también",
    (await bajar(CARTA, 1, jugador.token)).status === 401, "401");
  check("conocer la URL no basta: el guardia es el mismo que el del resto del panel",
    (await bajar(CARTA, 1, null)).status === 401 && (await bajar(CARTA, 1, admin.token)).status === 200,
    "verifyAdmin");
  check("una versión inexistente da 404, no un fichero vacío",
    (await bajar(CARTA, 99, admin.token)).status === 404, "404");
  check("una carta inexistente da 404",
    (await bajar("no-existe__gold", 1, admin.token)).status === 404, "404");
  check("sin parámetros, 400", (await bajar("", 1, admin.token)).status === 400, "400");
}

async function limpiar(): Promise<void> {
  const restos: string[] = [];
  for (const cardId of cartas) {
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
  console.log(`\n  limpieza: ${cuentas.length} cuentas · ${cartas.length} cartas purgadas · ${count} definiciones`);
  check("la verificación no deja nada suyo detrás", restos.length === 0 && count === 773,
    restos.length ? restos.join(" | ") : `${count} definiciones`);
}

main()
  .catch((e) => { console.error("\n✕ Verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar().catch((e) => { console.error("  ✕ limpieza:", e); fail++; });
    console.log("\n" + "─".repeat(66));
    console.log(`  ${pass} correctas · ${fail} fallidas`);
    console.log(fail === 0
      ? "  ✅ CADA VERSIÓN TIENE SU ARTEFACTO Y NINGUNA PISA A LA ANTERIOR"
      : "  ❌ LOS ARTEFACTOS DE CARTA TIENEN FALLOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
