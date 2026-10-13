/**
 * CICLO DE VIDA DE UN SOBRE — la autoridad de estado, del lado del SERVIDOR (Fase 20.4).
 *
 * ────────────────────────── QUÉ RESUELVE ──────────────────────────
 *
 * Hasta la Fase 20.4, `buyPack`/`openPackForUser` solo comprobaban que el sobre EXISTIERA. Un
 * sobre `retired` (p. ej. `prime`) se podía comprar por API aunque la tienda lo escondiera, y un
 * sobre en preparación no tenía forma de existir en Admin sin ser comprable. La visibilidad vivía
 * solo en React (`tienda/page.tsx` filtra `!retired`), que es exactamente lo que §SEGURIDAD
 * prohíbe: el estado no puede depender de la interfaz.
 *
 * Este módulo es la ÚNICA fuente de verdad del estado y de qué operaciones permite. Es PURO
 * (sin BD, sin red): lo llaman las funciones de servicio, que corren en servidor.
 *
 * ────────────────────────── LOS TRES ESTADOS ──────────────────────────
 *
 *   DRAFT   — configurable en Admin (pools, artwork, precio), pero NO público: ni tienda, ni
 *             compra, ni apertura por la ruta pública. No participa en operaciones de juego.
 *   ACTIVE  — producto vivo: tienda + compra + apertura.
 *   RETIRED — fuera de venta (la compra se rechaza en servidor), pero **abrible si ya se posee**:
 *             hay recompensas que conceden estos sobres y jugadores con ejemplares sin abrir.
 *             No se borra nada (pools, versiones, `user_cards`, `card_mints` intactos).
 *
 * ────────────────────────── RETROCOMPATIBILIDAD ──────────────────────────
 *
 * `packLifecycle()` deriva el estado sin romper ningún sobre existente: si un `PackDef` declara
 * `lifecycle`, manda; si no, `retired:true ⇒ RETIRED` y en otro caso `ACTIVE`. Así `prime`
 * (que hoy usa `retired:true`) queda RETIRED y todos los demás ACTIVE, sin tocar sus datos.
 */
import type { PackDef, PackLifecycle } from "./types";
import { ns } from "@/i18n/runtime";

const t = ns("packs");

/**
 * Estado canónico de un sobre. Deriva de `lifecycle` (explícito) o de `retired` (heredado).
 * Nunca lanza: un `PackDef` mal formado se trata como `ACTIVE` solo si no dice lo contrario, lo
 * cual es imposible aquí porque el tipo obliga a `lifecycle?`/`retired?`.
 */
export function packLifecycle(pack: Pick<PackDef, "lifecycle" | "retired">): PackLifecycle {
  if (pack.lifecycle) return pack.lifecycle;
  return pack.retired ? "RETIRED" : "ACTIVE";
}

/** ¿Es un producto comprable? Solo `ACTIVE`. */
export function isPurchasable(pack: Pick<PackDef, "lifecycle" | "retired">): boolean {
  return packLifecycle(pack) === "ACTIVE";
}

/**
 * ¿Es un borrador en preparación? Un DRAFT no es público: no tiene aún artwork final, ni
 * estadística de tienda, ni entra en las recomendaciones de compra. Los invariantes de
 * «producto público» (manifiesto de artwork, `packStats`, guía) lo excluyen por esto.
 */
export function isDraft(pack: Pick<PackDef, "lifecycle" | "retired">): boolean {
  return packLifecycle(pack) === "DRAFT";
}

/** ¿Debe aparecer como producto en la tienda pública? Solo `ACTIVE`. */
export function isStoreVisible(pack: Pick<PackDef, "lifecycle" | "retired">): boolean {
  return packLifecycle(pack) === "ACTIVE";
}

/**
 * ¿Se puede ABRIR por la ruta pública (suponiendo que se posee)? `ACTIVE` y `RETIRED` sí;
 * `DRAFT` no. La posesión la comprueba el servicio aparte: esto solo decide si el ESTADO del
 * producto lo permite.
 */
export function isPubliclyOpenable(pack: Pick<PackDef, "lifecycle" | "retired">): boolean {
  return packLifecycle(pack) !== "DRAFT";
}

/**
 * ¿Sigue siendo resoluble para histórico? Los tres estados: un sobre nunca «desaparece» —
 * `getPack` lo encuentra siempre—; lo que cambia es qué operaciones permite. RETIRED es
 * justamente «resoluble pero no vendible».
 */
export function isHistoricallyResolvable(pack: Pick<PackDef, "lifecycle" | "retired"> | undefined): boolean {
  return pack !== undefined;
}

// ────────────────────────── GUARDAS DE OPERACIÓN (servidor) ──────────────────────────

/** Veredicto de una guarda: `ok`, o un motivo con código HTTP para responder. */
export type LifecycleVerdict =
  | { ok: true }
  | { ok: false; reason: string; status: number };

const NOT_FOUND: LifecycleVerdict = { ok: false, reason: "Sobre no encontrado", status: 404 };

/**
 * ¿Puede COMPRARSE este sobre? Autoridad de servidor para `buyPack`.
 *   · inexistente → 404
 *   · DRAFT       → 404 (no es un producto público: no se filtra su existencia)
 *   · RETIRED     → 409 (existe, pero ya no se vende)
 *   · ACTIVE      → ok
 *
 * DRAFT devuelve 404 y no 403 a propósito: un producto no publicado no debe ni confirmar su
 * existencia a un cliente que sondea ids. RETIRED sí es 409 porque es un producto conocido.
 */
export function guardPurchase(pack: Pick<PackDef, "lifecycle" | "retired" | "cms"> | undefined, now = Date.now()): LifecycleVerdict {
  if (!pack) return NOT_FOUND;
  const state = packLifecycle(pack);
  // F60 · un sobre del panel sólo se vende dentro de su ventana (los de código no tienen ventana: sin cambios).
  if (state === "ACTIVE" && pack.cms) {
    const from = pack.cms.availableFrom ? Date.parse(pack.cms.availableFrom) : -Infinity;
    const to = pack.cms.availableTo ? Date.parse(pack.cms.availableTo) : Infinity;
    if (!(now >= from && now < to)) return { ok: false, reason: t("Este sobre no está a la venta ahora mismo"), status: 409 };
  }
  if (state === "ACTIVE") return { ok: true };
  if (state === "RETIRED") return { ok: false, reason: t("Este sobre ya no está a la venta"), status: 409 };
  return NOT_FOUND; // DRAFT
}

/**
 * ¿Puede ABRIRSE por la ruta pública? Autoridad de servidor para `openPackForUser`. NO comprueba
 * posesión (eso lo hace la RPC dentro de la transacción); solo el estado del producto.
 *   · inexistente → 404
 *   · DRAFT       → 404 (no abrible públicamente sin autorización administrativa explícita)
 *   · ACTIVE      → ok
 *   · RETIRED     → ok (histórico: si se posee, se abre)
 */
export function guardPublicOpen(pack: Pick<PackDef, "lifecycle" | "retired"> | undefined): LifecycleVerdict {
  if (!pack) return NOT_FOUND;
  if (isPubliclyOpenable(pack)) return { ok: true };
  return NOT_FOUND; // DRAFT
}
