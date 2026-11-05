# FASE 22.2 — NEXUS DUEL ARENA (Tablero de Duelos)

**Estado:** completada (capa de presentación) · **Fecha:** 2026-09-13
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** (cambios en árbol de trabajo)

---

## 1. Objetivo

Hacer que `/duelos` y el duelo activo se sientan un videojuego de esports premium a pantalla
completa (rival arriba / zona de juego / jugador abajo con HUD), construido **enteramente encima**
del motor de combate existente. Fase de UI/UX: **no** se toca motor, reglas, cálculo de stats, RNG,
matchmaking, rating, liquidación, timeout ni la lógica PvP. El servidor sigue siendo la autoridad y
no se expone el mazo/las cartas privadas del rival.

## 2. Auditoría previa — qué YA existía (y se reutiliza tal cual)

Antes de escribir nada se estudió el sistema de duelos. Prácticamente todo lo que pide la fase ya
estaba construido y probado, así que la regla fue **reutilizar, no reconstruir**:

| Pieza | Dónde vive | Reutilizado |
|---|---|---|
| Tablero (rival arriba / choque centro / mano abajo) | `src/components/duel/MatchBoard.tsx` | Sí, sin tocar |
| Mano en abanico + reversos del rival | `src/components/duel/arena/HandFan.tsx` | Sí, sin tocar |
| Arena PvE (barra, salir, marcador, turnos) | `src/app/duelos/jugar/page.tsx` | Sí, ampliada |
| Arena PvP (reloj, abandono, conexión) | `src/components/duel/pvp/PvpArena.tsx` | Sí, ampliada |
| Motor de combate, resolución, oponente, rating, PvP | `src/domain/cardgame/*`, `src/lib/duel/*` | Sí, intacto |
| Proyección redactada de la partida | `src/lib/duel/matchView.ts` (`buildMatchView`) | Sí, intacto |
| Cartas con profundidad/hover/selección | `CardVisual`, `Card3D` (design system) | Sí, intacto |
| Reduced-motion | `<MotionConfig reducedMotion="user">` en la arena | Ya presente |

**Conclusión de la auditoría:** el único hueco real era la **Fullscreen API del navegador** (§20).
Todo lo demás —layout full-screen, zonas, HUD, turnos, resolución, victoria/derrota, PvE+PvP,
privacidad del rival, autoridad del servidor— ya estaba y funcionaba.

## 3. Qué se añadió (mínimo, encima, sin duplicar)

1. **`src/lib/useFullscreen.ts`** (NUEVO) — hook de la Fullscreen API.
   - SSR-safe (`typeof document === "undefined"` en cada acceso).
   - Cross-browser: `requestFullscreen`/`webkitRequestFullscreen`,
     `fullscreenElement`/`webkitFullscreenElement`, eventos `fullscreenchange`/`webkitfullscreenchange`.
   - `supported` se deriva de la presencia real de la API; promesas con `.catch(() => {})` para que
     un rechazo del navegador no rompa nada.
   - Expone `{ supported, active, toggle, enter, exit }`; `enter` usa `document.documentElement` por defecto.

2. **`src/components/duel/FullscreenToggle.tsx`** (NUEVO) — botón de presentación pura.
   - **Degrada limpio:** `if (!supported) return null` (no obliga a nadie; no aparece si no hay API).
   - Accesible: objetivo táctil 44 px, `aria-pressed`, `aria-label`/`title`, foco visible (`nx-focus`).

3. **`src/app/duelos/jugar/page.tsx`** (MODIFICADO) — monta `<FullscreenToggle />` en la barra de la
   arena (`ArenaBar`), junto a «Salir». La arena ya envolvía todo en `<MotionConfig reducedMotion="user">`
   sobre un contenedor `flex min-h-screen flex-col`, y envía las jugadas a `/api/game/duel`.

4. **`src/components/duel/pvp/PvpArena.tsx`** (MODIFICADO) — monta el mismo botón
   (`<FullscreenToggle className="!h-9 !w-9 !min-h-0" />`) junto a «Abandonar». PvP reutiliza `MatchBoard`.

5. **`src/components/duel/arena.behavior.test.ts`** (NUEVO) — 5 pruebas de la capa visual (§27).

6. **`src/lib/duel/duel.test.ts`** (MODIFICADO) — se añadió `FullscreenToggle.tsx` a `UI_FILES`,
   como exige el propio invariante de cobertura del test («añádelo a UI_FILES para que los invariantes
   lo cubran»). Con ello el componente queda sujeto a los invariantes duros: sin RNG, sin importar
   orquestador/resolver/oponente/servidor, sin tablas de BD de duelos, sin estado de juego en localStorage.

## 4. Layout full-screen y HUD

La arena ya ocupa la pantalla (`min-h-screen flex flex-col`) con rival arriba, choque en el centro y
mano del jugador abajo (`MatchBoard`), barra superior con marcador/turno y acciones. El botón de
pantalla completa se integra en esa barra sin alterar la estructura. No se introdujo tarjeta blanca
centrada ni aspecto de dashboard: la mesa manda el viewport.

## 5. Cartas, mano y zona del jugador

Sin cambios: `CardVisual`/`Card3D` con profundidad, hover y selección; mano en abanico (`HandFan`);
acciones (elegir carta + estadística) que salen del estado real y viajan al servidor. No se inventó
recurso de energía/maná porque **el motor no lo tiene** (§11): no hay medidor de energía.

## 6. Zona del rival y privacidad

