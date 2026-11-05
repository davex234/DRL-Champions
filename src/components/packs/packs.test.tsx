/**
 * SOBRES — tests de la ceremonia de apertura y de la identidad del objeto.
 *
 * Se prueban PROPIEDADES, no píxeles. Las tres que importan, y por qué:
 *
 *   1. **El sobre entrega un CONJUNTO.** La ceremonia iba de la rotura al primer giro, así que
 *      las otras cuatro cartas no existían hasta que les llegaba el turno. Que el abanico
 *      exista y que las cartas no reveladas sigan a la vista es el arreglo, y es exactamente
 *      lo que un test de esta capa puede fijar.
 *   2. **La presentación no miente.** Ni la última carta, ni la anticipación, ni el escalón
 *      visual del sobre pueden cambiar lo que salió del sorteo. Se comprueba que las palancas
 *      que ANUNCIAN algo concreto (heraldo, confeti) no se toquen nunca por posición.
 *   3. **No hay una segunda fuente de verdad.** Ni un precio, ni un peso, ni una regla por
 *      `packId` escritos en la capa de presentación.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PackHand, type HandSlot } from "./PackHand";
import { CardBack } from "./CardBack";
import { CEREMONY, ceremonyFor, lastCardCeremony, stillCeremony } from "./ceremony";
import {
  packIdentity, tierForPack, TIER_ORDER, categoryForPack, teamMonogram, teamCardCount,
  type PackCategory,
} from "./packIdentity";
import { SealedPack } from "./SealedPack";
import { PackSigil } from "./PackSigil";
import { PACKS, getPack } from "@/data/packs";
import type { PackDef } from "@/domain/packs/types";
import { isDraft, isPurchasable } from "@/domain/packs/lifecycle";
import { isTeamPackCard } from "@/data/teamIdentities";
import { CARDS, getPlayer } from "@/data/catalog";
import { PACK_ART_AVAILABLE, packArtPath, packArtwork } from "@/data/packArtwork";
import { isEligible, buildPool } from "@/domain/packs/pool";
import { CardRegistry } from "@/collection/registry";
import { PLAYERS } from "@/data/players";
import { ALL_VARIANTS, getVariant } from "@/domain/cards/variants";

/** Las seis familias de producto. Si entra una nueva, estos tests la exigen cubierta. */
const CATEGORIES: PackCategory[] = ["inicial", "nexus", "regional", "team", "event", "icono"];

const html = (n: React.ReactElement): string => renderToStaticMarkup(n);
const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");
/** El cuerpo del fichero SIN su cabecera de documentación. */
const body = (rel: string): string => read(rel).split("*/").slice(1).join("*/");
/**
 * SOLO CÓDIGO: sin comentarios de ningún tipo.
 *
 * Hace falta para las comprobaciones de AUSENCIA («aquí no se escribe un precio», «aquí no
 * entra una probabilidad»). `body` solo recorta la cabecera, así que la documentación interna
 * seguía contando: este fichero explica por escrito que NO decide probabilidades, y la palabra
 * «probabilidad» de esa frase hacía fallar la comprobación. Un test que se rompe porque el
 * código está bien documentado está midiendo lo que no debe.
 */
const code = (rel: string): string =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const ACCENT = "#19e3ff";
const slots = (n: number, revealedUpTo = -1): HandSlot[] =>
  Array.from({ length: n }, (_, i) => ({
    revealed: i <= revealedUpTo,
    color: "#ffd35c",
  }));

/* ─────────────────────── EL ABANICO: EL ACTO QUE FALTABA ─────────────────────── */

test("ABANICO · el sobre entrega TODAS sus cartas, boca abajo", () => {
  /*
   * La propiedad es «tantos dorsos como cartas trae el sobre». Antes de esta pasada no había
   * ninguno: la primera carta aparecía ya girando y las otras cuatro no estaban en pantalla.
   */
  const markup = html(<PackHand slots={slots(5)} accent={ACCENT} mode="hand" />);
  const dorsos = markup.match(/aspect-\[5\/7\]/g) ?? [];
  assert.equal(dorsos.length, 5, "cinco cartas boca abajo, una por carta del sobre");
});

test("ABANICO · el número de cartas lo manda el sobre, no una constante", () => {
  /*
   * El catálogo tiene sobres de 3, 4, 5 y 6 cartas (`icon` 3, `prime` 4, `premium` 6). Un
   * abanico de cinco fijo habría mentido en tres de los doce.
   */
  for (const n of [3, 4, 6]) {
    const markup = html(<PackHand slots={slots(n)} accent={ACCENT} mode="hand" />);
    assert.equal((markup.match(/aspect-\[5\/7\]/g) ?? []).length, n, `${n} cartas`);
  }
  const cuentas = new Set(PACKS.map((p) => p.cardCount));
  assert.ok(cuentas.size > 1, "el catálogo tiene sobres de distinto tamaño; el abanico debe seguirlos");
});

