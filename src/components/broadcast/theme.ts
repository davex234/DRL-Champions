/**
 * Tema del Broadcast Overlay (capa visual). Colores de bando consistentes con el
 * observer. Centralizado para coherencia entre todos los elementos del overlay.
 */
export const ATK = "#ff3b5c";
export const DEF = "#19e3ff";
export const sideHex = (side: "ATK" | "DEF"): string => (side === "ATK" ? ATK : DEF);

export const ACCENT = {
  gold: "#ffce4f",
  clutch: "#ff2e63",
  plant: "#ff8a3d",
  white: "#e8eef5",
};
