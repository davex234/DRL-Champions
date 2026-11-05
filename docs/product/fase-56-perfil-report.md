# FASE 56 — PERFIL DE JUGADOR 4.0 · Identidad, showcase y perfil competitivo

Fecha: 2026-09-23 · sin commit/push/deploy · **0 migraciones** (cabeza 0054).

## 1. Qué perfil existía antes
Fase 31 ya había construido un perfil serio: ruta única `/jugador/[id]` (`/jugador/me` → propio), foto SELF/PUBLIC decidida en el
servidor (`buildPlayerIdentity`), vitrina de 3 ejemplares y 3 logros destacados persistidos (0049, aplicada), avatar de un conjunto
cerrado, colección resumida, ranked de F28, cara a cara, Pick'ems, actividad, compartir (Web Share + portapapeles), «Mi perfil» en la
navegación. Faltaba: el competitivo de F55 (colocación X/10, vecinos de escalera), temporada, alternativa honesta de logros, enlaces al
perfil desde el historial nuevo y el post-partida, nombre seguro y estados vacíos con el lenguaje pedido.

## 2. Arquitectura reutilizada
`GET /api/game/player` → `services/playerIdentity.ts` → `buildPlayerIdentity` (dominio puro). Añadido, todo lectura: `readLadderNeighbors`
(competitive.ts, 3 filas de la escalera), asientos de rating de la temporada activa (≤ 500, calendario por `loadSeasonCalendar`), y en el
dominio `standingOf` (reutiliza `ladderStanding` de F55), `seasonOf` (reutiliza `rankedRecap` de `/temporada`) y `publicName`.

## 3. Datos públicos finales
Nombre público, avatar, nivel de cuenta, cosméticos equipados (título/marco/banderín), rating, puesto, partidas, V/D/E, winrate, forma, rating
máximo, estado de colocación, vecinos de escalera (id de perfil, nombre, puesto, rating), temporada (nombre, días, tramo ranked), vitrina elegida,
logros destacados o últimos conseguidos (fecha al día), resumen de colección (conteos y rareza), últimas partidas ranked, Pick'ems corregidos,
actividad pública (fechas al día), cara a cara solo si hay espectador con sesión.

## 4. Datos privados excluidos
Correo, créditos/saldo, XP exacta, sobres abiertos, duelos privados, versión y uids de la vitrina, logros reclamables, pase y misiones, mazos
y su composición, lista de cartas de la colección, tokens/sesión/IP, flags de admin. Verificado serializando la foto pública (test P1) y en
vivo (escaneo de todas las respuestas: 0 fugas).

## 5–6. Perfil propio vs ajeno
Propio (SELF): editar perfil/vitrina/logros/avatar, equipo, cuenta, XP al siguiente nivel, «Ver temporada», datos «solo tú lo ves». Ajeno (PUBLIC):
solo lectura + compartir (+ acciones sociales de F29 ya existentes). Verificado en vivo: B visto por A → `PUBLIC`, sin botón editar; `/jugador/me` → SELF con editar.

## 7. Avatar / identidad
Se usa el sistema existente (emoji de conjunto cerrado + marco/título/banderín cosméticos); sin imágenes externas ni migración. Nombre:
`profiles.username` (nunca correo); si faltara o tuviera forma de correo → «Jugador NEXUS · XXXX» con 4 caracteres del id público. Nombres largos: 2 líneas con corte.

