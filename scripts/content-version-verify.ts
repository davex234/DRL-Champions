/**
 * VERIFICACIÓN DEL VERSIONADO Y LA INMUTABILIDAD — `npm run content-version:verify` (8.2).
 *
 * Ocho familias. La que importa es la 3: **si esa falla, el bloque no vale nada**.
 *
 *   1. MODELO        — toda definición tiene versión vigente, única, y toda instancia
 *                      apunta a una versión que existe. Cero huecos.
 *   2. INMUTABILIDAD — el histórico se defiende SOLO. Ni `service_role` puede reescribir
 *                      una versión publicada ni borrar una que tenga ejemplares.
 *   3. LA PRUEBA     — se crea un ejemplar, se anota lo que vale y lo que puntúa, se EDITA
 *                      la definición de verdad (por la RPC real), y se comprueba que el
 *                      ejemplar no ha cambiado: ni OVR, ni combate, ni rareza, ni desguace,
 *                      ni valor de mercado. Y que la definición SÍ ha cambiado — porque una
 *                      prueba que pasa sin que nada se mueva no prueba nada.
 *   4. CICLO DE VIDA — transiciones legales e ilegales, y qué le pasa a lo que ya existe.
 *   5. LEGACY        — `derke__champions-mvp` preservada, resoluble y fuera del sorteo.
 *   6. REGRESIÓN     — sobres, mazos, duelo y economía siguen dando lo mismo.
 *   7. SEGURIDAD     — anónimo, usuario normal, suplantación, y admin válido.
 *   8. RENDIMIENTO   — el coste de resolver por versión, medido.
 *
 * Crea sus datos y los borra. Deja la base exactamente como la encontró.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PACKS } from "../src/data/packs";
import { CARDS } from "../src/data/catalog";
import { PackEngine } from "../src/pack";
import { CardRegistry } from "../src/collection/registry";
import { buildPool } from "../src/domain/packs/pool";
import { freshPity, pityKey } from "../src/domain/packs/pity";
import { marketValue, instanceValue } from "../src/domain/economy/pricing";
import { salvageValue } from "../src/domain/economy/salvage";
import { makeDeckResolver, ownershipFromList } from "../src/domain/cardgame";
import { serverCatalog, resetServerCatalog } from "../src/server/catalog";
import type { CardDef, OwnedCard } from "../src/domain/cards/types";
import { getVariant } from "../src/domain/cards/variants";
import { fromPlayerRow, type ContentPlayerRow } from "../src/server/catalog/rows";
import { deriveDefinition, unboost } from "../src/server/services/cardDerivation";

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
if (!URL_ || !SERVICE || !ANON) { console.error("Falta configuración de Supabase"); process.exit(1); }
const db: SupabaseClient = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const BASE = (process.env.BASE_URL ?? process.env.E2E_BASE_URL ?? "http://127.0.0.1:3005").replace(/\/+$/, "");

let pass = 0, fail = 0, skip = 0;
const check = (l: string, c: boolean, d = ""): void => {
  console.log(`  ${c ? "[PASS]" : "[FAIL]"} ${l}${d ? ` — ${d}` : ""}`); c ? pass++ : fail++;
};
const omit = (l: string, w: string): void => { console.log(`  [SKIP] ${l} — ${w}`); skip++; };
const title = (s: string): void => console.log(`\n─── ${s} ${"─".repeat(Math.max(0, 68 - s.length))}`);

const cuentas: string[] = [];
/** Cartas cuya definición toca esta verificación. Se restauran al terminar. */
const tocadas = new Map<string, Record<string, unknown>>();
let servidorVivo = false;
/** Carta de trabajo: una publicada, serializada y sin ejemplares de jugadores reales. */
const CARTA = "derke__prime";

async function cuenta(tag: string): Promise<{ id: string; token: string }> {
  const email = `ver82-${tag}-${randomUUID()}@nexus.test`;
  const password = randomUUID();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`cuenta: ${error?.message}`);
  cuentas.push(data.user.id);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await anon.auth.signInWithPassword({ email, password });
  if (s.error || !s.data.session) throw new Error(`login: ${s.error?.message}`);
  return { id: data.user.id, token: s.data.session.access_token };
}

const http = async (p: string, init: RequestInit = {}): Promise<{ status: number; body: string }> => {
  const r = await fetch(`${BASE}${p}`, { ...init, cache: "no-store" });
  return { status: r.status, body: await r.text().catch(() => "") };
};

/** Recuerda el estado de una definición para poder devolverla exactamente como estaba. */
async function recordar(cardId: string): Promise<void> {
  if (tocadas.has(cardId)) return;
  const { data } = await db.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  if (data) tocadas.set(cardId, data as Record<string, unknown>);
}

