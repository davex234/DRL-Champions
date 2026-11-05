/**
 * EL RESPALDO DEL RETRATO — que nunca aparezca una imagen rota (Fase 48).
 *
 * El encargo lo pedía en dos sitios distintos y con las mismas palabras: si falta un retrato,
 * lo que se ve es el SIGILO. Nunca una imagen rota, nunca un `alt` vacío flotando, nunca un
 * cuadrado gris. Eso no se comprueba mirando: se pinta el componente y se mira el marcado.
 *
 * Lo que se cubre aquí:
 *   · el estado REAL de hoy (F48B): Veil pinta su arte y los otros nueve caen al sigilo sin
 *     un solo `<img>`, así que el navegador no pide nueve ficheros que no están;
 *   · el estado FUTURO —arte declarado—: el mismo componente pinta la imagen, con su tamaño
 *     intrínseco declarado para que la caja no salte;
 *   · y que el hueco esté reservado con la proporción del contrato en los dos casos.
 *
 * La simulación toca `AGENT_IDENTITY` y lo devuelve a su sitio en un `finally`: el manifiesto
 * se lee vivo, así que no hace falta recompilar nada ni dejar rastro.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentPortrait } from "./AgentPortrait";
import { AGENT_IDENTITY, type AgentArtVariant } from "@/agents/visuals";

const ROSTER = ["veil", "haze", "probe", "pulse", "spear", "blitz", "warden", "tripwire", "specter", "echo"];

const pinta = (agentId: string, variant: AgentArtVariant = "portrait", size: number | "fill" = 96) =>
  renderToStaticMarkup(<AgentPortrait agentId={agentId} variant={variant} size={size} />);

/** Declara arte para un agente, ejecuta, y deja el manifiesto como estaba. */
function conArte<T>(id: string, piezas: AgentArtVariant[], fn: () => T): T {
  const antes = AGENT_IDENTITY[id].published;
  AGENT_IDENTITY[id] = { ...AGENT_IDENTITY[id], published: piezas };
  try {
    return fn();
  } finally {
    AGENT_IDENTITY[id] = { ...AGENT_IDENTITY[id], published: antes };
  }
}

test("F48B: Veil pinta su arte REAL, en el hueco de retrato y en la ficha cuadrada", () => {
  const retrato = pinta("veil", "portrait", "fill");
  assert.match(retrato, /data-art="image"/);
  assert.match(retrato, /src="\/agents\/veil\/portrait\.webp"/);
  assert.match(retrato, /width="480"/);
  assert.match(retrato, /height="640"/);
  const ficha = pinta("veil", "avatar", 30);
  assert.match(ficha, /src="\/agents\/veil\/avatar\.webp"/);
  assert.match(ficha, /width="256"/);
  // Un hueco de retrato grande NO recibe el avatar: cae al retrato, que es el mismo encuadre.
  assert.match(pinta("veil", "portrait-large"), /data-art="glyph"/);
});

test("los otros nueve pintan el sigilo y NADIE pide una imagen", () => {
  for (const id of ROSTER.filter((x) => x !== "veil")) {
    const html = pinta(id);
    assert.match(html, /data-art="glyph"/, `${id} debería caer al sigilo`);
    assert.ok(!html.includes("<img"), `${id} está pidiendo una imagen que no existe`);
    assert.ok(!html.includes("/agents/"), `${id} filtra una ruta de arte inexistente`);
    // El sigilo va dentro: no es un hueco vacío, es la marca del agente.
    assert.match(html, /<svg/, `${id} no ha pintado el sigilo`);
  }
});

test("el hueco se reserva SIEMPRE con la proporción del contrato", () => {
  // 3:4 → 96 de alto dan 72 de ancho, haya arte o no. Es lo que impide el salto al cargar.
  assert.match(pinta("veil", "portrait", 96), /width:72px/);
  assert.match(pinta("veil", "portrait", 96), /height:96px/);
  // El avatar es cuadrado.
  assert.match(pinta("veil", "avatar", 40), /width:40px/);
  assert.match(pinta("veil", "avatar", 40), /height:40px/);
  // Fluido: la caja sale de la proporción, no de un número.
  assert.match(pinta("veil", "portrait", "fill"), /aspect-ratio:480 \/ 640/);
});

