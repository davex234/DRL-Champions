"use client";

/**
 * ARTWORK MANUAL POR EJEMPLAR — caché de presentación.
 *
 * ────────────────────────── POR QUÉ NO VIVE EN `useGameStore` ──────────────────────────
 *
 * Porque `useGameStore` se PERSISTE, y esto no debe persistirse. El mapa lo deriva el
 * servidor de la tabla `assets`: si un diseñador reemplaza el artwork de una versión, la URL
 * guardada en `localStorage` señalaría al fichero viejo hasta que alguien limpiara el
 * navegador. Es una caché de una respuesta, y las cachés de respuestas se vuelven a pedir.
 *
 * Tampoco es estado de juego: no cambia lo que tienes ni lo que vale. Mezclarlo con crédito,
 * ejemplares y sobres habría metido presentación dentro de la autoridad económica.
 *
 * ────────────────────────── POR QUÉ POR `uid` Y NO POR CARTA ──────────────────────────
 *
 * Porque la clave del problema es la VERSIÓN. Dos copias de la misma carta acuñadas bajo
 * versiones distintas tienen artworks distintos, y un mapa indexado por `card_id` obligaría
 * al navegador a elegir entre ellos. Indexado por ejemplar no hay nada que elegir: el
 * servidor ya resolvió por `card_id` + `minted_version` y esto solo lo guarda.
 *
 * Sin sesión el mapa está vacío y todo cae al dibujado de siempre, que es el comportamiento
 * correcto: el modo local no tiene ejemplares acuñados en ningún servidor.
 */
import { create } from "zustand";
import type { ArtworkByUid, CardArtworkRef } from "@/domain/cards/artwork";

interface ArtworkState {
  byUid: ArtworkByUid;
  /**
   * Vuelca el mapa que vino con el estado. REEMPLAZA, no fusiona: si un artwork dejó de
   * existir en el servidor tiene que dejar de existir aquí, y fusionar lo dejaría vivo.
   */
  setArtworks: (map: ArtworkByUid) => void;
  /**
   * COLECCIONES ILIMITADAS · añade el artwork de ejemplares pedidos aparte (una página de copias, los de un equipo).
   * Aquí sí se fusiona: son ejemplares que el estado no trae. El siguiente `setArtworks` vuelve a empezar de cero.
   */
  addArtworks: (map: ArtworkByUid) => void;
  /** El artwork de UN ejemplar, o `undefined` si esa versión no tiene. */
  artworkOf: (uid: string | undefined | null) => CardArtworkRef | undefined;
}

export const useArtworkStore = create<ArtworkState>((set, get) => ({
  byUid: {},
  setArtworks: (map) => set({ byUid: map ?? {} }),
  addArtworks: (map) => { if (map && Object.keys(map).length > 0) set((s) => ({ byUid: { ...s.byUid, ...map } })); },
  artworkOf: (uid) => (uid ? get().byUid[uid] : undefined),
}));