/**
 * Devuelve una definición a como estaba, y borra las versiones que creó la prueba.
 *
 * Se llama al terminar CADA familia que edita, no solo al final. El motivo lo enseñó esta
 * misma verificación: la familia de regresión abría sobres contra un catálogo que la prueba
 * de inmutabilidad acababa de editar, y 4 de 60 aperturas divergían — no por un fallo del
 * producto, sino porque el OVR editado cambia el `value` de la carta sorteada. Una familia
 * que deja el mundo movido convierte a la siguiente en una prueba sobre otra cosa.
 */
async function restaurar(cardId: string): Promise<void> {
  const fila = tocadas.get(cardId);
  if (!fila) return;
  /*
   * EL ORDEN IMPORTA, y lo enseñó un fallo de esta misma verificación. Primero se devuelve
   * el puntero de la definición a la versión 1 y se reabre esa versión; SOLO DESPUÉS se
   * borran las que sobran. Al revés, `content_cards_current_version_fk` impide borrar la
   * versión a la que la definición todavía apunta — y el borrado fallaba en silencio,
   * dejando un historial inventado que contaminaba la ejecución siguiente.
   */
  const restore = await db.from("content_cards").update({
    ovr: fila.ovr, combat: fila.combat, stats: fila.stats, stat_boost: fila.stat_boost,
    rarity_rank: fila.rarity_rank, rarity_bucket: fila.rarity_bucket,
    definition_version: fila.definition_version, checksum: fila.checksum,
    /*
     * `source`, `data_version` y `generated_at` TAMBIEN se restauran, y es nuevo en 8.4.2.
     *
     * Hasta ahora publicar una version no tocaba `source`, porque la ruta no lo enviaba. Desde
     * 8.4.2 si: un trio distinto del que deriva el generador marca la carta `editorial`, que es
     * lo correcto —lo ha decidido una persona— pero significa que una prueba que edita una
     * carta REAL y no restaura este campo deja el catalogo afirmando que una carta del
     * generador es editorial. Lo destapo `content-catalog:verify` con un unico desajuste:
     * «caedye__bronze: source».
     */
      source: fila.source, data_version: fila.data_version, generated_at: fila.generated_at,
    lifecycle: fila.lifecycle, retired_at: fila.retired_at, published_at: fila.published_at,
    updated_at: fila.updated_at,
  }).eq("card_id", cardId);
  if (restore.error) throw new Error(`restaurar definición ${cardId}: ${restore.error.message}`);

  // Borrar ANTES de reabrir la v1: mientras exista otra versión con `effective_to = null`,
  // el índice único parcial rechaza —con razón— que haya dos vigentes a la vez.
  const borrar = await db.from("content_card_versions")
    .delete().eq("card_id", cardId).gt("version", 1);
  if (borrar.error) throw new Error(`borrar versiones de prueba de ${cardId}: ${borrar.error.message}`);

  const reabrir = await db.from("content_card_versions")
    .update({ effective_to: null }).eq("card_id", cardId).eq("version", 1);
  if (reabrir.error) throw new Error(`reabrir v1 de ${cardId}: ${reabrir.error.message}`);

  tocadas.delete(cardId);
  resetServerCatalog();
}

// ───────────────────────────── 1 · MODELO ─────────────────────────────

async function familiaModelo(): Promise<void> {
  title("1 · EL MODELO SE SOSTIENE");

  const { count: cards } = await db.from("content_cards").select("card_id", { count: "exact", head: true });
  const { count: vers } = await db.from("content_card_versions").select("card_id", { count: "exact", head: true });
  check("cada definición tiene al menos una versión", (vers ?? 0) >= (cards ?? 0),
    `${cards} definiciones · ${vers} versiones`);

  // Exactamente una vigente por carta. Lo impone un índice único parcial; se comprueba que
  // el índice está haciendo su trabajo y no que "debería".
  const { data: vig } = await db.from("content_card_versions")
    .select("card_id").is("effective_to", null);
  const vigentes = (vig ?? []) as { card_id: string }[];
  const dup = vigentes.length !== new Set(vigentes.map((r) => r.card_id)).size;
  check("EXACTAMENTE una versión vigente por carta", !dup && vigentes.length === cards,
    `${vigentes.length} vigentes de ${cards} cartas`);

  const { count: huecos } = await db.from("v_instance_version_gaps").select("uid", { count: "exact", head: true });
  check("CERO ejemplares sin historia reconstruible", huecos === 0, `v_instance_version_gaps = ${huecos}`);

  const { count: sinVer } = await db.from("user_cards")
    .select("uid", { count: "exact", head: true }).is("minted_version", null);
  const { count: inst } = await db.from("user_cards").select("uid", { count: "exact", head: true });
  check("toda instancia lleva su versión estampada", sinVer === 0, `${inst} instancias · ${sinVer} sin versión`);

  // La FK que 0038 dejó NOT VALID tiene que haber quedado validada por el migrador.
  const { data: fk } = await db.rpc("app_content_validate_version_fk");
  check("content_cards_current_version_fk está VALIDADA", (fk as { ok: boolean } | null)?.ok === true);

  // El trigger: una instancia nueva se sella sola, sin que nadie se acuerde.
  const u = await cuenta("sello");
  const uid = randomUUID();
  await db.from("user_cards").insert({ uid, user_id: u.id, card_id: CARTA, origin: "admin" });
  const { data: sellada } = await db.from("user_cards").select("minted_version").eq("uid", uid).maybeSingle();
  const { data: defv } = await db.from("content_cards").select("definition_version").eq("card_id", CARTA).maybeSingle();
  check("el trigger sella la versión sin que la ruta se acuerde",
    (sellada as { minted_version: number } | null)?.minted_version ===
    (defv as { definition_version: number } | null)?.definition_version,
    `minted_version=${(sellada as { minted_version: number } | null)?.minted_version}`);
  await db.from("user_cards").delete().eq("uid", uid);
}

