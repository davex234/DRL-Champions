# Fase 70.1 · Hotfix de runtime (regresión hallada tras la RC F70)

**Fecha:** 2026-09-28 · **Build:** `drl-0.1.1-1-f3ed79f2` (sustituye a `c01cc6fd`) · **App:** `http://127.0.0.1:3005`, solo loopback.
**Evidencia:** `docs/product/qa/fase70-1/`.

## Síntoma (prueba manual de David sobre la RC)

- **A.** Rutas como el perfil, los logros o la temporada pintaban un hub con «JUGAR / INVENTARIO / TIENDA» y cartas grandes.
- **B.** `Failed to fetch` en `/tienda/creditos` y al confirmar la compra de un sobre.
- **C.** El botón ENTRAR del login «no hacía nada».
- **D.** Unas pantallas enseñaban nivel y saldo, y otras el formulario de login.

## Causa raíz (reproducida en Chrome real, perfil persistente)

Son dos causas encadenadas, y una sola explica los cuatro síntomas.

1. **El servidor de :3005 había caído.** La instancia arrancada al cerrar la RC murió en silencio: sin error en su log y sin proceso vivo. En ese momento Kong y el túnel seguían en pie (`127.0.0.1:54521` → 200 desde el host y desde el navegador).
2. **El service worker lo ocultaba** (`public/sw.js`, caché `nexus-v2`). Cuando fallaba la red, en cada navegación hacía dos cosas:
   - respondía `caches.match(req) || caches.match("/")` con estado 200;
   - guardaba el HTML de cada página, con el nivel y el saldo de la cuenta que la pidió.

   Resultado con el servidor caído:
   - una ruta nunca visitada mostraba **la portada cacheada** (el hub del síntoma A) en la URL pedida;
   - una ya visitada mostraba su HTML viejo, con la sesión congelada (síntoma D);
   - cada `/api` fallaba (síntomas B y C).

   Medido con el servidor caído, `repro-down.json`: todos los fallos convergen en **el mismo host y la misma API**, `http://127.0.0.1:3005/api/*`, con `net::ERR_CONNECTION_REFUSED`. `/logros`, `/social` y `/temporada` pintaban el hub con «9.025 DRL Credit» de la cuenta QA K.

**Hipótesis «el servidor llega a Supabase pero el navegador no»:** DESCARTADA. El navegador llega a Kong (`/auth/v1/health` 200 desde la página) y la build se compiló con `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521`, igual que la anterior. No había problema de CORS, cookies ni URL. Con el servidor vivo, `repro-up.json` da 13/13 rutas correctas, login OK y 0 fetch fallidos.

## Por qué F70 no lo detectó

- Todos los gates (tests, smoke, production:check, recorrido) corrieron **mientras el servidor estaba vivo**. production:check comprueba la app en el momento en que se ejecuta, y nada vigilaba después.
- El recorrido usaba un perfil de Chrome **efímero**: el service worker no llegaba a controlar ninguna carga, así que nunca se vio su respaldo a «/».
- Los tests del service worker (`sw.test.ts`) fijaban la exclusión de RSC y de `/api`, pero no la estrategia de las navegaciones.

## Fix (causa raíz, sin tocar producto)

- `public/sw.js`:
  - las navegaciones van **solo a red y no se guardan**;
  - sin conexión, se sirve `/offline.html`, que dice «No hay conexión con el servidor»; nunca otra ruta ni HTML personal;
  - el precache es solo `/offline.html` y el manifiesto;
  - la caché pasa a `nexus-v3`, y `activate` borra la v2 envenenada en los navegadores ya afectados.
- `public/offline.html`: nueva, estática, sin script y sin datos de ninguna cuenta.
- Operación: la app se arranca desacoplada de la sesión de la herramienta (proceso creado por WMI). **Recomendación para la release:** un servicio o tarea que la reinicie, y el gate de navegador en cada despliegue.

Sin cambios en economía, sobres, cartas, agentes, motor, rutas, auth ni BD. La cabeza sigue en 0058.

## Nuevo gate de regresión

- **Tests** (`src/pwa/sw.test.ts`, +3). **Fallan con el sw.js de F70** (comprobado: 8 pass / 3 fail) y pasan con el fix:
  - una navegación fallida nunca sirve el HTML de otra ruta ni HTML cacheado;
  - el precache no contiene «/»;
  - la versión de la caché es ≥ v3.
- **`npm run gate:browser`** (`scripts/ops/browser-gate.ts`). Usa Chrome real, el mismo origen que el usuario y un perfil persistente con el service worker controlando las cargas. No simula fetch. Credenciales en `QA_GATE_EMAIL` y `QA_GATE_PASSWORD`. Comprueba:
  - servidor vivo;
  - navegador → API y navegador → Kong;
  - login por formulario y sesión que persiste tras recargar;
  - 11 rutas por URL directa, el perfil público y 4 por clic, con la marca propia de cada página, estado 200, sin la página offline, 0 fetch fallidos y 0 errores de consola;
  - atrás y adelante;
  - que la caché del service worker no tenga HTML personal;
  - compra real del Sobre Bronce: −1.000 exactos, +1 sobre, persiste tras recargar;
  - 390 px;
  - logout real: sin token, 401 y formulario.

## Resultado final (build `f3ed79f2`)

| Gate | Resultado |
|---|---|
| `npm run gate:browser`, perfil fresco / perfil calentado del usuario | **31/31 / 31/31** |
| Recorrido F70 (PvE, Coach, perfil, logout y login) | 14/14, 0 errores de consola |
| Servidor caído + rutas nunca visitadas | página «No hay conexión con el servidor», sin el hub ni datos de otra sesión |
| Compras QA K | 3 compras: −2.500, −1.000, −1.000. El ledger cuadra (`reconcile-f701.json`, 12/12 cuentas) |
| `npm test` / tsc web / tsc scripts / lint | 5.423/5.423 / PASS / PASS / 0 errores |
| smoke / production:check | 74/74 / 24 PASS · 1 WARN (SMTP) · 1 FAIL (off-site `NOT_CONFIGURED`), ambos externos. `build` PASS |
| `/` · `/api/health` · `/api/ready` | 200 · 200 · ready (0058, 331/331) |
