# FASE 36.1 · Contrato de la métrica «sobres abiertos» (`packs_opened`)

Describe el código real. Si divergen, manda el código: `src/battlepass/missions.ts` (`METRIC_VERSIONS`, `metricValue`,
`missionProgress`, `assignMission`, `rebaselineForRepeat`), `src/server/services/progression.ts` (`loadFacts`),
`src/battlepass/metricRebase.ts`, `supabase/migrations/0019_economy_ledger.sql` (`app_apply_pack_open`).

## Qué significa

«Abre un sobre» (`d-abrir-1`, diaria, objetivo 1, 200 créditos + 150 XP del pase) y «Abre 10 sobres» (`w-sobres-10`,
semanal, objetivo 10, 1.500 créditos + 900 XP del pase) miden **sobres abiertos de verdad en el servidor**. Los logros
`sobres-100` y `sobres-1000` usan la misma cifra (acumulada, sin baseline).

## Qué cuenta y qué no

| acción | RPC | ¿cuenta? | prueba |
|---|---|---|---|
| Abrir un sobre (inventario, ceremonia, `buy_and_open`) | `app_apply_pack_open` | **+1** | sonda 6 · test SQL |
| Reintentar la misma apertura (misma clave) | `app_apply_pack_open` → devuelve el resultado guardado | **+0** | sonda 7 |
| Abrir 3 sobres distintos | 3 llamadas con claves distintas | **+3** | sonda 8 |
| Abrir sin sobres | excepción `No tienes ese sobre` | +0 | sonda 9 |
| Comprar un sobre | `app_buy_pack` | +0 | sonda 2–3 |
| Recibir sobres (alta, `app_grant_pack`, recompensas `app_grant_reward`) | — | +0 | sondas 1, 4, 5 |
| Poseer sobres (`user_packs`) | — | +0 | test de fuente |
| Telemetría | — | nunca (no es autoridad) | test |

Dos pestañas sobre el mismo sobre: el sobre se bloquea (`for update`) y `economy_ops.ref` es clave primaria; con la misma
clave, la segunda llamada o devuelve el resultado guardado o aborta su transacción entera (incluido el +1). Como mucho +1.

## Fuente canónica

`user_game.packs_opened`: se incrementa SOLO dentro de `app_apply_pack_open`, después de comprobar la clave de idempotencia
y de consumir el sobre, en la misma transacción que la fila `economy_ops` (kind `open_pack`). Monótona (solo +1). En la BD
real coincide exactamente con el número de `economy_ops` `open_pack` de cada usuario (22 = 22). Clientes sin permiso de
escritura (`revoke insert, update, delete … from anon, authenticated`). La app abre siempre con clave (`packOpRef`, gesto
del cliente o UUID del servidor).

`profiles.packs_opened` (fuente antigua) no la incrementa ningún camino del servidor (0 en los 10 perfiles reales) y un
trigger impide que la escriba el cliente. Se sigue leyendo solo como `packs_opened@legacy` para interpretar baselines
antiguas.

## Ventana y reloj

Diaria: 00:00Z–24:00Z; semanal: lunes 00:00Z (`domain/progression/periods.ts`), con el reloj del servidor. La baseline se fija
al asignar la misión, así que una apertura anterior a la ventana nunca cuenta como progreso de la tanda nueva.

## Baseline y versión

`ActiveMission.metricVersion` (dentro de `user_pass.state`, jsonb; sin cambio de esquema):

- **Sin campo** (legacy): baseline tomada de `profiles.packs_opened`. Se mide con esa fuente; nunca con la nueva.
- **`2`** (vigente): baseline tomada de `user_game.packs_opened`. Progreso = contador − baseline, acotado a [0, objetivo].

Misiones nuevas (sorteo, rotación, fijas) nacen con `metricVersion: 2`. Al reclamar una repetible, reinicia desde la fuente
vigente y queda en `2`. El modo local (sin servidor) no aporta la clave legacy y conserva su comportamiento.

## Transición

Rebase conservador explícito, una vez, con backup (nunca desde una lectura): `baseline = contador vigente − progreso visible
legacy`. Reclamadas y caducadas no se tocan. Ver `rebase-matrix.md`.
