# FASE 23.3 — MARKETPLACE GO-LIVE · Activación controlada

**Estado:** completada como **NO-GO controlado** · **Fecha:** 2026-09-13
**Rama:** `arch/stabilization` · **Sin commit/push/deploy** · **Sin cambios de código** (solo este informe)

> Veredicto: **el mercado NO se activa.** El gate de readiness existente está en rojo por
> **un** criterio, y es exactamente el caso que la propia fase previó: «Si el gate no está
> verde → NO activar» (§1). `GLOBAL_MARKET_ENABLED` permanece en `false`, sin tocar el test,
> sin bypass, sin mock. Abajo, qué falta, por qué, y cómo se activaría el día que se cumpla.

---

## 1. Estado de readiness

Se revisó **únicamente** el gate existente (`src/domain/economy/marketReadiness.ts` +
`marketReadiness.test.ts`), sin crear ninguna auditoría nueva. Evaluación
(`evaluateReadiness`, con los criterios `verify` asumidos OK y sin telemetría):

| # | Criterio | Decide | Estado |
|---|---|---|---|
| 1 | Propiedad en una sola tabla | verify | ✅ met |
| 2 | Transacciones atómicas | verify | ✅ met |
| 3 | Idempotencia en publicar y comprar | verify | ✅ met |
| 4 | El saldo no puede quedar negativo | verify | ✅ met |
| 5 | El precio lo valida el servidor | verify | ✅ met |
| 6 | La comisión se cobra y se quema | verify | ✅ met |
| 7 | Dos compradores simultáneos no rompen nada | verify | ✅ met |
| 8 | Ancla de precio calibrada | measure | ✅ met — banda 0.2–2.5× del coste de tirada: `common 0.58× · uncommon 1.08× · rare 0.90× · epic 0.60× · legendary 0.28×` |
| 9 | El desguace no explota con el mercado abierto | measure | ✅ met — peor caso `common`: el desguace es el **60 %** de la carta más barata de su rareza (< 100 %) |
| 10 | **Hay jugadores suficientes para descubrir precios** | operations | ❌ **UNKNOWN** |

**`marketReady = false`.** Bloqueante exacto (uno):

> **`player-mass`** — *«No se puede saber desde el repositorio: hace falta la telemetría de
> producción.»* Umbral: `MIN_PLAYERS_FOR_DISCOVERY = 200` jugadores activos.

Es un criterio `decidedBy: "operations"`: **no es técnico** y no se puede resolver escribiendo
código ni desde el entorno de prueba. Un criterio `unknown` **no cuenta como cumplido** —esa
es justamente la invariante del gate—. Los nueve criterios técnicos/medibles están en verde;
el décimo, la masa de jugadores, es el único que falta, y es una decisión de Operaciones con
un dato (telemetría de producción) que aquí no existe.

**Importante — los criterios `verify` (1–7):** en la tabla figuran «met» porque el evaluador
los recibe como verificados; su comprobación REAL la hace `npm run economy:verify` contra la
base de datos. En este entorno `economy:verify` no se pudo ejecutar (backend no accesible, §5),
así que 1–7 no están confirmados *aquí* de forma independiente. No cambia el veredicto: aunque
1–9 estuvieran confirmados, **`player-mass` mantiene el gate en rojo por sí solo**.

## 2. Estado de GLOBAL_MARKET_ENABLED

**`false`, sin cambios.** Ubicación canónica: `src/config/features.ts`
(`export const GLOBAL_MARKET_ENABLED = false;`). No se activó, no se mockeó, no se duplicó, no
se hizo bypass. Modificar el flag habría roto el cerrojo:

- `marketReadiness.test.ts › «hoy el mercado sigue cerrado, y el motivo esta escrito»` **afirma
  directamente** `GLOBAL_MARKET_ENABLED === false` y que el único bloqueante es `player-mass`.
  Ponerlo en `true` haría caer `npm test`, y hacerlo verde exigiría **editar ese test** —
  prohibido por §1, §20 y §23.

Se cumplió al pie la instrucción §1: gate no verde → no activar → identificar el criterio que
falta → no tocar el test.

## 3. Estado de /mercado

Sin cambios respecto a 23.2: con el flag en `false`, `/mercado` responde **200** y muestra el
mercado local y —para usuarios autenticados— el escaparate P2P con el aviso de que **abrirá
próximamente** y comprar/vender desactivados. No aparece el mercado abierto porque **no se
abrió**. La UX de apertura (ficha, compra, filtros, mis ventas/compras) quedó lista en 23.2 y
se activará sola cuando el flag pase a `true`.

## 4. Listing creado

**No se creó ningún listing real.** Publicar es una operación de escritura de valor que el
servidor bloquea con `503` mientras `GLOBAL_MARKET_ENABLED = false` (y la RPC solo la ejecuta
`service_role`). Como el mercado no se abrió, no había forma legítima de crear un listing sin
hacer bypass del cierre —prohibido—. No se fabricaron datos de prueba (§18).

## 5. Compra realizada

**No.** Por lo mismo que §4: la compra está cerrada por el flag y por la revocación de RPC. No
se ejecutó ninguna compra; **no se finge** que se hiciera (§21).

## 6–9. Transferencia / balances / ledger / serial-version-instance

