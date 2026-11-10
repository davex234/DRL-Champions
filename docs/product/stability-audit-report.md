# AUDITORÍA COMPLETA DE ESTABILIDAD

> Objetivo: dejar toda la aplicación navegable y estable, sin Runtime Errors, sin errores de
> hidratación, sin páginas rotas y sin componentes que fallen al montar.
>
> Criterio de aceptación aplicado: **aplicación real + navegador real + todas las rutas +
> interacciones principales + tests**. Ninguna pantalla se da por buena porque compile.

---

## 1 · RUTAS AUDITADAS

**39 ficheros `page.tsx`** en `src/app/**`, **13 rutas de API**, **1 layout**.

El recorrido automatizado cubre **43 especificaciones de ruta** (35 estáticas + 8 dinámicas
resueltas con datos reales) y hace **105 comprobaciones por pasada**:

| Bloque | Rutas |
|---|---|
| Núcleo | `/` · `/coleccion` · `/inventario` · `/tienda` · `/cuenta` · `/ranking` |
| Duelos | `/duelos` · `/duelos/jugar` · `/duelos/mazos` · `/duelos/replay/[matchId]` |
| Competición | `/torneos` · `/torneos/[id]` · `/pickems` · `/eventos` |
| Entrenador | `/entrenador` · `/equipos` · `/mapas` · `/strats` · `/partido` · `/carrera` · `/manager` |
| Colección | `/colecciones` · `/colecciones/[slug]` · `/mercado` |
| Progreso | `/logros` · `/recompensas` |
| Mundo | `/mundo` · `/noticias` |
| Sobres | `/abrir/[packId]` |
| Cliente aparte | `/launcher` |
| Administración | `/admin` + 8 subrutas |

Cada ruta se visita **con sesión y sin ella** (media aplicación cambia de rama), con cuenta
**vacía** y con cuenta **sembrada** (10 cartas, 3 sobres, 25.000 créditos, 620 puntos,
región EMEA), y las dinámicas se prueban con **id válido y con id inexistente** —que es lo
que llega por un enlace viejo.

Se audita en **desarrollo y en producción**.

---

## 2 · RUTAS QUE FALLABAN AL EMPEZAR

**Ninguna falla al montar.** Las 43 cargan, pintan contenido y responden.

Y esa frase, sola, sería engañosa: el fallo que motivó esta auditoría **es intermitente y
depende del estado del navegador**, no de la ruta. No se manifiesta en un Chrome limpio, que
es exactamente lo que usa un arnés de pruebas. Por eso el trabajo real fue construir un
arnés capaz de verlo (§4) y encontrar el mecanismo (§5).

---

## 3 · BUGS ENCONTRADOS

### BUG-1 · El service worker cachea las cargas RSC y las respuestas de la API — **P0**

**Archivo:** `public/sw.js`

**Causa raíz.** El comentario decía «estáticos: stale-while-revalidate», pero el código **no
filtraba nada**: aplicaba caché a todo GET del mismo origen que no fuera una navegación.

```js
// ANTES — sin ningún filtro de tipo de recurso
if (req.mode === "navigate") { /* network-first */ return; }
event.respondWith(
  caches.match(req).then((cached) => {
    const network = fetch(req).then(/* … */);
    return cached || network;      // ← la caché gana, sin comprobar nada
  }),
);
```

Eso incluye las **cargas RSC** (`?_rsc=`), que son el flujo Flight que el router pide en
**cada navegación de cliente**. Medido en una compilación real con perfil persistente:

| | Antes | Después |
|---|---|---|
| Cargas RSC en caché | **107** | **0** |
| Respuestas de `/api/` en caché | 0 en la muestra, pero **sin ninguna exclusión** | **0**, excluidas explícitamente |
| Estáticos para modo sin conexión | 32 | 36 |

