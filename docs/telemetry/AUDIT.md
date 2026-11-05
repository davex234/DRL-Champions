# OBSERVABILITY AUDIT — NEXUS

> FASE 14, bloque 1. Inspección del proyecto **antes de modificar nada**.
> 2026-09-06 · rama `arch/stabilization`

---

## Resumen en una frase

**NEXUS ya tiene tres registros de eventos duraderos, indexados y autoritativos, y
marcas de tiempo en prácticamente todas las tablas de dominio.** Lo que no tiene es la
otra mitad: **sesiones, vistas, abandono y errores**. Construir «telemetría» aquí no es
empezar de cero — es rellenar un hueco concreto y no duplicar lo que ya existe.

---

## 1. Qué existe

### 1.1 · Tres registros de eventos que ya son autoritativos

| tabla | qué registra | campos | índices |
|---|---|---|---|
| **`credit_transactions`** | **cada movimiento económico**, sin excepción | `user_id`, `delta`, `reason`, `ref`, `balance_after`, `created_at` | `(user_id, created_at desc)` · único `(user_id, ref)` |
| **`economy_ops`** | **cada operación económica**, con su resultado | `ref` (PK), `user_id`, `kind`, `result` jsonb, `created_at` | `(user_id, created_at desc)` |
| **`market_audit`** | **cada acción de mercado** | `user_id`, `action`, `card_id`, `listing_id`, `offer_id`, `price`, `created_at` | `(user_id, action, created_at desc)` |

`economy_ops.kind` ya distingue `buy_pack | open_pack | salvage | market_buy | …`.
`market_audit.action` ya está restringido por CHECK a
`list | buy | cancel | offer | accept_offer | cancel_offer`.

**Y el campo `ref` del libro mayor ya clasifica el tipo de evento por espacio de nombres:**

```
starter:<uuid>            alta de usuario (6.000 créditos)
pack:buy:<uid>:<gesto>    compra de sobre
pack:open:<uid>:<gesto>   apertura de sobre
duel:<…>                  recompensa de duelo
pickem:<uuid>:<escalón>   recompensa de Pick'em
pass:<…>                  nivel del pase reclamado
mission:<…>               misión reclamada
achievement:<…>           logro reclamado
mastery:<…>  drlc:<…>  refund:<…>
```

Es decir: **el 100 % de la economía y de las recompensas ya es consultable por usuario,
tipo y fecha, y es idempotente por `ref`.** La FASE 6 del encargo —«no dupliques
información que ya exista en el ledger»— no es una advertencia teórica aquí: es
literalmente lo que hay.

### 1.2 · Marcas de tiempo en el dominio

Casi todos los pasos del embudo ya tienen una fecha duradera:

| paso del embudo | de dónde sale hoy |
|---|---|
| `user_created` | `profiles.created_at` |
| `first_card_obtained` | `min(user_cards.obtained_at)` por usuario |
| `deck_created` | `duel_decks.created_at` |
| `duel_started` | `duel_matches.created_at` |
| `duel_completed` / abandonado | `duel_matches.status` + `updated_at` |
| `duel_won` / `duel_lost` | `duel_matches.winner` + `difficulty` |
| `prediction_created` | `pickem_answers.created_at` |
| `prediction_correct/incorrect` | `pickem_answers.scored_at` + puntuación |
| `listing_created` / `listing_purchased` | `market_listings.created_at` / `sold_at` |
| `strategy_created` | `user_strats.created_at` |
| `achievement_completed` | `user_achievements.claimed_at` |
| cualquier recompensa | `credit_transactions.ref` + `created_at` |
| sobres abiertos (acumulado) | `profiles.packs_opened` |

### 1.3 · Autorización, ya resuelta

| pieza | qué hace |
|---|---|
| `src/server/services/session.ts` → `getSession(req)` | Bearer de Supabase Auth → GoTrue → `userId`. **El cliente nunca envía su `userId`**; se deriva del token |
| `src/lib/supabase/adminAuth.ts` → `verifyAdmin(req)` | Bearer + `profiles.is_admin` comprobado con `service_role` |
| `profiles.is_admin` | columna real (migración 0006), protegida por trigger `SEC-02` (0009): solo la mueve el servidor |
| RLS | activo en `user_cards`, `credit_transactions`, `economy_ops`, `user_packs`, `user_game`, `card_mints`… con escritura revocada a `anon`/`authenticated` |