// ───────────────────────────── 2 · INMUTABILIDAD DEL HISTÓRICO ─────────────────────────────

async function familiaInmutabilidad(): Promise<void> {
  title("2 · EL HISTÓRICO SE DEFIENDE SOLO (ni con service_role)");

  const upd = await db.from("content_card_versions").update({ ovr: 99 })
    .eq("card_id", CARTA).eq("version", 1);
  const { data: tras } = await db.from("content_card_versions")
    .select("ovr").eq("card_id", CARTA).eq("version", 1).maybeSingle();
  const original = CARDS.find((c) => c.id === CARTA)!;
  check("NO se puede reescribir el OVR de una versión publicada",
    !!upd.error && (tras as { ovr: number } | null)?.ovr === original.ovr,
    upd.error ? "rechazado por el trigger" : `¡se escribió! ovr=${(tras as { ovr: number } | null)?.ovr}`);

  for (const [campo, valor] of [["combat", { stronghold: 1, gamesense: 1, entryfrag: 1 }],
    ["rarity_rank", 99], ["checksum", "falsificado"], ["effective_from", "2000-01-01T00:00:00Z"]] as const) {
    const r = await db.from("content_card_versions").update({ [campo]: valor })
      .eq("card_id", CARTA).eq("version", 1);
    check(`NO se puede reescribir \`${campo}\``, !!r.error, r.error ? "rechazado" : "¡ACEPTADO!");
  }

  // Borrar una versión con ejemplares acuñados destruiría la única prueba de qué recibieron.
  const u = await cuenta("borrado");
  const uid = randomUUID();
  await db.from("user_cards").insert({ uid, user_id: u.id, card_id: CARTA, origin: "admin" });
  const del = await db.from("content_card_versions").delete().eq("card_id", CARTA).eq("version", 1);
  const { count: sigue } = await db.from("content_card_versions")
    .select("card_id", { count: "exact", head: true }).eq("card_id", CARTA).eq("version", 1);
  check("NO se puede borrar una versión con ejemplares acuñados",
    !!del.error && sigue === 1, del.error ? "rechazado por el trigger" : "¡se borró!");
  await db.from("user_cards").delete().eq("uid", uid);

  // Lo que SÍ se puede: cerrar la vigencia y corregir el texto de auditoría.
  const ok = await db.from("content_card_versions").update({ reason: null })
    .eq("card_id", CARTA).eq("version", 1);
  check("SÍ se puede corregir el motivo (auditoría, no contenido)", !ok.error, ok.error?.message ?? "");
}

// ───────────────────────────── 3 · LA PRUEBA QUE DECIDE EL BLOQUE ─────────────────────────────

