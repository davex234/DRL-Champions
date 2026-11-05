# Tactical Coach · roster real — informe

**Resultado: GO.** El entrenador compone, dibuja, presenta y planifica con los agentes REALES del
juego. Auditoría previa: `tactical-coach-roster-real-auditoria.md`. Evidencia:
`docs/product/qa/roster-real/`.

## 1 · Por qué existían los diez ficticios

F47 partió de que el catálogo del proyecto (`src/agents/catalog.ts`) eran agentes PROPIOS —el
mismo que usa el motor de simulación— y de que los de Riot no se podían usar. F48 construyó
identidad visual y arte sobre esa premisa. Era la premisa equivocada **para el entrenador**, que
prepara partidas del juego real.

## 2 · Dónde estaban conectados

8 puntos del entrenador (`AgentEmblem`, `AgentPicker`, `CompositionBuilder`, `StrategyBoard`,
`TacticalTheater`, `composition.ts`, `strat.ts`, `strats/page.tsx`) — y, **fuera del entrenador**,
el motor de simulación y el juego de cartas (`src/sim`, `src/utility`, `src/abilities`,
`src/deck/analysis`, `broadcast`).

## 3 · Qué se ha hecho con ellos

- **En gameplay: nada.** `src/agents`, `src/abilities`, `src/sim`, `src/utility` idénticos a HEAD.
- **En el entrenador: pasan a LEGADO.** Se reconocen y se conservan (saneadores), se pintan con su
  sigilo en gris con anillo discontinuo y rótulo «Modelo anterior», y **no se ofrecen**.
  **Cero mapeos** ficticio → real.
- **F48** (Veil V1/V2, biblia, pipeline, `visuals.ts`, `AgentPortrait`): conservado como trabajo
  experimental; el entrenador ya no lo usa. No se ha producido más arte.

## 4 · Fuente del roster real

`valorant-api.com/v1/agents?isPlayableCharacter=true`, juego **13.05.00.5350494** (2026-08-20),
verificado contra **playvalorant.com/en-us/agents/** (29 nombres idénticos, 2026-09-21). Cruzado
además con el registro del importador de VLR del propio repo (27 que coinciden; le faltaban Veto y
Miks). Datos en `src/domain/tactics/valorantRoster.ts` (generado, con `uuid` de fuente por fila).

## 5–7 · Agentes, roles, habilidades

**29 agentes.** Roles reales: Duelista 8 · Iniciador 7 · Controlador 7 · Centinela 7 (sin «flex»).
**4 habilidades por agente**, con su tecla por defecto C/Q/E/X (definitiva marcada). Pasivas fuera.
La **marca** de la pizarra (humo, destello, muro…) la elige el entrenador al colocar la habilidad:
los datos no dicen a qué intención corresponde cada habilidad y deducirlo sería un mapeo inventado.

## 8 · Assets

Sólo DATOS. Ningún retrato ni icono de Riot (sin licencia — criterio de la Fase 16). Ficha propia:
anillo del color del rol + código de tres letras por regla. Prueba que falla si aparece una URL o
fichero de artwork en el catálogo o en el emblema.

## 9–12 · Pantallas (producción, BD del VPS, cuenta QA)

| Superficie | Resultado |
|---|---|
| Composition Manager | roster de 29, filtro de 4 roles, buscador («kay» → KAY/O), sin duplicados, tope de 5, guardar → recargar → los cinco siguen; responsive 390/768/1024/1440/1920 sin desbordes |
| Pizarra | las 5 fichas con agente real (código dentro, nombre debajo), 0 imágenes de agente; habilidades reales C/Q/E/X; «Dark Cover» colocada como humo; paso añadido; guardar → reabrir: agentes y «Habilidad: Dark Cover (E)» intactos |
| Presentar | lista los cinco reales con su rol; mapa con fichas |
| Plan Táctico | composiciones reales y la antigua (en gris) conviven; asignación previa intacta |
| Jugada antigua | `__QA_F471_STRAT__` abre con sus cinco agentes antiguos y el aviso «modelo anterior» al seleccionar |

Persistencia comprobada en BD (lectura): `agent_ids = {sova,jett,killjoy,kayo,omen}`; en los dos
pasos, `smoke : omen_e : Dark Cover`.

**Observación F47 (no tocada):** una flecha que nace sobre una ficha queda por encima y captura el
clic (seleccionar a Veil en `__QA_F471_STRAT__` selecciona la flecha). Es el orden de capas del
tablero; queda anotado.

## 13 · Datos anteriores

1 composición y 2 jugadas con ids ficticios, todas de la cuenta QA. **Intactas**: 30 fichas
antiguas conservadas (`updated_at` del 2026-09-20), composición antigua con sus cinco. Los
saneadores ya no las recortan al volver a guardar.

Datos de QA creados en esta fase (cuenta QA): 3 composiciones `__QA_REALROSTER__` y 3 jugadas
`__QA_REALROSTER_STRAT__` (una por pasada del instrumento).

## 14 · Migraciones

**0.** Cabecera **0054**. `agent_ids text[]` y `plan jsonb` no restringen catálogo.

## 15–19 · Gates

Tests **4554/4554** · tsc web y scripts **PASS** · lint **exit 0** · build **PASS** · :3005 con
`npm run start`.

## 20 · Working-tree safety

Copia previa de cada fichero editado (`backup-pre-realroster/` del scratchpad). Diferencia de
`git status`: sólo altas (`roster.ts`, `valorantRoster.ts`, `_realroster-qa.ts`, dos documentos y
`qa/roster-real/`). Parches con `assert count == 1` y conservación de fin de línea. Sin reset,
clean, restore, checkout, stash, commit ni push. Marketplace `GLOBAL_MARKET_ENABLED = false`.
