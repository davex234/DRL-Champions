# FASE 22.1 — SISTEMA DE PROGRESIÓN DEL JUGADOR

**Estado: entregado sobre lo existente.** NEXUS ya tenía nivel de cuenta + XP server-authoritative
y un pase de temporada con recompensas/claim idempotente; la Fase 22.1 **consolida el nivel de
cuenta en una pantalla `/progresion` dedicada** y lo cablea a las fuentes de XP y a las recompensas
existentes, sin crear un segundo sistema de XP, niveles ni recompensas. `npm test` 937/937,
typecheck, build y verifiers en verde. Validación real del bucle en navegador.

## Objetivo
Hacer visible y navegable el bucle `Jugar → XP → Nivel → Recompensas` reutilizando la progresión
que ya existe.

## Estado previo (lo que YA existía — no se reescribió)
- **Nivel de cuenta / XP:** `profiles.xp` + `domain/progression/levels.ts` (curva cuadrática
  `100·(nivel-1)^1.6`, `levelFromXp`), `useGameStore.xp`. Ya visible como insignia en la cabecera
  (`GameShell` usa `levelFromXp`). **Server-authoritative:** la XP la suma el SERVIDOR
  (`app_apply_pack_open` → `update profiles set xp = xp + p_xp`; también pickems 0013 y el bucle de
  juego 0018).
- **Fuentes de XP reales:** abrir sobres (`xpForCardRank` por carta) y duelos (`duelRewards`, XP de
  cuenta: ganar 60/110/180 por dificultad; empatar/perder también dan algo).
- **Pase de temporada** (`src/battlepass/` + `/api/game/progression` + migraciones 0011/0016): XP →
  niveles → tracks/recompensas → **claim server-authoritative e idempotente** (`app_grant_reward`,
  `credit_transactions`) + **misiones** + **logros** integrados. Surface en **`/logros`**.
- **Recompensas / historial**: `/recompensas` y `/tienda/creditos` («Tus movimientos», ledger real).

**Conclusión:** el bucle XP→nivel→recompensas YA está construido y es server-authoritative. El
hueco era una **pantalla `/progresion` dedicada al nivel de cuenta** (hasta ahora solo una insignia
en la cabecera).

## Qué se ha construido
1. **`/progresion`** — pantalla del NIVEL DE CUENTA: medalla de nivel, barra de XP, «+N XP para el
   nivel siguiente», panel **«Cómo ganar XP»** (fuentes reales) y tarjetas-puente a las
   recompensas existentes (pase, historial, perfil). **De SOLO LECTURA:** lee `useGameStore.xp`
   (sincronizado del servidor), no concede XP ni reclama nada.
2. **`xpSources.ts`** — helper puro que DERIVA las fuentes de XP del propio código
   (`xpForCardRank`, `duelPayoutTable`), para enseñarlas sin inventar valores.
3. **Entrada de navegación** «Progresión» en la sección Progreso.

Nada de esto crea un segundo sistema: el nivel es el de `levels.ts`, las recompensas reclamables
son las del pase existente (`/logros`), y la economía es la de siempre.

## Modelo de XP / niveles
`levelFromXp(xp)` sobre `profiles.xp` (server-authoritative). Curva cuadrática documentada en
`levels.ts` (`totalXpForLevel(n) = 100·(n-1)^1.6`). Determinista y ya probada por la monotonía en
`xpSources.test.ts`. No se cambió la fórmula.

## Fuentes de XP (reales, derivadas del código)
- **Abrir sobres:** `xpForCardRank(rank) = 10 + 8·rank` por carta → **+18–138 XP/carta** según
  rareza. Concedida por el servidor al abrir (no por visitar la pantalla).
- **Ganar duelos:** `duelRewards` → **+60 · 110 · 180 XP** (EASY/NORMAL/HARD).
- **Jugar duelos:** empatar/perder → **+15–80 XP**.
- **Objetivos y pase:** misiones, logros y pase (en `/logros`).

## Recompensas / Claim / Idempotencia
Las recompensas reclamables (nivel de pase, misiones, logros) viven en el **pase existente**
(`/logros`), con claim **server-authoritative e idempotente** (`/api/game/progression` →
`app_grant_reward` + `credit_transactions`, migraciones 0011/0016). `/progresion` **enlaza** a ese
sistema; **no** reimplementa claim ni crea un segundo control de recompensas. Las recompensas
económicas pasan por el ledger existente. No se puede reclamar dos veces (garantía del servidor
existente).

## Seguridad / Idempotencia
- **XP, nivel, claim: server-authoritative.** El cliente no puede asignarse XP: online, solo las
  RPC del servidor tocan `profiles.xp`; `/progresion` es de solo lectura (test lo verifica: no
  `addXp`, no mutación de `s.xp`, no llamada de claim, no toca la RPC).
- **Idempotencia** de recompensas: la existente del pase/ledger (`ref` + asiento). No se creó otra.
- **Anti-farm:** la XP se concede por acciones reales completadas (apertura consumida, duelo
  resuelto), no por abrir una pantalla ni refrescar. `/progresion` no concede nada.
