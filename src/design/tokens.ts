/**
 * SISTEMA DE DISEÑO NEXUS — fuente ÚNICA de los valores visuales (Fase 9A).
 *
 * Antes de esta fase cada pantalla improvisaba: `rounded-xl` junto a `rounded-2xl`,
 * `bg-white/[0.03]` junto a `bg-base-700/30`, opacidades de texto en 40/45/50/55/60.
 * El resultado se leía como una web con tarjetas, no como un producto de esports.
 *
 * Aquí viven los valores. `tailwind.config.ts` los consume para generar las utilidades y
 * `globals.css` los publica como custom properties para lo que no puede ser una clase
 * (gradientes calculados, sombras compuestas, fondos por contexto). No hay una tercera copia.
 *
 * REGLA: ningún componente inventa un color, un radio o una duración. Si falta algo, se
 * añade aquí. Los nombres antiguos (`base-*`, `drl`, `rarity-*`) se CONSERVAN porque 36
 * pantallas dependen de ellos; esta capa los ordena y añade lo que faltaba.
 */

// ───────────────────────────── Color ─────────────────────────────

/** Fondos, del más profundo al más elevado. Un plano = un nivel, sin mezclar. */
export const SURFACE = {
  /** El lienzo de la aplicación. Nada va por debajo. */
  canvas: "#06070d",
  /** Superficie base de una sección. */
  base: "#0b0d18",
  /** Tarjeta o panel sobre la sección. */
  raised: "#11131f",
  /** Elemento elevado: menú abierto, diálogo, carta seleccionada. */
  elevated: "#171a2b",
  /** Máxima elevación: overlay a pantalla completa. */
  overlay: "#1f2336",
} as const;

/** Bordes. La opacidad codifica jerarquía, no capricho. */
export const BORDER = {
  /** Separador apenas perceptible. */
  subtle: "rgba(255,255,255,0.06)",
  /** Borde por defecto de una tarjeta. */
  DEFAULT: "rgba(255,255,255,0.10)",
  /** Elemento interactivo en reposo. */
  strong: "rgba(255,255,255,0.18)",
  /** Foco, hover o selección. */
  focus: "rgba(255,255,255,0.32)",
} as const;

/** Texto. Cuatro niveles, ni uno más. */
export const TEXT = {
  /** Titulares y cifras. */
  primary: "#eef1f8",
  /** Cuerpo. */
  secondary: "rgba(238,241,248,0.72)",
  /** Apoyo, descripciones. */
  muted: "rgba(238,241,248,0.48)",
  /** Etiquetas, unidades, metadatos. */
  faint: "rgba(238,241,248,0.30)",
} as const;

/** Acentos de marca. */
export const ACCENT = {
  /** Acción principal, identidad NEXUS. */
  primary: "#ff2e63",
  primaryGlow: "#ff5c8a",
  /** Acento secundario: información, competición en curso. */
  cyan: "#19e3ff",
  /** Acento terciario: logro, recompensa, rareza alta. */
  gold: "#ffd35c",
} as const;

/** Semántica. Es un eje INDEPENDIENTE del acento: nunca se usa `primary` para «error». */
export const SEMANTIC = {
  success: "#3fc07a",
  warning: "#ffb03d",
  danger: "#ff4d5e",
  info: "#19e3ff",
} as const;

/** Rareza de variante. Mismos valores que antes de la Fase 9: las cartas no cambian. */
export const RARITY = {
  bronze: "#cd7f32",
  silver: "#c8d2dc",
  gold: "#ffce4f",
  prime: "#7b5cff",
  winner: "#19e3ff",
  mvp: "#ff2e63",
  mastersMvp: "#ff8a3d",
  championsMvp: "#ffd35c",
  icon: "#f5f0e6",
} as const;

// ───────────────────────────── Forma y ritmo ─────────────────────────────

/**
 * Radios. Escala corta a propósito: cuanto mayor es el elemento, mayor el radio.
 * Un chip y un panel con el mismo radio es exactamente lo que hacía que esto
 * pareciera una web con tarjetas.
 */
export const RADIUS = {
  /** Chips, insignias, celdas pequeñas. */
  sm: "6px",
  /** Botones, campos. */
  md: "10px",
  /** Tarjetas. */
  lg: "16px",
  /** Paneles y secciones. */
  xl: "22px",
  /** Contenedores a pantalla completa. */
  "2xl": "28px",
  full: "9999px",
} as const;