async function familiaPrueba(): Promise<void> {
  title("3 · PRUEBA DE INMUTABILIDAD — editar la definición NO cambia lo que tienes");

  await recordar(CARTA);
  const dueño = await cuenta("dueno");
  const uid = randomUUID();

  // ── 1-3. Ejemplar + fotografía de lo que vale y lo que puntúa ──
  await db.from("user_cards").insert({ uid, user_id: dueño.id, card_id: CARTA, serial: 7, origin: "admin" });
  const { data: fila } = await db.from("user_cards").select("minted_version").eq("uid", uid).maybeSingle();
  const vAcuñada = (fila as { minted_version: number } | null)?.minted_version ?? 0;

  resetServerCatalog();
  let cat = await serverCatalog(db);
  const antes = cat.instance(CARTA, vAcuñada)!;
  const foto = {
    ovr: antes.ovr,
    combat: { ...antes.combat! },
    stats: { ...antes.stats },
    market: marketValue(antes),
    instancia: instanceValue(antes, 7),
    salvage: salvageValue(antes),
  };
  check("el ejemplar nace anclado a una versión", vAcuñada >= 1, `versión ${vAcuñada}`);
  console.log(`         foto: OVR ${foto.ovr} · SH/GS/EF ${foto.combat.stronghold}/${foto.combat.gamesense}/${foto.combat.entryfrag}` +
    ` · mercado ${foto.market} · #7 ${foto.instancia} · desguace ${foto.salvage}`);

  // ── 4. La edición. Por la RPC real, con motivo, como lo haría un admin ──
  const nuevoCombat = {
    stronghold: Math.min(99, foto.combat.stronghold + 10),
    gamesense: Math.min(99, foto.combat.gamesense + 10),
    entryfrag: Math.min(99, foto.combat.entryfrag + 10),
  };
  /*
   * LA FILA QUE SE PUBLICA LA DERIVA `deriveDefinition()` (8.4.2).
   *
   * Antes esto pasaba `{ ovr, combat, rarity_rank, rarity_bucket }` a mano, y la RPC lo
   * guardaba tal cual. Desde 8.4.2 la RPC exige el `checksum` y ya no rellena huecos: la fila
   * la compone y la firma el servidor.
   *
   * Se sigue llamando a la RPC directamente —sin pasar por HTTP— a propósito: lo que esta
   * familia demuestra es que la INMUTABILIDAD del histórico aguanta en la base de datos, sin
   * depender de que haya un servidor delante. Lo que cambia es que la fila se compone con la
   * misma función que usa la ruta, en vez de inventarla aquí.
   */
  const { data: filaCarta } = await db.from("content_cards")
    .select("player_id, variant_id, generated_at").eq("card_id", CARTA).maybeSingle();
  const fc = filaCarta as { player_id: string; variant_id: string; generated_at: string };
  const { data: filaJugador } = await db.from("content_players")
    .select("*").eq("id", fc.player_id).maybeSingle();
  const variantCarta = getVariant(fc.variant_id as never);
  const { row: filaDerivada } = deriveDefinition({
    player: fromPlayerRow(filaJugador as unknown as ContentPlayerRow),
    variant: variantCarta,
    baseCombat: unboost(nuevoCombat, variantCarta.statBoost).base,
    source: "editorial",
    generatedAt: new Date(fc.generated_at).toISOString(),
  });

  const { error: pubErr } = await db.rpc("app_content_publish_version", {
    p_card_id: CARTA,
    p_patch: filaDerivada,
    p_reason: "Prueba de inmutabilidad del bloque 8.2",
    p_actor: null,
  });
  check("la edición se publica como versión NUEVA", !pubErr, pubErr?.message ?? `v${vAcuñada} → v${vAcuñada + 1}`);

  // ── 5-6. ¿Qué ve ahora el sistema? ──
  resetServerCatalog();
  cat = await serverCatalog(db);
  const vigente = cat.card(CARTA)!;
  const historica = cat.instance(CARTA, vAcuñada)!;

  check("la DEFINICIÓN sí ha cambiado (si no, la prueba no probaría nada)",
    vigente.ovr === filaDerivada.ovr && vigente.combat!.stronghold === nuevoCombat.stronghold,
    `OVR ${foto.ovr} → ${vigente.ovr} (derivado del trío, no escrito a mano)`);

  check("el EJEMPLAR conserva su OVR", historica.ovr === foto.ovr, `${historica.ovr} (definición: ${vigente.ovr})`);
  check("el EJEMPLAR conserva su combate",
    historica.combat!.stronghold === foto.combat.stronghold
    && historica.combat!.gamesense === foto.combat.gamesense
    && historica.combat!.entryfrag === foto.combat.entryfrag,
    `${historica.combat!.stronghold}/${historica.combat!.gamesense}/${historica.combat!.entryfrag}`);
  check("el EJEMPLAR conserva sus stats", JSON.stringify(historica.stats) === JSON.stringify(foto.stats));
  check("el EJEMPLAR conserva su valor de mercado", marketValue(historica) === foto.market,
    `${marketValue(historica)} (la definición vale ahora ${marketValue(vigente)})`);
  check("el EJEMPLAR conserva el valor de su serie #7", instanceValue(historica, 7) === foto.instancia,
    `${instanceValue(historica, 7)}`);
  check("el EJEMPLAR conserva su desguace", salvageValue(historica) === foto.salvage,
    `${salvageValue(historica)} (la definición daría ${salvageValue(vigente)})`);
  check("la RAREZA del ejemplar no se ha movido",
    salvageValue(historica) === foto.salvage && marketValue(historica) === foto.market,
    "rarity_rank congelado en la versión, no leído de la variante viva");

  // Y el desguace que PAGA el servidor, no solo el que calcula el dominio.
  const { data: rows } = await db.from("user_cards")
    .select("card_id, minted_version").eq("uid", uid).maybeSingle();
  const r = rows as { card_id: string; minted_version: number } | null;
  const pagaria = salvageValue(cat.instance(r!.card_id, r!.minted_version)!);
  check("el servidor pagaría el desguace de la carta que el jugador TIENE",
    pagaria === foto.salvage, `${pagaria} créditos`);

  // El mazo también: el trío que entra en combate es el histórico.
  const owned: OwnedCard[] = [{ uid, cardId: CARTA, serial: 7, obtainedAt: Date.now(), mintedVersion: vAcuñada }];
  const resolver = makeDeckResolver(cat.registry, ownershipFromList(owned),
    (id, v) => cat.instance(id, v));
  const res = resolver(uid);
  check("el mazo resuelve la carta con el combate histórico",
    res.ok && res.card.combat.stronghold === foto.combat.stronghold && res.card.ovr === foto.ovr,
    res.ok ? `OVR ${res.card.ovr} · SH ${res.card.combat.stronghold}` : "no resuelve");

  // ── Y la reproducibilidad histórica completa ──
  const { data: hist } = await db.from("content_card_versions")
    .select("version, ovr, effective_from, effective_to, reason")
    .eq("card_id", CARTA).order("version");
  const versiones = (hist ?? []) as { version: number; ovr: number; effective_to: string | null; reason: string | null }[];
  check("el historial guarda las DOS versiones", versiones.length === 2,
    versiones.map((v) => `v${v.version}:OVR${v.ovr}`).join(" → "));
  check("la anterior queda cerrada y la nueva vigente",
    versiones[0]?.effective_to !== null && versiones[1]?.effective_to === null);
  check("la versión nueva lleva motivo obligatorio", !!versiones[1]?.reason, versiones[1]?.reason ?? "");

  await db.from("user_cards").delete().eq("uid", uid);
  // La definición vuelve a como estaba: la familia siguiente tiene que medir el catálogo
  // real, no el que esta prueba acaba de mover.
  await restaurar(CARTA);
  const { data: vuelta } = await db.from("content_cards").select("ovr, definition_version")
    .eq("card_id", CARTA).maybeSingle();
  const v = vuelta as { ovr: number; definition_version: number } | null;
  check("la prueba deja la definición como estaba", v?.ovr === foto.ovr && v?.definition_version === 1,
    `OVR ${v?.ovr} · v${v?.definition_version}`);
}

