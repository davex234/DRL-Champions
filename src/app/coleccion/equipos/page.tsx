"use client";

/**
 * COLECCIÓN POR EQUIPO — `/coleccion/equipos` (Fase 21.3, §8).
 *
 * Sub-ruta del álbum: explora la colección del usuario agrupada por equipo. Reutiliza el sistema
 * existente (store, identidades, componentes de carta y el visor de detalle); no crea un segundo
 * inventario ni toca el álbum principal.
 */
import { HydrationGate } from "@/components/layout/HydrationGate";
import { TeamCollection } from "@/components/collection/TeamCollection";

export default function TeamCollectionPage() {
  return (
    <HydrationGate>
      <TeamCollection />
    </HydrationGate>
  );
}
