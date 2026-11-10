# F72.5 · CTAs de /jugar

Fecha: 2026-09-29 · Solo presentación · Sin migración, commit, push ni deploy. Evidencia: `docs/product/qa/fase72-5/`.

## Cambio

Los botones de las tres tarjetas de `/jugar` (Road to Champions, Duelos, Tactical Coach) salen de UN componente nuevo,
`ModeCta` (`src/components/modes/ModePanel.tsx`), que sustituye al `NxButton` dentro de `ModePanel`; estilos en
`src/app/game-experience.css` (`.nx-mode-cta*`, junto a `.nx-mode`).

| | Antes | Después |
|---|---|---|
| Alto | 52 px | 68 px (64 px en móvil) |
| Texto | 15 px | 19 px, negrita, mayúsculas |
| RTC | magenta de marca | oro sólido `255,211,92`, tinta oscura (contraste 14,0) |
| Duelos | fondo 3 % blanco (fantasma) | magenta sólido `255,46,99`, tinta blanca (3,6 = AA de texto grande) |
| Coach | fondo 3 % blanco (fantasma) | cian sólido `47,224,255`, tinta oscura (12,6) |
| Forma | chaflán | chaflán `nx-clip-sm` + bisel interior + dos cortes diagonales + `///` + flecha SVG |

- Ancho: todo el ancho útil de la tarjeta, con 24 px (20 px en móvil) de aire; separado del título.
- Hover: más brillo y filete claro; flecha +5 px y botón −1 px solo con movimiento permitido. Active: `nx-press`. Foco por teclado:
  anillo blanco + filete oscuro pintados HACIA DENTRO (el chaflán es un `clip-path` y recortaría un anillo exterior).
- Reducido: sin desplazamientos ni transiciones; el brillo del hover se mantiene (no es movimiento).
- Nada cambia de lógica: mismos `href`, etiquetas (`campaignAreaCta` sigue decidiendo JUGAR / RETOMAR PARTIDA / COMPLETAR EQUIPO),
  `data-testid` y `data-cta` (sigue habiendo UNA acción dominante marcada). La flecha es SVG para que el texto del enlace siga
  siendo solo la etiqueta. No hay estado deshabilitado real en estos tres (siempre son enlaces): no se inventa.
- NO tocados: la banda «Continuar partida» (`play-hub-resume`) y el JUGAR global de la cabecera.

## QA real (:3005, cuenta QA A)

`scripts/_f725-qa.ts after`: **78/78** a 1440/1024/390 — ancho útil, alto ≥ 60, 19 px, fondo sólido del modo, contraste AA, texto entero
y flecha, misma altura los tres, una sola acción dominante, sin scroll horizontal, hover (brillo + flecha), active, foco por Tab,
reducido quieto, los tres clics reales a su destino (`/jugar/road-to-champions`, `/duelos`, `/entrenador`), 0 errores de consola.
`scripts/_f725-resume.ts`: **13/13** con una partida rápida real abierta — «RETOMAR PARTIDA» en una línea también en la columna de
261 px (1024), la banda «Continuar partida» intacta; la partida se abandonó al final.

Suite 5.542/5.542 · tsc web+scripts 0 · lint 0 errores · build `drl-0.1.1-1-133d5d5e` (supervisor F70.2) · smoke 74/74 ·
gate:browser 56/56 (persona I) · health 200 · ready 0058.

F72.5 — CERRADA (GO)