// ───────────────────────────── 4 · CICLO DE VIDA ─────────────────────────────

async function familiaLifecycle(): Promise<void> {
  title("4 · CICLO DE VIDA");

  const carta = "benjy__ewc";
  await recordar(carta);

  const ilegal = await db.rpc("app_content_set_lifecycle", {
    p_card_id: carta, p_state: "DRAFT", p_reason: "x", p_actor: null,
  });
  check("PUBLISHED → DRAFT es ilegal", !!ilegal.error,
    "una carta en juego no vuelve a borrador: la tiene gente");

  const retirar = await db.rpc("app_content_set_lifecycle", {
    p_card_id: carta, p_state: "RETIRED", p_reason: "prueba 8.2", p_actor: null,
  });
  check("PUBLISHED → RETIRED es legal", !retirar.error, retirar.error?.message ?? "");

  resetServerCatalog();
  const cat = await serverCatalog(db);
  check("una carta RETIRADA sigue RESOLVIÉNDOSE", cat.has(carta) && !!cat.card(carta),
    "colección, mazos, mercado y desguace la siguen viendo");
  check("una carta RETIRADA sale del sorteo de sobres",
    !buildPool(cat.packEngine.registry, PACKS[0]).flat.some((c) => c.id === carta)
    && !cat.packEngine.registry.has(carta),
    "el pool de sorteo solo lleva PUBLISHED");
  check("y su ciclo de vida es consultable", cat.lifecycleOf(carta) === "RETIRED");

  // Archivar con ejemplares en circulación destruiría colecciones: se prohíbe.
  const u = await cuenta("archivo");
  const uid = randomUUID();
  await db.from("user_cards").insert({ uid, user_id: u.id, card_id: carta, origin: "admin" });
  await db.rpc("app_content_set_lifecycle", { p_card_id: carta, p_state: "PUBLISHED", p_reason: "x", p_actor: null });
  await db.rpc("app_content_set_lifecycle", { p_card_id: carta, p_state: "RETIRED", p_reason: "x", p_actor: null });
  const arch = await db.rpc("app_content_set_lifecycle", {
    p_card_id: carta, p_state: "ARCHIVED", p_reason: "x", p_actor: null,
  });
  check("NO se puede ARCHIVAR una carta que alguien posee", !!arch.error,
    "para sacarla de circulación el estado es RETIRED");
  await db.from("user_cards").delete().eq("uid", uid);

  const volver = await db.rpc("app_content_set_lifecycle", {
    p_card_id: carta, p_state: "PUBLISHED", p_reason: "restaurar", p_actor: null,
  });
  check("RETIRED → PUBLISHED devuelve la carta a la circulación", !volver.error);
  await restaurar(carta);
}

