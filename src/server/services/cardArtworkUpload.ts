/**
 * ARTWORK MANUAL DE UNA VERSIÓN DE CARTA — subir, listar, resolver.
 *
 * ────────────────────────── LA PREMISA ──────────────────────────
 *
 * Las cartas de NEXUS se **diseñan a mano**. El artwork final es un fichero que exporta una
 * persona; no se reconstruye desde una foto ni se genera. Este módulo solo lo guarda, lo ata
 * a una versión concreta y sabe devolverlo.
 *
 * ────────────────────────── NO ES UNA SEGUNDA ARQUITECTURA ──────────────────────────
 *
 * Se escribe en la tabla `assets` y en el bucket `assets` de siempre, con las mismas rutas
 * (`assetPath`), el mismo checksum (`sha256Hex`) y el mismo modelo de versión de asset
 * (`group_id` · `version` · `is_current`). La migración 0043 solo amplió dos listas de
 * valores admitidos. Lo único propio de aquí es la clave del sujeto y la validación.
 *
 * ────────────────────────── LA CLAVE: `<card_id>#v<N>` ──────────────────────────
 *
 * `subject_id` es COMPUESTO a propósito. La v1 y la v2 son dos sujetos distintos para el
 * gestor de assets, con sus propias filas: publicar la v2 no puede pisar el artwork de la v1
 * porque ni siquiera comparten fila.
 *
 * La versión de la carta NO va en `assets.version`, que ya significa otra cosa —la versión
 * DEL ASSET, la que sube `replace` al cambiar un fichero por otro mejor—. Mezclarlas habría
 * hecho imposible reemplazar el artwork de la v1 sin que pareciera el de la v2.
 *
 * ────────────────────────── POR QUÉ SE VALIDA AQUÍ ──────────────────────────
 *
 * El `upload` genérico de `/api/admin/assets` **no valida nada**: acepta cualquier fichero y
 * lo deja en un bucket PÚBLICO. Para el artwork de una carta eso no vale, así que esta puerta
 * comprueba extensión, tipo declarado, tamaño y —lo que de verdad importa— los **bytes
 * reales**: un `.png` que no empieza por la firma PNG no es un PNG por mucho que lo diga su
 * nombre. Confiar en la extensión es cómo se sube un ejecutable a un bucket público.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { assetPath, ASSET_BUCKET } from "@/lib/assets/storage";

/** Formatos admitidos. PNG y WEBP: los dos que el producto ya usa para cartas. */
export const FORMATOS = {
  png: { mime: "image/png", firma: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  webp: { mime: "image/webp", firma: null },
} as const;

export type FormatoArtwork = keyof typeof FORMATOS;

/** 12 MB. Una carta de 750×1050 sin comprimir no llega; por encima es otra cosa. */
export const MAX_BYTES = 12 * 1024 * 1024;

/** La clave del sujeto. Una función, para que nadie la componga a mano en otro sitio. */
export const subjectIdFor = (cardId: string, version: number): string => `${cardId}#v${version}`;

/**
 * La carpeta del sujeto DENTRO DEL BUCKET — y por qué no es `subjectIdFor`.
 *
 * `#` no puede aparecer en la clave de un objeto de Storage: viaja en la URL de subida y se
 * lee como el separador de fragmento, así que todo lo que va detrás —`v<N>/<uuid>.png`— se
 * descarta y las dos versiones acaban escribiendo EL MISMO fichero `card_artwork/<card_id>`.
 * La primera subida gana, la segunda muere con «The resource already exists» y la
 * independencia entre v1 y v2 se pierde justo donde más importa.
 *
 * Así que la versión se separa en un segmento propio. La clave en BD sigue siendo `#v<N>`.
 */
export const storageSubjectFor = (cardId: string, version: number): string =>
  `${cardId}/v${version}`;

export interface ArtworkAsset {
  id: string;
  cardId: string;
  cardVersion: number;
  name: string;
  format: string;
  bytes: number;
  checksum: string;
  url: string | null;
  storagePath: string | null;
  assetVersion: number;
  status: string;
  createdAt: string;
}

/**
 * ¿Es este fichero lo que dice ser?
 *
 * Cuatro comprobaciones, y la que decide es la cuarta: los bytes. WEBP se reconoce por su
 * contenedor RIFF (`RIFF....WEBP`), que no es una firma fija y por eso se comprueba aparte.
 */
export function validarArtwork(
  nombre: string, mime: string, bytes: Uint8Array,
): { ok: true; formato: FormatoArtwork } | { ok: false; error: string } {
  if (bytes.byteLength === 0) return { ok: false, error: "El fichero está vacío" };
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, error: `El fichero pesa ${Math.round(bytes.byteLength / 1024 / 1024)} MB; el máximo son ${MAX_BYTES / 1024 / 1024} MB` };
  }

  const ext = (nombre.split(".").pop() ?? "").toLowerCase();
  if (ext !== "png" && ext !== "webp") {
    return { ok: false, error: `Extensión no admitida: «${ext || "sin extensión"}». Solo PNG y WEBP.` };
  }
  const formato = ext as FormatoArtwork;

  if (mime && mime !== FORMATOS[formato].mime) {
    return { ok: false, error: `El tipo declarado (${mime}) no corresponde a un .${ext}` };
  }

  // Los BYTES, que es lo único que no se puede falsear renombrando.
  if (formato === "png") {
    const f = FORMATOS.png.firma;
    const coincide = f.every((b, i) => bytes[i] === b);
    if (!coincide) return { ok: false, error: "El contenido no es un PNG (firma incorrecta)" };
  } else {
    const riff = String.fromCharCode(...bytes.subarray(0, 4));
    const webp = String.fromCharCode(...bytes.subarray(8, 12));
    if (riff !== "RIFF" || webp !== "WEBP") {
      return { ok: false, error: "El contenido no es un WEBP (contenedor RIFF/WEBP incorrecto)" };
    }
  }

  return { ok: true, formato };
}