Y `CACHE = "drl-champions-v1"` era una **constante fija**: el manejador `activate` solo borra
cachés cuyo nombre difiera del actual, así que **la caché no se invalidaba jamás** entre
despliegues.

**Cómo produce `chunk.reason.enqueueModel is not a function`.** En el cliente Flight de React
(`react-server-dom-turbopack-client.browser.development.js:1691`):

```js
function resolveModelChunk(response, chunk, value) {
  if ("pending" !== chunk.status) chunk.reason.enqueueModel(value);
  else { /* … camino normal … */ }
}
```

Si llega una fila para un chunk que **ya no está pendiente**, React asume que es un chunk de
*stream* y que su `reason` es un controlador con `enqueueModel`. Cuando no lo es —porque las
filas del flujo no corresponden a la tabla de chunks de ese cliente— salta ese error exacto.
Servir la carga Flight de una compilación al cliente de otra produce justamente eso.

**Severidad P0**: rompe la navegación con un Runtime Error, es global (el SW se registra en
todas las páginas) y sobrevive a los despliegues.

**Corregido**: lista blanca en lugar de lista negra. Solo se cachean estáticos con hash de
contenido (`/_next/static/`, inmutables por definición), recursos de `public/` y el armazón
para el modo sin conexión. `?_rsc=`, las cabeceras del router de Next (`RSC`,
`Next-Router-Prefetch`, `Next-Router-State-Tree`) y `/api/*` se dejan pasar sin tocar. El
nombre de la caché pasa a `nexus-v2`, y ese cambio es también la vía por la que **se limpia
sola la caché envenenada** de quien ya la tuviera.

### BUG-2 · Un service worker de producción envenena el servidor de desarrollo — **P0**

**Archivo:** `src/components/pwa/RegisterSW.tsx`

**Causa raíz.** Un service worker se instala por **ORIGEN**, no por modo. Basta con haber
abierto una vez una compilación de producción en `localhost:3001` para que siga controlando
las sesiones de `next dev` en ese mismo puerto. La versión anterior hacía esto:

```js
if (process.env.NODE_ENV !== "production") return;   // ← no registra…
```

…pero **no registrar no es lo mismo que desregistrar**: el worker ya instalado se quedaba
exactamente donde estaba, sirviendo desde su caché artefactos de producción a un cliente de
desarrollo, cuyos identificadores de módulo no tienen nada que ver.

Esto explica lo que más despistaba: **el fallo no se reproduce en un Chrome limpio**, porque
un perfil nuevo no tiene el service worker instalado. Toda auditoría con perfil temporal lo
declara sano.

**Corregido**: en desarrollo la aplicación ahora **retira** el worker —le pide que vacíe sus
cachés (`nexus:purge`), lo desregistra, borra `caches` y recarga una vez—.

Verificado en navegador (`npm run sw:purge-verify`): partiendo de un origen envenenado,
`registros 1 → 0`, `cachés 1 → 0`, sin control, **2 cargas de página** (sin bucle de
recargas) y la aplicación sigue funcionando.

### BUG-3 · El `BUILD_ID` no cambiaba aunque cambiara el código — **P1**

**Archivo:** `next.config.mjs`

**Causa raíz.** `generateBuildId` devolvía `drl-${version}-${build}` leyendo solo
`version.json`. Comprobado en la práctica:

```
BUILD_ID actual:                 drl-0.1.1-1
BUILD_ID tras cambiar el código: drl-0.1.1-1     ← idéntico
```

Next envía el build id en cada petición RSC y el cliente compara: si no coincide, fuerza una
recarga completa. **Es su red de seguridad para cuando se despliega mientras alguien tiene la
pestaña abierta.** Con un id congelado esa red nunca se dispara, y un navegador con chunks o
cargas Flight viejas cree estar al día. Combinado con BUG-1, es la receta del fallo.

**Corregido** conservando la intención original (reproducibilidad para los artefactos del
Build Cloud): el id se deriva de la versión **y de un hash del contenido** de `src/`,
`public/sw.js`, el manifiesto y los ficheros de configuración.

