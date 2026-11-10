# WALKOUT 0.8 — el NPC 3D en producción

**Veredicto: WALKOUT 0.8 — 3D FIXED IN PRODUCTION** (release `drl-0.1.1-1-1a675671`, 2026-10-08T18:38:22Z).
Evidencia: `docs/product/qa/walkout-0.8/`.

## 1. Causa raíz exacta

No era un fallo del walkout ni de producción: en tu PC el navegador **pide movimiento reducido** y el walkout, por
diseño, lo respetaba siempre (2D), sin ofrecer ninguna forma de pedir el 3D desde el juego.

| Comprobación (tu Chrome / tu Windows, solo lectura) | Valor medido |
|---|---|
| `matchMedia('(prefers-reduced-motion: reduce)')` | **true** (`no-preference` false). «No emulation» en DevTools = el valor REAL del sistema |
| Windows › Accesibilidad › Efectos visuales › **Efectos de animación** | **desactivado** (`SPI_GETCLIENTAREAANIMATION = False`) → origen del «reduce» |
| Chrome › Sistema › **«Usar aceleración gráfica cuando esté disponible»** | **desactivado** (`hardware_acceleration_mode.enabled = false`) |
| Proceso GPU de Chrome | `--use-angle=d3d11-warp-webgl` → WebGL por **software** (CPU) |
| GPU instalada | NVIDIA GeForce RTX 3060, driver 32.0.15.9649, estado OK — **Chrome no la usa** |
| WebGL / WebGL2 | disponibles; renderer «ANGLE (Microsoft, **Microsoft Basic Render Driver**…)»; `failIfMajorPerformanceCaveat` → no hay hardware |
| Equipo | 20 núcleos, 16 GB (no es «modesto»: no influye) |
| Assets 3D, CSP, modelo, three.js, flag, `/abrir/icon` | todos correctos (200, sin violaciones, flag «all», misma pieza en preview y apertura) |

Ruta completa revisada: apertura → recompensa persistida → clasificación (Record Breaker → MEGA) → flag «all» →
`chooseStage` → **`reduced` = true → 2D**. Era la única causa: ni WebGL, ni la GPU, ni los assets, ni la CSP
provocaron tu 2D. `chrome://gpu` no es accesible desde la extensión: los datos de GPU salen de WebGL, del proceso GPU de
Chrome y de su `Local State`.

## 2. Cambios

- **Preferencia «Animaciones de apertura»** (`src/lib/walkout/animationPref.ts`): Cinemática 3D · Automático (por
  defecto) · Reducidas. Persistente en el dispositivo (como el sonido). Cinemática ignora `prefers-reduced-motion`,
  nunca una incompatibilidad técnica; Reducidas nunca carga el 3D.
- **Ajustes**: `OpeningAnimationSettings` en el menú del juego y en `/cuenta` (pestaña Cuenta), con el modo activo en
  claro («Automático · 2D (tu sistema pide menos movimiento)», «Cinemática 3D»…).
- **En el propio reproductor**: botón «Ver en 3D» / «Ver en 2D» que guarda la preferencia y vuelve a presentar ESA carta
  (solo la animación). No se ofrece si el 2D es por un fallo técnico.
- **Escenario** (`WalkoutStage.tsx`): en reducido ya **no descarga three.js** para sondear; códigos de motivo
  `REDUCED_MOTION · WEBGL_UNAVAILABLE · WEBGL_CONTEXT_LOST · MODEL_LOAD_FAILED · ASSET_LOAD_FAILED · RUNTIME_ERROR ·
  TIMEOUT · LOW_END_DEVICE`; plazo de 15 s para la persona; los errores al crear o pintar la escena pasan a 2D con UN
  aviso (antes un fallo de pintado tumbaba el walkout de esa carta).
- **Telemetría**: un evento por carta `walkout_stage:<3d|2d>:<código>:<preferencia>` (sin datos personales).
- Arnés: escena `w-ph` (PATMEN Record Breaker 92 Filipinas → lar0k Turquía → mada Canadá).

## 3. Pruebas

**Build de producción aislada** (contenedor sin BD ni secretos; arnés = apertura real con cartas reales fijas):

