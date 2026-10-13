/**
 * CATÁLOGO DE LA TIENDA — la ÚNICA configuración de lo que se enseña y se vende en /tienda (Fase 49).
 *
 * Cambiar la tienda = editar este fichero. Ningún componente lleva precios, ids ni textos de producto.
 * El resolvedor (`domain/store/resolve.ts`) lo cruza con el catálogo real (sobres, cartas, ciclo de
 * vida) y el servidor lo vuelve a resolver por `productId` en cada compra: lo que diga el navegador no
 * cuenta. `validateStoreCatalog` (test) comprueba que todo lo de aquí existe y es coherente.
 *
 * ────────────────────────── CÓMO SE CAMBIA ──────────────────────────
 *
 *   · Otra carta en «Cartas destacadas»: añade/edita una entrada de `cardOffers` con su `cardId` (el id
 *     del catálogo, p. ej. `leaf__champions-s`). `enabled: false` la retira sin borrarla; `sortOrder`
 *     ordena; `featured` la marca «Destacada».
 *   · Poner precio: `realMoneyPrice: { cents: 199, currency: "EUR" }` y/o `gameCurrencyPrice` (créditos).
 *     Sin precio, el método se enseña «por anunciar». Con precio, se sigue sin cobrar mientras no haya
 *     pasarela (`PAYMENTS_ENABLED`) o el servidor no sepa entregar esa clase por créditos.
 *   · Ventanas: `startAt`/`endAt` en ISO-8601. Fuera de la ventana la oferta no existe.
 *
 * ────────────────────────── LO QUE NO SE DECIDE AQUÍ ──────────────────────────
 *
 *   · El precio de un SOBRE en créditos: es el de `data/packs` (lo cobra `app_buy_pack`).
 *   · Si un sobre se puede vender: lo decide su ciclo de vida (DRAFT/RETIRED nunca se venden).
 *
 * PRECIOS EN EUROS: ninguno está decidido todavía (2026-09-21). Todos van a `null` a propósito.
 */
import type { StoreCatalogConfig } from "@/domain/store/types";