```
build 1 (sin cambios):     drl-0.1.1-1-554b9bc2
build 2 (sin cambios):     drl-0.1.1-1-554b9bc2   ← reproducible
build 3 (código cambiado): drl-0.1.1-1-b796e0c8   ← sensible
build 4 (revertido):       drl-0.1.1-1-554b9bc2   ← vuelve el original
```

### BUG-4 · La CSP bloquea la comprobación del servidor de actualizaciones — **P1**

**Archivo:** `src/components/launcher/LauncherHome.tsx`

**Causa raíz.** `/launcher` hacía `fetch("https://update.drlchampions.com/health")`, host que
no está en `connect-src`. El navegador lo bloqueaba y dejaba **dos errores en la consola** en
cada visita, además de un indicador de estado permanentemente en «Sin conexión».

**Corregido** por donde corresponde: el servidor de actualizaciones **solo importa en el
cliente de escritorio**, así que la comprobación se hace únicamente bajo Tauri (`isTauri()`).
La web deja de llamar a un servicio externo que no necesita, y no hace falta ampliar la CSP.
En escritorio el build estático no emite cabeceras, así que sigue funcionando igual. Se añade
el estado `desktop-only` para no mostrar «Sin conexión» cuando la pregunta no aplica.

---

## 4 · SIETE FALLOS DEL PROPIO ARNÉS (que invalidaban resultados anteriores)

Esto merece su sección porque cada uno produjo un **falso PASS**, y un falso PASS es peor que
un fallo:

| # | Fallo del arnés | Qué ocultaba |
|---|---|---|
| 1 | No se escuchaba `Runtime.consoleAPICalled` | **React informa por `console.error`.** Se recorría la aplicación entera y se declaraba limpia mientras la pantalla mostraba un Runtime Error |
| 2 | La sonda del overlay leía `shadowRoot.textContent` | Devolvía la **hoja de estilo** del portal de Next: 35 falsos positivos, uno por ruta |
| 3 | La navegación «de cliente» usaba `history.pushState` | El App Router lo **ignora**: 25 rutas se daban por buenas mirando siempre la misma pantalla. Se detectó porque rutas distintas devolvían el mismo número de caracteres |
| 4 | Los errores se atribuían a la ruta siguiente | Un `fetch` con temporizador de 4 s llega después de la sonda. El error del launcher aparecía como fallo de `/torneos/[id]` |
| 5 | `child.kill()` con `shell: true` mataba el shell, no a Next | Quedaban **servidores huérfanos** de ejecuciones anteriores; las pruebas siguientes hablaban con ellos y servían código viejo. Provocó un fallo fantasma de 12 comprobaciones en `duel:e2e` |
| 6 | Se buscaban las cartas por un `aria-label` que no existe | El modal de la colección se daba por roto cuando el roto era el selector |
| 7 | La sonda de torneos consultaba la tabla `tournaments` en vez de `events` | `/torneos/[id]` **solo se probaba con un id inexistente**: la pantalla con datos reales no se llegaba a visitar nunca |

Los siete están corregidos, y las correcciones llevan comentario explicando el porqué para
que no vuelvan.

---

## 5 · INVESTIGACIÓN DE `enqueueModel` — HIPÓTESIS DESCARTADAS

Se descartaron dos hipótesis **con evidencia**, antes de tocar código:

**H1 · Desajuste de versión de React.** La aplicación fija `react: 19.0.0` mientras el cliente
Flight de Next 16.2.9 está compilado contra `19.3.0-experimental-3f0b9e61`. Parecía definitivo.
**Es falso**: `next/dist/build/create-compiler-aliases.js` aliasa `react$` y `react-dom$` a las
copias vendorizadas de Next, en navegador y en servidor. El App Router **no ejecuta el React de
la aplicación**, y las dos mitades del protocolo comparten build (`npm run react:probe` lo
comprueba). Se corrigió el veredicto de la sonda para que no induzca a ese error.