| Escenario | Resultado |
|---|---|
| s1 reducido + Automático · 1440 | 2D `REDUCED_MOTION`, **0 descargas** de three.js/modelo; «Ver en 3D» → persona 3D, preferencia guardada |
| s2 reducido + **Cinemática 3D** · 1440 | 3D: camina, celebra (ARMS_CROSSED), revela la carta (t = 14,6 s); REPETIR sin reabrir |
| s3 sin preferencia + Automático · **390** | 3D: camina, celebra (HYPE_JUMP), revela |
| s4 Reducidas | 2D, 0 descargas 3D |
| s5 sin WebGL + Cinemática | 2D `WEBGL_UNAVAILABLE`, la carta se presenta |
| s6 contexto WebGL perdido a mitad | 2D `WEBGL_CONTEXT_LOST`; la siguiente vuelve a 3D |
| s7 el modelo no carga | 2D `MODEL_LOAD_FAILED` en las 3, la apertura sigue |
| **Total** | **57/57**; en todas: cada especial con SU país (CAN, TUR, **PHL**), 1 apertura, resumen, 0 errores |
| Ceremonia completa (SALTAR, REPETIR, doble clic, F5, 8 escenas) | **90/90** a 1440 · **35/35** a 390 |
| CERRAR a mitad del walkout | vuelve a `/packs`, escena 3D liberada, 1 apertura, sin reabrir |

**Producción pública** (https://valorosters.com, invitado = motor local, sin cuenta ni gasto; sobre Icon dejado en el
estado local del invitado de prueba; cartas sorteadas por el motor real): sin preferencia del sistema → 3D;
reducido + Automático → 2D; **reducido + Cinemática 3D → 3D a 1440 y a 390**; Reducidas → 2D; Bronce → apertura
tradicional. Todo `TODO OK`, 0 errores de consola (`qa-public-live.txt`).

**Tu Chrome real** (sesión admin ya iniciada; sin abrir sobres): en `/cuenta` el ajuste mostraba «Automático · 2D (tu
sistema pide menos movimiento)»; seleccioné **Cinemática 3D**; en `/admin/walkout` la escena `w-ph` salió en **3D**
(`WEBGL`, persona cargada en 1,4 s, arena CAN para mada) con Windows aún pidiendo movimiento reducido.

**GPU real: NO medida.** Todas las pruebas automáticas renderizan por software (SwiftShader), y tu Chrome también
(WARP), porque la aceleración gráfica está apagada. Los fps en tu PC no se pudieron medir: la pestaña estaba en
segundo plano y Chrome pausa el dibujo. No afirmo ningún rendimiento con GPU.

Tests: suite **6351/6351**, typecheck verde, lint 0 errores, `pack-opening:verify` 34/34, build de producción verde
(compuerta + despliegue). Economía: 7 ficheros con su sha256; overlay de 10 ficheros de presentación/tests.

## 4. Estado

- Release activa `drl-0.1.1-1-1a675671`; healthy, 0 errores en logs, APIs y assets 200, `/design-system` 404.
- **WALKOUT GLOBAL: ON** (`"all"`, sin cambios).
- Tu preferencia en este Chrome: **Cinemática 3D** (se cambia en Cuenta › Animaciones de apertura).

## 5. Lo que depende de tu PC (no lo he tocado)

1. **Para que el 3D vaya fluido con tu RTX 3060**: Chrome › Configuración › Sistema › activar «Usar aceleración gráfica
   cuando esté disponible» → «Reiniciar». Hoy Chrome dibuja con la CPU.
2. Windows › Accesibilidad › Efectos visuales › «Efectos de animación»: no hace falta tocarlo; con «Cinemática 3D» el
   juego ya no depende de ello (y el resto de webs seguirán respetando tu elección).

## 6. Riesgos pendientes

- Rendimiento con GPU real y en móviles modestos sin medir; audio sin escuchar.
- Con Cinemática 3D y aceleración por software (como tu Chrome ahora) el 3D puede ir lento; el botón «Ver en 2D» y el
  ajuste lo resuelven al instante.
- Los motivos `walkout_stage` empiezan a contarse ahora: vigilar `/admin/operations`.

## 7. Rollback

`ssh nexusadmin@212.95.40.144 /opt/nexus/projects/valorosters/bin/deploy.sh --activate drl-0.1.1-1-6079e070` (0.7, sin
la preferencia) · walkout apagado: `--activate drl-0.1.1-1-69e4b672` · antes del walkout: `--activate drl-0.1.1-1-39b025b8`.
Sin migraciones, nada que deshacer en la BD.