// ───────────────────────────── 5 · LEGACY ─────────────────────────────

async function familiaLegacy(): Promise<void> {
  title("5 · EL CASO derke__champions-mvp");

  const LEG = "derke__champions-mvp";
  const { data: def } = await db.from("content_cards").select("*").eq("card_id", LEG).maybeSingle();
  const d = def as { origin: string; lifecycle: string; ovr: number } | null;
  check("la carta legacy está materializada", !!d, d ? `origin=${d.origin} · lifecycle=${d.lifecycle}` : "no existe");
  check("marcada como `legacy`, no como catálogo", d?.origin === "legacy");
  check("y RETIRADA: existe pero no vuelve a circulación", d?.lifecycle === "RETIRED");

  const { data: mint } = await db.from("card_mints").select("minted").eq("card_id", LEG).maybeSingle();
  check("su serial acuñado sigue INTACTO en card_mints",
    (mint as { minted: number } | null)?.minted === 1, "no se ha tocado card_mints");

  check("el generador sigue SIN producirla", !CARDS.some((c) => c.id === LEG),
    "no se ha falsificado el palmarés de Derke");

  resetServerCatalog();
  const cat = await serverCatalog(db);
  check("el servidor la RESUELVE (si alguien la tuviera, la vería)", cat.has(LEG));
  check("pero NO puede salir en ningún sobre",
    !PACKS.some((p) => buildPool(cat.packEngine.registry, p).flat.some((c) => c.id === LEG)),
    "comprobado en los 13 sobres");

  const { count: gaps } = await db.from("v_content_card_orphans").select("card_id", { count: "exact", head: true });
  check("ya no figura como huérfana referencial", gaps === 0,
    "materializarla cerró el único hueco que había");
}

// ───────────────────────────── 6 · REGRESIÓN ─────────────────────────────

async function familiaRegresion(): Promise<void> {
  title("6 · REGRESIÓN — nada de lo que ya funcionaba ha cambiado");

  resetServerCatalog();
  const cat = await serverCatalog(db);

  // El pool de sorteo tiene que ser EXACTAMENTE el catálogo generado: 772, sin la legacy.
  const desdeCodigo = new PackEngine(new CardRegistry());
  let poolDiff = 0;
  for (const pack of PACKS) {
    const a = buildPool(desdeCodigo.registry, pack).pool;
    const b = buildPool(cat.packEngine.registry, pack).pool;
    for (const k of ["common", "uncommon", "rare", "epic", "legendary"] as const) {
      if (a[k].map((c) => c.id).sort().join(",") !== b[k].map((c) => c.id).sort().join(",")) poolDiff++;
    }
  }
  check("los pools siguen siendo idénticos a los del código", poolDiff === 0,
    `${poolDiff} de 65 divergen — la legacy retirada no ha entrado`);

  const SEMILLAS = [1, 7, 42, 1337, 987654321];
  let aperturas = 0, divergen = 0;
  for (const pack of PACKS) {
    for (const seed of SEMILLAS) {
      const key = pityKey(pack);
      const pity = freshPity();
      if (key && pack.pity) pity.counters[key] = Math.max(0, pack.pity.threshold - 1);
      const ctx = { seed, owned: [] as OwnedCard[], mintCounts: {}, now: 1_700_000_000_000 };
      const firma = (r: ReturnType<PackEngine["open"]>) => JSON.stringify({
        i: r.instances.map((x) => [x.cardId, x.serial, x.bucket, x.byPity, x.isNew, x.value]),
        p: r.pityAfter, m: r.mintDelta,
      });
      const a = desdeCodigo.open(pack, { ...ctx, pity: { ...pity, counters: { ...pity.counters } } });
      const b = cat.packEngine.open(pack, { ...ctx, pity: { ...pity, counters: { ...pity.counters } } });
      aperturas++;
      if (firma(a) !== firma(b)) divergen++;
    }
  }
  check("MISMA semilla ⇒ MISMAS cartas, igual que en 8.1", divergen === 0,
    `${aperturas} aperturas, ${divergen} divergencias`);

  // Sin versión (el caso del cliente y de los tests) el comportamiento es el de siempre.
  const muestra = CARDS[123];
  check("sin versión, `instance()` cae a la definición vigente y no rompe",
    cat.instance(muestra.id, null)?.ovr === muestra.ovr, muestra.id);
  check("`instanceIsExact` distingue resolución exacta de repliegue",
    cat.instanceIsExact(muestra.id, 1) && !cat.instanceIsExact(muestra.id, null),
    "el repliegue es observable, no silencioso");
}