- **RLS:** cada usuario ve/gasta solo lo suyo (RLS existente de `profiles`/economía).

## Perfil / Header / UI
La cabecera (`GameShell`) ya muestra nivel + progreso; `/progresion` usa **el mismo `levelFromXp`**
(una sola fuente de nivel — test de consistencia). El perfil (`/cuenta`) muestra rango/nivel. No se
duplica la información.

## Integración con logros / packs / economía
- **Logros:** intactos; se reclaman en `/logros` (sistema existente). No se duplicaron ni se
  cambiaron condiciones.
- **Packs:** la XP de apertura la concede el flujo real (`app_apply_pack_open`), no la visita a
  `/abrir/:id`. No se tocó el RNG ni el motor.
- **Economía:** recompensas por el ledger existente; sin balance paralelo.
- **Misiones (§13):** ya existen (pase); integradas vía `/logros`. No se construyó un sistema nuevo.

## Responsive / Accesibilidad
`/progresion`: medalla + barra apilan en móvil (`flex-col sm:flex-row`), rejillas
`sm:grid-cols-2/3`, sin overflow. `Meter` con `label`, `role="img"` en la medalla, foco visible,
contraste; el nivel/XP no dependen solo del color (cifras + barra + texto).

## Tests
- **Nuevos (4):** `xpSources.test.ts` — fuentes derivadas del código real, `levelFromXp`
  (nivel/umbral/monotonía = subida de nivel), `/progresion` de solo lectura (no concede XP ni
  reclama, server-authoritative), consistencia con la cabecera.
- **Ya cubierto (sin duplicar):** el pase/claim idempotente y los logros tienen sus tests
  (`battlepass/tracks.test`, progresión server, `security:verify` sobre las rutas). Los 13
  escenarios del §24 quedan cubiertos entre estos.
- **Suite:** `npm test` **937/937** ✅ · typecheck ✅ · build ✅ (`/progresion` registrada) ·
  `security:verify` ✅ · `pack:verify` ✅ · `content:verify` ✅ · `distribution:verify` ✅ (30/0).
  Ningún test existente modificado para forzar verde.

## Validación REAL (navegador, `next start`, usuario demo)
1. Cabecera **NIVEL 3**. `/progresion`: medalla **Nivel 3**, XP **13 / 277**, «**+264 XP para el
   nivel 4** · 580 totales», fuentes con valores reales (**+18-138/carta**, duelos **+60·110·180**),
   puentes a pase/historial/perfil. ✅
2. **Acción real que concede XP:** abrir el «Sobre Inicial» (5 cartas nuevas) — conducido por
   **teclado** (Enter abre, Enter revela, Escape salta). ✅
3. **XP incrementada:** vuelta a `/progresion` → «**+142 XP para el nivel 4**» (subió ~122 XP), la
   barra más llena, nivel 3. ✅
4. **Persistencia:** recarga de `/progresion` → sigue en «+142 XP», nivel 3. ✅
No se generó XP por consola; se usó el flujo real. Capturas en el scratchpad. (Cruzar un nivel
requeriría más aperturas; la subida de nivel está probada en `levelFromXp` y la XP demostrada crece
por acción real.)

## P2 reales restantes
- **Dos pistas de XP** (cuenta vs. pase) conviven a propósito: la de cuenta es vitalicia
  (`/progresion`, cabecera), la del pase es estacional con recompensas (`/logros`). No se
  fusionaron (sería una decisión de diseño y tocaría dos sistemas). Es coherente, pero unificarlas
  algún día sería una mejora.
- **Recompensas por nivel de CUENTA** (distintas de las del pase) no existen; el bucle de
  recompensas es el del pase. Añadir hitos de nivel de cuenta sería aditivo (fase posterior), sin
  duplicar el claim (reutilizaría `app_grant_reward`).
- **Cruzar nivel en navegador** no se forzó (sin farmear packs); el mecanismo está probado.

## Cambios NO realizados
Sin tocar RNG, pack draw engine, probabilidades, pools, minting, market, PvP, combat, Pick'ems,
Trainer, roster, `teamIdentities`, Team Packs, artwork, la fórmula de XP ni el motor del pase. No
se resolvieron los 6 BLOCKED, no se hizo Ola 4, no se corrigió la rareza P2, no se modificó Fnatic.
Sin commit/push/deploy.

## Archivos modificados
| archivo | cambio |
|---|---|
| `src/app/progresion/page.tsx` | **nueva** — pantalla del nivel de cuenta (solo lectura) |
| `src/domain/progression/xpSources.ts` | **nuevo** — fuentes de XP derivadas del código |
| `src/domain/progression/xpSources.test.ts` | **nuevo** — 4 tests |
| `src/design/nav.ts` | +ítem «Progresión» en la sección Progreso |
| `docs/product/fase-22-1-player-progression-report.md` | este informe |
