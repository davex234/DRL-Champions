/**
 * `/api/admin/cards` — el plano de control de definiciones y versiones (Bloque 8.2).
 *
 *   POST { action: "list",        filtros }                        → listado paginado
 *   POST { action: "facets" }                                     → valores de los filtros
 *   POST { action: "players",     q }                             → jugadores para un alta
 *   POST { action: "sheet",       cardId }                        → la ficha completa
 *   POST { action: "create",      playerId, variantId, reason }   → alta en DRAFT
 *   POST { action: "editor",      cardId }                        → lo justo para editarla
 *   POST { action: "updateDraft", cardId, combat, reason, expectedVersion }
 *   POST { action: "inspect",     cardId }                        → definición + historial
 *   POST { action: "publish",     cardId, combat, reason, expectedVersion }
 *   POST { action: "lifecycle",   cardId, state, reason }         → transición de estado
 *
 * ────────────────────────── QUÉ SE PUEDE ESCRIBIR (8.4.2) ──────────────────────────
 *
 * Un trío de combate. Nada más.
 *
 * Hasta 8.4.1 esta ruta aceptaba un `patch` con `ovr`, `stats`, `stat_boost`, `rarity_rank` y
 * `rarity_bucket` y los guardaba tal cual. La auditoría de 8.4.2 lo midió: publicar
 * `{ ovr: 99 }` sobre un trío de 84/80/65 guardaba un 99 —una cifra que ninguna función del
 * dominio produce— y ese 99 llegaba al ancla de mercado. Ahora el cuerpo lleva `combat` (el
 * trío BASE, sin el bonus de la variante) y **todo lo demás lo deriva el servidor** con
 * `deriveDefinition()`. Un campo derivado en la petición no se ignora: se rechaza diciendo
 * de dónde sale realmente.
 *
 * ────────────────────────── QUÉ ES Y QUÉ NO ES ──────────────────────────
 *
 * **No es** `/admin/cartas`. No hay pantalla, ni listado, ni buscador, ni previsualización,
 * ni alta manual: eso es 8.3/8.4 y construirlo aquí sería colar medio bloque por delante.
 *
 * **Sí es** la superficie mínima que el modelo necesita para poder demostrarse. Sin ella,
 * «una edición no muta una instancia histórica» sería una afirmación sobre código que nadie
 * ha ejecutado; con ella, la prueba de inmutabilidad edita de verdad, por el camino real, y
 * comprueba de verdad. Tres acciones, ninguna de conveniencia.
 *
 * ────────────────────────── SEGURIDAD ──────────────────────────
 *
 * Tres puertas, y ninguna confía en el cliente:
 *
 *   1. `middleware.ts` corta en el borde cualquier `/api/admin/*` sin `Bearer`.
 *   2. `verifyAdmin(req)` resuelve el token contra GoTrue y comprueba `profiles.is_admin`
 *      con `service_role`. **El actor sale de ahí**, nunca del cuerpo: un `userId` o un
 *      `role` en el JSON se ignoran por completo (no se leen).
 *   3. Las RPC `app_content_*` son `security definer` con `execute` revocado a `anon` y
 *      `authenticated`: aunque alguien llegara con un token de usuario normal a PostgREST,
 *      no podría invocarlas.
 *
 * Y por debajo de las tres, la garantía que no depende de ninguna: el trigger de
 * inmutabilidad de `content_card_versions` rechaza cualquier reescritura del histórico,
 * incluso ejecutada con `service_role`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyAdmin } from "@/lib/supabase/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { serverCatalog, resetServerCatalog } from "@/server/catalog";
import { getVariant } from "@/domain/cards/variants";
import { marketValue } from "@/domain/economy/pricing";
import {
  listCards, listFacets, cardSheet, createCard, creatablePlayers, cardEditor,
} from "@/server/services/adminCards";
import {
  deriveDefinition, validateCombat, DERIVED_FIELDS, IMMUTABLE_FIELDS,
} from "@/server/services/cardDerivation";
import { fromPlayerRow, type ContentPlayerRow } from "@/server/catalog/rows";
import { playerCombatBase } from "@/data/catalog";
import { renderCardVersion, artworkStatus, artworkDir } from "@/server/services/cardArtwork";
import { subirArtwork, artworkDeCarta, artworkDeInstancia, MAX_BYTES } from "@/server/services/cardArtworkUpload";
import { internalError } from "@/server/ops/log";
import { readCardInstances } from "@/server/services/userCards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

/**
 * Traduce una petición de escritura en la fila COMPLETA que se va a guardar.
 *
 * Es el único camino por el que el panel puede cambiar una definición, y no acepta ni un
 * número que no haya derivado él mismo. Devuelve `null` en `error` cuando todo va bien.
 *
 * El `source` no se pregunta: se deduce. Si el trío que llega es exactamente el que el
 * generador deriva hoy para ese jugador, la carta sigue siendo `vlr`; si difiere, la ha
 * escrito una persona y queda marcada `editorial`. Es la diferencia entre «esto sale de las
 * métricas» y «esto lo decidió alguien», y tiene que verse en la fila.
 */
