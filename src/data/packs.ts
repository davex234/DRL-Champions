import type { PackDef } from "@/domain/packs/types";
import { setPackClassAliases } from "@/domain/packs/packClass";

/**
 * Catálogo de sobres. Cada uno con probabilidades y precio distintos.
 * Añadir un sobre nuevo (o de evento) = añadir una entrada aquí.
 */
export const PACKS: PackDef[] = [
  {
    id: "inicial",
    name: "Sobre Inicial",
    description: "Tu primer paso: cinco cartas de todas las ediciones para empezar tu colección.",
    price: 0,
    cardCount: 5,
    weights: { common: 70, uncommon: 26, rare: 3.5, epic: 0.5, legendary: 0 },
    accent: "#19e3ff",
    tag: "Gratis",
  },
  /*
   * ═══════════════════ LA GAMA BASE: BRONCE → PLATA → ORO (Packs Base 4.0) ═══════════════════
   *
   * Tres escalones que se leen de un vistazo, y cada salto lo marca la GARANTÍA, que es lo que
   * el dominio ya usaba para derivar el escalón (`tierForPack`): sin garantía → `base`, rara →
   * `premium`, épica → `elite`. El nombre del producto y el escalón interno son cosas distintas
   * y siguen siéndolo: Bronce es `base`, Plata es `premium` y Oro es `elite`.
   *
   * ─────────── POR QUÉ BRONCE Y PLATA CONSERVAN SU `id` ───────────
   *
   * `estandar` y `premium` son identificadores PERSISTIDOS: están en `user_packs` de cada
   * jugador, en el libro mayor (`buy_pack:estandar`), en los carriles y misiones de la
   * temporada, en el trigger de alta de la migración 0011 y en el historial de aperturas.
   * Cambiar el id habría obligado a migrar todo eso —y a decidir qué pasa con lo ya concedido—
   * para ganar cero: lo que ve el jugador es el NOMBRE. Así que esto es un renombrado, no un
   * producto nuevo: mismo precio, mismos pesos, misma garantía, mismo sorteo.
   */
  {
    id: "estandar",
    name: "Sobre Bronce",
    description: "El sobre de cada día: sobre todo Base y Plata, con opción a cualquier clase.",
    // Fase 57.4 · 750 → 1.000: a 750 rendía 6,1× por crédito, muy por encima del resto de la línea (auditoría 57.4).
    price: 2500,
    cardCount: 5,
    weights: { common: 55, uncommon: 35, rare: 8, epic: 1.8, legendary: 0.2 },
    accent: "#c87f4a",
  },
  {
    id: "premium",
    name: "Sobre Plata",
    description: "Un escalón por encima de Bronce: sin cartas Base, sobre todo Plata y Oro.",
    price: 6000,
    cardCount: 6,
    weights: { common: 30, uncommon: 45, rare: 18, epic: 6, legendary: 1 },
    // Fase 57.3 · `guaranteedMin` es solo IDENTIDAD (escalón y arte, `tierForPack`): el sorteo lo decide `packClass`.
    guaranteedMin: "rare",
    accent: "#cfd6de",
  },
  {
    /*
     * ORO — el escalón élite de la gama base. Es el ÚNICO producto nuevo de la fase.
     *
     * Su economía NO se ha inventado: es la del único escalón élite comparable que ya existe y
     * está MEDIDO, el Sobre Masters (5.000 créditos, 5 cartas, épica garantizada, pesos
     * 10/40/30/17/3), que en `economy:model` entrega 5,0× su precio en valor medio — la misma
     * banda que Bronce (5,3×) y Plata (5,4×). La escalera quedó 750 → 2.500 → 5.000 (Fase 57.4: 1.000 → 2.500 → 4.000).
     *
     * Lo que Oro NO copia de Masters es lo que hace a Masters un sobre de evento: no lleva
     * `eventId`, así que su categoría es `nexus` (gama de la casa) y no `event`.
     *
     * El aviso de la Fase 13 sigue en pie y por eso se deja escrito: el catálogo sostiene un
     * número limitado de sobres de rareza alta —hoy 20 raras, 20 épicas y 3 legendarias— y
     * `prime` se retiró por quedar DOMINADO al ser el cuarto. Oro entra en esa misma cola: si
     * `economy:model` lo mide dominado, la decisión correcta es bajarlo de escalón o retirarlo,
     * no compensarlo tocando las cartas.
     */
    id: "oro",
    name: "Sobre Oro",
    description: "Acceso real a cartas muy buenas: desde Oro hacia arriba.",
    // Fase 57.4 · 5.000 → 4.000: al mismo precio que Masters rendía 3,6× frente a 4,4× (dominado por Masters).
    price: 12000,
    cardCount: 5,
    weights: { common: 10, uncommon: 40, rare: 30, epic: 17, legendary: 3 },
    // Fase 57.3 · `guaranteedMin` es solo IDENTIDAD (escalón y arte, `tierForPack`): el sorteo lo decide `packClass`.
    guaranteedMin: "epic",
    accent: "#ffce4f",
  },
  {
    id: "masters",
    name: "Sobre Masters",
    description: "El sobre del evento Masters: la clase Masters (Masters L y SDC) es la que más sale.",
    price: 20000,
    cardCount: 5,
    weights: { common: 10, uncommon: 40, rare: 30, epic: 17, legendary: 3 },
    // Fase 57.3 · ni `weights` ni `guaranteedMin` (identidad: escalón, arte) deciden el sorteo: lo decide `packClass`.
    guaranteedMin: "epic",
    // Catálogo diseñado (2026-09-21): el filtro de grupos antiguo («internacional/base/regional») dejaba fuera
    // Future Star y las legendarias y el sobre no podía dar ni raras ni legendarias. Sin filtro sortea las 7
    // ediciones con SUS pesos de siempre: sus poco comunes son Masters L/SDC y sus épicas Champions S.
    accent: "#ff8a3d",
    tag: "Evento",
    eventId: "masters-toronto",
  },
  {
    id: "champions",
    name: "Sobre Champions",
    description: "Los mejores del mundo: la clase Champions (Champions S) es la que más sale.",
    price: 35000,
    cardCount: 5,
    weights: { common: 5, uncommon: 30, rare: 35, epic: 22, legendary: 8 },
    // Fase 57.3 · ni `weights` ni `guaranteedMin` (identidad: escalón, arte) deciden el sorteo: lo decide `packClass`.
    guaranteedMin: "epic",
    // Catálogo diseñado (2026-09-21): el filtro de grupos antiguo («internacional/base/regional») dejaba fuera
    // Future Star y las legendarias y el sobre no podía dar ni raras ni legendarias. Sin filtro sortea las 7
    // ediciones con SUS pesos de siempre: sus poco comunes son Masters L/SDC y sus épicas Champions S.
    accent: "#ffd35c",
    tag: "Evento",
    eventId: "champions-paris",
  },
  {
    id: "ewc",
    name: "Sobre EWC",
    // Pack Opening 3.1 · sortea con su plan por ranuras (`packClass#SPECIAL_PACK_PLAN`): la carta destacada es Champions S
    // o Icon (la «épica garantizada» de siempre). 6.000 → 8.500: una Champions S garantizada vale por sí sola ~1 crédito por
    // crédito a 6.000; a 8.500 rinde 0,54 (por debajo de Plata, 0,56: EWC no tiene targeting).
    description: "El sobre del evento EWC. Champions S (o Icon) garantizada en la carta destacada.",
    price: 8500,
    cardCount: 5,
    weights: { common: 8, uncommon: 38, rare: 32, epic: 19, legendary: 3 },
    guaranteedMin: "epic",
    // Catálogo diseñado (2026-09-21): el filtro de grupos antiguo («internacional/base/regional») dejaba fuera
    // Future Star y las legendarias y el sobre no podía dar ni raras ni legendarias. Sin filtro sortea las 7
    // ediciones con SUS pesos de siempre: sus poco comunes son Masters L/SDC y sus épicas Champions S.
    accent: "#19e3ff",
    tag: "Evento",
    eventId: "ewc-2026",
  },
  /*
   * FASE 57.6 — los regionales de EMEA, Americas y Pacific (y sus Team Packs, que heredan su economía) pasan de 3.000
   * a 3.500 créditos. Con la valoración F57.5B su bucket «rara» (18 % por carta) es la clase Prime, y a 3.000 daban
   * 6,0–6,5× de valor por crédito frente a ~5,2× de la línea principal: la compra dominante. A 3.500 quedan en 5,0–5,6×,
   * dentro de ±12 % de la mediana de la línea. China (sin Prime, Champions ni Icon en su pool) sigue a 3.000.
   * Evidencia: `docs/product/fase-57-6-economy-final.md`.
   */
  {
    id: "emea",
    name: "Sobre EMEA",
    description: "Solo jugadores de la región EMEA.",
    price: 3500,
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
    price: 3500,
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
    price: 3500,
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
    // Pack Opening 3.1 · 3.000 → 9.500. Su pool solo tiene Masters L/SDC y Champions S: cualquier carta vale al menos lo
    // de un Masters, así que a 3.000 rendía 2,7 por crédito y sus 14 Masters salían más baratos que una Champions comprada
    // por la vía directa. Con su plan (inclinación 0,30: variedad sin repetir tanto) y 9.500, 0,49 — como los regionales.
    description: "Solo jugadores de la región China. Con el catálogo actual sus cartas son Masters L, Masters SDC y Champions S.",
    price: 9500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 0, legendary: 0 },
    restrictRegion: "China",
    accent: "#19e3ff",
    tag: "Regional",
  },
  /* ═══════════════════════════ SOBRES DE EQUIPO (Fase 20) ═══════════════════════════
   *
   * ────────────────────────── QUÉ ES UN TEAM PACK, EXACTAMENTE ──────────────────────────
   *
   * **Mayor probabilidad de cartas del equipo. NO una carta del equipo garantizada.** La
   * diferencia no es de matiz: una garantía se implementaría con `guarantees`, se vería en la
   * ficha del sobre y cambiaría el sorteo. Aquí no hay ninguna.
   *
   * El sesgo lo produce un POOL persistido (`content_pools`, modo `RULE`) que da peso 5 a las
   * cartas del equipo frente al peso 1 de las demás, y el motor lo aplica por la única vía que
   * existe (`pickWeighted`). Un pool `RULE` **repondera sin restringir**: el sobre sigue
   * pudiendo entregar cualquier carta de su región. Si el pool se desvinculara, estos sobres
   * seguirían abriéndose como un regional cualquiera.
   *
   * ────────────────────────── DE DÓNDE SALEN ESTOS NÚMEROS ──────────────────────────
   *
   * **Precio, cartas y pesos son los del PRODUCTO REGIONAL que ya existe** (3.500 créditos desde la F57.6 —3.000 antes—, 5
   * cartas, 35/40/18/6/1). No se ha inventado un punto de precio nuevo: un Team Pack es un
   * sobre DIRIGIDO, la misma clase de producto que los cuatro regionales, y comparte su
   * economía. `restrictRegion` es la región REAL de la plantilla del equipo, así que el sobre
   * renuncia a las otras tres regiones — eso es lo que se paga por la puntería.
   *
   * El peso 5 está MEDIDO, no elegido a ojo (`scripts/_fase20-calibrate.ts`, 4.000 aperturas
   * con el motor real):
   *
   *     equipo          cartas del equipo    cartas/sobre    P(≥1 del equipo)
   *     Team Heretics        11 de 204           1,13             72,3 %
   *     NAVI                 16 de 204           1,20             74,4 %
   *     G2                   10 de 182           0,91             63,2 %
   *     Fnatic               25 de 204           2,12             94,2 %
   *
   * Fnatic sale más alto porque TIENE más cartas en el catálogo (25), no porque su sobre
   * reciba un trato distinto: el peso es el mismo 5 para los cuatro. Sin ningún sesgo, Fnatic
   * ya daría 1,20 cartas por sobre. Es una propiedad del catálogo, y queda dicha.
   *
   * ────────────────────────── EL ACENTO ──────────────────────────
   *
   * Fnatic y NAVI usan su color de marca tal y como ya está declarado en `data/teams.ts`. Los
   * de Heretics y G2 son negro sobre blanco: sobre el escenario negro de la apertura no se
   * verían, así que se usa el otro extremo de su propia paleta. Es una decisión de
   * presentación, del mismo tipo que el acento de los doce sobres anteriores.
   */
  {
    id: "team-heretics",
    name: "Sobre Team Heretics",
    description: "Más probabilidad de cartas de Team Heretics. Sortea entre jugadores de EMEA.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    team: "Team Heretics",
    accent: "#cfd3dc",
    tag: "Equipo",
  },
  {
    id: "team-fnatic",
    name: "Sobre Fnatic",
    description: "Más probabilidad de cartas de Fnatic. Sortea entre jugadores de EMEA.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    team: "Fnatic",
    accent: "#ff5900",
    tag: "Equipo",
  },
  {
    id: "team-navi",
    name: "Sobre NAVI",
    description: "Más probabilidad de cartas de NAVI. Sortea entre jugadores de EMEA.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    team: "NAVI",
    /*
     * RETIRADO DEL ESCAPARATE (2026-09-22), como `prime`. Decisión de producto: la oferta de
     * equipos pasa a ser Heretics, Fnatic, G2, Team Liquid y Karmine Corp.
     *
     * RETIRED y no DRAFT ni borrado, y esto no es un detalle: `retired` lo saca de la tienda y del
     * catálogo público pero lo deja ABRIBLE y concedible, así que los sobres de NAVI que un jugador
     * ya tenga en su inventario se siguen abriendo con su arte y su pool. DRAFT los habría
     * bloqueado en el servidor, y borrar la definición habría dejado inventario huérfano.
     */
    retired: true,
    accent: "#ffe500",
    tag: "Equipo",
  },
  {
    id: "team-g2",
    name: "Sobre G2",
    description: "Más probabilidad de cartas de G2. Sortea entre jugadores de Americas.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Americas",
    team: "G2",
    accent: "#8e97a8",
    tag: "Equipo",
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
    description: "Épica o superior garantizada. Ya no se vende: llega como recompensa.",
    price: 10000,
    cardCount: 4,
    weights: { common: 0, uncommon: 25, rare: 35, epic: 30, legendary: 10 },
    guaranteedMin: "epic",
    accent: "#7b5cff",
    tag: "Exclusivo",
  },
  {
    /*
     * ICON (2026-10-09, decisión del propietario) · DOS sobres ICON. Este conserva el id HISTÓRICO `icon` (80.000 desde 2026-10-09): los
     * sobres que ya tienen los jugadores (compras, recompensa `s-collect`, receta Champions → Icon) siguen dando 3 cartas.
     * Fase 57.4 · 3 cartas; F80: 60.000. Desde 2026-10-09: las 3 son ICON, cada una sorteada por separado (pueden
     * repetirse) con la tabla de calidad aprobada (`iconQuality`: 65 / 17,5 / 17,5), a 80.000 (decisión del propietario:
     * a 60.000 rendía 1,06 de valor por crédito, el mejor de la tienda). El precio NUEVO es el de compra; los sobres ya
     * adquiridos conservan su derecho (3 ICON) y la compra exige ver el precio actual (`domain/packs/priceConfirm`).
     */
    id: "icon",
    name: "Sobre ICON Premium",
    description: "Tres cartas ICON garantizadas (Record Breaker o Moments), cada una sorteada por separado: pueden repetirse.",
    price: 80000,
    cardCount: 3,
    weights: { common: 0, uncommon: 0, rare: 30, epic: 45, legendary: 25 },
    // `guaranteedMin` es solo IDENTIDAD (categoría «icono» y arte, `packIdentity`): el sorteo lo decide `packClass`.
    guaranteedMin: "legendary",
    accent: "#f5f0e6",
    tag: "3 ICON garantizadas",
  },
  {
    /* ICON (2026-10-09) · el sobre ICON de UNA carta, 30.000. Id nuevo: no toca a los `icon` ya adquiridos. */
    id: "icon-single",
    name: "Sobre ICON",
    description: "Una carta ICON garantizada (Record Breaker o Moments).",
    price: 30000,
    cardCount: 1,
    weights: { common: 0, uncommon: 0, rare: 30, epic: 45, legendary: 25 },
    guaranteedMin: "legendary",
    accent: "#f5f0e6",
    tag: "1 ICON garantizada",
  },
  /* ═══════════════════════ TEAM PACKS — OLA 1 (Fase 20.5) ═══════════════════════
   *
   * Cinco Team Packs nuevos, TODOS en `lifecycle: "DRAFT"`: existen como producto y en Admin,
   * pero NO son públicos (la tienda los oculta y el servidor rechaza comprarlos/abrirlos por la
   * ruta pública — Fase 20.4). Pasar a ACTIVE exige artwork oficial + su pool de sesgo publicado
   * + decisión de precio.
   *
   * ────────────────────────── DE DÓNDE SALEN ESTOS VALORES ──────────────────────────
   *
   * · `team` es la IDENTIDAD ACTUAL del equipo (`teamIdentities.ts`, alias de roster VLR 2026):
   *   LOUD→«LOUD», BLG→«BLG», TE→«TE», JDG→«JDG», Team Liquid→«TL». No es el nombre editorial:
   *   es el valor de `Player.team` de la plantilla actual, para que el pool de sesgo seleccione
   *   solo cartas del equipo de hoy (los cinco tienen 0 cartas «históricas que no deben entrar»,
   *   medido en la auditoría 20.5A). El motor NO lee `team`: el sesgo lo aporta el pool.
   *
   * · Precio, cartas y pesos son los del REGIONAL de cada equipo (`teamPackEconomics`), heredados
   *   sin inventar: EMEA/Americas 3.500·5·35/40/18/6/1 (3.000 hasta la F57.6); China 3.000·5·35/40/18/0/0 (China no
   *   promete épicas ni legendarias, Fase 13). El precio final sigue siendo decisión de producto.
   *
   * · La mayor probabilidad de carta del equipo la produce el pool `boost-team-<id>` (RULE, peso
   *   medido), NO una garantía: ninguno declara `guaranteedMin`/`guarantees`.
   */
  {
    id: "team-loud",
    name: "Sobre LOUD",
    description: "Más probabilidad de cartas de LOUD. Sortea entre jugadores de Americas.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Americas",
    team: "LOUD",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-blg",
    name: "Sobre BLG",
    description: "Más probabilidad de cartas de BLG. Sortea entre jugadores de China.",
    price: 9500, // Pack Opening 3.1 · Team Pack = economía de su regional (China)
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 0, legendary: 0 },
    restrictRegion: "China",
    team: "BLG",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-te",
    name: "Sobre TE",
    description: "Más probabilidad de cartas de TE. Sortea entre jugadores de China.",
    price: 9500, // Pack Opening 3.1 · Team Pack = economía de su regional (China)
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 0, legendary: 0 },
    restrictRegion: "China",
    team: "TE",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-jdg",
    name: "Sobre JDG",
    description: "Más probabilidad de cartas de JDG. Sortea entre jugadores de China.",
    price: 9500, // Pack Opening 3.1 · Team Pack = economía de su regional (China)
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 0, legendary: 0 },
    restrictRegion: "China",
    team: "JDG",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-liquid",
    name: "Sobre Team Liquid",
    description: "Más probabilidad de cartas de Team Liquid. Sortea entre jugadores de EMEA.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    team: "TL",
    /*
     * ACTIVO desde 2026-09-22. Su auditoría (`teamPackCatalog`) tenía UN solo bloqueo —el artwork—
     * y el arte oficial ya está. Lo demás no se ha tocado: 14 cartas elegibles en EMEA, pool
     * `boost-team-team-liquid` ya creado y economía derivada del regional EMEA (3.500 / 5 / 35-40-18-6-1 desde la F57.6).
     */
    accent: "#19e3ff",
    tag: "Equipo",
  },
  /* ═══════════════════════ TEAM PACKS — OLA 2 (Fase 20.5) ═══════════════════════
   *
   * Nueve Team Packs más, TODOS en `lifecycle: "DRAFT"` (misma mecánica que la Ola 1: existen y
   * se configuran en Admin, pero el servidor rechaza comprarlos/abrirlos y la tienda los oculta).
   * `team` = alias de identidad ACTUAL (`teamIdentities.ts`); economía heredada del regional
   * (`teamPackEconomics`). El sesgo lo aporta `boost-team-<id>` (RULE, peso medido); ninguna
   * garantía. China (TYL, XLG) sin épicas ni legendarias (Fase 13).
   */
  {
    id: "team-tyl",
    name: "Sobre TYL",
    description: "Más probabilidad de cartas de TYL. Sortea entre jugadores de China.",
    price: 9500, // Pack Opening 3.1 · Team Pack = economía de su regional (China)
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 0, legendary: 0 },
    restrictRegion: "China",
    team: "TYL",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-karmine",
    name: "Sobre Karmine Corp",
    description: "Más probabilidad de cartas de Karmine Corp. Sortea entre jugadores de EMEA.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    team: "KC",
    /* ACTIVO desde 2026-09-22, por lo mismo que Team Liquid: 10 cartas elegibles, pool creado y
       artwork oficial. Ni precio, ni pesos, ni pool se han tocado. */
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-m8",
    name: "Sobre M8",
    description: "Más probabilidad de cartas de M8. Sortea entre jugadores de EMEA.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    team: "M8",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-fut",
    name: "Sobre FUT",
    description: "Más probabilidad de cartas de FUT. Sortea entre jugadores de EMEA.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "EMEA",
    team: "FUT",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-100t",
    name: "Sobre 100T",
    description: "Más probabilidad de cartas de 100T. Sortea entre jugadores de Americas.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Americas",
    team: "100T",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-prx",
    name: "Sobre Paper Rex",
    description: "Más probabilidad de cartas de Paper Rex. Sortea entre jugadores de Pacific.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Pacific",
    team: "PRX",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-ns",
    name: "Sobre NS",
    description: "Más probabilidad de cartas de NS. Sortea entre jugadores de Pacific.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Pacific",
    team: "NS",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-ge",
    name: "Sobre GE",
    description: "Más probabilidad de cartas de GE. Sortea entre jugadores de Pacific.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Pacific",
    team: "GE",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  {
    id: "team-xlg",
    name: "Sobre XLG",
    description: "Más probabilidad de cartas de XLG. Sortea entre jugadores de China.",
    price: 9500, // Pack Opening 3.1 · Team Pack = economía de su regional (China)
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 0, legendary: 0 },
    restrictRegion: "China",
    team: "XLG",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
  /* ═══════════════════════ TEAM PACK — OLA 3 (Fase 20.5) ═══════════════════════
   *
   * Leviatán, mismo patrón que las Olas 1 y 2: DRAFT, economía heredada del regional Americas
   * (`teamPackEconomics`), `team` = alias de identidad ACTUAL («LEV», `teamIdentities.ts`). El
   * sesgo lo aporta `boost-team-lev` (RULE, peso medido). Ninguna garantía.
   */
  {
    id: "team-lev",
    name: "Sobre Leviatán",
    description: "Más probabilidad de cartas de Leviatán. Sortea entre jugadores de Americas.",
    price: 3500,
    cardCount: 5,
    weights: { common: 35, uncommon: 40, rare: 18, epic: 6, legendary: 1 },
    restrictRegion: "Americas",
    team: "LEV",
    lifecycle: "DRAFT",
    accent: "#19e3ff",
    tag: "Equipo",
  },
];