const sha256 = async (bytes: Uint8Array): Promise<string> => {
  const d = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const filaAArtwork = (r: Record<string, unknown>): ArtworkAsset => {
  const meta = (r.meta ?? {}) as { cardId?: string; cardVersion?: number };
  return {
    id: String(r.id),
    cardId: meta.cardId ?? String(r.subject_id ?? "").split("#")[0],
    cardVersion: meta.cardVersion ?? Number(String(r.subject_id ?? "").split("#v")[1] ?? 0),
    name: String(r.name ?? ""),
    format: String(r.format ?? ""),
    bytes: Number(r.bytes ?? 0),
    checksum: String(r.checksum ?? ""),
    url: (r.url as string) ?? null,
    storagePath: (r.storage_path as string) ?? null,
    assetVersion: Number(r.version ?? 1),
    status: String(r.status ?? ""),
    createdAt: String(r.created_at ?? ""),
  };
};

/**
 * Sube el artwork de UNA versión.
 *
 * Si esa versión ya tenía uno, esto es un REEMPLAZO: la fila anterior deja de ser
 * `is_current` y la nueva sube `version` dentro del mismo `group_id`. El fichero viejo NO se
 * borra del bucket — un artwork que alguien ya pudo distribuir no desaparece porque se suba
 * otro, y el historial es lo que permite volver atrás.
 */
export async function subirArtwork(
  sb: SupabaseClient, cardId: string, version: number,
  fichero: { nombre: string; mime: string; bytes: Uint8Array }, actor: string,
): Promise<{ ok: true; data: ArtworkAsset } | { ok: false; error: string; status: number }> {
  const { data: v } = await sb.from("content_card_versions")
    .select("version").eq("card_id", cardId).eq("version", version).maybeSingle();
  if (!v) return { ok: false, error: `No existe ${cardId} v${version}`, status: 404 };

  const val = validarArtwork(fichero.nombre, fichero.mime, fichero.bytes);
  if (!val.ok) return { ok: false, error: val.error, status: 400 };

  const subjectId = subjectIdFor(cardId, version);
  const { data: previo } = await sb.from("assets")
    .select("id, group_id, version").eq("subject_type", "card").eq("kind", "card_artwork")
    .eq("subject_id", subjectId).eq("is_current", true).maybeSingle();

  const assetId = crypto.randomUUID();
  const grupo = previo ? String((previo as { group_id: string }).group_id) : assetId;
  const nuevaVersion = previo ? Number((previo as { version: number }).version) + 1 : 1;

  const ruta = assetPath("card_artwork" as never, storageSubjectFor(cardId, version), assetId, val.formato);
  const { error: eUp } = await sb.storage.from(ASSET_BUCKET)
    .upload(ruta, fichero.bytes as unknown as ArrayBuffer, {
      contentType: FORMATOS[val.formato].mime, upsert: false,
    });
  if (eUp) return { ok: false, error: `Storage: ${eUp.message}`, status: 500 };

  const url = sb.storage.from(ASSET_BUCKET).getPublicUrl(ruta).data.publicUrl ?? null;

  // El anterior deja de ser el vigente ANTES de insertar el nuevo: en ningún momento hay dos.
  if (previo) {
    await sb.from("assets").update({ is_current: false })
      .eq("id", (previo as { id: string }).id);
  }

  const fila = {
    id: assetId, group_id: grupo, version: nuevaVersion, is_current: true,
    name: fichero.nombre, kind: "card_artwork", subject_type: "card", subject_id: subjectId,
    source: "manual", quality: 0, format: val.formato, bytes: fichero.bytes.byteLength,
    checksum: await sha256(fichero.bytes), priority: 0, status: "approved",
    bucket: ASSET_BUCKET, storage_path: ruta, url,
    tags: ["card-artwork"],
    meta: { cardId, cardVersion: version },
    created_by: actor,
  };
  const { error } = await sb.from("assets").insert(fila);
  if (error) return { ok: false, error: error.message, status: 500 };

  return { ok: true, data: filaAArtwork(fila as unknown as Record<string, unknown>) };
}

/** El artwork VIGENTE de cada versión de una carta. Vacío si no se ha subido ninguno. */
export async function artworkDeCarta(
  sb: SupabaseClient, cardId: string,
): Promise<Record<number, ArtworkAsset>> {
  const { data } = await sb.from("assets").select("*")
    .eq("subject_type", "card").eq("kind", "card_artwork").eq("is_current", true)
    .like("subject_id", `${cardId}#v%`);
  const out: Record<number, ArtworkAsset> = {};
  for (const r of ((data ?? []) as Record<string, unknown>[])) {
    const a = filaAArtwork(r);
    if (a.cardVersion > 0) out[a.cardVersion] = a;
  }
  return out;
}

/**
 * EL ARTWORK DE UN EJEMPLAR — `card_id` + `minted_version` y nada más.
 *
 * Sin heurísticas: ni la versión más reciente, ni `obtained_at`, ni la fecha del asset. Un
 * ejemplar acuñado bajo la v1 enseña el artwork de la v1 aunque exista la v2 y aunque la v2
 * sea más bonita. Es la misma regla que ya gobierna sus estadísticas desde 8.2, aplicada a
 * la ilustración.
 *
 * Devuelve `null` cuando esa versión no tiene artwork subido — y `null` significa «pinta la
 * carta como siempre, con Card3D», nunca «pon la de otra versión».
 */
export async function artworkDeInstancia(
  sb: SupabaseClient, cardId: string, mintedVersion: number | null | undefined,
): Promise<ArtworkAsset | null> {
  if (mintedVersion == null) return null;
  const { data } = await sb.from("assets").select("*")
    .eq("subject_type", "card").eq("kind", "card_artwork").eq("is_current", true)
    .eq("subject_id", subjectIdFor(cardId, mintedVersion)).maybeSingle();
  return data ? filaAArtwork(data as Record<string, unknown>) : null;
}

/**
 * EL ARTWORK DE MUCHOS EJEMPLARES A LA VEZ — la versión en lote de la anterior.
 *
 * Existe por una razón concreta: la colección pinta cientos de cartas de una vez. Preguntar
 * una por una serían cientos de peticiones para dibujar una pantalla —el N+1 clásico— y la
 * rejilla se quedaría en blanco mientras llegan.
 *
 * La regla de resolución es EXACTAMENTE la misma que la de arriba, y por eso ambas componen
 * la clave con `subjectIdFor`: `card_id` + `minted_version`, sin heurísticas. Lo único que
 * cambia es que las claves distintas se piden juntas.
 *
 * El resultado va indexado por `uid` de ejemplar, no por carta: dos copias de la misma carta
 * acuñadas bajo versiones distintas son dos entradas distintas, que es justo lo que impide
 * que una enseñe el artwork de la otra.
 *
 * Un ejemplar sin `minted_version` —o cuya versión no tiene artwork— simplemente no aparece
 * en el mapa, y ausencia significa «píntala como siempre».
 */
export async function artworkDeInstancias(
  sb: SupabaseClient,
  instancias: { uid: string; cardId: string; mintedVersion?: number | null }[],
): Promise<Record<string, ArtworkAsset>> {
  const claves = new Map<string, string[]>(); // subject_id → uids que lo comparten
  for (const i of instancias) {
    if (i.mintedVersion == null) continue;
    const k = subjectIdFor(i.cardId, i.mintedVersion);
    const lista = claves.get(k);
    if (lista) lista.push(i.uid);
    else claves.set(k, [i.uid]);
  }
  if (claves.size === 0) return {};

  /*
   * En TANDAS. `in(...)` viaja en la URL, y una colección grande tiene cientos de claves
   * distintas: sin trocear se choca contra el límite de longitud de la petición y contra el
   * `max_rows` de PostgREST, que trunca EN SILENCIO — un artwork que falta sin decirlo.
   */
  const TANDA = 150;
  const todas = [...claves.keys()];
  const filas: Record<string, unknown>[] = [];
  for (let i = 0; i < todas.length; i += TANDA) {
    const { data, error } = await sb.from("assets").select("*")
      .eq("subject_type", "card").eq("kind", "card_artwork").eq("is_current", true)
      .in("subject_id", todas.slice(i, i + TANDA));
    if (error) return {};
    filas.push(...((data ?? []) as Record<string, unknown>[]));
  }

  const out: Record<string, ArtworkAsset> = {};
  for (const fila of filas) {
    const a = filaAArtwork(fila);
    for (const uid of claves.get(String(fila.subject_id)) ?? []) out[uid] = a;
  }
  return out;
}