async function derivarEscritura(
  sb: SupabaseClient, cardId: string, body: Record<string, unknown>,
): Promise<{ error: string; status: number } | { error: null; row: Record<string, unknown>; cambia: boolean }> {
  // Un campo derivado o inmutable en el cuerpo es un error del llamante, no ruido.
  for (const k of Object.keys(body)) {
    if (DERIVED_FIELDS[k]) {
      return { error: `\`${k}\` no se envía: ${DERIVED_FIELDS[k]}`, status: 400 };
    }
    if (IMMUTABLE_FIELDS[k]) {
      return { error: `\`${k}\` es inmutable: ${IMMUTABLE_FIELDS[k]}`, status: 400 };
    }
  }
  if (body.patch !== undefined) {
    return {
      error: "`patch` ya no existe. Envía `combat` con el trío base; el resto lo deriva el servidor.",
      status: 400,
    };
  }

  const v = validateCombat(body.combat);
  if (!v.ok) return { error: v.error, status: 400 };

  const { data: def } = await sb.from("content_cards").select("*").eq("card_id", cardId).maybeSingle();
  if (!def) return { error: "Carta no encontrada", status: 404 };
  const row = def as Record<string, unknown>;

  const { data: pRow } = await sb.from("content_players").select("*")
    .eq("id", row.player_id as string).maybeSingle();
  if (!pRow) {
    return { error: `El jugador ${String(row.player_id)} no está en el catálogo persistido`, status: 409 };
  }
  const player = fromPlayerRow(pRow as unknown as ContentPlayerRow);

  let variant;
  try { variant = getVariant(row.variant_id as string as never); }
  catch { return { error: `Variante desconocida: ${String(row.variant_id)}`, status: 409 }; }

  const gen = playerCombatBase(player);
  const igualAlGenerador = gen.ok
    && gen.combat.stronghold === v.combat.stronghold
    && gen.combat.gamesense === v.combat.gamesense
    && gen.combat.entryfrag === v.combat.entryfrag;
  const source = igualAlGenerador && gen.ok ? gen.source : "editorial";

  const { row: derivada } = deriveDefinition({
    player, variant, baseCombat: v.combat, source,
    /*
     * La marca de generación no la mueve una edición: describe la calibración con la que la
     * carta nació, no cuándo se tocó. Para «cuándo se tocó» está `updated_at`.
     *
     * Y se NORMALIZA a ISO, que no es cosmética: `generatedAt` entra en `cardChecksum()`, así
     * que la huella depende de cómo se escriba la fecha. PostgREST devuelve el `timestamptz`
     * como «2026-08-31T00:00:00+00:00» y el resto del sistema —`fromCardRow`, y por tanto
     * `content-catalog:verify`— usa «2026-08-31T00:00:00.000Z». Sin este `toISOString()` la
     * huella que firma una edición es distinta de la que calcula quien la comprueba, aunque
     * los dos estén describiendo exactamente la misma carta. Lo destapó la familia 9.
     */
    generatedAt: new Date(String(row.generated_at)).toISOString(),
  });

  const anterior = row.combat as { stronghold: number; gamesense: number; entryfrag: number };
  const cambia =
    derivada.combat.stronghold !== anterior.stronghold ||
    derivada.combat.gamesense !== anterior.gamesense ||
    derivada.combat.entryfrag !== anterior.entryfrag ||
    derivada.ovr !== Number(row.ovr) ||
    derivada.source !== String(row.source) ||
    derivada.checksum !== String(row.checksum);

  return { error: null, row: derivada as unknown as Record<string, unknown>, cambia };
}

