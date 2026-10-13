/**
 * NEXUS LAUNCHER — NOVEDADES.
 *
 * Portada editorial del cliente. Cada pieza es abrible (tiene cuerpo, no solo titular), que
 * es la diferencia entre un carrusel decorativo y una sección de noticias de verdad.
 */
import type { LauncherNews, NewsCategory } from "./types";

export const NEWS: LauncherNews[] = [
  {
    id: "n1",
    gameId: "project-alpha",
    category: "Actualización",
    title: "El campo de batalla cambia",
    excerpt:
      "Ferrovía entra en rotación competitiva y la economía de ronda se reescribe: comprar ya no es una decisión individual.",
    body: [
      "El parche 3.14 cierra el ciclo de revisión económica que empezó en primavera. El bono de derrota deja de escalar en solitario y pasa a repartirse por equipo, de modo que las rondas de rescate dejan de ser una lotería individual y vuelven a ser una decisión de grupo.",
      "Ferrovía se incorpora a la rotación competitiva con dos sitios, un paso central elevado y ángulos largos pensados para el rifle. Es el primer mapa del catálogo diseñado desde cero con el nuevo motor de sonido direccional.",
      "El pase de acto arranca con la actualización y se extiende ocho semanas. Las recompensas de progreso se conservan entre actos por primera vez.",
    ],
    date: "2026-08-28",
    artSeed: 771,
    accent: "#19e3ff",
  },
  {
    id: "n2",
    gameId: "drl-champions",
    category: "Contenido",
    title: "Descubre las novedades de la temporada",
    excerpt:
      "Noventa niveles de pase, cartas de edición limitada y un mercado que responde al rendimiento real del circuito.",
    body: [
      "La Temporada 1 · Ascenso trae noventa niveles de pase con recompensas semanales, una colección de edición limitada por región y la primera tanda de cartas generadas a partir del rendimiento real de la temporada competitiva.",
      "El mercado interno pasa a reaccionar al rendimiento: las cartas de jugadores en racha suben de valor de referencia y las de plantillas inactivas se abaratan. La economía deja de ser una tabla fija.",
      "Se añaden clasificatorias abiertas cada fin de semana con premios de colección para los mejores dieciséis.",
    ],
    date: "2026-09-01",
    artSeed: 1102,
    accent: "#ff2e63",
  },
  {
    id: "n3",
    gameId: "project-zero",
    category: "Evento",
    title: "Compite junto a los mejores",
    excerpt:
      "El reinicio de temporada vacía todos los alijos. Setenta y dos horas para hacerse con el primer botín del ciclo.",
    body: [
      "El reinicio de temporada vacía los alijos de todos los operativos y devuelve el mapa a su estado inicial. Durante las primeras setenta y dos horas, el ritmo de aparición de botín de alto valor se duplica.",
      "Los tres primeros equipos en extraer con el manifiesto completo obtienen una insignia permanente de perfil, visible en el launcher y en la partida.",
      "El evento es gratuito para todos los propietarios del acceso anticipado.",
    ],
    date: "2026-08-30",
    artSeed: 1330,
    accent: "#ffb03d",
  },
  {
    id: "n4",
    gameId: "project-nexus",
    category: "Esports",
    title: "El circuito abre inscripciones",
    excerpt:
      "Clasificatorias abiertas en las cuatro regiones. Del sofá al escenario en seis fines de semana.",
    body: [
      "Las clasificatorias abiertas del Ciclo 4 arrancan en las cuatro regiones con formato de eliminación doble. Cualquier cuenta con nivel 15 o superior puede inscribirse desde el propio cliente.",
      "Los dieciséis mejores de cada región disputan la fase de grupos regional, y los cuatro primeros de cada grupo viajan al evento internacional de cierre de ciclo.",
      "Toda la retransmisión se sigue desde la pestaña de novedades del launcher, sin salir de la aplicación.",
    ],
    date: "2026-08-19",
    artSeed: 1487,
    accent: "#8b5cf6",
  },
  {
    id: "n5",
    gameId: "project-omega",
    category: "Comunidad",
    title: "Los trazados de la comunidad llegan al circuito",
    excerpt:
      "Seis recorridos creados por jugadores entran en la rotación oficial de contrarreloj.",
    body: [
      "El editor de trazados ha producido más de cuarenta mil recorridos desde su apertura. Seis de ellos entran esta semana en la rotación oficial de contrarreloj, con marcas globales y clasificación semanal.",
      "Los autores reciben una parte de las recompensas de temporada generadas por su trazado mientras siga en rotación.",
    ],
    date: "2026-07-11",
    artSeed: 1655,
    accent: "#3fc07a",
  },
];

export function getNews(): LauncherNews[] {
  return [...NEWS].sort((a, b) => b.date.localeCompare(a.date));
}

/** Novedades de un título concreto (ficha de juego). */
export function newsForGame(gameId: string): LauncherNews[] {
  return getNews().filter((n) => n.gameId === gameId);
}

export const CATEGORY_ACCENT: Record<NewsCategory, string> = {
  "Actualización": "#19e3ff",
  Contenido: "#ff2e63",
  Evento: "#ffb03d",
  Esports: "#8b5cf6",
  Comunidad: "#3fc07a",
};

/** Fecha larga en español, estable entre servidor y cliente (sin `toLocaleDateString`). */
const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}