**H2 · `next build` con `next dev` en marcha.** Comparten `.next/` y `BUILD_ID`. Se montó la
reproducción —compilar en paralelo con la pestaña abierta, navegar durante y después— y
**no se manifestó**: 0 errores de Flight en las tres fases.

**Lo que sí quedó probado**, y es la causa: BUG-1 + BUG-2 + BUG-3 componen la cadena completa.
El SW guarda cargas Flight de una compilación (**medido: 107**), las sirve sin comprobar nada
a un cliente de otra, y el build id congelado impide que Next detecte el desfase.

**Honestidad sobre el alcance de la prueba:** medí el defecto (107 cargas RSC cacheadas) y leí
el código de React que lanza ese mensaje exacto, pero **no conseguí provocar la cadena
completa a demanda**: el `?_rsc=` lleva un hash que suele cambiar entre compilaciones, así que
la colisión que sirve una carga vieja es oportunista. Lo que afirmo es que el mecanismo está
eliminado y que **cachear cargas RSC no es defendible en ningún caso**, con o sin ese error.

---

## 6 · ARCHIVOS MODIFICADOS

**Producto (4):**
- `public/sw.js` — reescrito: lista blanca de caché, exclusión de RSC y `/api/`, caché versionada, canal de purga.
- `src/components/pwa/RegisterSW.tsx` — retira el worker en desarrollo en vez de solo no registrarlo.
- `next.config.mjs` — `generateBuildId` reproducible **y** sensible al contenido.
- `src/components/launcher/LauncherHome.tsx` — la comprobación del servidor de actualizaciones, solo en escritorio.

**Arnés y verificación (nuevos):**
- `scripts/stability-audit.ts` · `scripts/audit-interactions.ts` · `scripts/audit-lowcontent.ts`
- `scripts/sw-verify.ts` · `scripts/sw-dev-purge-verify.ts` · `scripts/react-version-probe.ts`
- `scripts/lib/server.ts` (apagado por árbol de procesos)
- `scripts/lib/cdp.ts` (captura de `console.error`, contador de cargas, perfiles persistentes)

**Tests nuevos:** `src/pwa/sw.test.ts` (8) · `src/build/buildid.test.ts` (4)

**No se ha tocado** ninguna regla de juego, economía, rangos, progresión, sistema táctico,
dominio de cartas, motor de duelos ni seguridad. Los cambios son de estabilidad.

---

## 7 · TESTS AÑADIDOS

**`src/pwa/sw.test.ts` — 8 tests.** Leen el service worker real y bloquean la regresión: que
`?_rsc=` y `/api/` se excluyan **antes** de cualquier `respondWith`; que se comprueben también
las cabeceras del router (un prefetch puede llegar sin query); que solo se cachee lo inmutable;
que el manejador no acabe en una rama que lo capture todo; que el nombre de caché lleve versión
y no sea el envenenado; y que `RegisterSW` **desregistre** en desarrollo.

**`src/build/buildid.test.ts` — 4 tests.** Las dos propiedades tienen que cumplirse a la vez, y
por eso van juntas: reproducible (mismo código → mismo id) **y** sensible (código distinto → id
distinto), incluido un cambio en `public/sw.js`, que no se compila y se olvidaría fácilmente.

---

## 8 · RESULTADO DE CADA VERIFICACIÓN

### Tests y compilación
| | |
|---|---|
| `npm run typecheck` (web + scripts) | ✅ |
| `npm test` | ✅ **374 tests** (eran 362; +12 nuevos) |
| `npm run build` | ✅ |
| `npm run security:verify` | ✅ todas |

