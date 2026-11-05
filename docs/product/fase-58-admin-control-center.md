# Fase 58 — Admin Control Center 4.0

2026-09-24 · **GO.**

- Una migración aditiva (0055), aplicada en el VPS con backup previo verificado.
- Sin commit, push ni deploy.

Evidencia en `docs/product/qa/fase58-admin/`: `architecture.md`, `security.md`, `routes.json`, `permissions.json`, `qa.json`, `issues-fixed.json`, `visual-qa.json` y `screenshots/` (51 capturas).

## Baseline → final

| | Antes | Después |
|---|---|---|
| Tests | 5050/5050 | **5066/5066** |
| Cabeza de migraciones | 0054 | **0055** (aplicada 2026-09-24T11:06Z) |
| Catálogo | 331 | 331 |
| `GLOBAL_MARKET_ENABLED` / `PAYMENTS_ENABLED` | false / false | false / false |
| tsc web / scripts · eslint · build | OK | OK · 0 errores (27 avisos, los mismos) · PASS |

## Qué había antes

- **Barrera de acceso.** `AdminGuard`, `/api/admin/session` y `verifyAdmin` (V-1), más un middleware que exige Bearer.
- **Cartas.** Listado, alta en borrador con el arte real, editor con antes/después, versiones, publicación, ciclo de vida y arte.
- **Pools y releases.** Pools con su propio registro; releases, operaciones, torneos y assets.
- **Home.** Un editor de roster LOCAL.
- **Lo que faltaba:** usuarios, moderación persistida, ajustes de créditos con rastro, eventos del juego, observabilidad económica, un registro de auditoría global, búsqueda y salud.

## Qué hay ahora

- **Armazón propio.** `/admin` sin el cromo del juego; barra lateral por grupos, cabecera con búsqueda, admin actual y estado real del sistema, y paleta Ctrl/Cmd+K.
- **Dashboard.**
  - KPIs de `app_admin_dashboard_stats`: usuarios, activos, catálogo, cartas en circulación, sobres, créditos, sancionados, competitivo, eventos y temporada.
  - Alertas de comprobaciones reales y actividad del registro.
- **Búsqueda global.** Usuarios (nombre, email e id), cartas, jugadores, equipos, sobres y eventos, agrupados y con enlace a su ficha.
- **Cartas** (`/admin/cards`).
  - Tabla con arte real (`CardThumb`), jugador, edición, clase F57.3, OVR, rol, estado, `marketValue` e id/versión.
  - Filtros en BD más filtros de página; orden y paginación en servidor.
  - Selección múltiple, exportación CSV/JSON y cambio de estado masivo (CRÍTICO, sin borrado).
  - Importación con dry run obligatorio: al confirmar crea borradores.
  - Alta, ficha y edición reutilizan las páginas existentes: preview con el CardArt real, antes/después, versiones y registro.
- **Jugadores y equipos.**
  - Listas y fichas con las cartas asociadas.
  - Solo lectura: no hay backend de escritura y el equipo impreso de una carta es histórico.
- **Sobres.**
  - Tabla con arte, precio, cartas, estado, tipo, EV, EV/precio, desguace/precio, % Prime y % Icon (datos `packStats`).
  - Ficha con configuración, probabilidades (tabla F57.3 o rareza medida), garantías y pools.
  - **Simulador de solo lectura** (antes/después, mismas semillas); marca «NO válida» una configuración con bucle.
- **Eventos.**
  - Asistente de 5 pasos que siempre crea un **borrador** (`admin_event_drafts`).
  - Publicar (ALTO, escribiendo el nombre) inserta el evento canónico en `public.events`; sus recompensas son las de `challengeSetFor`.
  - Estados Borrador, Programado, Activo, Terminado y Cancelado, calculados por fecha (zona del navegador y UTC).
  - Analítica real: reclamos en `user_achievements`.
- **Usuarios.** Búsqueda y ficha 360: identidad sin secretos, progreso, colección, sobres, mazos, competitivo, pase, modos, libro mayor, sanciones y actividad administrativa.
  - **Operaciones:** ajustar créditos (añadir o retirar, saldo actual → cambio → final, motivo, idempotente, saldo esperado) y conceder sobre o carta con `award()`.
  - **Zona peligrosa:** suspender o banear (el ban permanente es CRÍTICO y exige escribir el usuario) y revocar.
- **Moderación.** Sanciones activas, caducadas y revocadas. El enforcement es real en el servidor (ver `security.md`).
- **Economía.** Solo observabilidad:
  - salud (7 comprobaciones);
  - banda de la línea principal;
  - valor y desguace por clase;
  - fuentes y sumideros del libro mayor a 7 y 30 días;
  - sobres más abiertos;
  - créditos en circulación.
- **Temporadas, competitivo y recompensas.** Solo lectura, con datos reales. Sin botones inventados: no existe cierre de temporada ni acciones de competitivo en el dominio.
- **Auditoría.** Registro inmutable con filtros (acción, entidad, id, admin, fechas) y paginación.
- **Sistema.** Versión, entorno, cabeza de migraciones (sondeo real), catálogo, 9 comprobaciones de salud en vivo y flags de solo lectura.

## Hallazgos y correcciones

- **Sin persistencia de sanciones.** Resuelto con 0055 y enforcement.
- **Auditoría editable.** Ahora es append-only.
- **Créditos sin vía con rastro.** Resuelto con una RPC sobre el libro mayor.
- **El panel se desmontaba al refrescarse el token.** Perdía formularios; corregido en `useAdminSession`.
- **Latencia de salud a 0 ms.** Corregido.
- **Aviso real, sin corregir:** el Sobre Oro no tiene pool vinculado (la economía está congelada y no tiene efecto).

## Datos

- **Tu cuenta:** NO modificada (939.575 créditos y 0 sanciones, antes y después).
- **Cuenta QA** (`qa_campaign_352_8c32`):
  - créditos +1 y −1 (neto 0);
  - suspensión de 1 h, con enforcement comprobado (403) y revocada;
  - 6 entradas de auditoría.
- **Borrador de evento:** 1 creado y cancelado; `public.events` sin cambios.
- **Producción:** no se ha modificado ningún dato peligroso.

## Limitaciones reales

- Un único rol de admin (no hay superadmin).
- Jugadores, equipos, precios y sobres no se escriben desde el panel (no hay backend o están congelados).
- La descripción y la imagen de un evento son metadatos del panel: el juego muestra nombre, tipo, región y fechas.
- Los eventos de sobre (EWC/Masters/Champions) viven en código.
- «Usuarios activos» usa `last_seen_at`.