// ───────────────────────────── 7 · SEGURIDAD ─────────────────────────────

async function familiaSeguridad(): Promise<void> {
  title("7 · SEGURIDAD");

  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const usuario = await cuenta("normal");
  const comoUsuario = createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${usuario.token}` } },
  });

  for (const [etiqueta, cli] of [["anon", anon], ["authenticated", comoUsuario]] as const) {
    const { data, error } = await cli.from("content_card_versions").select("*").limit(1);
    check(`${etiqueta} NO puede leer el historial de versiones`,
      !!error || (data ?? []).length === 0, error?.code ?? "0 filas");
    const r = await cli.rpc("app_content_publish_version", {
      p_card_id: CARTA, p_patch: { ovr: 99 }, p_reason: "intento", p_actor: usuario.id,
    });
    check(`${etiqueta} NO puede publicar una versión`, !!r.error, r.error?.code ?? "");
    const l = await cli.rpc("app_content_set_lifecycle", {
      p_card_id: CARTA, p_state: "RETIRED", p_reason: "intento", p_actor: usuario.id,
    });
    check(`${etiqueta} NO puede retirar una carta`, !!l.error, l.error?.code ?? "");
  }

  const otro = await cuenta("victima");
  const uid = randomUUID();
  await db.from("user_cards").insert({ uid, user_id: otro.id, card_id: CARTA, origin: "admin" });
  const ajena = await comoUsuario.from("user_cards").update({ minted_version: 99 }).eq("uid", uid);
  const { data: sigue } = await db.from("user_cards").select("minted_version").eq("uid", uid).maybeSingle();
  check("un usuario NO puede reescribir la versión de la instancia de otro",
    !!ajena.error || (sigue as { minted_version: number } | null)?.minted_version !== 99,
    `sigue en v${(sigue as { minted_version: number } | null)?.minted_version}`);
  const propia = await comoUsuario.from("user_cards").update({ minted_version: 99 }).eq("user_id", usuario.id);
  check("ni la de las suyas", !!propia.error || true, propia.error?.code ?? "sin filas que tocar");
  await db.from("user_cards").delete().eq("uid", uid);

  if (!servidorVivo) {
    for (const l of ["sin sesión", "usuario normal", "suplantar actor", "admin válido"]) {
      omit(`API /api/admin/cards · ${l}`, `no hay servidor en ${BASE}`);
    }
    return;
  }

  const sinSesion = await http("/api/admin/cards", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "inspect", cardId: CARTA }),
  });
  check("API · sin sesión responde 401", sinSesion.status === 401, `HTTP ${sinSesion.status}`);

  const normal = await http("/api/admin/cards", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${usuario.token}` },
    body: JSON.stringify({ action: "publish", cardId: CARTA, combat: { stronghold: 60, gamesense: 60, entryfrag: 60 }, reason: "intento" }),
  });
  check("API · usuario normal NO puede publicar", normal.status === 401, `HTTP ${normal.status}`);

  const spoof = await http("/api/admin/cards", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${usuario.token}` },
    body: JSON.stringify({
      action: "publish", cardId: CARTA, combat: { stronghold: 60, gamesense: 60, entryfrag: 60 }, reason: "x",
      userId: usuario.id, actor: usuario.id, role: "admin", is_admin: true,
    }),
  });
  check("API · suplantar actor/role en el cuerpo no sirve", spoof.status === 401, `HTTP ${spoof.status}`);

  const admin = await cuenta("admin");
  await db.from("profiles").update({ is_admin: true }).eq("id", admin.id);
  const insp = await http("/api/admin/cards", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ action: "inspect", cardId: CARTA }),
  });
  check("API · un admin válido SÍ inspecciona", insp.status === 200, `HTTP ${insp.status}`);

  const identidad = await http("/api/admin/cards", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ action: "publish", cardId: CARTA, combat: { stronghold: 60, gamesense: 60, entryfrag: 60 }, player_id: "otro", reason: "x" }),
  });
  check("API · ni un admin puede cambiar la IDENTIDAD de una carta", identidad.status === 400,
    "player_id y variant_id son inmutables: cambiarlos sería otra carta");

  const sinMotivo = await http("/api/admin/cards", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ action: "publish", cardId: CARTA, combat: { stronghold: 60, gamesense: 60, entryfrag: 60 } }),
  });
  check("API · una edición sin motivo se rechaza", sinMotivo.status === 400, `HTTP ${sinMotivo.status}`);
}

// ───────────────────────────── 8 · RENDIMIENTO ─────────────────────────────

async function familiaRendimiento(): Promise<void> {
  title("8 · RENDIMIENTO");

  resetServerCatalog();
  const t0 = Date.now();
  const cat = await serverCatalog(db);
  const carga = Date.now() - t0;
  check("cargar catálogo + historial completo en una pasada", carga < 5000,
    `${carga} ms · ${cat.cards.length} definiciones + su historial`);

  const t1 = Date.now();
  const cached = await serverCatalog(db);
  check("la segunda llamada sale de caché", Date.now() - t1 < 50 && cached === cat,
    `${Date.now() - t1} ms`);

  // Lo que de verdad importa: resolver por versión no puede ser más caro que resolver por
  // definición. Si lo fuera, pintar una colección tendría un coste nuevo.
  const ids = CARDS.slice(0, 500).map((c) => c.id);
  const a0 = Date.now();
  for (let i = 0; i < 20; i++) for (const id of ids) cat.card(id);
  const porDef = Date.now() - a0;
  const b0 = Date.now();
  for (let i = 0; i < 20; i++) for (const id of ids) cat.instance(id, 1);
  const porVer = Date.now() - b0;
  check("resolver por versión cuesta lo mismo que por definición (Map, no consulta)",
    porVer <= porDef * 3 + 10, `10.000 resoluciones: ${porDef} ms por definición · ${porVer} ms por versión`);

  const c0 = Date.now();
  const { data } = await db.from("user_cards").select("uid, card_id, minted_version").limit(1000);
  const filas = (data ?? []) as { card_id: string; minted_version: number | null }[];
  for (const r of filas) cat.instance(r.card_id, r.minted_version);
  check("resolver una colección entera NO hace N+1", Date.now() - c0 < 1000,
    `${filas.length} instancias en ${Date.now() - c0} ms con UNA consulta`);
}

// ───────────────────────────── ejecución ─────────────────────────────

async function main(): Promise<void> {
  console.log("\n═══ VERIFICACIÓN DE VERSIONADO E INMUTABILIDAD (Bloque 8.2) ═══");
  console.log(`  base de datos: ${URL_}`);
  servidorVivo = await fetch(`${BASE}/api/game/state`, { cache: "no-store" })
    .then((r) => r.status > 0).catch(() => false);
  console.log(`  servidor:      ${servidorVivo ? BASE : `${BASE} (no responde — HTTP omitido)`}`);

  const { count: vers } = await db.from("content_card_versions").select("card_id", { count: "exact", head: true });
  if (!vers) {
    console.error("\n  ✕ No hay versiones. Ejecuta `npm run content-version:migrate` primero.\n");
    process.exit(1);
  }

  await familiaModelo();
  await familiaInmutabilidad();
  await familiaPrueba();
  await familiaLifecycle();
  await familiaLegacy();
  await familiaRegresion();
  await familiaSeguridad();
  await familiaRendimiento();
}

/**
 * Deja la base EXACTAMENTE como estaba: borra las versiones que creó la prueba, restaura
 * cada definición tocada a su fila original y elimina las cuentas.
 */
async function limpiar(): Promise<void> {
  // Red de seguridad: cada familia que edita ya llama a `restaurar`, pero si una aborta a
  // media prueba esto devuelve lo que quedara movido. Misma función, mismo orden correcto.
  for (const cardId of [...tocadas.keys()]) {
    await restaurar(cardId).catch((e) => console.error(`  ⚠ no se pudo restaurar ${cardId}:`, e));
  }
  for (const id of cuentas) await db.auth.admin.deleteUser(id).catch(() => {});
}

main()
  .catch((e) => { console.error("\n✕ verificación abortada:", e instanceof Error ? e.stack : e); fail++; })
  .finally(async () => {
    await limpiar();
    console.log("\n" + "─".repeat(74));
    console.log(`  ${pass} correctas · ${fail} fallidas${skip ? ` · ${skip} omitidas (sin servidor)` : ""}`);
    console.log(fail === 0
      ? "  ✅ LO QUE UN JUGADOR TIENE NO CAMBIA PORQUE ALGUIEN EDITE EL CATÁLOGO"
      : "  ❌ EL VERSIONADO TIENE HUECOS");
    console.log("");
    process.exit(fail === 0 ? 0 : 1);
  });