/**
 * CHAFLÁN — la firma geométrica de NEXUS, por fin como token.
 *
 * Estaba repartido: `globals.css` fijaba `--nx-chamfer: 18px` y `--nx-chamfer-sm: 10px`, y
 * `CardRenderer` se inventaba 11/16/21/25 px por tamaño de carta, más un 5 px suelto en el
 * medallón de variante. Cuatro sitios decidiendo la misma firma.
 *
 * La escala va por ROL, no por tamaño: el corte de un botón y el de un panel no son el mismo
 * gesto a distinta escala, son dos piezas distintas del mismo objeto.
 *
 * **Ni un valor existente cambia.** `stage` es el 18 px que ya usaba `.nx-clip` y `control` el
 * 10 px de `.nx-clip-sm`, así que los 94 usos actuales del chaflán se ven exactamente igual.
 * `plate` y `medallion` son nuevos y solo los estrenan las primitivas.
 */
export const CHAMFER = {
  /** Sello, insignia, nodo del pase. El corte más pequeño que sigue leyéndose. */
  medallion: "5px",
  /** Botón, chip, campo. (= el `--nx-chamfer-sm` de siempre.) */
  control: "10px",
  /** Panel, sección, bloque de contenido. */
  plate: "14px",
  /** Contenedor a pantalla completa, arena, cabecera. (= el `--nx-chamfer` de siempre.) */
  stage: "18px",
} as const;

/**
 * HUNDIDO — la quinta superficie, la que faltaba.
 *
 * Un hueco practicado en una placa: más oscuro que lo que lo rodea, con el filo superior en
 * sombra y el inferior iluminado. Es lo que hace que una posición de carta se lea como
 * excavada y no como pegada encima, y no existía como token pese a estar dibujado a mano en el
 * tablero, en la placa de datos de la carta y en el pase.
 *
 * Se publica como sombras compuestas porque eso es lo que es: un hueco no tiene color propio,
 * tiene luz.
 */
export const RECESSED = {
  /** Hueco leve: campo, celda, pista. */
  sm: "inset 0 1px 3px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.07)",
  /** Hueco de referencia: posición de carta, placa de datos. */
  md: "inset 0 3px 7px rgba(0,0,0,0.9), inset 0 -1px 0 rgba(255,255,255,0.12)",
  /** Pozo: la zona de enfrentamiento, un raíl de recompensas. */
  lg: "inset 0 16px 30px -18px rgba(0,0,0,0.95), inset 0 -16px 30px -18px rgba(0,0,0,0.95)",
} as const;

/** Espaciado. Base 4, con los saltos que realmente se usan. */
export const SPACE = {
  px: "1px",
  0.5: "2px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
  20: "80px",
} as const;

/**
 * Tipografía. Dos familias con papeles distintos: `display` (Rajdhani, condensada,
 * técnica) para titulares, cifras y etiquetas; `sans` (Inter) para todo lo que se lee
 * en frases. Mezclarlas al azar es lo que hace que un producto parezca improvisado.
 */
export const TYPE = {
  /** Etiqueta en versalitas: seguida de `tracking-label`. */
  label: { size: "10px", height: "1.2", weight: "700", tracking: "0.18em" },
  caption: { size: "11px", height: "1.4", weight: "500", tracking: "0" },
  body: { size: "14px", height: "1.55", weight: "400", tracking: "0" },
  bodyLg: { size: "16px", height: "1.6", weight: "400", tracking: "0" },
  /** Titulares (familia display). */
  h3: { size: "20px", height: "1.2", weight: "700", tracking: "0.01em" },
  h2: { size: "28px", height: "1.12", weight: "700", tracking: "0.01em" },
  h1: { size: "40px", height: "1.05", weight: "700", tracking: "0.01em" },
  /** Cifra grande de marcador o cabecera. */
  display: { size: "64px", height: "0.95", weight: "700", tracking: "-0.01em" },
} as const;

/**
 * READOUT — la cifra competitiva como PAPEL tipográfico, no como tamaño.
 *
 * OVR, créditos, XP, puntos, rango, marcador y serial son el mismo tipo de dato y hasta ahora
 * se escribían con el tamaño que hiciera falta en cada sitio: la auditoría contó CATORCE
 * tamaños de letra distintos en el vestíbulo. La clase `.nx-readout` ya fijaba familia, peso y
 * cifras tabulares; lo que faltaba era la escala.
 *
 * Cinco pasos y ninguno más. Una cifra que no cabe en uno de estos cinco no es una cifra
 * competitiva: es texto.
 */