const LIFECYCLES = new Set([
  "DRAFT", "REVIEW", "APPROVED", "PUBLISHED", "RETIRED", "ARCHIVED", "REJECTED",
]);

/**
 * GET `?cardId=<id>&version=<n>` — LA DEFINICIÓN DE UNA VERSIÓN, COMO FICHERO.
 *
 * ────────────────────────── QUÉ ES ESTE ARTEFACTO Y QUÉ NO ES ──────────────────────────
 *
 * Es la fila de `content_card_versions`, servida tal cual y con nombre de fichero. **No se
 * genera nada**: no hay render, ni composición, ni imagen. Se lee lo que ya está guardado y
 * se envía. Por eso puede existir sin tocar el pipeline de artwork, que es otro camino
 * (`card-generator` → `artwork-renderer` → PNG en `output/`, fuera de la web).
 *
 * ────────────────────────── POR QUÉ POR VERSIÓN Y NO POR CARTA ──────────────────────────
 *
 * Porque una carta no tiene UNA definición: tiene una por versión, y los ejemplares acuñados
 * apuntan a la suya. Exportar «la carta» obligaría a elegir cuál, y la elección natural —la
 * vigente— es justo la que NO describe lo que tiene en la mano quien compró una v1.
 *
 * `content_card_versions` es inmutable por trigger desde 8.2, así que publicar una v2 no
 * puede reescribir el fichero de la v1: son filas distintas y se descargan por separado.
 *
 * La comprobación de administrador es la misma de siempre: `verifyAdmin(req)`. Sin `Bearer`
 * válido y sin `profiles.is_admin`, 401 — igual que el POST.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Acceso restringido" }, { status: 401, headers: NO_STORE });
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ error: "Supabase admin no configurado" }, { status: 503, headers: NO_STORE });
  }

  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId") ?? "";
  const version = Number(url.searchParams.get("version"));
  if (!cardId || !Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "cardId y version requeridos" }, { status: 400, headers: NO_STORE });
  }

  const { data, error } = await sb.from("content_card_versions")
    .select("*").eq("card_id", cardId).eq("version", version).maybeSingle();
  if (error) return internalError("api/admin/cards", error, req);
  if (!data) {
    return NextResponse.json({ error: `No existe ${cardId} v${version}` }, { status: 404, headers: NO_STORE });
  }

  /*
   * `artifact` elige QUÉ se descarga de esa versión. Sin él, la definición — el
   * comportamiento que ya existía y que no cambia.
   *
   * Los binarios NO viven en `public/`: se leen de `output/artwork/admin/<cardId>/v<N>/` y
   * los sirve esta ruta, que ya ha comprobado que quien pide es administrador. Conocer la
   * ruta del fichero no da acceso a nada porque esa carpeta no la sirve el servidor web.
   */
  const artifact = url.searchParams.get("artifact");
  if (artifact && artifact !== "json") {
    const estado = artworkStatus(cardId, version);
    const fichero = estado.files.find((f) => f.kind === artifact);
    if (!fichero) {
      return NextResponse.json(
        { error: `No hay artefacto «${artifact}» para ${cardId} v${version}. Genérala primero.` },
        { status: 404, headers: NO_STORE });
    }
    const abs = join(artworkDir(cardId, version), fichero.path);
    if (!existsSync(abs)) {
      return NextResponse.json({ error: "El manifest lo declara pero el fichero no está" },
        { status: 409, headers: NO_STORE });
    }
    const bytes = readFileSync(abs);
    const ext = fichero.path.split(".").pop() ?? "bin";
    const MIME: Record<string, string> = { png: "image/png", webp: "image/webp", json: "application/json" };
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        ...NO_STORE,
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${cardId}.v${version}.${artifact}.${ext}"`,
      },
    });
  }

  const nombre = `${cardId}.v${version}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      ...NO_STORE,
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${nombre}"`,
    },
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const admin = await verifyAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Acceso restringido" }, { status: 401, headers: NO_STORE });
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json({ error: "Supabase admin no configurado" }, { status: 503, headers: NO_STORE });
  }

  /*
   * LA SUBIDA DE ARTWORK VIAJA COMO MULTIPART, no como JSON, así que se atiende ANTES de
   * intentar leer el cuerpo: `req.json()` sobre un multipart consume el flujo y lo rompe.
   */
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    /*
     * EL TAMAÑO SE MIRA ANTES DE LEER EL CUERPO.
     *
     * `validarArtwork` tiene la regla de los 12 MB, pero no llega a ejecutarse si el cuerpo
     * revienta antes: `req.formData()` sobre un multipart enorme falla en la plataforma y sale
     * un 500 opaco en vez del 400 con el motivo. Se corta aquí, por `Content-Length`, con
     * holgura para el sobre del multipart (cabeceras y separadores, no el fichero).
     */
    const declarado = Number(req.headers.get("content-length") ?? 0);
    if (declarado > MAX_BYTES + 1024 * 1024) {
      return NextResponse.json(
        { error: `El fichero pesa ${Math.round(declarado / 1024 / 1024)} MB; el máximo son ${MAX_BYTES / 1024 / 1024} MB` },
        { status: 400, headers: NO_STORE },
      );
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "No se ha podido leer el fichero enviado" }, { status: 400, headers: NO_STORE },
      );
    }
    if (form.get("action") !== "artworkUpload") {
      return NextResponse.json({ error: "Acción multipart no válida" }, { status: 400, headers: NO_STORE });
    }
    const cardId = String(form.get("cardId") ?? "");
    const version = Number(form.get("version"));
    const file = form.get("file");
    if (!cardId || !Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "cardId y version requeridos" }, { status: 400, headers: NO_STORE });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta el fichero" }, { status: 400, headers: NO_STORE });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await subirArtwork(sb, cardId, version,
      { nombre: file.name, mime: file.type, bytes }, admin.userId);
    return r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* cuerpo vacío */ }

  const action = typeof body.action === "string" ? body.action : "";

  /*
   * Las acciones de LECTURA de catálogo no llevan `cardId`, así que la comprobación de
   * abajo tiene que ir después de ellas. En 8.2 esta ruta solo servía a una carta concreta;
   * ahora también sirve al listado.
   */
  if (action === "list") {
    const r = await listCards(sb, {
      q: str(body.q), lifecycle: str(body.lifecycle), variant: str(body.variant),
      bucket: str(body.bucket), origin: str(body.origin), poolId: str(body.poolId),
      sort: str(body.sort) as never, dir: body.dir === "desc" ? "desc" : "asc",
      page: num(body.page), pageSize: num(body.pageSize),
    });
    return r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }

  if (action === "facets") {
    const r = await listFacets(sb);
    return r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }

  if (action === "players") {
    const r = await creatablePlayers(sb, str(body.q));
    return r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }

  if (action === "create") {
    const r = await createCard(sb, {
      playerId: str(body.playerId) ?? "", variantId: str(body.variantId) ?? "",
      reason: str(body.reason) ?? "",
      editorial: body.editorial as { combat: never; reason: string } | undefined,
    }, admin.userId);
    return r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }

  const cardId = typeof body.cardId === "string" ? body.cardId : "";
  if (!cardId) {
    return NextResponse.json({ error: "cardId requerido" }, { status: 400, headers: NO_STORE });
  }

  /*
   * ── GENERAR LA IMAGEN DE UNA VERSIÓN ──
   *
   * EXPLÍCITO a propósito: no se renderiza al abrir la ficha. Rasterizar cuesta ~1 s y 470 KB
   * por carta, y hacerlo por cada visita convertiría mirar en producir.
   *
   * IDEMPOTENTE por construcción: el renderizador compara la huella de la composición contra
   * el `manifest.json` que haya en la carpeta de esa versión y reutiliza si coincide. Pulsar
   * dos veces confirma; no duplica. La respuesta lo dice en `cached`.
   */
  if (action === "renderArtwork") {
    const version = num(body.version);
    if (version === undefined || !Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: "version requerida" }, { status: 400, headers: NO_STORE });
    }
    const r = await renderCardVersion(sb, cardId, version);
    return r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }

  /**
   * Qué hay para cada versión, sin generar ni subir nada. Lo consulta la ficha al abrirse.
   *
   * Dos cosas distintas por versión, y conviene no confundirlas:
   *   · `artwork`  — la ilustración MANUAL. Es la definitiva.
   *   · `render`   — la exportación técnica del pipeline. Prueba de datos, no arte final.
   */
  if (action === "artworkStatus") {
    const [{ data: vs }, manual] = await Promise.all([
      sb.from("content_card_versions").select("version").eq("card_id", cardId).order("version"),
      artworkDeCarta(sb, cardId),
    ]);
    const estados = ((vs ?? []) as { version: number }[]).map((v) => ({
      version: v.version,
      artwork: manual[v.version] ?? null,
      render: artworkStatus(cardId, v.version),
    }));
    return NextResponse.json({ cardId, versions: estados }, { headers: NO_STORE });
  }

  /**
   * QUÉ ARTWORK LE TOCA A UN EJEMPLAR. Solo `card_id` + `minted_version`.
   *
   * Existe para poder DEMOSTRAR la regla, y para que el juego tenga a quién preguntar el día
   * que pinte artwork manual. Sin heurísticas: ni la última versión, ni la fecha.
   */
  if (action === "artworkForInstance") {
    const mv = num(body.mintedVersion) ?? null;
    const a = await artworkDeInstancia(sb, cardId, mv);
    return NextResponse.json({ cardId, mintedVersion: mv, artwork: a }, { headers: NO_STORE });
  }

  // ── La ficha completa ──
  if (action === "sheet") {
    const r = await cardSheet(sb, cardId);
    return r.ok
      ? NextResponse.json(r.data, { headers: NO_STORE })
      : NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
  }

  // ── Editar un BORRADOR en sitio ──
  if (action === "updateDraft") {
    const reason = str(body.reason)?.trim();
    if (!reason) return NextResponse.json({ error: "Una edición necesita motivo" }, { status: 400, headers: NO_STORE });

    const d = await derivarEscritura(sb, cardId, body);
    if (d.error !== null) {
      return NextResponse.json({ error: d.error }, { status: d.status, headers: NO_STORE });
    }
    if (!d.cambia) {
      return NextResponse.json({ error: "Esa edición no cambia nada" }, { status: 400, headers: NO_STORE });
    }

    const { data, error } = await sb.rpc("app_content_update_draft", {
      p_card_id: cardId, p_patch: d.row, p_reason: reason, p_actor: admin.userId,
      p_expected_version: num(body.expectedVersion) ?? null,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
    resetServerCatalog();
    return NextResponse.json({ ...(data as object), definition: d.row }, { headers: NO_STORE });
  }

  // ── Lo justo para abrir el editor ──
  if (action === "editor") {
    const r = await cardEditor(sb, cardId);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status, headers: NO_STORE });
    return NextResponse.json(r.data, { headers: NO_STORE });
  }

  // ── Consultar: definición vigente + historial completo ──
  if (action === "inspect") {
    const [def, versions, instances] = await Promise.all([
      sb.from("content_cards").select("*").eq("card_id", cardId).maybeSingle(),
      sb.from("content_card_versions").select("*").eq("card_id", cardId).order("version"),
      // COLECCIONES ILIMITADAS · todos los ejemplares, por cursor: es el número de «a cuánta gente afecta» y no puede quedarse corto.
      readCardInstances<{ uid: string; minted_version: number | null }>(sb, cardId, "uid, minted_version").then((data) => ({ data, error: null as { message: string } | null }), (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e) } })),
    ]);
    if (!def.data) {
      return NextResponse.json({ error: "Carta no encontrada" }, { status: 404, headers: NO_STORE });
    }
    // Cuántos ejemplares hay bajo cada versión. Es lo primero que hay que saber antes de
    // publicar una edición: dice a cuánta gente afecta —y a cuánta NO, que es el punto.
    const byVersion: Record<string, number> = {};
    for (const r of (instances.data ?? []) as { minted_version: number | null }[]) {
      const k = r.minted_version === null ? "sin-version" : String(r.minted_version);
      byVersion[k] = (byVersion[k] ?? 0) + 1;
    }
    return NextResponse.json(
      { definition: def.data, versions: versions.data ?? [], instancesByVersion: byVersion },
      { headers: NO_STORE },
    );
  }

  // ── Publicar una versión nueva ──
  if (action === "publish") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "Una versión nueva necesita motivo" }, { status: 400, headers: NO_STORE });
    }

    /*
     * La fila que se va a guardar la deriva el servidor entera. `player_id` y `variant_id`
     * salen de la carta existente, no de la petición: cambiarlos sería cambiar la identidad
     * de la carta —sería OTRA carta— y las instancias existentes quedarían apuntando a algo
     * que no es lo que sus dueños obtuvieron.
     */
    const d = await derivarEscritura(sb, cardId, body);
    if (d.error !== null) {
      return NextResponse.json({ error: d.error }, { status: d.status, headers: NO_STORE });
    }
    if (!d.cambia) {
      return NextResponse.json(
        { error: "Esa versión sería idéntica a la vigente: no se publica una versión que no cambia nada" },
        { status: 400, headers: NO_STORE },
      );
    }

    /*
     * CONCURRENCIA. `expectedVersion` es la versión que el administrador tenía delante, y la
     * comprueba la RPC **bajo su propio `for update`** — no aquí.
     *
     * La primera versión de esto leía la fila antes de llamar, y la verificación de 8.4.1
     * enseñó por qué no basta: si dos administradores leen a la vez, los dos pasan la
     * comprobación y las dos publicaciones salen adelante. Dentro del cerrojo no hay ventana.
     */
    const expected = num(body.expectedVersion);
    const { data, error } = await sb.rpc("app_content_publish_version", {
      p_card_id: cardId, p_patch: d.row, p_reason: reason, p_actor: admin.userId,
      p_expected_version: expected ?? null,
    });
    if (error) {
      const conflicto = /ha cambiado mientras la editabas/.test(error.message);
      const actual = conflicto ? Number(error.message.match(/hay v(\d+)/)?.[1]) : undefined;
      return NextResponse.json(
        { error: error.message, ...(conflicto ? { conflict: true, current: actual } : {}) },
        { status: 409, headers: NO_STORE },
      );
    }
    const marketAnchor = await syncCardReference(sb, cardId);
    return NextResponse.json({ ...(data as object), marketAnchor }, { headers: NO_STORE });
  }

  // ── Mover el ciclo de vida ──
  if (action === "lifecycle") {
    const state = typeof body.state === "string" ? body.state : "";
    if (!LIFECYCLES.has(state)) {
      return NextResponse.json({ error: "Estado no válido" }, { status: 400, headers: NO_STORE });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const { data, error } = await sb.rpc("app_content_set_lifecycle", {
      p_card_id: cardId, p_state: state, p_reason: reason || null, p_actor: admin.userId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 409, headers: NO_STORE });
    }
    /*
     * Publicar por primera vez deja el ancla del mercado apuntando a esta versión (D-1/D-1b)
     * y descarta el catálogo en memoria de ESTE proceso. La invalidación entre procesos la
     * hace `_bump_catalog()` dentro de la RPC.
     */
    const anchor = state === "PUBLISHED" ? await syncCardReference(sb, cardId) : null;
    resetServerCatalog();
    return NextResponse.json({ ...(data as object), marketAnchor: anchor }, { headers: NO_STORE });
  }

  return NextResponse.json({ error: "Acción no válida" }, { status: 400, headers: NO_STORE });
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined =>
  (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * D-1 · SINCRONIZAR EL ANCLA DEL MERCADO AL PUBLICAR UNA VERSIÓN (Bloque 8.3).
 *
 * ────────────────────────── LA DEUDA, ENUNCIADA CON PRECISIÓN ──────────────────────────
 *
 * El bloque 8.2 dejó abierto que la banda antifraude del mercado puede quedar
 * desincronizada cuando exista edición en producción. El mecanismo exacto:
 *
 *   `_check_price_band` (0004) llama a `_price_anchor(card_id)`, que devuelve
 *     1º `card_price_stats.avg_price` — lo que la carta ha trado DE VERDAD
 *     2º `card_reference.fair_value` — el valor de catálogo, si nunca se ha vendido
 *
 * `card_reference` la puebla `POST /api/market/sync-reference` a mano. Publicar una versión
 * cambiaba el OVR —y por tanto `marketValue`— sin tocar esa tabla: a partir de ahí, la banda
 * de precio de esa carta se calculaba contra un ancla obsoleta.
 *
 * ────────────────────────── QUÉ SE ARREGLA Y QUÉ NO ──────────────────────────
 *
 * **Se arregla la parte que era un fallo**: publicar recalcula el `fair_value` de esa carta
 * con la MISMA función que usa el mercado (`marketValue`), en la misma petición. No cambia
 * ninguna regla del mercado: la banda, los multiplicadores y las RPC siguen intactos; lo
 * único que cambia es que el número que leen deja de estar viejo.
 *
 * **No se “arregla” lo que no está roto**: si la carta tiene historial de ventas, el ancla
 * sigue siendo `avg_price`, y eso es correcto por diseño — un ancla de mercado debe decir
 * lo que la carta VALE en el mercado, no lo que el catálogo cree que vale. Que ese precio
 * medio agregue ejemplares de versiones distintas es una propiedad del modelo de mercado
 * (los listados se indexan por `card_id`, no por versión), y separarlo exige cambiar el
 * esquema del mercado. Eso queda declarado como deuda de 8.4, no escondido.
 *
 * Es idempotente y se autocorrige: si una publicación fallara aquí, la siguiente —o
 * `sync-reference`— deja la fila correcta.
 */
async function syncCardReference(
  sb: SupabaseClient, cardId: string,
): Promise<{ cardId: string; fairValue: number } | { error: string }> {
  try {
    // Se relee el catálogo: la publicación acaba de cambiar la definición vigente y la
    // copia en memoria de este proceso todavía es la anterior.
    resetServerCatalog();
    const cat = await serverCatalog(sb);
    const def = cat.card(cardId);
    if (!def) return { error: "carta no encontrada tras publicar" };

    const player = cat.player(def.playerId);
    const fairValue = marketValue(def);
    const { error } = await sb.from("card_reference").upsert({
      card_id: def.id,
      player_id: def.playerId,
      nick: player?.nick ?? null,
      team: player?.team ?? null,
      region: player?.region ?? null,
      rank: getVariant(def.variantId).rank,
      ovr: def.ovr,
      fair_value: fairValue,
      updated_at: new Date().toISOString(),
    }, { onConflict: "card_id" });
    if (error) return { error: error.message };
    return { cardId: def.id, fairValue };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "error al sincronizar el ancla" };
  }
}