### Navegador real — desarrollo
| | |
|---|---|
| `npm run audit:stability` | ✅ **105 comprobaciones · P0 0 · P1 0** |
| `npm run audit:interactions` | ✅ modales, menús, pestañas, cierre de sesión |
| `npm run audit:lowcontent` | ✅ ninguna pantalla atascada en carga |
| `npm run ux:verify` | ✅ 22 pantallas × 5 anchos |
| `npm run sw:purge-verify` | ✅ el worker se retira solo |
| `npm run duel:e2e` | ✅ partida completa con clics reales |
| `npm run duel-gameplay:verify` | ✅ |
| `npm run progression:verify` | ✅ |
| `npm run strats:verify` | ✅ |
| `npm run test:e2e` | ✅ |

### Navegador real — producción (`next build` + `next start`)
| | |
|---|---|
| `npm run audit:stability` | ✅ **105 comprobaciones · P0 0 · P1 0 · P2 0** |
| `npm run sw:verify` | ✅ 0 cargas RSC, 0 respuestas de API, 36 estáticos |

---

## 9 · `chunk.reason.enqueueModel is not a function`

**No aparece en ninguna de las 105 comprobaciones**, ni en desarrollo ni en producción, ni en
carga dura ni en navegación de cliente, ni recorriendo el circuito dos veces con la caché del
router caliente, ni usando atrás/adelante.

Y lo que más importa: **el mecanismo que lo producía está eliminado y hay tests que lo
impiden volver.** El service worker ya no guarda ni una sola carga RSC (medido: 107 → 0), en
desarrollo se retira solo, y el build id vuelve a cambiar cuando cambia el código, de modo que
la red de seguridad de Next contra despliegues a mitad de sesión funciona otra vez.

**Sobre tu navegador ahora mismo:** es muy probable que tengas la caché envenenada de la
versión anterior. Se limpia sola —al entrar en desarrollo la aplicación desregistra el worker
y borra sus cachés, y en producción el cambio de nombre de caché (`v1` → `nexus-v2`) hace que
`activate` borre la vieja—. No tienes que hacer nada a mano.

---

## 10 · RIESGOS QUE QUEDAN ABIERTOS

1. **No conseguí provocar el error a demanda** (§5). El defecto está medido y eliminado, pero
   no puedo enseñarte una captura del mensaje reproducido en laboratorio. Si vuelve a
   aparecer, `npm run audit:stability` lo capturará ahora —antes no podía, por los siete fallos
   del arnés—.

2. **Dos `next dev` sobre el mismo proyecto se pisan**: comparten `.next/dev`. Me costó un buen
   rato de esta auditoría. No es un fallo del producto, pero conviene saberlo.

3. **`next build` con `next dev` en marcha** comparte `.next/` y reescribe `BUILD_ID`. No lo
   pude relacionar con ningún fallo observable (§5, H2), pero durante la Fase 9 se hizo unas
   veinticinco veces. Lo prudente es no compilar con el servidor de desarrollo vivo.

4. **401 en tres pantallas de administración** (`/admin/assets`, `/admin/control`,
   `/admin/releases`) con un usuario que no es administrador. Clasificado **P2 y correcto por
   diseño**: la puerta de cliente (`NEXT_PUBLIC_ADMIN`) es una comodidad y el servidor es la
   autoridad, así que refutar la petición es lo que debe pasar. Deja ruido en consola; para
   quitarlo habría que consultar el estado de administrador antes de pedir datos, lo que es un
   cambio de comportamiento fuera del alcance de una pasada de estabilidad.

5. **Arte que falta** (fotos de jugador, escudos). La aplicación ya lo sustituye por su
   marcador y la auditoría lo cuenta aparte, no como fallo.

6. **Los tests del service worker son de código fuente.** `public/sw.js` se sirve tal cual, sin
   pasar por el empaquetador, así que no hay forma de importarlo y simularlo con fidelidad. La
   comprobación de comportamiento existe, pero vive en un navegador real (`npm run sw:verify`),
   no en `npm test`.