export const READOUT = {
  /** Dentro de un chip o una fila densa. */
  xs: "13px",
  /** Dato secundario en una placa. */
  sm: "18px",
  /** El valor de la pantalla. */
  md: "26px",
  /** Protagonista: marcador de duelo, saldo, OVR de la carta grande. */
  lg: "40px",
  /** Momento: resultado final, nivel alcanzado. */
  xl: "64px",
} as const;

// ───────────────────────────── Profundidad y movimiento ─────────────────────────────

/**
 * Elevación. Dos componentes: una sombra que asienta el elemento y, opcionalmente, un
 * halo de color. El halo NO sustituye a la sombra —sin sombra, el neón flota.
 */
export const ELEVATION = {
  none: "none",
  sm: "0 1px 2px rgba(0,0,0,0.4)",
  md: "0 6px 16px -4px rgba(0,0,0,0.55)",
  lg: "0 18px 50px -12px rgba(0,0,0,0.75)",
  xl: "0 32px 80px -20px rgba(0,0,0,0.85)",
} as const;

export const GLOW = {
  primary: "0 0 24px rgba(255,46,99,0.45)",
  cyan: "0 0 24px rgba(25,227,255,0.40)",
  gold: "0 0 32px rgba(255,211,92,0.50)",
  success: "0 0 24px rgba(63,192,122,0.40)",
} as const;

/**
 * Duraciones. Un producto de esports responde rápido: por encima de ~350 ms una
 * transición de interfaz se percibe como lentitud, no como elegancia. Las revelaciones
 * (abrir un sobre, resolver un turno) son la excepción y tienen su propia escala.
 */
export const DURATION = {
  /** Realimentación inmediata: hover, pulsación. */
  instant: 120,
  /** Transición normal de interfaz. */
  fast: 200,
  /** Entrada de un panel o cambio de pantalla. */
  normal: 320,
  /** Momento con intención dramática. */
  slow: 600,
  /** Revelación (sobres, resultado de duelo). */
  reveal: 1200,
} as const;

/** Curvas. `out` para lo que entra, `inOut` para lo que se mueve, `spring` para lo físico. */
export const EASING = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/**
 * ELEVACIÓN SEMÁNTICA — los mismos valores de `ELEVATION`, dichos por su función.
 *
 * La auditoría contó 22 sombras distintas en la colección. No sobran valores: falta un
 * vocabulario. `ELEVATION` se conserva tal cual (lo consume Tailwind y 36 pantallas); esto le
 * pone nombre a para qué sirve cada escalón, y añade el único que faltaba de verdad: `focus`.
 */
export const DEPTH = {
  /** Al ras del plano. */
  none: ELEVATION.none,
  /** Un separador que apenas se despega. */
  subtle: ELEVATION.sm,
  /** Una placa apoyada en el escenario. */
  surface: ELEVATION.md,
  /** Un objeto: carta, sobre, medallón. */
  object: ELEVATION.lg,
  /** Una capa por encima de todo: diálogo, revelación. */
  impact: ELEVATION.xl,
  /**
   * FOCO. El único que no existía, y el que hace falta para no borrar el `outline` del
   * navegador sin dar nada a cambio: un anillo de dos tonos que se ve sobre cualquier
   * superficie del sistema, oscura o clara.
   */
  focus: "0 0 0 2px #06070d, 0 0 0 4px rgba(255,46,99,0.9)",
} as const;

/**
 * Z-INDEX — jerarquía semántica.
 *
 * Medido: 30 usos de `z-10`, 13 de `z-20`, 7 de `z-50` y **nueve valores arbitrarios** entre
 * `z-[60]` y `z-[100]`, cada uno decidido por quien tuvo el conflicto ese día. Cuando dos
 * capas se pelean, gana quien puso el número más alto — que no es una jerarquía, es una
 * subasta.
 */
export const LAYER = {
  /** Contenido normal. */
  base: 0,
  /** Algo que se despega dentro de su contenedor: cabecera pegajosa, capa de una carta. */
  surface: 10,
  /** Elemento que flota sobre su sección: menú, tooltip, carta levantada. */
  floating: 20,
  /** El cromo de la aplicación: barra superior, navegación. */
  chrome: 40,
  /** Velo a pantalla completa. */
  overlay: 50,
  /** Diálogo y revelación. */
  modal: 60,
  /** Avisos. Siempre por encima de todo lo demás. */
  toast: 80,
} as const;

