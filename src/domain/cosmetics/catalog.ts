/**
 * CATÁLOGO DE COSMÉTICOS (Fase 12) — dominio PURO.
 *
 * ────────────────────────── QUÉ FALTABA ──────────────────────────
 *
 * La Fase 11 cerró la mitad del problema: los cosméticos del carril de aspecto ya se pueden
 * EQUIPAR (`profiles.equipped`, `app_equip_cosmetic`). Pero equipar algo que no se ve en
 * ninguna parte sigue siendo un id en una tabla. El carril de pago del pase reparte
 * exclusivamente aspecto, así que un aspecto invisible es un producto que no existe.
 *
 * Lo que falta es lo de siempre: la traducción de `marco:neon` a algo que un ojo pueda
 * reconocer. Eso es lo que hay aquí, y nada más.
 *
 * ────────────────────────── LO QUE ESTE FICHERO NO ES ──────────────────────────
 *
 * No es un sistema cosmético. No hay motor, ni capas, ni composición, ni tabla nueva. Es un
 * diccionario de presentación: id → nombre y color. Un cosmético que se reparta mañana y no
 * esté aquí NO desaparece: se enseña con su nombre derivado del id y el tono neutro. Es
 * deliberado —un cosmético concedido y no pintado sería otra vez el fallo de la Fase 10—.
 *
 * ────────────────────────── LAS CUATRO FAMILIAS ──────────────────────────
 *
 *   titulo    Una línea de texto bajo el nombre. Es el más visible y el más barato.
 *   marco     Un aro alrededor del avatar.
 *   avatar    Un emblema propio, en lugar del emoji elegido a mano.
 *   banderin  Una insignia pequeña junto al nombre.
 *   insignia  El reconocimiento de la maestría de colección (Fase 13). A diferencia de las
 *             otras cuatro, NO se escribe a mano: son 166 y las deriva `collection/mastery`
 *             del propio catálogo, así que un equipo nuevo trae su insignia sin que nadie la
 *             añada aquí. `cosmetic()` sabe pintar lo que no conoce, y por eso funciona.
 */

export type CosmeticFamily = "titulo" | "marco" | "avatar" | "banderin" | "insignia";

export const FAMILY_LABEL: Record<CosmeticFamily, string> = {
  titulo: "Título",
  marco: "Marco",
  avatar: "Avatar",
  banderin: "Banderín",
  insignia: "Insignia",
};

export const FAMILY_ORDER: CosmeticFamily[] = ["titulo", "marco", "avatar", "banderin", "insignia"];

export interface CosmeticDef {
  id: string;
  family: CosmeticFamily;
  label: string;
  /** Color del cosmético. En `marco` es el aro; en el resto, el acento del texto. */
  color: string;
  /** Solo para `avatar` y `banderin`: el glifo que se pinta. */
  glyph?: string;
}

const DEFS: CosmeticDef[] = [
  // Títulos — el carril libre, de menor a mayor.
  { id: "titulo:aspirante", family: "titulo", label: "Aspirante", color: "#8b96a3" },
  { id: "titulo:analista", family: "titulo", label: "Analista", color: "#19e3ff" },
  { id: "titulo:estratega", family: "titulo", label: "Estratega", color: "#7b5cff" },
  { id: "titulo:leyenda-s1", family: "titulo", label: "Leyenda · Temporada 1", color: "#ffd35c" },

  // Marcos.
  { id: "marco:circuito", family: "marco", label: "Circuito", color: "#8b96a3" },
  { id: "marco:neon", family: "marco", label: "Neón", color: "#19e3ff" },
  { id: "marco:holografico", family: "marco", label: "Holográfico", color: "#ff2e63" },
  { id: "marco:prime", family: "marco", label: "Prime", color: "#ffd35c" },

  // Avatares.
  { id: "avatar:nexus-visor", family: "avatar", label: "Visor", color: "#8b96a3", glyph: "◍" },
  { id: "avatar:nexus-halcon", family: "avatar", label: "Halcón", color: "#19e3ff", glyph: "◈" },
  { id: "avatar:nexus-corona", family: "avatar", label: "Corona", color: "#ffce4f", glyph: "♛" },
  { id: "avatar:nexus-prime", family: "avatar", label: "Prime", color: "#ffd35c", glyph: "✦" },

  // Banderines.
  { id: "banderin:nexus-s1", family: "banderin", label: "NEXUS S1", color: "#ff2e63", glyph: "⬢" },
  { id: "banderin:emea-s1", family: "banderin", label: "EMEA S1", color: "#19e3ff", glyph: "⬢" },
  { id: "banderin:champions-s1", family: "banderin", label: "Champions S1", color: "#ffd35c", glyph: "⬢" },
];

