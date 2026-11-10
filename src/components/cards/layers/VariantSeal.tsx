/**
 * EL SELLO DE VARIANTE — la silueta que dice qué reconoce una carta.
 *
 * ────────────────────────── POR QUÉ UNA FORMA Y NO UN COLOR ──────────────────────────
 *
 * Tres de las ocho variantes reales comparten el color exacto `#ff2e63` (mythic, clutch,
 * top-kills) y otras dos comparten el dorado. Distinguirlas por tono es imposible **por
 * construcción**, no por falta de afinado. Una silueta sí se distingue, y además sobrevive a
 * todo lo que un color no sobrevive: pantalla pequeña, movimiento reducido, captura estática,
 * daltonismo y cualquier paleta futura.
 *
 * ────────────────────────── LA GEOMETRÍA ──────────────────────────
 *
 * SVG en línea, dibujado aquí, original. Ni un asset externo, ni un logotipo de nadie, ni un
 * icono de una librería: cuatro siluetas construidas con la misma gramática —ángulos rectos y
 * diagonales de 45°, como el chaflán de las placas de NEXUS— para que se lean como familia.
 *
 *     MVP       rombo con estrella de cuatro puntas    el mejor
 *     CAMPEÓN   corona de tres almenas sobre barra     ganó el torneo
 *     CLUTCH    anillo con muesca y punto              se quedó solo
 *     TOP       galón ascendente sobre base            lideró una estadística
 *
 * ────────────────────────── ACCESIBILIDAD ──────────────────────────
 *
 * El sello NO es decorativo: es el dato que distingue una carta de otra. Lleva `role="img"` y
 * su `aria-label`, así que un lector de pantalla dice «MVP del torneo» y no se queda con la
 * etiqueta de diez píxeles. Cuando va acompañado del texto de la variante —en la placa— el
 * sello se marca decorativo para no leer dos veces lo mismo.
 */
import type { SealShape } from "@/design/variantIdentity";

/** Trazos de cada silueta, en una caja de 24×24. */
function path(shape: Exclude<SealShape, null>): React.ReactNode {
  switch (shape) {
    case "mvp":
      // Rombo + estrella de cuatro puntas: el vértice hacia arriba es «lo más alto».
      return (
        <>
          <path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 6.4 13.6 10.4 17.6 12 13.6 13.6 12 17.6 10.4 13.6 6.4 12 10.4 10.4Z" fill="currentColor" />
        </>
      );
    case "champion":
      // Corona de tres almenas sobre su barra: la única silueta con base plana y ancha.
      return (
        <>
          <path d="M3 17.5h18v3H3z" fill="currentColor" />
          <path d="M3 15.5 4.7 6.5l3.6 3.6L12 4l3.7 6.1 3.6-3.6 1.7 9z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </>
      );
    case "clutch":
      // Anillo abierto por arriba + punto: uno dentro, el cerco incompleto.
      return (
        <>
          <path d="M16.9 4.6a9 9 0 1 1-9.8 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="12.5" r="3.1" fill="currentColor" />
        </>
      );
    case "top":
      // Galón ascendente sobre base: la única con dirección.
      return (
        <>
          <path d="M3.5 13.5 12 5l8.5 8.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.5 19.5h11" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
        </>
      );
  }
}

export function VariantSeal({
  shape,
  label,
  size = 12,
  className,
  /** El texto de la variante ya está al lado: entonces el sello no se vuelve a leer. */
  decorative = false,
}: {
  shape: SealShape;
  label?: string;
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  if (!shape) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      {...(decorative || !label
        ? { "aria-hidden": true }
        : { role: "img" as const, "aria-label": label })}
    >
      {path(shape)}
    </svg>
  );
}