Sin cambios y verificado por test: `RivalHand({ count })` recibe solo un **recuento** y pinta
**reversos** (`DuelCardBack`, `aria-label` «El rival tiene N cartas ocultas»). No hay prop de cartas
del rival; la vista llega ya **redactada** por `buildMatchView`. Nunca se expone el mazo oculto.

## 7. Turnos, acciones, animaciones y resolución

Sin cambios: indicador de turno claro, acciones derivadas del estado, animaciones que **representan
un resultado ya decidido por el servidor** (no lo calculan), y presentación del choque/resolución
existentes. En PvP, además, reloj de turno y aviso de «el rival está decidiendo…», con la cuenta
atrás que **no decide** nada (espera al cierre del servidor).

## 8. Energía / recursos

**No aplica.** El motor de duelos es de comparación de estadísticas (10 turnos, atacante elige carta
+ eje) y **no tiene** recurso de energía/mana. Conforme a la restricción de la fase, **no se inventó**
ningún HUD de energía.

## 9. Pantalla completa (§20)

Botón con la Fullscreen API real del navegador y **fallback** por ocultación cuando la API no está
disponible (no se fuerza nada). Montado en PvE y PvP. Cross-browser y SSR-safe.

## 10. Responsive, accesibilidad y rendimiento

- **Responsive:** la arena ya se probó a 390/768/1440 (capturas en `docs/product/qa/`); el botón es
  `shrink-0` y no rompe el flujo. Sin scroll accidental introducido.
- **Accesibilidad:** objetivo 44 px, `aria-pressed`/`aria-label`, foco visible, reduced-motion
  respetado vía `MotionConfig reducedMotion="user"`; no se depende solo del color.
- **Rendimiento:** el hook solo escucha `fullscreenchange` (sin polling, sin N+1, sin renders masivos).

## 11. Seguridad

Servidor autoritativo (las jugadas van a `/api/game/duel`; la interfaz no calcula combate ni resultado),
información privada del rival nunca expuesta (reversos por recuento, vista redactada). El botón de
pantalla completa es presentación pura: no toca red, estado de juego ni recompensas.

## 12. Pruebas (`arena.behavior.test.ts`, 5 escenarios)

1. **SERVER-AUTHORITY** — ni `MatchBoard`, ni `HandFan`, ni `PvpArena` usan `Math.random`; la jugada
   va a `/api/game/duel`.
2. **PRIVACIDAD** — `RivalHand` toma `count`, pinta `DuelCardBack`, sin cartas del rival.
3. **PANTALLA COMPLETA** — el hook usa la Fullscreen API, expone `supported`, usa `.catch`; el botón
   se oculta sin soporte; está cableado en PvE y PvP.
4. **REDUCED-MOTION** — `MotionConfig reducedMotion="user"` en la arena PvE.
5. **SSR-SAFE** — el hook comprueba `typeof document === "undefined"`.

**Resultado:** `arena.behavior` 5/5 + `duel` (invariantes, incl. cobertura del nuevo componente) 20/20 →
**25/25**. Suite completa antes de esta entrega: **942/942**; `typecheck` ✓, `build` ✓, `security:verify` ✓,
`pack:verify` ✓, `content:verify` ✓, `distribution:verify` ✓ (30/0).

## 13. Validación en navegador — qué se comprobó de verdad

Se arrancó la build de producción (`next start`, puerto 3007) y se abrió `/duelos` en Chrome a 1440×960:

- **`/duelos` carga** correctamente (shell NEXUS, cabecera de nivel/créditos, navegación inferior).
- **Autoridad del servidor confirmada en vivo:** sin sesión, la pantalla **rechaza fabricar un duelo
  local** y muestra «Necesitas una cuenta — jugar duelos se guarda en el servidor». Es exactamente el
  invariante que esta fase no debe romper: el duelo vive en el servidor, no en el navegador.
- El flujo de acceso (`/cuenta`) renderiza bien (Entrar/Registro/Recuperar).

**Limitación honesta del entorno (no es un defecto de esta fase):** el duelo interactivo autenticado
**no pudo ejecutarse en vivo** porque el Supabase local (`127.0.0.1:54521`) está **caído** (Docker
desinstalado en esta máquina), y el duelo es server-authoritative de extremo a extremo (auth + RPCs).
Autenticar requeriría (a) teclear una contraseña en un campo —prohibido por las reglas de seguridad
del navegador—, (b) levantar Supabase —Docker no disponible— o (c) escribir en el Supabase del VPS
—fuera de la autorización de solo lectura—. Ninguna es admisible aquí. La cobertura funcional del
interior del duelo (turnos, selección de carta/eje, resolución, victoria/derrota, PvE+PvP) queda
respaldada por la suite de invariantes (942/942) y por las capturas de QA previas en `docs/product/qa/`.

## 14. NO se tocó (lista de la fase)

Motor de combate, reglas, cálculo de stats, RNG, matchmaking, rating, liquidación, timeout, lógica
PvP, `MatchBoard`, `HandFan`, `matchView`, dominio `cardgame/*`, endpoints `/api/game/*`, RPCs.

## 15. Deuda / P2

- **Audio de la arena:** no se añadió; queda como P2 (reutilizar infra de audio existente cuando se
  aborde), tal como permite la fase.
- **Validación interactiva en vivo del duelo:** pendiente de un entorno con Supabase operativo
  (local con Docker, o autorización de escritura contra el VPS). No bloquea la entrega de esta capa.

## 16. Entrega

Sin `git commit`, sin `push`, sin `deploy`. Cambios en el árbol de trabajo.