## 8–9. Competitivo, colocación y rating
Héroe con el emblema ranked de F55 (colocación con muescas / clasificado / #1), rating y «Colocación X / 10» o «#puesto de N». Panel
«Competitivo»: anterior → jugador → siguiente con enlace al perfil de cada vecino y «+N para superar a X», récord, forma, historial con rival
enlazado. Sin rangos con nombre. En vivo: QA B → colocación 1/10, #2, 980, siguiente = QA A (#1, 1020, +41).

## 10. Cartas destacadas
La vitrina persistida (0049), elegida por el jugador: ejemplar concreto, `cardId` exacto (variantes no se colapsan; test K1), pintada con
`PlayerCard → CardFace → CardArt` (sin fondo/borde/caja; halo por `drop-shadow`). Sin vitrina: «Sin cartas destacadas».

## 11. Mazo y privacidad
Los mazos son privados por diseño (F31/F32, contrato «el perfil no enseña mazos»). **No se ha cambiado la política**: no hay sección de mazo
destacado; en el perfil propio queda el enlace «Editar equipo».

## 12. Temporada
Panel «Temporada actual»: nombre del calendario canónico, días restantes, tramo ranked de la temporada (misma función que `/temporada`) y
«Ver temporada» solo en el propio. El pase (nivel, misiones) no viaja a un perfil ajeno; en el propio sigue el bloque de temporada de F34.

## 13. Logros
Destacados (elegidos, solo conseguidos, validado en servidor + RPC). Si no eligió, «Últimos logros conseguidos» (regla objetiva: fecha de
reclamo, máx. 3), nunca «favoritos». Sin rarezas inventadas (el catálogo no las tiene). Vacío: «Aún no hay logros para mostrar».

## 14. Actividad
La de F31, solo hechos públicos (resultados ranked, logros conseguidos, Pick'ems corregidos; fechas al día). Nada de compras, saldo, aperturas ni admin.

## 15–16. Clasificación / historial → perfil
Clasificación: `playerHref(e.userId)` (ya existía; verificado en vivo con clic real → `/jugador/<B>`). Historial de `/competitivo`: la ficha
abre el detalle y el nombre del rival abre su perfil (nuevo). Historial completo y detalle ya enlazaban. Post-partida ranked: «Ver perfil del
rival» (del `?matchup=` del servidor; no se ofrece si no hay perfil accesible). El VS de «rival encontrado» no enlaza (sacaría de la partida).

## 17. Seguridad
En vivo: id malformado 400; inexistente 404; sin sesión 200 PUBLIC sin H2H; escribir sin sesión 401; cuerpo con `userId` ajeno 400 BAD_BODY;
vitrina con carta de otro 403 NOT_OWNED; duplicados 400; uid con HTML 400 BAD_UID; avatar con HTML 400 BAD_AVATAR. XSS: el nombre se pinta
como texto (React escapa; test S3). Enumeración: el perfil público es público por diseño (ids UUID, lectura limitada por usuario / hash de IP, F31).
No se encontraron vulnerabilidades nuevas.

## 18. Persistencia / migraciones
0 migraciones. Sin escrituras nuevas. La verificación real no modificó datos (solo lecturas y escrituras rechazadas).

## 19. QA visual
`docs/product/qa/fase56-profile/`: 23 capturas del arnés `/design-system/fase56` (01–15 pedidas + temporada, anónimo, 1920/1366), 0 desbordes
y 0 errores de consola (`shots.json`); `live/` con el perfil ajeno real (clic desde la clasificación), el propio real a 1440 y 390 (`live.json`).

## 20. Tests
Antes 4920/4920 → después **4938/4938** (nuevo `f56.profile.test.tsx`, 18). Contratos reescritos a su intención (no debilitados): F34 «el perfil
no recibe pase ni objetivos» (antes prohibía la palabra *season* en el servicio) y «108» (antes «la Fase 34 no tocó el perfil»); el pin 78 de F32
se respetó cambiando mi código.

## 21. Types / lint / build
tsc web PASS · tsc scripts PASS · eslint src 0 errores (10 advertencias preexistentes, ninguna de F56) · `npm run build` PASS (exit 0).
Incidencia: tras las capturas, el proceso `next start` terminó sin error en su log; se relanzó y la verificación real pasó. Causa no determinada.

## 22–24. Catálogo, economía, Marketplace/Payments
331 cartas sin cambios; economía sin cambios (ninguna escritura, ningún servicio económico tocado); `GLOBAL_MARKET_ENABLED=false`, `PAYMENTS_ENABLED=false`.

## 25. Archivos
Nuevos: `src/app/design-system/fase56/{page.tsx,fixtures.ts}`, `src/domain/profile/f56.profile.test.tsx`, `scripts/_fase56-{shots,live}.ts`, este informe, capturas.
Modificados: `domain/profile/identity.ts`, `server/services/playerIdentity.ts`, `server/services/competitive.ts` (`readLadderNeighbors`),
`components/player/{PlayerHero,ProfileSections,PlayerIdentityView,CardShowcase}.tsx`, `components/competitive/ranked/RecentMatchCards.tsx`,
`components/duel/pvp/PvpOutcome.tsx`, `app/duelos/pvp/page.tsx`, `app/design-system/fase31/fixtures.ts` (exporta `facts`), `domain/season/season.contract.test.ts`.

## 26. GO / NO-GO
**GO.** Perfil público real con datos reales, privacidad verificada (tests + en vivo), competitivo F55 integrado, enlaces desde clasificación,
historial y post-partida, estados vacíos honestos, responsive sin desbordes, gates completos.
