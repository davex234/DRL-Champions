# Auditoría de la capa analítica

> FASE 14, bloque 5, paso 1. Qué había antes de escribir una sola consulta.

---

## Qué existe

| pieza | qué es | ¿sirve para analítica? |
|---|---|---|
| **Vistas SQL** — `ranking_level`, `ranking_collection`, `ranking_market`, `ranking_rarities` (0001), `v_upcoming_matches`, `v_recent_results` (0003) | Agregados de lectura | **Sí, como precedente**: leer agregados con SQL ya es el patrón de la casa |
| **Funciones `recompute_*`** — `recompute_standings`, `recompute_team_stats`, `recompute_player_event_stats` (0003) | Recomponen estadísticas deportivas | **Sí, como precedente** de función SQL para agregar |
| **RPC `app_*`** (15 funciones) | Mutaciones económicas idempotentes | No: son escrituras |
| **`src/server/services/*.ts`** (17 servicios) | Lecturas con el query builder + `ServiceResult<T>` | **Sí, como patrón de envoltorio** |
| `src/platform/cloud/analytics.ts` | Analítica de partidas **simuladas**, en memoria, sin usuario | **No.** Es otra cosa (ya avisado en `AUDIT.md` §4) |
| `/admin/live` | Panel del pipeline de contenido | **No.** No es analítica de jugador |

**No existe ninguna capa de reporting de producto.** Ni repositorios, ni helpers SQL, ni
constructor de consultas propio. No hay nada que duplicar.

---

## La decisión: SQL, no TypeScript

Un embudo es una **intersección entre seis tablas**: «de los usuarios creados en esta
ventana, cuántos tienen además una fila en `duel_matches` con estado COMPLETED».

**PostgREST no puede expresar eso.** Es el query builder que el proyecto usa para todas
sus lecturas, y sabe incrustar recursos relacionados, no cruzar y agregar.

La alternativa era traerse las filas a Node y cruzarlas allí. Para calcular usuarios
activos diarios eso significa **descargar todos los eventos del día**. No escala, y no
hace falta: PostgreSQL está para esto, y el proyecto ya lo usa así para los rankings.

**Arquitectura elegida:** 11 funciones SQL (migración 0030) + envoltorio tipado
(`src/server/services/analytics.ts`), siguiendo el patrón `ServiceResult` de los otros 17
servicios.

**Lo que NO se creó**, porque el encargo lo prohíbe y porque no hace falta: ninguna tabla
de agregados, ninguna vista materializada, ningún caché, ningún cron, ninguna dependencia.
Cada llamada recalcula desde las tablas autoritativas, así que **es imposible que se quede
desfasada o discrepe del dato real**.

---

## Dos correcciones que la auditoría obligó a hacer

### 1 · «Sobre abierto» no está en el libro mayor

La taxonomía del bloque 2 decía que `welcome_pack_opened` se derivaba de
`credit_transactions.ref like 'pack:open:%'`. **Es incorrecto.**

Abrir un sobre **no cuesta créditos**, así que `app_apply_pack_open` no escribe en el libro
mayor: escribe `user_cards`, `card_mints` y `user_game.packs_opened`. La operación sí queda
en **`economy_ops` con `kind='open_pack'`**, que es la fuente correcta.

Comprobado contra los datos reales: 11 filas de `open_pack` en `economy_ops`; **cero**
refs `pack:open:` en el libro mayor (solo hay `pack:buy:`, de las compras, que sí cuestan).

### 2 · `first_card` filtra por origen

`user_cards.origin` tiene tres valores reales: `pack` (58), `market` (50), `admin` (36).
Una carta concedida por un administrador o comprada en el mercado **no es** el momento de
«mi primera carta» de la primera experiencia. El embudo filtra `origin='pack'`.

---

## Verificado, no supuesto

| afirmación | comprobación |
|---|---|
| `profiles.created_at` es un espejo fiel de `auth.users.created_at` | Las dos fechas coinciden (±5 s) en las **58** cuentas existentes. Se usa `profiles` porque vive en `public` y se puede cruzar |
| Los embudos funcionan retroactivamente | El embudo FTUE sobre 60 días devuelve **58 usuarios** y sus pasos autoritativos, con la telemetría a cero |
| Las funciones no las puede llamar un jugador | `permission denied for function analytics_ftue_funnel` con la clave anónima |

**Trampa encontrada al verificar:** PostgreSQL concede `EXECUTE` a **PUBLIC** por defecto
en toda función nueva. Revocárselo a `anon` y `authenticated` no quita nada, porque no
tenían concesión propia: la heredaban de PUBLIC. La primera versión de la migración hacía
justo eso y las funciones seguían siendo invocables; lo que las bloqueaba era el permiso de
**tabla** de 0029, que es una buena segunda barrera pero no la que se pretendía. Corregido
con `revoke ... from public` y verificado en el ACL.

---

*Detalle de cada métrica en [`METRICS.md`](METRICS.md) · de cada embudo en
[`FUNNELS.md`](FUNNELS.md).*