export const STORE_CATALOG: StoreCatalogConfig = {
  version: 1,

  featuredHero: [
    {
      id: "champions-s",
      enabled: true,
      sortOrder: 1,
      editionId: "champions-s",
      eyebrow: "Destacado",
      title: "Champions S",
      subtitle: "Nuevas cartas. Nuevas leyendas.",
      description: "Las épicas de la temporada: los mejores del circuito en su mejor versión. Salen en el Sobre Champions y en el Sobre Icon.",
      // Las cinco Champions S de más OVR con equipos distintos (catálogo real, 2026-09-21).
      cardIds: ["slowly__champions-s", "s0pp__champions-s", "buzz__champions-s", "leaf__champions-s", "meteor__champions-s"],
      packId: "champions",
      ctaLabel: "Ver Sobre Champions",
    },
  ],

  // Sobres: el precio en créditos es el del sobre. Dinero real previsto (BOTH) y sin precio decidido.
  packOffers: [
    { id: "estandar", packId: "estandar", enabled: true, sortOrder: 10, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "premium", packId: "premium", enabled: true, sortOrder: 20, purchaseMode: "BOTH", realMoneyPrice: null, badge: "FEATURED" },
    /* Oro cierra la gama base, justo detrás de Bronce y Plata. */
    { id: "oro", packId: "oro", enabled: true, sortOrder: 30, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "champions", packId: "champions", enabled: true, sortOrder: 30, purchaseMode: "BOTH", realMoneyPrice: null, badge: "NEW" },
    /* ICON (2026-10-09) · dos sobres ICON: 1 carta a 30.000 (nuevo) y 3 cartas a 80.000 (el `icon` de siempre). */
    { id: "icon-single", packId: "icon-single", enabled: true, sortOrder: 39, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "icon", packId: "icon", enabled: true, sortOrder: 40, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "masters", packId: "masters", enabled: true, sortOrder: 50, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "ewc", packId: "ewc", enabled: true, sortOrder: 60, purchaseMode: "BOTH", realMoneyPrice: null },
    // El Sobre Inicial es gratis y lo reparte el servidor con su propia regla: solo créditos (0).
    { id: "inicial", packId: "inicial", enabled: true, sortOrder: 70, purchaseMode: "GAME_CURRENCY" },
    { id: "emea", packId: "emea", enabled: true, sortOrder: 80, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "americas", packId: "americas", enabled: true, sortOrder: 81, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "pacific", packId: "pacific", enabled: true, sortOrder: 82, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "china", packId: "china", enabled: true, sortOrder: 83, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "team-heretics", packId: "team-heretics", enabled: true, sortOrder: 90, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "team-fnatic", packId: "team-fnatic", enabled: true, sortOrder: 91, purchaseMode: "BOTH", realMoneyPrice: null },
    /* NAVI retirado del escaparate (2026-09-22): la definición y el inventario se conservan. */
    { id: "team-navi", packId: "team-navi", enabled: false, sortOrder: 92, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "team-liquid", packId: "team-liquid", enabled: true, sortOrder: 94, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "team-karmine", packId: "team-karmine", enabled: true, sortOrder: 95, purchaseMode: "BOTH", realMoneyPrice: null },
    { id: "team-g2", packId: "team-g2", enabled: true, sortOrder: 93, purchaseMode: "BOTH", realMoneyPrice: null },
  ],

  // Cajas: 10 sobres del tipo, al inventario y sin abrir. Solo dinero real (regla de producto).
  boxOffers: [
    { id: "caja-estandar", name: "Caja Estándar", packId: "estandar", enabled: true, sortOrder: 10, purchaseMode: "REAL_MONEY", realMoneyPrice: null },
    { id: "caja-premium", name: "Caja Premium", packId: "premium", enabled: true, sortOrder: 20, purchaseMode: "REAL_MONEY", realMoneyPrice: null },
    { id: "caja-masters", name: "Caja Masters", packId: "masters", enabled: true, sortOrder: 30, purchaseMode: "REAL_MONEY", realMoneyPrice: null },
    { id: "caja-champions", name: "Caja Champions", packId: "champions", enabled: true, sortOrder: 40, purchaseMode: "REAL_MONEY", realMoneyPrice: null, badge: "FEATURED" },
  ],

  // Cartas concretas que vende la casa (NO es el Marketplace). Selección inicial automática: una por
  // rareza, entre las de más OVR del catálogo real. Editable a mano.
  cardOffers: [
    { id: "mada__moments", cardId: "mada__moments", featured: true, enabled: true, sortOrder: 10, purchaseMode: "BOTH", gameCurrencyPrice: null, realMoneyPrice: null },
    { id: "leaf__champions-s", cardId: "leaf__champions-s", featured: false, enabled: true, sortOrder: 20, purchaseMode: "BOTH", gameCurrencyPrice: null, realMoneyPrice: null },
    { id: "xross__future-star", cardId: "xross__future-star", featured: false, enabled: true, sortOrder: 30, purchaseMode: "BOTH", gameCurrencyPrice: null, realMoneyPrice: null },
    { id: "jinggg__masters-l", cardId: "jinggg__masters-l", featured: false, enabled: true, sortOrder: 40, purchaseMode: "BOTH", gameCurrencyPrice: null, realMoneyPrice: null },
  ],

  // Packs especiales: combinaciones explícitas de recursos que ya existen (sobres, cartas, créditos).
  bundleOffers: [
    {
      id: "pack-inicio", name: "Pack Inicio", tagline: "Para arrancar la colección con ventaja.",
      enabled: true, sortOrder: 10, purchaseMode: "REAL_MONEY", realMoneyPrice: null,
      contents: { packs: [{ packId: "estandar", count: 5 }, { packId: "premium", count: 1 }], cardIds: [], credits: 2000 },
    },
    {
      id: "pack-coleccionista", name: "Pack Coleccionista", tagline: "Sobres de competición y una épica garantizada.",
      enabled: true, sortOrder: 20, purchaseMode: "REAL_MONEY", realMoneyPrice: null,
      contents: { packs: [{ packId: "premium", count: 5 }, { packId: "masters", count: 2 }], cardIds: ["trent__champions-s"], credits: 5000 },
    },
  ],
};
