/**
 * ARTE DE DRL CREDITS — FICHERO GENERADO por `scripts/credits-art/render.ts`. No se edita a mano.
 *
 * Una escena por paquete (y el héroe). `coins` es el número de monedas DIBUJADAS: la regla visual del producto
 * («más créditos, más monedas») la fija `creditsArt.test.ts` contra el catálogo de `domain/economy/drlCredits`.
 */
export interface CreditsArt { id: string; file: string; width: number; height: number; bytes: number; coins: number; chest: "none" | "standard" | "premium" }

export const CREDITS_ART: readonly CreditsArt[] = [
  {
    "id": "starter",
    "file": "/store/credits/starter.webp",
    "width": 720,
    "height": 540,
    "bytes": 44112,
    "coins": 6,
    "chest": "none"
  },
  {
    "id": "basic",
    "file": "/store/credits/basic.webp",
    "width": 720,
    "height": 540,
    "bytes": 53932,
    "coins": 23,
    "chest": "none"
  },
  {
    "id": "popular",
    "file": "/store/credits/popular.webp",
    "width": 720,
    "height": 540,
    "bytes": 70958,
    "coins": 68,
    "chest": "none"
  },
  {
    "id": "large",
    "file": "/store/credits/large.webp",
    "width": 720,
    "height": 540,
    "bytes": 72042,
    "coins": 91,
    "chest": "standard"
  },
  {
    "id": "ultimate",
    "file": "/store/credits/ultimate.webp",
    "width": 720,
    "height": 540,
    "bytes": 95652,
    "coins": 186,
    "chest": "premium"
  },
  {
    "id": "hero",
    "file": "/store/credits/hero.webp",
    "width": 1600,
    "height": 900,
    "bytes": 244792,
    "coins": 211,
    "chest": "premium"
  }
];
