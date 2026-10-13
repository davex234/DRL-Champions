# QA · Fase 40 — Player Journey 3.0 (primera sesión)

**174 escenas**: 151 sintéticas + 23 reales.

## synthetic/ (151)

Arnés `/design-system/fase40?scene=<escena>`. Monta las pantallas REALES (vestíbulo `DailyLobby` + `buildDailyLoop`,
colección `CollectionRoomScreen`, constructor `DeckBuilder` / `TeamHub`, pre-partida `PreMatch`, resultado `ResultScreen`
con partidas del motor puro). Solo los **hechos de cuenta** son QA SYNTHETIC (marca en cada captura). Instrumento:
`npx tsx scripts/_fase40-visual-qa.ts` con `next start -p 3005` (sin túnel). Métricas en `synthetic/index.json`.

32 escenas: fresh, welcome, dismiss, open-pack, pack-unavailable, collection, collection-insufficient, home-collect,
home-collect-free, deck-ready, deck-incomplete, deck-builder-first, deck-autocomplete, deck-saved, active-deck,
first-match, match-active, match-complete-win/loss/draw, journey-complete, returning-step2, returning-step3,
legacy-complete, active-pvp-override, active-draft-override, offline, season-/social-/events-unavailable, long-text,
keyboard.

| Viewport | Capturas |
|---|---|
| 1440×900 | 49 |
| 1024×800 | 33 |
| 390×844 (página completa) | 48 |
| 768×1024 | 18 |
| 844×390 | 3 |
| de ellas con `prefers-reduced-motion: reduce` | 30 |
| interacción (explorar por libre, ver la guía, foco de teclado) | 4 |

Resultado: **desbordamiento 0 · elementos recortados de la guía 0 · errores de consola 0 · controles < 44 px en la guía
0**. Los 404 de fotos de jugador/escudo ausentes (fallback canónico, `public/players/README.md`) se cuentan aparte.

Bug visto aquí y corregido antes de la captura final: en 390 px las tres cartas de bienvenida (`PlayerCard`) no cabían y se
solapaban/recortaban → miniaturas estáticas en móvil, cartas grandes desde `sm`.

## real/ (23) — cuenta QA nueva real

Cuenta **`64ee0e54`** creada por el **formulario real de registro** (`/cuenta`, GoTrue con autoconfirmación; sin API
de administración), no admin. App local `next start` → túnel SSH → PostgreSQL del VPS. Credenciales aleatorias fuera del
repo. Instrumento `scripts/_fase40-real-e2e.ts` (evidencia en BD por SSH, solo lectura; reanuda por hechos).

La primera sesión se completó en **5 ejecuciones** sobre la MISMA cuenta. Las ejecuciones 1–4 destaparon dos bugs del
producto y tres del instrumento, que se arreglaron; cada ejecución siguiente retomó la cuenta donde la anterior la dejó
(eso también prueba «jugador que vuelve»). Logs: `e2e-run1..5.log`.

| Ejecución | Qué cubrió | Resultado |
|---|---|---|
| 1 | A registro real · B contrato de alta · C bienvenida (recarga ×2 sin escrituras) · D primer sobre real · E colección con coach · F logout/login | 22 ✓ / 1 ✗ en A–F (ver nota 1). G falló → **bug de producto 1** |
| 2 | vuelta → G | G falló otra vez (el arreglo aún no cubría la navegación completa) → **bug 1 afinado** |
| 3 | vuelta → G (3 Sobres Iniciales gratis) → H primer equipo (Autocompletar, guardar, activado) → I pre-partida | G ✓, H ✓ (6/6), I: 0 turnos jugados → **bug del instrumento** (selector) |
| 4 | vuelta con partida a medias → «Continuar partida» gana al recorrido | ✓; 0 turnos → **bug del instrumento** (selector de ejes, ver nota 2) |
| 5 | vuelta → I primer combate completo → J vestíbulo | **14 ✓ / 1 ✗** (nota 3) |

Capturas: `run1-*` (registro, bienvenida 1440/390/1024, resumen del primer sobre, vestíbulo COLECCIONA, coach de colección),
`run3-*` (Sobre Inicial gratis, vestíbulo CONSTRUYE, coach del constructor, autocompletar, guardado y activado, PLANTILLA
LISTA, pre-partida con coach), `run4-*` (jugador que vuelve, CONTINUAR PARTIDA por encima de la guía), `real-*`
(ejecución 5: vuelta, continuar, turno, resultado VICTORIA 7-3, vestíbulo después en 1440/390/1024).

### Evidencia en BD (final, `real/evidence.json`)

| Hecho | Valor | Mapea a |
|---|---|---|
| Alta | créditos 6.000, XP 0, 0 cartas, `estandar=1,inicial=3`, asiento `starter_grant:6000` único | trigger `handle_new_user` |
| Sobres | 7 abiertos (4 de bienvenida + 3 Sobres Iniciales gratis), 35 cartas, todas `origin=pack` | apertura real (`economy_ops open_pack` ×7, `buy_pack` ×3) |
| Coste de los Sobres Iniciales | `buy_pack:inicial:0` ×3 | precio 0 del catálogo |
| Equipo | 1 equipo de 10 cartas propias sin duplicadas, **activo** | constructor real + `set_active` |
| Partida | PVE · EASY · `duel-combat-2` · `duel-turns-2` · 10 turnos · COMPLETED · victoria 7-3, 10 turnos por la interfaz | motor canónico |
| Recompensa | `duel_win:120` (créditos 6.000 → 6.120), 8 puntos | recompensa PvE existente (Fácil) |
| XP de cuenta | 0 → 1.090 | apertura de sobres (RPC existente) + partida PvE |
| XP del pase / logros / campaña / draft | 0 / 0 / 0:0 / 0 | sin cambios |
| **Capa de primera sesión** | **0 créditos · 0 sobres · 0 cartas · 0 XP** | — |

### Notas

1. La huella de alta encontró una ficha ranked **1000/0** y una fila de pase vacía creadas 1 s después del registro: las
   crea `/cuenta` (pantalla del registro) al montar `CompetitiveSummary` → `GET /api/game/competitive`
   (`ensureRating` + `getProgression` al leer). Deuda previa; no la usa el recorrido. El check de la ejecución 1 (que exigía
   0 filas) falló; el hecho se verificó después por SQL: rating 1000 con 0 partidas y pase con XP 0, sin reclamos, creados
   a las 10:12:21Z (alta 10:12:20Z). El instrumento se reformuló para exigir 0 partidas ranked y XP de pase 0.
2. Los ejes SH/GS/EF se buscaban por texto `^(SH|GS|EF)`: la carta del jugador **Shr1mp** también empieza por «SH».
3. En la ejecución 5 el combate se retomó con «Continuar partida» (sin `?primera=1`) y el resultado no enseñó «Primera
   sesión completada». Corregido después (la arena relee el vestíbulo también si retomó una partida); **no reverificado en
   real** porque la cuenta ya no está en su primera partida. El vestíbulo SÍ enseñó los destinos (captura `real-05`).
4. `real-05-home-after` muestra entre los destinos el evento de **demostración** DRL Masters Madrid como «en directo»:
   bug encontrado aquí y corregido (los eventos demo ya no se anuncian); la captura es anterior al arreglo.
5. `run1-real-07-collection-coach` es anterior a mover el coach arriba de la colección; la posición nueva está en las
   sintéticas 016–024.
