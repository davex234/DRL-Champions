import type { PackDef } from "@/domain/packs/types";

/**
 * Catálogo de sobres. Cada uno con probabilidades y precio distintos.
 * Añadir un sobre nuevo (o de evento) = añadir una entrada aquí.
 */
export const PACKS: PackDef[] = [
  {
    id: "inicial",
    name: "Sobre Inicial",
    description: "Tu primer paso. Cartas base para empezar tu colección.",
    price: 0,
    cardCount: 5,
    weights: { common: 70, uncommon: 26, rare: 3.5, epic: 0.5, legendary: 0 },
    accent: "#19e3ff",
    tag: "Gratis",
  },
  {
    id: "estandar",
    name: "Sobre Estándar",
    description: "El sobre de cada día. Equilibrado y asequible.",
    price: 750,
    cardCount: 5,
    weights: { common: 55, uncommon: 35, rare: 8, epic: 1.8, legendary: 0.2 },
    accent: "#8b96a3",
  },
  {
    id: "premium",
    name: "Sobre Premium",
    description: "Mejores probabilidades. Carta rara o superior garantizada.",
    price: 2500,
    cardCount: 6,
    weights: { common: 30, uncommon: 45, rare: 18, epic: 6, legendary: 1 },
    guaranteedMin: "rare",
    accent: "#ffce4f",
    tag: "Premium",
  },
  {
    id: "masters",
    name: "Sobre Masters",
    description: "Estrellas de los Masters internacionales. Épica garantizada.",
    price: 5000,
    cardCount: 5,
    weights: { common: 10, uncommon: 40, rare: 30, epic: 17, legendary: 3 },
    guaranteedMin: "epic",
    restrictGroups: ["internacional", "base", "regional"],
    accent: "#ff8a3d",
    tag: "Evento",
    eventId: "masters-toronto",
  },
  {
    id: "champions",
    name: "Sobre Champions",
    description: "Los mejores del mundo. La mayor probabilidad de legendarias.",
    price: 8000,
    cardCount: 5,
    weights: { common: 5, uncommon: 30, rare: 35, epic: 22, legendary: 8 },
    guaranteedMin: "epic",
    restrictGroups: ["internacional", "base", "regional"],
    accent: "#ffd35c",
    tag: "Evento",
    eventId: "champions-paris",
  },
  {
    id: "ewc",
    name: "Sobre EWC",
    description: "Estrellas de la Esports World Cup. Épica garantizada.",
    price: 6000,
    cardCount: 5,
    weights: { common: 8, uncommon: 38, rare: 32, epic: 19, legendary: 3 },
    guaranteedMin: "epic",
    restrictGroups: ["internacional", "base", "regional"],
    accent: "#19e3ff",
    tag: "Evento",
    eventId: "ewc-2026",
  },
  {
    id: "emea",
    name: "Sobre EMEA",
    description: "Solo jugadores de la región EMEA.",
    price: 3000,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    accent: "#19e3ff",
    tag: "Regional",
  },
  {
    id: "americas",
    name: "Sobre Americas",
    description: "Solo jugadores de la región Americas.",
    price: 3000,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Americas",
    accent: "#19e3ff",
    tag: "Regional",
  },
  {
    id: "pacific",
    name: "Sobre Pacific",
    description: "Solo jugadores de la región Pacific.",
    price: 3000,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Pacific",
    accent: "#19e3ff",
    tag: "Regional",
  },
  {
    id: "china",
    name: "Sobre China",
    /*
     * SIN EPICAS NI LEGENDARIAS, Y AHORA SE DICE (Fase 13).
     *
     * Declaraba un 6 % de épicas y un 1 % de legendarias que NO PUEDE entregar: ningún
     * jugador de la región China tiene un galardón que abra esas rarezas (medido en
     * `npm run content:audit`: 0 de 89 jugadores, frente a 5 en EMEA y 7 en Americas). Es un
     * hecho del palmarés real, no un fallo de datos, y fabricar el galardón sería inventar
     * un resultado deportivo.
     *
     * Poner esos pesos a cero NO cambia ni un sorteo —el motor ya renormalizaba sobre los
     * buckets con cartas—, así que esto es exclusivamente una corrección de honestidad:
     * el sobre deja de anunciar una probabilidad inalcanzable.
     *
     * Y la contrapartida, medida: al no repartir nunca a rarezas que no tiene, es el
     * regional MÁS BARATO por carta en las tres que sí entrega (común 1.583 frente a 1.704,
     * poco común 1.399 frente a 1.500, rara 3.123 frente a 3.367). No es un sobre peor: es
     * un sobre sin premio gordo y con mejor tasa base.
     */
    description: "Solo jugadores de la región China. Sin épicas ni legendarias, y mejor tasa base.",
    price: 3000,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 0, legendary: 0 },
    restrictRegion: "China",
    accent: "#19e3ff",
    tag: "Regional",
  },
  {
    /*
     * PRIME, RETIRADO DEL ESCAPARATE (Fase 13).
     *
     * Medido en `content:audit` y `economy:model`: está DOMINADO en todos los ejes que se
     * pueden medir.
     *
     *   · Coste por rareza: 1,84× el mejor en épicas, 1,38× en legendarias, 6,13× en raras.
     *   · Coste por carta del grupo `exclusiva` —su único nicho posible, porque no restringe
     *     grupo—: 10.050 frente a los 8.071 del Premium.
     *   · Certeza de llevarse una `exclusiva`: 2 sobres para el 90 %, o sea 20.000 créditos,
     *     exactamente lo mismo que cuestan los 8 Premium que dan la misma certeza.
     *   · Y es el ÚNICO sobre cuyo percentil 10 (8.850) queda por debajo de su precio.
     *
     * La causa es estructural: con 34 raras, 9 épicas y 7 legendarias, el catálogo sostiene
     * tres sobres de rareza alta (Premium, Masters, Icon) y Prime es el cuarto.
     *
     * NO se borra. La variante `prime` tiene 5 cartas, hay recompensas que conceden sobres
     * Prime y hay jugadores con sobres sin abrir: borrarlo rompería las tres cosas. Se deja
     * de VENDER, que es lo único que estaba mal.
     *
     * Vuelve al escaparate cuando el catálogo tenga cartas suficientes de rareza alta para
     * que deje de estar dominado — la condición es objetiva y `content:verify` la vigila.
     */
    retired: true,
    id: "prime",
    name: "Sobre Prime",
    description: "Cartas Prime exclusivas con stats mejorados.",
    price: 10000,
    cardCount: 4,
    weights: { common: 0, uncommon: 25, rare: 35, epic: 30, legendary: 10 },
    guaranteedMin: "epic",
    accent: "#7b5cff",
    tag: "Exclusivo",
  },
  {
    id: "icon",
    name: "Sobre Icon",
    description: "La élite legendaria. Leyendas e Iconos del juego.",
    price: 20000,
    cardCount: 3,
    weights: { common: 0, uncommon: 0, rare: 30, epic: 45, legendary: 25 },
    guaranteedMin: "legendary",
    accent: "#f5f0e6",
    tag: "Legendario",
  },
];

export const PACK_BY_ID = new Map(PACKS.map((p) => [p.id, p]));

export function getPack(id: string): PackDef | undefined {
  return PACK_BY_ID.get(id);
}