**No hay `middleware.ts`.** La autorización vive en cada ruta, con estos dos ayudantes.

`src/config/admin.ts` → `ADMIN_ENABLED` es **solo una compuerta de interfaz**
(`NEXT_PUBLIC_ADMIN`), no autorización. Cualquier endpoint nuevo de operaciones debe usar
`verifyAdmin`, no esta constante.

### 1.4 · Un reportador de fallos ya escrito… y nunca instalado en la app

`src/platform/crash.ts` (42 líneas) ya:

- instala `window.addEventListener("error")` y `("unhandledrejection")`, **idempotente**;
- compone un `CrashReport` con `{at, version, platform, os, message, stack, recentLogs}`;
- lo persiste en el adaptador KV local;
- y lleva escrito: `// TODO(server): POST report al endpoint de crashes cuando exista.`

Se instala desde `initPlatform()`, y **`initPlatform()` solo lo llama
`src/components/launcher/BootGate.tsx`** — es decir, únicamente en el shell del launcher.
**En las rutas normales de jugador no hay ningún manejador global de errores.**

`src/platform/log.ts` es un búfer de logs en memoria (500 entradas, niveles
info/warn/error/debug, persistencia best-effort). Local, nunca sale del dispositivo.

### 1.5 · Versión de la aplicación

`src/platform/version.ts` expone `APP_VERSION` (`0.1.1`), `BUILD_NUMBER`, `FULL_VERSION`
y `buildInfo()`. Lo sincroniza el pipeline de release desde `version.json`. **Fuente única
ya existente** para el campo `app_version` de cualquier evento.

### 1.6 · Punto de montaje del cliente

```tsx
// src/app/layout.tsx
<body>
  <AuthProvider>          {/* única frontera de cliente con contexto, ya conoce al usuario */}
    <GameShell>{children}</GameShell>
  </AuthProvider>
</body>
```

`GameShell` está en las 18 pantallas de jugador (verificado en la Fase 13).

---

## 2. Qué funciona

- **El libro mayor.** Idempotente por `ref`, con `balance_after` en cada asiento. Es una
  auditoría económica completa y fiable.
- **La autorización.** `getSession` deriva el usuario del token; `verifyAdmin` comprueba
  un flag protegido por trigger. Las dos primitivas son correctas y reutilizables.
- **`economy_ops`.** Es, de hecho, ya una tabla de eventos con `kind` y `result` jsonb.
- **`market_audit`.** Cubre 5 de las 6 acciones de mercado que pedía la FASE 7.
- **`/api/game/loop`.** Lee el estado real del jugador; sirve como definición canónica de
  «qué debería estar haciendo», útil para contrastar con lo que hace de verdad.

---

## 3. Qué está incompleto

| # | qué | detalle |
|---|---|---|
| I1 | **`crash.ts` no se instala en la app de jugador** | Existe, funciona, y solo se activa en `/launcher` vía `BootGate` |
| I2 | **`crash.ts` no envía nada** | El `TODO(server)` sigue abierto: los informes mueren en el KV local del dispositivo |
| I3 | **`log.ts` nunca sale del cliente** | 500 entradas en memoria, persistencia local. Invisible para operaciones |
| I4 | **No hay `error.tsx` ni `global-error.tsx`** en `src/app` | Un fallo de renderizado no se captura ni se reporta en ninguna ruta |
| I5 | **`market_audit` cubre acciones, no vistas** | Falta el primer escalón del embudo de mercado |
| I6 | **`profiles.packs_opened` es un acumulado** | Sirve para «cuántos», no para «cuándo» ni «en qué sesión» |

---

## 4. Qué está duplicado

**Nada que deba unificarse, pero sí una colisión de nombres que hay que evitar.**

`src/platform/cloud/analytics.ts` exporta `TelemetrySink`, `TelemetryEvent` y `Metrics`.
**No es telemetría de producto:** es analítica *derivada* de partidas simuladas
(`match.ticks`, `match.rounds`), en memoria, pura y determinista, sin usuario, sin sesión
y sin persistencia. Pertenece a la capa `platform/cloud` (motor de simulación).

**Decisión: no se toca y no se reutiliza.** Y lo que se construya en esta fase **no debe
llamarse `TelemetryEvent`** a secas, o dentro de seis meses alguien importará el
equivocado.