**No aplican en vivo** en esta fase, porque no hubo operación P2P (mercado cerrado). Lo que sí
está garantizado por el sistema ya construido y probado (migración 0020 + `economy:verify`):
transferencia atómica (`select … for update`, cambio de dueño en la misma sentencia), ledger de
tres asientos (`_ledger_apply`: pago comprador, ingreso vendedor, comisión quemada), y la
conservación de `uid`/`serial`/`minted_version`/`instanceValue` (la carta cambia de dueño sin
remint: es la MISMA fila de `user_cards`). Estas propiedades están cubiertas por
`marketReadiness` (criterios 1–7) y el backend, no por una compra ejecutada hoy.

## 10. Concurrencia / idempotencia

**Validadas por los tests existentes, no por una prueba viva** (§11/§12 lo permiten
explícitamente). Concurrencia: criterio `no-double-spend` (candado `for update` sobre el
listado; el segundo comprador recibe «ya no está disponible» y no pierde créditos).
Idempotencia: criterio `idempotent` (clave `p_ref` → `economy_ops`; un reintento devuelve el
mismo resultado con `repeated: true`, sin segunda transferencia/pago/comisión). No se tocó el
locking para fabricar una prueba (§11).

## 11. Resultado de la validación REAL

**No se pudo ejecutar la operación P2P real, y no se finge lo contrario** (§21). Motivos, por
orden:

1. **El gate está en rojo** (`player-mass` UNKNOWN) → la fase, por su propia regla §1, es un
   NO-GO: no se activa.
2. Aunque se ignorase (que no se hace), **abrir exigiría poner el flag en `true`**, lo que
   rompe `marketReadiness.test.ts`; hacerlo verde exigiría editar el test → prohibido.
3. **Entorno**: la fuente de verdad es la VPS (§19), pero el proyecto apunta a Supabase local
   (`127.0.0.1:54521`), que está **caído** (Docker desinstalado; §19 prohíbe reinstalarlo o
   levantar Supabase local). No hay, en esta sesión, un mecanismo autorizado para operar el
   backend remoto con dos cuentas de prueba. Por tanto no hay dónde ejecutar la compra real.

**Lo que sí se validó de verdad** (dentro de las limitaciones): el **gate de readiness** (55
pruebas de market/economy/readiness en verde), la **suite completa** (968/968), typecheck,
build, los verificadores, y que `/mercado` y el resto de secciones responden con el flag en
`false`. La integridad económica y de propiedad está respaldada por el sistema construido y sus
tests, no por una transacción ejecutada hoy.

## 12. Tests (§20)

- `npm test` → **968/968** ✓ (incluye `marketReadiness.test.ts`, market, economy, RLS,
  idempotencia y concurrencia en su forma comprobable sin BD).
- `marketReadiness.test.ts` + market + UX + sell → **55/55** ✓.
- `typecheck` ✓ (0 errores) · `build` ✓ · `security:verify` ✓ · `pack:verify` ✓ ·
  `content:verify` ✓ · `distribution:verify` ✓ (30/0).
- `economy:verify` → **no ejecutable** (necesita Supabase vivo; `fetch failed`). Es el que
  confirmaría en vivo los criterios `verify` 1–7 y las pruebas de RLS/idempotencia/concurrencia
  contra la BD. Limitación de entorno, documentada.

**No se modificó ningún test para conseguir verde.** No se tocó `marketReadiness.test.ts`.

## 13. Regresión (§22)

Con el flag en `false` (estado sin cambios), responden **200**: `/mercado`, `/tienda`,
`/coleccion`, `/inventario`, `/packs`, `/duelos`, `/progresion`. Como no se activó nada, no hay
riesgo de que «el mercado abierto» rompa otras secciones: sigue cerrado.

## 14. Rollback (§23)

El estado seguro **ya es el actual**: `GLOBAL_MARKET_ENABLED = false` en
`src/config/features.ts`. Procedimiento de activación futura y su reversión:

- **Activar** (cuando `player-mass` esté cumplido con telemetría real): poner
  `GLOBAL_MARKET_ENABLED = true` en `src/config/features.ts` y desplegar. `marketReadiness.test.ts`
  seguirá siendo el cerrojo: si algún criterio técnico decae, `npm test` avisa.
- **Rollback**: volver la constante a `false` y desplegar. Es un cambio de una línea, sin
  migración ni estado que revertir; los listados vivos que hubiera quedan solo-lectura (las
  escrituras vuelven a `503`) y las lecturas siguen funcionando. **No** se parchea el backend en
  producción para ocultar un problema (§23): ante un incidente grave, se apaga el flag.

## 15. P2 reales restantes

- **Cumplir `player-mass`**: recoger la telemetría de jugadores activos en producción y, con
  ≥ 200, alimentar `evaluateReadiness({ activePlayers })` desde una fuente real (hoy el gate no
  tiene cableada esa entrada de telemetría — conectarla es trabajo de Operaciones/plataforma).
- **Validación P2P viva** (vendedor→listing→comprador→compra, con comprobación de balances,
  ledger, serial/version/instance): pendiente de un entorno con el backend remoto accesible de
  forma autorizada y con dos cuentas de prueba.
- **Ejecutar `economy:verify` en la VPS** para confirmar en vivo los criterios `verify` 1–7 y
  las pruebas de RLS/idempotencia/concurrencia contra la base de datos real.
- **Ensayo de concurrencia/idempotencia real** (doble compra simultánea, retry) una vez abierto,
  como verificación de campo de lo que los tests ya afirman.

## 16. Archivos modificados

- `docs/product/fase-23-3-marketplace-go-live-report.md` — **(nuevo)** este informe.

**No se modificó ningún archivo de código.** El gate detuvo la activación, que es exactamente
el comportamiento correcto de una activación *controlada*. Sin `git commit`, `push` ni `deploy`;
cambios en el árbol de trabajo.
