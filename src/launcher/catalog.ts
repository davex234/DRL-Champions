/**
 * NEXUS LAUNCHER — CATÁLOGO DE TÍTULOS.
 *
 * Datos del escaparate. Son estáticos y deterministas a propósito: el launcher se comporta
 * igual en cada arranque, y sustituir esto por un `fetch` a una API real es cambiar solo el
 * proveedor (`getGames`), sin tocar motores ni interfaz.
 *
 * DRL Champions es el único título REAL (tiene `route`); el resto son producciones del sello
 * que ejercitan el ciclo completo de instalación.
 */
import type { Game, DiskLocation } from "./types";

const GB = 1024 ** 3;

export const GAMES: Game[] = [
  {
    id: "drl-champions",
    name: "DRL Champions",
    title: "DRL CHAMPIONS",
    tagline: "El circuito competitivo, en tus manos.",
    description:
      "Construye tu plantilla con las estrellas del circuito, disputa duelos tácticos por rondas y escala hasta la cima de la temporada. Cartas generadas con rendimiento real, economía viva y torneos que se resuelven solos.",
    genre: "Cartas competitivas",
    developer: "NEXUS Studios",
    version: "0.1.1",
    updatedAt: "2026-09-01",
    sizeBytes: Math.round(4.2 * GB),
    palette: { key: "#ff2e63", accent: "#ff5c8a", deep: "#2a0713" },
    artSeed: 1041,
    monogram: "DC",
    tags: ["Competitivo", "Coleccionable", "Temporadas"],
    requirements: [
      { label: "Sistema", minimum: "Windows 10 64-bit", recommended: "Windows 11 64-bit" },
      { label: "Procesador", minimum: "Intel i3-8100", recommended: "Intel i5-11400" },
      { label: "Memoria", minimum: "8 GB RAM", recommended: "16 GB RAM" },
      { label: "Gráfica", minimum: "GTX 1050", recommended: "RTX 3060" },
      { label: "Almacenamiento", minimum: "5 GB", recommended: "8 GB SSD" },
    ],
    content: [
      { id: "dc-s1", kind: "Temporada", title: "Temporada 1 · Ascenso", summary: "90 niveles de pase, recompensas semanales y cartas de edición limitada." },
      { id: "dc-duel", kind: "Modo", title: "Duelo por rondas", summary: "Enfrentamientos resueltos por lectura táctica y gestión de economía." },
      { id: "dc-ev", kind: "Evento", title: "Serie Ascenso", summary: "Clasificatorias abiertas cada fin de semana con premios de colección." },
    ],
    route: "/",
    bundled: true,
  },
  {
    id: "project-alpha",
    name: "Project Alpha",
    title: "PROJECT ALPHA",
    tagline: "Cinco operativos. Un objetivo. Cero segundas oportunidades.",
    description:
      "Shooter táctico por rondas en el que cada bala cuenta y cada habilidad se compra. Mapas de tres calles, economía por ronda y un techo de habilidad que no se toca en cien horas.",
    genre: "Shooter táctico",
    developer: "Meridian Interactive",
    version: "3.14.0",
    updatedAt: "2026-08-28",
    sizeBytes: Math.round(22.5 * GB),
    palette: { key: "#19e3ff", accent: "#6ff0ff", deep: "#04222c" },
    artSeed: 2207,
    monogram: "PA",
    tags: ["Táctico", "5v5", "Free to play"],
    requirements: [
      { label: "Sistema", minimum: "Windows 10 64-bit", recommended: "Windows 11 64-bit" },
      { label: "Procesador", minimum: "Ryzen 3 3100", recommended: "Ryzen 5 5600X" },
      { label: "Memoria", minimum: "8 GB RAM", recommended: "16 GB RAM" },
      { label: "Gráfica", minimum: "GTX 1650", recommended: "RTX 4060" },
      { label: "Almacenamiento", minimum: "24 GB SSD", recommended: "30 GB NVMe" },
    ],
    content: [
      { id: "pa-act", kind: "Temporada", title: "Acto III · Fractura", summary: "Nuevo mapa urbano, revisión de economía y pase de acto." },
      { id: "pa-mode", kind: "Modo", title: "Asalto rápido", summary: "Nueve rondas, sin cambio de lado, para partidas de quince minutos." },
      { id: "pa-map", kind: "Mapa", title: "Ferrovía", summary: "Dos sitios, un paso central elevado y ángulos largos para el rifle." },
    ],
    route: null,
  },
  {
    id: "project-nexus",
    name: "Project Nexus",
    title: "PROJECT NEXUS",
    tagline: "El tablero se mueve mientras piensas.",
    description:
      "Estrategia en tiempo real de escaramuzas cortas: despliega, corta líneas de suministro y gana el mapa antes de que el rival termine su segunda expansión.",
    genre: "Estrategia",
    developer: "Ninth Column",
    version: "1.9.2",
    updatedAt: "2026-08-19",
    sizeBytes: Math.round(14.8 * GB),
    patchBytes: Math.round(3.6 * GB),
    palette: { key: "#8b5cf6", accent: "#c4b5fd", deep: "#1b1140" },
    artSeed: 3319,
    monogram: "PN",
    tags: ["Estrategia", "1v1", "Clasificatoria"],
    requirements: [
      { label: "Sistema", minimum: "Windows 10 64-bit", recommended: "Windows 11 64-bit" },
      { label: "Procesador", minimum: "Intel i5-9400", recommended: "Intel i7-12700" },
      { label: "Memoria", minimum: "12 GB RAM", recommended: "16 GB RAM" },
      { label: "Gráfica", minimum: "GTX 1060", recommended: "RTX 3070" },
      { label: "Almacenamiento", minimum: "16 GB SSD", recommended: "20 GB NVMe" },
    ],
    content: [
      { id: "pn-s4", kind: "Temporada", title: "Ciclo 4 · Convergencia", summary: "Rebalanceo de facciones y nueva capa de escaramuzas." },
      { id: "pn-mode", kind: "Modo", title: "Duelo relámpago", summary: "Partidas de ocho minutos con recursos acelerados." },
    ],
    route: null,
  },
  {
    id: "project-zero",
    name: "Project Zero",
    title: "PROJECT ZERO",
    tagline: "Sin reaparición. Sin ruido. Sin testigos.",
    description:
      "Extracción táctica de una sola vida. Entras con lo que llevas y sales con lo que consigas — o te quedas dentro para siempre.",
    genre: "Shooter táctico",
    developer: "Halcyon Works",
    version: "0.8.4",
    updatedAt: "2026-08-30",
    sizeBytes: Math.round(38.1 * GB),
    palette: { key: "#ffb03d", accent: "#ffd35c", deep: "#331d03" },
    artSeed: 4423,
    monogram: "PZ",
    tags: ["Extracción", "Acceso anticipado", "PvPvE"],
    requirements: [
      { label: "Sistema", minimum: "Windows 10 64-bit", recommended: "Windows 11 64-bit" },
      { label: "Procesador", minimum: "Ryzen 5 3600", recommended: "Ryzen 7 7700X" },
      { label: "Memoria", minimum: "16 GB RAM", recommended: "32 GB RAM" },
      { label: "Gráfica", minimum: "RTX 2060", recommended: "RTX 4070" },
      { label: "Almacenamiento", minimum: "40 GB NVMe", recommended: "50 GB NVMe" },
    ],
    content: [
      { id: "pz-wipe", kind: "Evento", title: "Reinicio de temporada", summary: "Se vacían los alijos y arranca la carrera por el primer botín." },
      { id: "pz-map", kind: "Mapa", title: "Dique seco", summary: "Zona portuaria con tres puntos de extracción y una única salida segura." },
    ],
    route: null,
  },
  {
    id: "project-omega",
    name: "Project Omega",
    title: "PROJECT OMEGA",
    tagline: "Velocidad pura, sin sanciones.",
    description:
      "Arcade competitivo de carreras a pie por circuitos verticales. Sin armas: solo trazada, impulso y la línea perfecta.",
    genre: "Arcade",
    developer: "Vertex Lab",
    version: "2.2.1",
    updatedAt: "2026-07-11",
    sizeBytes: Math.round(9.3 * GB),
    palette: { key: "#3fc07a", accent: "#8affc2", deep: "#052a1a" },
    artSeed: 5531,
    monogram: "PO",
    tags: ["Arcade", "Contrarreloj", "Juego cruzado"],
    requirements: [
      { label: "Sistema", minimum: "Windows 10 64-bit", recommended: "Windows 11 64-bit" },
      { label: "Procesador", minimum: "Intel i3-10100", recommended: "Intel i5-12400" },
      { label: "Memoria", minimum: "8 GB RAM", recommended: "16 GB RAM" },
      { label: "Gráfica", minimum: "GTX 1050 Ti", recommended: "RTX 3060" },
      { label: "Almacenamiento", minimum: "10 GB SSD", recommended: "12 GB SSD" },
    ],
    content: [
      { id: "po-s2", kind: "Temporada", title: "Circuito 2 · Altura", summary: "Seis trazados verticales y clasificación semanal." },
    ],
    route: null,
  },
];

const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

/** Proveedor del catálogo. Punto único de sustitución por una API real. */
export function getGames(): Game[] {
  return GAMES;
}

export function getGame(id: string): Game | undefined {
  return BY_ID.get(id);
}

/** Título por defecto al abrir el launcher: el juego real del cliente. */
export const DEFAULT_GAME_ID = "drl-champions";

/** Unidades de disco del equipo. Mock con la misma forma que devolvería el sistema. */
export const DISKS: DiskLocation[] = [
  { id: "c", label: "Disco local (C:)", path: "C:\\Games\\NEXUS", totalBytes: 512 * GB, freeBytes: Math.round(146.8 * GB) },
  { id: "d", label: "Almacenamiento (D:)", path: "D:\\NEXUS", totalBytes: 2048 * GB, freeBytes: Math.round(1204.3 * GB) },
  { id: "e", label: "Unidad externa (E:)", path: "E:\\Juegos", totalBytes: 1024 * GB, freeBytes: Math.round(18.2 * GB) },
];

export const DEFAULT_INSTALL_PATH = DISKS[0].path;