`src/app/admin/live/page.tsx` se llama «Live» pero es el **Live Ecosystem** —el
orquestador de contenido (torneos → cartas → noticias → mercado) con proveedores mock—.
**No es operaciones de jugador. No se toca.** La consola de esta fase necesita su propia
ruta.

---

## 5. Qué falta de verdad

Esto es lo único que no se puede derivar de nada existente:

| # | hueco | por qué importa |
|---|---|---|
| **F1** | **No existe el concepto de sesión.** Cero coincidencias de `session_id`, `last_seen`, `activity` | Sin sesión no hay DAU/WAU, ni acciones por sesión, ni duración, ni retorno |
| **F2** | **No se registra ninguna vista.** Ni rutas, ni pantallas, ni modos | Sin vistas no hay denominador: se puede contar quién abrió un sobre, pero no quién *llegó a la pantalla* y no lo abrió |
| **F3** | **No se registra el abandono.** Solo hay huellas de lo que se completó | Es literalmente la pregunta del encargo: *¿dónde abandona la gente?* Un usuario que entra al constructor y se va no deja rastro |
| **F4** | **No hay telemetría de errores en servidor ni en cliente** | Un flujo crítico roto solo se descubre mirando la consola a mano |
| **F5** | **No hay ninguna vista de operaciones de producto** | `/admin/live` es del pipeline de contenido, no de jugadores |

**Reformulado: falta exactamente la mitad conductual.** La mitad transaccional —qué
ocurrió, a quién, cuándo y por cuánto— ya está resuelta y es de mejor calidad que lo que
daría una herramienta de terceros.

---

## 6. Qué NO debemos tocar

| qué | por qué |
|---|---|
| `src/domain/**`, `src/engine/**`, `combat2/**` | Reglas del juego (reglas absolutas 1–4, 9) |
| `credit_transactions`, `economy_ops`, `app_grant_reward`, `app_adjust_credits`, `app_buy_pack` | Libro mayor y economía (reglas 4–7, 15). Se **leen**, nunca se escriben desde telemetría |
| `market_audit`, fórmulas de mercado | Regla 5. Se lee |
| `src/platform/cloud/analytics.ts` | Es otra cosa (§4). Colisión de nombres |
| `src/app/admin/live/**` | Es el Live Ecosystem, no operaciones de jugador |
| Datos VCT, `duel_decks` rules, geometría del Entrenador | Reglas 8, 9, 10 |
| `ADMIN_ENABLED` como mecanismo de autorización | No lo es; usar `verifyAdmin` |

---

## 7. Conclusión de la auditoría → arquitectura mínima propuesta

Tres decisiones, todas derivadas de lo anterior:

**D1 · Una sola tabla nueva, y solo para lo conductual.**
`telemetry_events` con `event_name`, `user_id` nullable, `session_id`, `occurred_at`,
`metadata` jsonb, `environment`, `app_version`, `route`, `severity`. Nada de economía
entra ahí: la economía se **consulta** en el libro mayor. Una sola fuente de verdad para
el dinero (regla 15).

**D2 · Los embudos se calculan con `UNION` de dos orígenes.**
Los pasos transaccionales salen de las tablas autoritativas (`profiles.created_at`,
`user_cards.obtained_at`, `duel_decks.created_at`, `duel_matches`, `credit_transactions`)
y los conductuales de `telemetry_events`. Así no se duplica un solo dato y el embudo
funciona **retroactivamente** para los usuarios que ya existen — algo que una solución de
solo-eventos no podría hacer.

**D3 · Los errores adaptan `crash.ts`, no lo sustituyen.**
Ya captura, ya sanea, ya tiene el `TODO(server)` escrito. Se le da el endpoint que
esperaba y se instala también en la app de jugador (hoy solo vive en el launcher).

**Ninguna dependencia externa.** La auditoría no encuentra ninguna razón que supere a la
solución propia (regla 13): el 60 % del trabajo ya está hecho en tablas que PostHog o
Mixpanel no podrían leer, y meter una herramienta de terceros crearía la segunda fuente de
verdad que la regla 15 prohíbe.

---

*Continúa en `EVENT-TAXONOMY.md` (qué eventos y por qué), `FUNNELS.md`,
`SECURITY.md`, `LIVE-OPERATIONS.md` y `README.md`.
La sección «ANTES vs DESPUÉS» de este documento se completa al cierre de la fase.*