test("cuando el arte EXISTE, el mismo componente lo pinta sin tocar ninguna pantalla", () => {
  /* Simulado sobre Blitz: Veil ya tiene arte real (F48B) y no sirve para probar la vuelta. */
  conArte("blitz", ["portrait"], () => {
    const html = pinta("blitz");
    assert.match(html, /data-art="image"/);
    assert.match(html, /src="\/agents\/blitz\/portrait\.webp"/);
    // Tamaño intrínseco declarado: el navegador reserva el hueco antes de descargar.
    assert.match(html, /width="480"/);
    assert.match(html, /height="640"/);
    assert.match(html, /loading="lazy"/);
  });
  // Y al quitarlo, vuelve el sigilo: el respaldo no es un estado del que no se pueda salir.
  assert.match(pinta("blitz"), /data-art="glyph"/);
});

test("un avatar declarado NO se estira para rellenar un hueco de retrato", () => {
  conArte("haze", ["avatar"], () => {
    // En su hueco cuadrado, el avatar se usa.
    assert.match(pinta("haze", "avatar", 40), /src="\/agents\/haze\/avatar\.webp"/);
    // En un hueco de retrato NO: mejor el sigilo que una cabeza deformada.
    assert.match(pinta("haze", "portrait"), /data-art="glyph"/);
  });
});

test("un retrato declarado sí sirve para el hueco cuadrado del roster", () => {
  conArte("probe", ["portrait"], () => {
    assert.match(pinta("probe", "avatar", 30), /src="\/agents\/probe\/portrait\.webp"/);
  });
});

test("el retrato lleva identidad TEXTUAL: no es la única forma de saber quién es", () => {
  /*
   * Accesibilidad del encargo: si la pantalla ya escribe el nombre al lado, el retrato es
   * decorativo y no se repite; si no lo escribe, el retrato tiene que decirlo él.
   */
  const solo = pinta("warden");
  assert.match(solo, /role="img"/);
  // Warden es del modelo anterior (el entrenador usa el roster real): se anuncia como tal.
  assert.match(solo, /aria-label="Warden · Modelo anterior"/);
  // Y una sola vez: el sigilo ya es la imagen etiquetada, el envoltorio no la repite.
  assert.equal(solo.match(/aria-label=/g)?.length, 1, "el nombre se anuncia dos veces");

  /*
   * Acompañado de texto, el envoltorio lleva `aria-hidden` — que calla TODO lo de dentro,
   * sigilo incluido—, así que el lector de pantalla lee el nombre de la pantalla y no dos
   * veces el del retrato.
   */
  const acompanado = renderToStaticMarkup(<AgentPortrait agentId="warden" decorative />);
  assert.match(acompanado, /aria-hidden="true"/);
});

test("un agente inexistente no rompe nada: marco, sigilo neutro y su propio identificador", () => {
  const html = pinta("notanagent");
  assert.match(html, /data-art="glyph"/);
  assert.ok(!html.includes("<img"));
  assert.match(html, /aria-label="notanagent"/);
});

test("F59 · EL MAPA LLEVA LA CARA DENTRO DE LA FICHA (nunca cuerpos enteros ni el retrato de F48)", () => {
  /*
   * La regla que el encargo puso en mayúsculas y la que más fácil sería romper sin darse
   * cuenta el día que existan retratos bonitos: encima del mapa gana la LEGIBILIDAD. Con cinco
   * jugadores, utilidades, flechas, zonas y texto compitiendo, un retrato a 20 px es una
   * mancha y un sigilo sigue siendo una marca.
   *
   * Se comprueba en la fuente porque es una decisión de arquitectura, no de estilo: si alguien
   * importa el retrato en la capa del tablero, esto falla antes de llegar a una pantalla.
   */
  /*
   * SUSTITUIDA en F59 por decisión del usuario: ahora hay arte real de los 29 y en el mapa se quiere
   * la CARA recortada dentro del marcador («no cinco cuerpos enteros diminutos»). Lo que sigue
   * protegiendo es la legibilidad: la ficha conserva su anillo/halo/selección, la cara va DENTRO
   * (`AgentFaceSvg`, radio de la ficha) y, sin arte (legado), el sigilo de siempre.
   */
  const tablero = readFileSync(join(process.cwd(), "src/components/tactics/StrategyBoard.tsx"), "utf8");
  assert.ok(!/<AgentPortrait|<AgentFullBody|AgentLineup/.test(tablero), "ni retratos de interfaz ni cuerpos enteros sobre el mapa");
  assert.match(tablero, /<AgentFaceSvg agentId=\{agentId\} r=\{r - 0\.35 \* U\}/, "la cara, recortada dentro de la ficha");
  assert.match(tablero, /AgentEmblemGlyph/, "respaldo: el sigilo dentro del SVG del mapa");
});