export const PACK_BY_ID = new Map(PACKS.map((p) => [p.id, p]));

export function getPack(id: string): PackDef | undefined {
  return PACK_BY_ID.get(id);
}

// ────────────────────────── F60 · SOBRES DEL PANEL (catálogo vivo) ──────────────────────────
/*
 * Los sobres de arriba son CÓDIGO (su economía está congelada, F57.6). Los creados desde /admin/packs viven en
 * `content_packs` y llegan en tiempo de ejecución (`/api/content/packs` en el cliente, el cargador en el servidor):
 * se AÑADEN aquí en sitio —mismas referencias `PACKS`/`PACK_BY_ID`— con id `cms-…`, así que tienda, compra, apertura
 * e inventario los ven sin recompilar. Sólo ACTIVE y RETIRED: un borrador nunca entra en el juego.
 */
const CODE_PACK_IDS = new Set(PACKS.map((p) => p.id));
let packsVersion = 0;
const packListeners = new Set<() => void>();

export function applyRuntimePacks(defs: readonly PackDef[]): boolean {
  const next = defs.filter((d) => d.id.startsWith("cms-") && !CODE_PACK_IDS.has(d.id) && d.lifecycle !== "DRAFT" && !!d.cms);
  const current = PACKS.filter((p) => !CODE_PACK_IDS.has(p.id));
  if (JSON.stringify(current) === JSON.stringify(next)) return false;
  for (let i = PACKS.length - 1; i >= 0; i--) if (!CODE_PACK_IDS.has(PACKS[i].id)) { PACK_BY_ID.delete(PACKS[i].id); PACKS.splice(i, 1); }
  for (const d of next) { PACKS.push(d); PACK_BY_ID.set(d.id, d); }
  setPackClassAliases(next.map((d) => [d.id, d.cms!.templateId] as const));
  packsVersion++;
  for (const l of packListeners) l();
  return true;
}

export const isRuntimePack = (id: string): boolean => PACK_BY_ID.has(id) && !CODE_PACK_IDS.has(id);
export const subscribePacks = (cb: () => void): (() => void) => { packListeners.add(cb); return () => packListeners.delete(cb); };
export const getPacksVersion = (): number => packsVersion;