/**
 * DENSIDAD — NEXUS tiene dos modos de UI y hasta ahora usaban el mismo ritmo.
 *
 * `gameplay` es donde se juega y se colecciona: la pieza manda, hay aire y el dato se lee de
 * lejos. `management` es donde se administra —constructor de mazos, mercado, listas del
 * entrenador—: cabe más información, se lee de cerca, y aun así habla el mismo idioma.
 *
 * No son dos estéticas: son dos ritmos de la misma. Cambian el aire y el tamaño del dato,
 * nunca la geometría ni el color.
 */
export const DENSITY = {
  gameplay: { gap: SPACE[6], pad: SPACE[5], readout: READOUT.lg, label: TYPE.label.size },
  management: { gap: SPACE[3], pad: SPACE[3], readout: READOUT.sm, label: TYPE.label.size },
} as const;

/** Puntos de ruptura. Coinciden con los que se verifican en 9J. */
export const BREAKPOINT = {
  mobile: 390,
  tablet: 768,
  laptop: 1024,
  desktop: 1440,
  wide: 1920,
} as const;

/** Altura de la barra superior. La usan el armazón y cualquier elemento pegajoso. */
export const CHROME = {
  topBar: 64,
  topBarCompact: 56,
  mobileBar: 64,
} as const;

// ───────────────────────────── Fase 3B ─────────────────────────────

/**
 * GROSOR DE TRAZO — la escala que faltaba.
 *
 * `BORDER` codifica el COLOR del canto (cuatro niveles de jerarquía) pero nunca su grosor, así
 * que cada pantalla escribía `border` (1 px) o `border-2` según le pareciera. Tres pasos y
 * ninguno más, porque un canto no tiene más papeles que estos tres:
 *
 *   hair   separar        — la línea por defecto entre dos zonas
 *   edge   señalar        — selección, foco, estado activo
 *   heavy  advertir       — el único que grita; se reserva a lo destructivo o crítico
 */
export const STROKE = {
  hair: "1px",
  edge: "2px",
  heavy: "3px",
} as const;

/**
 * SUPERFICIES — la gramática, escrita.
 *
 * Había cinco componentes (`Stage`, `Plate`, `Recessed`, `Rail`, `Medallion`) pero la
 * gramática aprobada nombra otros cinco PAPELES (background, stage, plate, recessed, object),
 * y las dos listas no coincidían: `background` no era ninguna pieza y `object` no existía.
 *
 * Aquí queda resuelto: el papel es el token, el componente es su encarnación. `Rail` y
 * `Medallion` no son papeles nuevos — son un separador y un objeto de formato pequeño.
 *
 * La respuesta a «¿qué superficie estoy usando?» es el atributo `data-surface` que cada
 * primitiva emite, y su valor sale SIEMPRE de esta tabla.
 */
export const SURFACES = {
  /** El lienzo de la aplicación. No tiene canto ni sombra: es el fondo del mundo. */
  background: { chamfer: null, depth: "none", tint: false },
  /** El plano donde ocurre algo: héroe, arena, vitrina. Luz ambiental propia. */
  stage: { chamfer: CHAMFER.stage, depth: "impact", tint: true },
  /** La unidad de contenido: panel, sección, bloque. */
  plate: { chamfer: CHAMFER.plate, depth: "surface", tint: true },
  /** Un hueco practicado en una placa: campo, pista, pozo. */
  recessed: { chamfer: CHAMFER.control, depth: "none", tint: false },
  /** Una pieza que se coge: carta, sobre, sello. Se despega del plano. */
  object: { chamfer: CHAMFER.plate, depth: "object", tint: true },
} as const;

export type SurfaceRole = keyof typeof SURFACES;

/**
 * FOCO — una decisión, tres codificaciones.
 *
 * `DEPTH.focus` es la sombra; la clase `.nx-focus` la aplica HACIA DENTRO (una pieza con
 * `clip-path` recorta cualquier anillo exterior, así que un foco por fuera sería invisible en
 * la mitad del sistema) y `NxButton` usa el anillo de Tailwind con estos mismos dos colores.
 *
 * Publicar las partes aquí es lo que permite verificar que las tres dicen lo mismo, en vez de
 * confiar en que nadie las separe.
 */
export const FOCUS = {
  /** Color del anillo. Es el acento de marca: el foco no inventa color. */
  ring: ACCENT.primary,
  /** Separación entre la pieza y el anillo, del color del lienzo. */
  offset: SURFACE.canvas,
  /** Grosor del anillo y de la separación. */
  width: STROKE.edge,
} as const;