test("ABANICO · durante el revelado las demás cartas SIGUEN a la vista, atenuadas", () => {
  /*
   * §7 del encargo. `CardReveal` pintaba solo la carta activa; el resto desaparecía de la
   * pantalla hasta su turno. Aquí se fija que el abanico persista y que la activa sea la
   * protagonista: las demás bajan de opacidad, ella no.
   */
  const markup = html(
    <PackHand slots={slots(5, 1)} accent={ACCENT} mode="strip" activeIndex={2} charge={0.5} />,
  );
  assert.equal((markup.match(/aspect-\[5\/7\]/g) ?? []).length, 5, "las cinco siguen en pantalla");
  const atenuadas = markup.match(/opacity-45/g) ?? [];
  assert.equal(atenuadas.length, 4, "las cuatro que no son la activa se atenúan");
});

test("ABANICO · una carta revelada se tiñe con el color de su rareza REAL", () => {
  /*
   * El color no lo elige el abanico: lo trae resuelto la ceremonia desde la variante del
   * dominio. Lo que se comprueba es que una revelada NO siga pintada con el acento del sobre
   * —si lo hiciera, el marcador no diría nada de lo que ha salido—.
   */
  const conRareza = html(
    <PackHand slots={slots(5, 0)} accent={ACCENT} mode="strip" activeIndex={1} />,
  );
  assert.match(conRareza, /#ffd35c/, "la revelada usa el color de su rareza");

  const sinRevelar = html(<PackHand slots={slots(5)} accent={ACCENT} mode="strip" activeIndex={0} />);
  assert.ok(
    !/#ffd35c/.test(sinRevelar),
    "boca abajo NO se filtra la rareza: el dorso no puede adelantar lo que hay delante",
  );
});

/* ─────────────────────── UN SOLO DORSO ─────────────────────── */

test("DORSO · la ceremonia entera usa UNA sola pieza de dorso", () => {
  /*
   * El dorso estaba escrito dentro de `CardReveal` a 300 px fijos. Al aparecer el abanico
   * hacían falta dos, y copiarlo habría creado dos dorsos que se separarían con el primer
   * cambio — el mismo error que `SealedPack` ya evita entre la tienda y la apertura.
   */
  // `read` y no `body`: en `CardReveal` los imports van ANTES de la cabecera de
  // documentación, así que recortarla se llevaría por delante justo lo que se comprueba.
  assert.match(read("./PackHand.tsx"), /from "\.\/CardBack"/, "el abanico usa CardBack");
  assert.match(read("./CardReveal.tsx"), /from "\.\/CardBack"/, "el revelado usa CardBack");
  assert.ok(
    !/M50 10 L84 30/.test(read("./CardReveal.tsx")),
    "el sigilo ya no está dibujado a mano en el revelado: vive en CardBack",
  );
});

test("DORSO · el dorso lleva el sigilo de la familia y escala con su caja", () => {
  const markup = html(<CardBack accent={ACCENT} className="w-[92px]" />);
  assert.match(markup, /M50 10 L84 30/, "el hexágono de NEXUS, el mismo troquel que el sobre");
  assert.match(markup, /w-\[38%\]/, "el sigilo se dimensiona en %: el mismo dorso a 92 y a 300 px");
  assert.ok(!/width="300"/.test(markup), "sin medidas fijas dentro de la pieza");
});

test("DORSO · la carga de anticipación se dibuja, y sin carga no ensucia", () => {
  const cargado = html(<CardBack accent={ACCENT} charged={1} chargeColor="#ff2e63" className="w-[92px]" />);
  assert.match(cargado, /#ff2e63/, "el canto se enciende con el color que se le da");

  const limpio = html(<CardBack accent={ACCENT} charged={0} className="w-[92px]" />);
  assert.ok(!/#ff2e63/.test(limpio), "sin carga no hay rastro del color de carga");
});

/* ─────────────────────── LA ÚLTIMA CARTA ─────────────────────── */

test("CEREMONIA · la última carta tiene más ceremonia y la MISMA carta", () => {
  /*
   * §11 del encargo, y la línea que no se puede cruzar: la quinta carta se presenta mejor
   * POR SER la quinta, nunca porque se haya cambiado. Sube intensidad (tensión, sala, onda) y
   * NO toca lo que anuncia algo concreto.
   */
  for (const nivel of Object.keys(CEREMONY) as (keyof typeof CEREMONY)[]) {
    const base = CEREMONY[nivel];
    const ult = lastCardCeremony(base);
    assert.ok(ult.buildup > base.buildup, `${nivel}: más tensión`);
    assert.ok(ult.ring, `${nivel}: la onda de choque marca el cierre`);
    assert.ok(ult.dim >= base.dim, `${nivel}: la sala no se aclara`);
    // Las dos palancas que ANUNCIAN: intactas. Subirlas sería un fake-out (§9).
    assert.equal(ult.herald, base.herald, `${nivel}: no se canta una rareza que no es`);
    assert.equal(ult.confetti, base.confetti, `${nivel}: el confeti celebra una Winner, no una posición`);
  }
});

test("CEREMONIA · una común en el último hueco sigue siendo una común", () => {
  /*
   * La prueba de honestidad del §22: la carta más humilde del juego, colocada en el hueco de
   * mayor ceremonia, no gana heraldo, ni confeti, ni rayos. Solo espera un poco más.
   */
  const bronce = getVariant("bronze");
  const ult = lastCardCeremony(ceremonyFor(bronce));
  assert.equal(ult.herald, "", "una Bronce no canta nada");
  assert.equal(ult.confetti, false);
  assert.equal(ult.rays, false, "ni corona radial: eso es de la parte alta de la escalera");
  assert.equal(ult.burst, ceremonyFor(bronce).burst, "ni una partícula de más");
});

test("CEREMONIA · con movimiento reducido no se pierde NINGÚN revelado", () => {
  /*
   * §15: la preferencia dice «no quiero ver movimiento», no «quiero ver menos cartas». Se
   * apagan efectos; la tensión sigue existiendo (buildup > 0) para las 9 escaleras.
   */
  for (const nivel of Object.keys(CEREMONY) as (keyof typeof CEREMONY)[]) {
    const quieto = stillCeremony(CEREMONY[nivel]);
    assert.ok(quieto.buildup > 0, `${nivel}: sigue habiendo revelado`);
    assert.equal(quieto.rays, false);
    assert.equal(quieto.burst, 0);
    assert.equal(quieto.shards, 0);
    assert.equal(quieto.confetti, false);
  }
});

test("CEREMONIA · toda variante del dominio tiene su receta", () => {
  // Si alguien añade un nivel de animación al dominio y se olvida de esto, el juego no puede
  // quedarse sin ceremonia para una rareza: se comprueba con las 37 variantes reales.
  for (const v of ALL_VARIANTS) {
    const spec = ceremonyFor(v);
    assert.ok(spec && spec.buildup > 0, `${v.id} (${v.animation}) sin receta`);
  }
});

/* ─────────────────────── IDENTIDAD DEL SOBRE ─────────────────────── */

test("IDENTIDAD · el escalón lo declara el CATÁLOGO, no una tabla por id", () => {
  /*
   * El tier sale de `guaranteedMin`, que es el único campo que ya ordena los sobres por
   * ambición. Deliberadamente NO del precio: el precio cambia en cada rebalanceo y la
   * identidad de un objeto no puede cambiar porque se ajuste una tarifa.
   */
  assert.equal(tierForPack(getPack("inicial")!), "base", "sin garantía, sobre base");
  assert.equal(tierForPack(getPack("estandar")!), "base");
  assert.equal(tierForPack(getPack("premium")!), "premium", "garantiza rara o mejor");
  assert.equal(tierForPack(getPack("masters")!), "elite", "garantiza épica");
  assert.equal(tierForPack(getPack("champions")!), "elite");
  assert.equal(tierForPack(getPack("icon")!), "legend", "garantiza legendaria");

  /*
   * Ni un `packId` escrito como regla. Se exceptúan los ids que COINCIDEN con el nombre de un
   * escalón (`premium`) o de una categoría (`inicial`): la palabra está ahí por el escalón o
   * por la familia, no por el sobre, y confundirlas haría imposible llamar «premium» a un
   * escalón o «inicial» a la familia del sobre de bienvenida.
   */
  const src = body("./packIdentity.ts");
  const vocabulario = [...TIER_ORDER, ...CATEGORIES] as string[];
  for (const p of PACKS.filter((x) => !vocabulario.includes(x.id))) {
    assert.ok(
      !new RegExp(`["']${p.id}["']`).test(src),
      `«${p.id}» aparece escrito en la identidad: sería una segunda tabla de sobres`,
    );
  }
});

test("IDENTIDAD · todos los sobres del catálogo tienen identidad, y sube monótona", () => {
  for (const p of PACKS) {
    const id = packIdentity(p);
    assert.ok(TIER_ORDER.includes(id.tier), `${p.id} sin escalón válido`);
    assert.ok(id.foil > 0 && id.rings >= 1, `${p.id} sin material`);
  }
  // El acabado no puede ir a peor al subir de escalón: sería lo contrario de una jerarquía.
  const porEscalon = TIER_ORDER.map((t) =>
    packIdentity({
      id: `sonda-${t}`,
      price: 1000,
      guaranteedMin: t === "base" ? undefined : t === "premium" ? "rare" : t === "elite" ? "epic" : "legendary",
    }));
  for (let i = 1; i < porEscalon.length; i++) {
    assert.ok(porEscalon[i].foil >= porEscalon[i - 1].foil, "el foil no baja");
    assert.ok(porEscalon[i].rings >= porEscalon[i - 1].rings, "los anillos no bajan");
    assert.ok(porEscalon[i].bloom >= porEscalon[i - 1].bloom, "el resplandor no baja");
  }
});

test("IDENTIDAD · la presentación no decide precio, peso ni probabilidad", () => {
  /*
   * LEER el precio es legítimo y hace falta: el sobre de bienvenida se reconoce porque es
   * gratis (`pack.price === 0`). Lo que no puede aparecer es un precio ESCRITO —`price: 3000`—
   * ni un peso ni una probabilidad, que son decisiones de economía y de sorteo.
   */
  const src = code("./packIdentity.ts");
  assert.ok(!/price\s*:\s*\d/.test(src), "aquí no se escribe un precio");
  assert.ok(!/weights|drawn|pickWeighted/.test(src), "ni un peso ni una probabilidad");
  assert.match(src, /pack\.price === 0/, "el precio solo se compara, para reconocer el sobre gratuito");
});

/**
 * UN SOBRE SIN ARTWORK ENTREGADO.
 *
 * Desde la Fase 20.1 los dieciséis productos del catálogo tienen su fichero, así que el camino
 * PROCEDIMENTAL ya no se puede ejercitar con un sobre real. Sigue existiendo y sigue siendo el
 * respaldo de cualquier producto nuevo, así que se prueba con una sonda cuyo id no está —ni
 * estará— en el manifiesto.
 */
const SIN_ARTE: PackDef = {
  ...getPack("premium")!,
  id: "sonda-sin-arte",
  name: "Sonda Sin Arte",
};

test("SOBRE · el objeto se dibuja con el sobre del catálogo, no con datos sueltos", () => {
  /*
   * Antes recibía `accent` y `name` por separado, así que cada pantalla decidía qué parte del
   * sobre le contaba al objeto — y ninguna le contaba la garantía, que es justo lo que da el
   * escalón. Recibir el `PackDef` es lo que hace imposible dibujar un sobre a medias.
   */
  const src = read("./SealedPack.tsx");
  assert.match(src, /pack: Pick<PackDef/, "recibe el sobre, no parámetros sueltos");
  assert.match(src, /packIdentity/, "y su identidad sale del catálogo");

  const dibujado = html(<SealedPack pack={SIN_ARTE} cutProgress={0} width={156} />);
  assert.match(dibujado, /Sonda Sin Arte/, "el nombre sale del catálogo");
  assert.match(dibujado, /Nexus/, "la familia se nombra en el troquel");
});

test("ARTWORK · un sobre declarado en el manifiesto se pinta con su fichero", () => {
  /*
   * FASE 20.1. El asset entregado es la cara COMPLETA del sobre, así que cuando existe manda
   * él: se pinta su fichero y se apaga la decoración procedimental. Pintar las dos cosas
   * dejaría dos objetos superpuestos y el nombre escrito dos veces.
   */
  for (const p of PACKS.filter((x) => PACK_ART_AVAILABLE.has(x.id))) {
    const markup = html(<SealedPack pack={p} cutProgress={0} width={200} />);
    assert.match(markup, new RegExp(`src="${packArtPath(p.id)}"`), `${p.id}: no pinta su artwork`);
    assert.ok(!/M50 10 L84 30/.test(markup), `${p.id}: dibuja el troquel ENCIMA del artwork`);
    assert.ok(
      !new RegExp(`>${p.name}<`).test(markup),
      `${p.id}: repite el nombre sobre la placa que el asset ya trae`,
    );
  }
});

test("ARTWORK · sin declarar, no se pide la imagen y se dibuja el troquel", () => {
  /*
   * La imagen NO puede ser el caso por defecto: la ruta se DERIVA del `packId`, así que pedirla
   * sin saber si existe sería un 404 por sobre en cada pintada de la tienda. El manifiesto es
   * la declaración de lo que ha llegado de verdad.
   */
  assert.equal(packArtwork("sonda-sin-arte"), null, "no declarado ⇒ no hay artwork");
  const markup = html(<SealedPack pack={SIN_ARTE} cutProgress={0} width={200} />);
  assert.ok(!/<img/.test(markup), "pide una imagen que no existe");
  assert.match(markup, /M50 10 L84 30/, "y en su lugar dibuja el troquel");
  // La convención de nombre es derivada y estable, no una tabla escrita a mano.
  assert.equal(packArtPath("team-fnatic"), "/packs/pack-team-fnatic.webp");
});

test("ARTWORK · el manifiesto cubre TODOS los productos del catálogo", () => {
  /*
   * La red que impide que la tienda quede a medias. Sin esto, añadir un sobre al catálogo lo
   * dejaba dibujado al lado de quince con arte y nadie se enteraba hasta verlo — así se
   * descubrió que a `ewc` le faltaba el fichero.
   */
  // Fase 20.5: un DRAFT en preparación aún no tiene artwork (llega antes de pasar a ACTIVE), así
  // que el manifiesto solo debe cubrir los productos PÚBLICOS (no-DRAFT). La red sigue vigilando
  // que ningún sobre público quede dibujado a medias.
  const sinArte = PACKS.filter((p) => !isDraft(p) && !PACK_ART_AVAILABLE.has(p.id)).map((p) => p.id);
  assert.deepEqual(sinArte, [], `sobres públicos sin artwork declarado: ${sinArte.join(", ")}`);
  // Y al revés: nada declarado que no sea un producto (un fichero huérfano no se pinta solo).
  const huerfanos = [...PACK_ART_AVAILABLE].filter((id) => !PACKS.some((p) => p.id === id));
  assert.deepEqual(huerfanos, [], `declarados sin producto: ${huerfanos.join(", ")}`);
});

test("SOBRE · dos escalones distintos NO se dibujan igual", () => {
  /*
   * La prueba del problema original: el Inicial (gratis) y el Icon (20.000) eran el mismo
   * objeto pintado de otro color. Se comprueba sobre el camino DIBUJADO —el de cualquier
   * producto nuevo— porque es donde vive esa lógica.
   */
  const base = html(<SealedPack pack={{ ...SIN_ARTE, guaranteedMin: undefined }} cutProgress={0} width={156} />);
  const leyenda = html(<SealedPack pack={{ ...SIN_ARTE, guaranteedMin: "legendary" }} cutProgress={0} width={156} />);
  const anillos = (m: string): number => (m.match(/stroke-dasharray="7 6"/g) ?? []).length;
  assert.ok(anillos(leyenda) > anillos(base), "el legendario está más acuñado");
  // El id del degradado lleva sufijo por instancia (`useId`): dos sobres en pantalla no
  // pueden compartir `<defs>` o el segundo heredaría el color del primero.
  assert.match(leyenda, /url\(#nxpack-[^)]+\)/, "el sigilo alto lleva relleno degradado");
  assert.ok(!/url\(#nxpack-[^)]+\)/.test(base), "el base es mate: sin degradado en el sigilo");
});

/* ─────────────────────── LA CEREMONIA NO DECIDE NADA ─────────────────────── */

test("APERTURA · el acto de las cartas existe entre la rotura y el revelado", () => {
  // Fase 38: las fases son la máquina de estados de presentación; el escenario (sobre, rotura, mano) es `PackStage`.
  const src = body("../packs/PackOpeningExperience.tsx");
  const stage = body("./PackStage.tsx");
  // F81 · la rotura entrega a la TENSIÓN y de ahí a la HERO (la rotura sigue sacando las cartas en abanico en PackStage).
  assert.match(read("../../domain/packs/reveal.ts"), /export type RevealPhase = [^;]*"buildup"[^;]*"hero"[^;]*"hero_hold"[^;]*"rest"/, "las fases existen");
  assert.match(src, /dispatch\(\{ type: "INTRO_DONE" \}\)/, "la rotura entrega a la tensión…");
  assert.match(src, /dispatch\(\{ type: "CONTINUE" \}\)/, "…y el jugador decide cuándo deja la hero");
  assert.match(stage, /mode="hand"/, "el abanico a tamaño de objeto sigue en la rotura");
});

test("APERTURA · «abrir otro» no expulsa al jugador de la ceremonia", () => {
  /*
   * §13. Era el botón de mayor intención del producto y navegaba FUERA —a la tienda o al
   * inventario—, justo en el momento en que el jugador quería repetir. Con unidades de este
   * sobre, la ceremonia se reinicia en el sitio.
   */
  const src = body("../packs/PackOpeningExperience.tsx");
  const summary = body("./PackSummary.tsx");
  assert.match(src, /const openAnother = useCallback/, "existe el reinicio en el sitio");
  assert.match(src, /onOpenAnother=\{openAnother\}/, "el resumen lo recibe");
  assert.match(
    summary,
    /available > 0 && onOpenAnother \? \(\s*<NxButton[\s\S]{0,220}?onClick=\{onOpenAnother\}/,
    "con sobres de este tipo, el botón principal abre otro AQUÍ",
  );
  assert.match(summary, /packsLeft > 0 \? "\/inventario" : "\/packs"/, "y solo si no quedan, cambia de destino");
});

test("APERTURA · la pantalla no calcula ni una recompensa", () => {
  /*
   * §17 y §18: el servidor es la autoridad. Esta pantalla anima lo que le devuelven. La
   * comprobación es de ausencia, que es la única que sirve aquí.
   */
  const src = body("../packs/PackOpeningExperience.tsx");
  assert.ok(!/Math\.random/.test(src), "sin azar propio: el sorteo es del motor");
  assert.ok(!/weights|guaranteedMin\s*[:=][^=]|pity\s*[:=][^=]/.test(src), "sin pesos ni garantías ni pity");
  assert.ok(!/\.price/.test(src), "sin precios");
  /*
   * El serial se LEE del ejemplar (`serial={best.serial}`), nunca se construye. Lo que no
   * puede aparecer es un serial compuesto aquí: `serial: <algo>` o `serial = <algo>`.
   */
  // Pasar el serial a la carta (`serial={best.serial}`) es leerlo. Lo prohibido es
  // COMPONERLO: un `serial:` de objeto o un `serial =` de asignación.
  assert.ok(!/serial\s*:\s*[^=\s]|serial\s*=[^={]/.test(src), "no asigna seriales: los acuña el Minter");
  assert.match(body("./PackSummary.tsx"), /serial=\{(?:featured|it)\.serial \?\? undefined\}/, "el serial sale del ejemplar acuñado");
  assert.match(src, /openPackOutcome|openPackFromInventory/, "usa las rutas de apertura que ya existían");
});

test("APERTURA · el artwork real se pide por ejemplar, sin una petición por carta", () => {
  /*
   * §14. `CardVisual` resuelve por `uid` contra el mapa que ya vino con el estado. Un `fetch`
   * en esta capa sería N+1 por sobre abierto.
   */
  // Fase 38: las caras de las cartas del sobre se pintan en el resumen (`PackSummary`) y en el revelado.
  const ceremonia = body("./PackSummary.tsx");
  const revelado = body("./CardReveal.tsx");
  for (const [nombre, src] of [["ceremonia", ceremonia], ["revelado", revelado]] as const) {
    assert.match(src, /CardVisual/, `${nombre}: usa la cara conectada`);
    assert.match(src, /uid=\{/, `${nombre}: por ejemplar`);
    assert.ok(!/fetch\(/.test(src), `${nombre}: sin peticiones por carta`);
  }
});

test("REVELADO · la ficha dice quién es la carta, no solo la dibuja", () => {
  /*
   * §7 pide jugador, OVR, rol, equipo, variante y rareza. Todo eso estaba DENTRO del arte:
   * a 150 px es ilegible de un vistazo y para un lector de pantalla no existe.
   */
  const src = body("./CardReveal.tsx");
  assert.match(src, /player\.nick/, "jugador");
  assert.match(src, /result\.card\.ovr/, "OVR");
  assert.match(src, /player\.role/, "rol");
  assert.match(src, /canonicalCardTeam\(result\.card, player\)\.label/, "equipo (el impreso en la carta, canónico)");
  assert.match(src, /variant\.label/, "variante");
  assert.match(src, /result\.serial/, "y el serial cuando la variante lo tiene");
  assert.ok(!/getVariant\(\s*["']/.test(src), "no fija una variante a mano: lee la del ejemplar");
});

test("REVELADO · la anticipación usa la rareza REAL, sin fake-outs", () => {
  /*
   * §9. El canto del dorso se carga con el color de la variante que va a salir —no con uno
   * elegido para engañar— y el mismo valor alimenta el abanico del pie.
   */
  const src = body("./CardReveal.tsx");
  assert.match(src, /const accent = variant\.palette\.primary/, "el color es el de la variante del ejemplar");
  assert.match(src, /chargeColor=\{accent\}/, "y es el que carga el dorso");
  assert.match(src, /onCharge\?\.\(c, accent\)/, "el abanico recibe el mismo color");
});

/* ═══════════════════════ FASE 20 · CATÁLOGO DE PRODUCTOS ═══════════════════════ */

test("CATÁLOGO · cada sobre cae en UNA familia, y todas las familias tienen dueño", () => {
  /*
   * La categoría se DERIVA de lo que el catálogo declara. Dos propiedades importan: que
   * ningún sobre se quede sin familia (la derivación es total) y que ninguna familia sea
   * decorativa — si una categoría no la usa ningún sobre, es vocabulario muerto.
   */
  const usadas = new Set(PACKS.map((p) => categoryForPack(p)));
  for (const p of PACKS) {
    assert.ok(CATEGORIES.includes(categoryForPack(p)), `${p.id} sin familia`);
  }
  for (const c of CATEGORIES) {
    assert.ok(usadas.has(c), `la familia «${c}» no la usa ningún sobre del catálogo`);
  }
});

test("CATÁLOGO · la familia sale de los datos, no del identificador del sobre", () => {
  // Los casos que fijan la tabla de derivación, uno por rama.
  assert.equal(categoryForPack(getPack("inicial")!), "inicial", "gratis ⇒ bienvenida");
  assert.equal(categoryForPack(getPack("estandar")!), "nexus", "sin nada especial ⇒ el base de la casa");
  assert.equal(categoryForPack(getPack("premium")!), "nexus", "premium es escalón, no familia");
  assert.equal(categoryForPack(getPack("emea")!), "regional", "restringe región ⇒ regional");
  assert.equal(categoryForPack(getPack("masters")!), "event", "tiene evento ⇒ evento");
  assert.equal(categoryForPack(getPack("icon")!), "icono", "garantiza legendaria ⇒ icono");
  assert.equal(categoryForPack(getPack("team-fnatic")!), "team", "tiene equipo ⇒ equipo");

  /*
   * EL ORDEN DE ESPECIFICIDAD IMPORTA. Un sobre de equipo TAMBIÉN restringe región; si la
   * regla regional se evaluara antes, los cuatro Team Packs se presentarían como regionales.
   */
  assert.ok(getPack("team-fnatic")!.restrictRegion, "el sobre de equipo restringe región…");
  assert.equal(categoryForPack(getPack("team-fnatic")!), "team", "…y aun así gana «equipo»");
});

test("CATÁLOGO · cada familia tiene su propio símbolo, y todos son distintos", () => {
  /*
   * «No queremos la misma bolsa cambiando de color.» La prueba de que eso ya no pasa: seis
   * familias, seis trazados distintos, y ninguno repetido.
   */
  const marcado = new Map<PackCategory, string>();
  for (const c of CATEGORIES) {
    const p = PACKS.find((x) => categoryForPack(x) === c)!;
    const id = packIdentity(p);
    marcado.set(c, html(<PackSigil kind={id.sigil} accent="#19e3ff" monogram={id.monogram} />));
  }
  const sigilos = new Set([...marcado.values()].map((m) => m.replace(/#19e3ff/g, "")));
  assert.equal(sigilos.size, CATEGORIES.length, "dos familias comparten dibujo");
  // Pero TODAS llevan el hexágono: la familia es el marco, no el símbolo.
  for (const [c, m] of marcado) assert.match(m, /M50 10 L84 30/, `${c} ha perdido el marco de la familia`);
});

test("EQUIPO · el sobre enseña el escudo con las siglas REALES del equipo", () => {
  for (const p of PACKS.filter((x) => x.team)) {
    const id = packIdentity(p);
    assert.equal(id.category, "team");
    assert.equal(id.sigil, "crest", "un sobre de equipo lleva escudo");
    assert.ok(id.monogram && id.monogram.length >= 2, `${p.id} sin monograma`);
  }
  /*
   * El monograma en el MARCADO se comprueba sobre el camino dibujado: en los cuatro sobres de
   * equipo del catálogo las siglas viven ya DENTRO del fichero de artwork (el render las
   * compone en el troquel), así que buscarlas en el HTML daría un falso negativo.
   */
  const equipo = PACKS.find((x) => x.team)!;
  const sonda: PackDef = { ...equipo, id: "sonda-equipo-sin-arte" };
  const markup = html(<SealedPack pack={sonda} cutProgress={0} width={200} />);
  assert.ok(
    markup.includes(teamMonogram(equipo.team!)),
    `el escudo dibujado no enseña «${teamMonogram(equipo.team!)}»`,
  );
  // Las siglas salen del registro de equipos cuando está, y del propio nombre cuando no.
  assert.equal(teamMonogram("Team Heretics"), "TH", "de data/teams.ts");
  assert.equal(teamMonogram("Fnatic"), "FNC", "de data/teams.ts");
  assert.equal(teamMonogram("NAVI"), "NAVI", "el valor YA es la etiqueta: no está en el registro");
});

test("EQUIPO · el sobre NO garantiza carta del equipo, y el motor no sabe qué equipo es", () => {
  /*
   * ESTA ES LA COMPROBACIÓN CRÍTICA DEL §11. El sesgo tiene que vivir en el pool persistido y
   * en ningún otro sitio:
   *
   *   · Ni una garantía en el `PackDef` (`guarantees` / `guaranteedMin`) — eso SÍ sería una
   *     promesa de carta del equipo.
   *   · Y el motor de elegibilidad no puede leer `pack.team`: si lo leyera, el sobre
   *     entregaría SOLO cartas del equipo y el pool dejaría de ser la autoridad.
   */
  const registry = new CardRegistry();
  for (const p of PACKS.filter((x) => x.team)) {
    assert.ok(!p.guaranteedMin, `${p.id} garantiza rareza: dejaría de ser «más probable»`);
    assert.ok(!p.guarantees?.length, `${p.id} tiene garantías declaradas`);

    /*
     * La prueba de que `team` es PRESENTACIÓN: el pool que deduce el motor es EXACTAMENTE el
     * mismo con y sin ese campo. Si `isEligible` lo mirara, quitarlo cambiaría el pool.
     */
    const conEquipo = buildPool(registry, p).flat.map((c) => c.id).join("|");
    const sinEquipo = buildPool(registry, { ...p, id: `${p.id}-sin-team`, team: undefined }).flat
      .map((c) => c.id).join("|");
    assert.equal(conEquipo, sinEquipo, `${p.id}: el campo team altera la elegibilidad`);

    // Y el pool contiene MÁS que las cartas del equipo (el IMPRESO, la regla del sesgo): si no, sería
    // una garantía. Un equipo sin ninguna carta en el catálogo (BLG, TE, JDG) no puede venderse.
    const total = buildPool(registry, p).flat.length;
    const suyas = buildPool(registry, p).flat.filter((c) => isTeamPackCard(c, registry.player(c.playerId), p.team)).length;
    if (suyas === 0) { assert.ok(isDraft(p) && !isPurchasable(p), `${p.id}: sin cartas del equipo y a la venta`); continue; }
    assert.ok(suyas > 0, `${p.id}: el equipo no tiene ninguna carta elegible`);
    assert.ok(total > suyas * 2, `${p.id}: el pool es casi solo del equipo (${suyas}/${total})`);
  }
  // Y el motor de elegibilidad, por si alguien lo cambia: no menciona el equipo.
  assert.ok(!/pack\.team/.test(read("../../domain/packs/pool.ts")), "pool.ts no puede leer pack.team");
  assert.ok(!/\bteam\b/.test(read("../../domain/packs/openPack.ts")), "openPack.ts no puede saber de equipos");
  assert.doesNotThrow(() => isEligible(registry, getPack("team-g2")!, new CardRegistry().cards[0]));
});

test("EQUIPO · el recuento de cartas del equipo es real y derivado", () => {
  /*
   * Es el dato que la tienda enseña para que «más probabilidad» sea comprobable. Se deriva del
   * catálogo, así que no puede quedarse mintiendo cuando entren cartas nuevas.
   */
  const fnatic = teamCardCount("Fnatic");
  const heretics = teamCardCount("Team Heretics");
  assert.ok(fnatic.total > 0 && heretics.total > 0);
  assert.notEqual(fnatic.total, heretics.total, "los dos sobres no tienen las mismas cartas del equipo");
  // Derivado con la regla del sesgo (el equipo impreso): lo mismo que cuenta el catálogo.
  assert.equal(heretics.total, CARDS.filter((c) => isTeamPackCard(c, getPlayer(c.playerId), "Team Heretics")).length);
  const suma = Object.values(fnatic.porRareza).reduce((a, b) => a + (b ?? 0), 0);
  assert.equal(suma, fnatic.total, "el desglose por rareza suma el total");
  assert.equal(teamCardCount("Equipo Que No Existe").total, 0, "un equipo sin cartas da cero, no falla");
});

test("CATÁLOGO · ninguna pantalla decide nada por `packId`", () => {
  /*
   * §9 y §10 del encargo: prohibido `if (packId === "heretics")`. Se comprueba sobre las
   * piezas que dibujan el producto y sobre la tienda, con los ids REALES del catálogo.
   */
  const piezas: [string, string][] = [
    ["packIdentity", code("./packIdentity.ts")],
    ["PackSigil", code("./PackSigil.tsx")],
    ["SealedPack", code("./SealedPack.tsx")],
    ["ShopHero", code("../shop/ShopHero.tsx")],
    ["ShopRail", code("../shop/ShopRail.tsx")],
  ];
  const vocabulario = [...TIER_ORDER, ...CATEGORIES] as string[];
  for (const [nombre, src] of piezas) {
    for (const p of PACKS.filter((x) => !vocabulario.includes(x.id))) {
      assert.ok(
        !new RegExp(`["']${p.id}["']`).test(src),
        `${nombre} menciona el sobre «${p.id}»: sería una regla por producto`,
      );
    }
    assert.ok(!/packId\s*===/.test(src), `${nombre} compara packId`);
  }
});

/* ─────────────────────── ANTI-GRAMÁTICA ─────────────────────── */

test("ANTI-GRAMÁTICA · las piezas nuevas no reintroducen lo que el sistema vino a quitar", () => {
  const piezas = ["./PackHand.tsx", "./CardBack.tsx"].map(body).join("\n");
  assert.ok(!/z-\[\d+\]/.test(piezas), "z-index arbitrario: existe la escala `LAYER`");
  assert.ok(!/rounded-(xl|2xl|3xl)\b/.test(piezas), "esquina redondeada genérica en vez de chaflán");
  assert.ok(!/overflow-x-auto/.test(piezas), "un carril con scroll corta la primera y la última carta");
});