const BY_ID = new Map(DEFS.map((d) => [d.id, d]));

export const familyOf = (cosmeticId: string): CosmeticFamily | null => {
  const prefix = cosmeticId.split(":")[0];
  return (FAMILY_ORDER as string[]).includes(prefix) ? (prefix as CosmeticFamily) : null;
};

/**
 * Tono de una insignia de maestría, deducido de su propio eje.
 *
 * `insignia:equipo:100t` → eje `equipo`. Es el mismo reparto de color que usa el panel de
 * maestría, escrito aquí para que una insignia equipada en el perfil se vea igual que en la
 * lista de donde salió.
 */
const MASTERY_TINT: Record<string, string> = {
  equipo: "#19e3ff",
  region: "#7b5cff",
  variante: "#ffce4f",
  rareza: "#ff2e63",
};

/**
 * Escalones de PRESTIGIO (Fase 14). Una insignia mejorada lleva el escalón como último
 * segmento del id: `insignia:equipo:100t:oro`.
 *
 * Se declaran aquí —y no se importan de `collection/prestige`— para que este módulo siga
 * sin dependencias: es un diccionario de presentación y tiene que poder pintar un id
 * cualquiera sin arrastrar medio dominio. Los precios sí viven en `prestige.ts`, que es
 * donde se deciden; aquí solo está el nombre y el color.
 */
const PRESTIGE_LOOK: Record<string, { label: string; color: string }> = {
  plata: { label: "Plata", color: "#c8d2dc" },
  oro: { label: "Oro", color: "#ffce4f" },
  elite: { label: "Élite", color: "#ff2e63" },
};

/**
 * Descripción de un cosmético. **Nunca devuelve `null` para un id con familia válida**: si
 * no está en el diccionario, se deriva del propio id. Un cosmético concedido que no se
 * pudiera pintar volvería a ser el fallo que la Fase 10 documentó.
 *
 * Las 166 insignias de maestría viven exactamente por esta puerta: no están escritas, se
 * derivan. Es lo que permite que un equipo nuevo traiga la suya sin tocar este fichero.
 */
export function cosmetic(cosmeticId: string): CosmeticDef | null {
  const known = BY_ID.get(cosmeticId);
  if (known) return known;

  const family = familyOf(cosmeticId);
  if (!family) return null;

  const rest = cosmeticId.slice(family.length + 1);
  const parts = rest.split(":");

  /*
   * Si el último segmento es un escalón de prestigio, se separa: manda sobre el tono del
   * eje —una insignia de oro tiene que verse de oro— y se añade al nombre. Sin esto,
   * `insignia:equipo:100t:oro` se leería como un conjunto llamado «100t:oro».
   */
  const tierKey = parts.length > 2 ? parts[parts.length - 1] : "";
  const tier = PRESTIGE_LOOK[tierKey] ?? null;
  if (tier) parts.pop();

  /*
   * Con dos o más segmentos, el primero es el EJE (`equipo`, `region`, `rareza`…) y el
   * resto es el nombre. Vale para las insignias de maestría y también para los títulos que
   * la Fase 13 concede al completar una región (`titulo:region:emea` → «Emea»), que sin
   * esto se leerían como «Region:emea».
   */
  const [axis, ...tail] = parts;
  const hasAxis = tail.length > 0;
  const isMastery = family === "insignia" && hasAxis;
  const slug = hasAxis ? tail.join(":") : parts.join(":");

  const base = slug.replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const label = (base || FAMILY_LABEL[family]) + (tier ? ` · ${tier.label}` : "");
  return {
    id: cosmeticId,
    family,
    label,
    color: tier?.color ?? (isMastery ? MASTERY_TINT[axis] : undefined) ?? "#8b96a3",
    glyph: family === "insignia" ? (tier ? "◈" : "◆") : undefined,
  };
}

/** Lo equipado, resuelto a definiciones. Ignora en silencio lo que no tenga familia. */
export function equippedDefs(equipped: Record<string, string> | null | undefined): Partial<Record<CosmeticFamily, CosmeticDef>> {
  const out: Partial<Record<CosmeticFamily, CosmeticDef>> = {};
  for (const [family, id] of Object.entries(equipped ?? {})) {
    if (!id || !(FAMILY_ORDER as string[]).includes(family)) continue;
    const def = cosmetic(id);
    if (def && def.family === family) out[def.family] = def;
  }
  return out;
}

/** Todos los del catálogo conocido, para pruebas y para el informe. */
export const ALL_COSMETICS: readonly CosmeticDef[] = DEFS;
