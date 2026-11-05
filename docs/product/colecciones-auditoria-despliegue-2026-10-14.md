# Colecciones por equipo · auditoría final y preparación del despliegue (2026-10-14)

Complementa a `colecciones-cierre-2026-10-14.md`. **No se ha desplegado, no se ha hecho push, no se ha aplicado ninguna
migración en producción ni se ha reiniciado nada allí.** En producción solo se ha leído (consultas `READ ONLY`, `readlink`,
`sha256sum`) y se ha tomado una copia de seguridad (el guion de copia solo lee la base y escribe en `/opt/nexus/backups`).

Leyenda: **[V]** verificado · **[L]** probado en local · **[QA]** probado en el stack de QA aislado · **[R]** probado en
una copia restaurada de producción (contenedor desechable, `--network none`) · **[P]** pendiente · **[B]** bloqueado.

## 1. Estado inicial comprobado

| Qué | Encontrado |
|---|---|
| Rama | `feat/team-collections`, sin upstream (nada publicado) [V] |
| HEAD al empezar | `93e794f` (docs). Los ficheros de la release no cambiaban desde `a8a315b`, de donde salió `ea82a9f8` [V] |
| Sin confirmar | los mismos 33 ficheros ajenos de siempre (F78 copias off-site, PNG de QA, `settings.local.json`): **intactos** [V] |
| Artefacto `ea82a9f8` | en `valorosters-i18n-qa/rc/` (NO en `incoming/`); `sha256sum -c` OK; extraído entero: sus 145 ficheros de la rama son **byte a byte los de HEAD** y los 2 retirados no están; es fuente (se compila al desplegar) [V] |
| Producción | `current` → `drl-0.1.1-1-4b1f4c01`, `valorosters-app` healthy; 0075 y 0076 **no** aplicadas; `temporada-2` en DRAFT (30/11); 2 cuentas, 0 equipos completos [V] |
| Copias | diaria de las 04:30 (`daily/`, 14 días, con sha256) y unidades completas de `backup-drlcards.sh` (`pre-0074-colecciones`, …). No hay copia diaria de DRLCards en el crontab de nexusadmin aparte de `nexus-backup.sh` (que sí la incluye) [V] |

## 2. Cambios de esta auditoría

| Commit | Qué |
|---|---|
| `e1a6f81` | `scripts/ops/_collections-apply-0075-0076.sh` (guion real de aplicado: `precheck`, `ensayo`, `aplicar-0075`, `aplicar-0076`, `verificar`) y `_collections-migration-rehearsal.sh` + `_collections-rehearsal.functional.sql` (ensayo completo sobre una copia restaurada) |
| `a5f5f8f` | **originales del arte de agentes versionados** (`personajes/cara`, `personajes/entero`, 58 ficheros, 2,8 MB) con una excepción acotada en `.gitignore` |
| `4d785bd` | **la liquidación de colecciones ya no depende de entrar en Colecciones** (`src/lib/game/sync.ts`) + `collectionSettle.test.ts` |
| `d3f8dc6`, `6e5ca7e` | QA de navegador de esa liquidación (`_team-collections-bgsettle.ts`, `team-collections.sh bgsettle`); la puerta toma `personajes/` de git |
| `5451cf8`, `0340fb3` | **el aviso de la recompensa** («G2 completado · +300 XP · Insignia…») llega aunque la liquidación ocurra en segundo plano: aviso compartido (memoria + `sessionStorage`) que pinta el armazón normal del juego y la portada (a donde se llega al iniciar sesión), nunca la apertura de sobres, los duelos ni el lanzador. Defecto encontrado por la QA de la candidata intermedia `36bda0e2`: al entrar en Colecciones ya no quedaba nada pendiente y el jugador no se enteraba |

**Candidata nueva: `drl-0.1.1-1-fe98c81a`** (sustituye a `ea82a9f8`; las intermedias `36bda0e2` y `6ed543a0` quedan obsoletas):
151 ficheros = los 145 de antes + `sync.ts`, el aviso compartido y sus pruebas. `valorosters-i18n-qa/rc/drl-0.1.1-1-fe98c81a.tar`,
sha256 `6d1f38d699b01a33cd3debc27a536594a8681d45c0273b1ee7a208ead70c2ec3`.
Frontera exacta, F78 = producción, 0075+0076 aditivas con rollback, economía intacta (comprobaciones del guion de stage).

## 3. Migraciones 0075 y 0076

Revisión del SQL y de sus dependencias:

- **Orden**: 0075 y después 0076 (0076 no depende de 0075, pero el guion exige ese orden para que el estado intermedio sea
  siempre uno de los probados). Cada una en su propia transacción (`psql -1`).
- **Dependencias** (comprobadas por el guion antes de tocar nada, porque PL/pgSQL no valida llamadas al crear la función):
  `app_season_apply(uuid,text,text,text,int,int,jsonb,jsonb)` (0064), `app_admin_audit(uuid,text,text,text,jsonb)` (0055),
  `game_seasons`, PK `(user_id, cosmetic_id)` de `user_cosmetics` (0016), `profiles.is_admin`, `content_audit_log`, índice
  `user_cards(user_id, card_id)` (0011). Todas presentes en la copia de producción [R].
- **Idempotencia**: `create table if not exists` / `create or replace function`, pero el guion **se niega** a aplicar si ya
  hay rastro (tablas o funciones) y a aplicar 0076 sin 0075: no se re-ejecuta a ciegas.
- **Seguridad**: RLS activada sin políticas; `revoke` a `anon`/`authenticated`; funciones SECURITY DEFINER con
  `search_path=public` y EXECUTE solo para `service_role`. Verificado tras aplicar [R][QA].
- **Datos**: ninguna escribe filas al aplicarse; las huellas de 17 tablas existentes no cambian [R].
- **Compatibilidad**: el código publicado (`4b1f4c01`) no usa nada de esto; el código nuevo funciona sin 0075 (todo lo
  derivado; `settle` 503) y sin 0076 (el panel dice «Falta la migración 0076»).

**Ensayo completo sobre una copia restaurada del backup de hoy** (`pre-0075-0076-audit/20261014T124558Z`) — `REHEARSAL_OK` [R]:

| # | Escenario | Resultado |
|---|---|---|
| 0 | copia restaurada | 25 tablas con los recuentos del backup |
| 1 | `precheck` + `ensayo` (0075+0076 en una transacción, verificación, ROLLBACK) | dependencias OK; datos intactos; sin rastro después |
| 2 | `aplicar-0075` | 183 ms, 0 filas cambiadas, verificada |
| 3 | **0076 falla a mitad** (fallo inyectado al final de su transacción) | 0075 entera (3/3), 0076 sin rastro (0/2), datos idénticos; `verificar` OK |
| 4 | `aplicar-0076` | 177 ms, 0 filas cambiadas, verificada |
| 5 | funcional con cuentas y funciones reales (ROLLBACK) | catálogo del código = 331 publicadas de producción; incompleto → nada; sin temporada → pendiente; con temporada → +300 una vez y 3 reintentos 0 (libro y progreso reales); la PK impide duplicar; desguazar no retira y volver a completar no paga; insignia de China una vez con su cosmético y permanente; la otra cuenta sin nada; alta de equipo auditada con el admin real y clave inmutable |
| 6 | rollback 0076 + 0075 **con datos guardados** | funciones y tablas retiradas; archivo completo (1:1:1); XP e insignia del jugador intactos; cartas, perfiles, créditos, libro de XP, cosméticos y catálogo idénticos; un segundo rollback se rechaza |
| 7 | restaurar (reaplicar + devolver archivo) | filas devueltas; volver a liquidar concede 0 XP |

Además, en el stack de QA (Postgres real, sin datos de producción) se han vuelto a ejecutar en esta auditoría 0075 `sqltest`
(incluye 24 y 16 sesiones simultáneas), `txfail` (fallo a mitad de la liquidación) y 0076 `sqltest` (§8) [QA].

## 4. 300 XP y temporadas

| Requisito | Estado |
|---|---|
| 300 XP una sola vez por cuenta y equipo | [R][QA][L] PK (usuario, equipo) + marca `xp_granted_at` + clave única del libro de XP de la temporada |
| Peticiones simultáneas | [QA] 24 y 16 sesiones; 8 y 6 liquidaciones a la vez por la API: una sola concesión |
| Sin temporada activa: pendientes | [R][QA][L] la compleción se guarda con XP a null |
| Al empezar la temporada: se cobran | [R][QA][L] el siguiente `settle` con temporada activa cobra 300 una vez |
| **No perder XP por no entrar en Colecciones** | **Defecto real encontrado y corregido** (`4d785bd`): antes solo se liquidaba al abrir Colecciones. Ahora tras cada sincronización con el servidor (inicio de sesión, recarga, operaciones), en segundo plano y como mucho 1/min; y el aviso de lo ganado se enseña en cualquier pantalla normal (`5451cf8`). [L] pruebas; [QA] `bgsettle` en navegador y aviso tras iniciar sesión (ver §8) |
| Errores de transacción | [QA] fallo a mitad: ni compleción ni evento ni asiento ni progreso; [R] 0076 roto no deja nada |
| Desguazar no revierte | [R][QA][L] |
| Restricciones contra duplicados | [R] la PK rechaza la segunda compleción |

Límite conocido: un jugador que no abre la app no liquida (no hay proceso de servidor que lo haga por él); en cuanto
entra, se liquida. Los XP se apuntan en la temporada activa en ese momento.

## 5. Las tres pruebas de arte de agentes

- **Causa**: `.gitignore` excluía `/personajes/` junto a `/cartas/` (653 MB) y `/sobres/` (37 MB) como «arte fuente
  pesado»; F59 añadió después tres pruebas (`agentArt.test.ts` C, D y G) que comprueban la procedencia del arte contra
  esos originales. En el PC pasaban porque la carpeta existe; en un clon limpio, en **CI** (`.github/workflows/test.yml`
  ejecuta `npm test` en cada push) y en la puerta de la release fallaban.
- **Arreglo** (`a5f5f8f`): versionar solo `personajes/cara` y `personajes/entero` (58 ficheros, 2,8 MB; sus derivados ya
  estaban en `public/agents/`). Las pruebas no se tocan.
- **Validación**: clon limpio de la rama (con finales de línea LF, como en CI) → **6.579/6.579** sin datos añadidos [L].
  Nota: un clon con el `autocrlf=true` del Git de Windows convierte a CRLF y hace fallar 32 pruebas que leen cabeceras de
  migraciones; CI (Ubuntu) y el repositorio (`core.autocrlf=false`) usan LF.
- **Requiere tu visto bueno antes de publicar**: una vez en el remoto, esos originales quedan en el historial.

## 6. `/admin/collection-sets` — recomendación

- **Usos reales**: ninguna pantalla del jugador llama ya a `/api/game/collection-sets`; el perfil (`playerIdentity`) sigue
  leyendo `collection_sets` para nombrar y pintar insignias antiguas; los sondeos de salud y de cabeza de migraciones
  (`f73Probe`, `ops/release`) usan la tabla para detectar 0062; el panel sigue pudiendo generar y publicar sets.
- **Riesgo actual**: bajo. El `POST {claim}` antiguo sigue accesible por API directa y solo concede el cosmético antiguo
  (sin XP desde 0075 ni créditos); producción tiene 0 reclamos. Publicar un set desde el panel ya no cambia nada visible.
- **Recomendación**: **mantener** la ruta, la tabla y los datos; **ocultarla del menú** del panel en una tarea aparte (su
  rótulo «Colecciones» confunde con las nuevas) y, en esa misma tarea, decidir si el reclamo antiguo responde 410. No se
  ha modificado nada.

## 7. Auditoría funcional y de seguridad

Ver §8 para los resultados de la candidata `36bda0e2`. Cubre: todas las cartas y ediciones, duplicados, equipos nuevos y
sin región, 3 + 6, 50.000 y 60.000 cartas, las cuatro insignias, permanencia, destacar bloqueadas/ajenas (403), perfil,
alta de equipos (validación, clave inmutable, auditoría, solo admin), logos y escudo con etiqueta, RLS y permisos,
aislamiento entre cuentas, cuerpos manipulados, 401/400/404/405, ocho idiomas en navegador.

## 8. Validación final

Todo ejecutado hoy de nuevo (no se reutiliza ningún resultado anterior). Candidata `drl-0.1.1-1-fe98c81a`.

| Suite | Resultado | Dónde |
|---|---|---|
| `npm test` (repo, incluye el trabajo F78 sin confirmar de la copia) | **6.595/6.595** | [L] |
| `npm run typecheck` · `npm run lint` · `npm run i18n:audit` | 0 errores · 0 errores (30 avisos, los de siempre) · sin problemas (13.825 × 7) | [L] |
| Clon limpio de la rama, LF como CI (`a5f5f8f`, antes del arreglo de XP) | **6.579/6.579**, incluidas las 3 de arte de agentes, sin datos añadidos | [L] |
| Puerta de la candidata (npm ci + next build + tsc + pruebas sobre la fuente de la release) | **6.586/6.586 · GATE_OK** | [QA] |
| Liquidación sin entrar en Colecciones (`bgsettle`, navegador) | **5/0**: solo portada y álbum; NAVI guardado con 300 XP; repetir da 0 | [QA] |
| Colecciones: API + navegador, 8 idiomas × 390/1440 | **896/0** (incluye el aviso de recompensa en la portada tras iniciar sesión, 50.000 y 60.000 cartas, cuerpos manipulados, 401/400/404/405, aislamiento, perfil, insignias bloqueadas/ajenas 403) | [QA] |
| Permanencia (se borran las cartas de China) | **6/0** | [QA] |
| Alta de equipo nuevo con catálogo servido desde la base (API + panel 8 idiomas + Colecciones) y limpieza | **84/0**; restos 0; base de QA devuelta a 0 cartas/0 identidades en `content_*` | [QA] |
| QA autenticada de todo el juego, 8 idiomas | **1.286 PASS · 7 FAIL** — ver abajo | [QA] |
| Visual de pantallas tocadas y vecinas, 8 idiomas × 390/768/1440 | **576 pantallas, 0 hallazgos** (idioma, desbordes, cortados, restos de español, claves, consola, hidratación) | [QA] |
| Humo de invitado, 8 idiomas | **132/0** | [QA] |
| 0075 `sqltest` (Postgres real) · `txfail` · 0076 `sqltest` | SQLTEST_OK (39 comprobaciones en esta pasada) · TXFAIL_OK · SQLTEST_OK con la base idéntica tras el ROLLBACK | [QA] |
| Ensayo completo sobre la copia restaurada de producción | REHEARSAL_OK (§3) | [R] |
| Copia de seguridad + simulacro de restauración | BACKUP_OK + DRILL_OK (25 tablas, 0 diferencias, 26 s) | [V] |

**Los 7 fallos de la QA autenticada no son del producto**: los siete son la misma comprobación («sin restos de español»
en el inicio del panel de administración) en los 7 idiomas no españoles, y el texto marcado es `qa-nuevo`: la clave del
equipo **sintético** que crearon mis pasadas anteriores del alta. El panel enseña en «Actividad administrativa reciente»
las 12 últimas filas del registro de auditoría, que es append-only; en la base de QA hay 7 filas recientes y 6 son
`team_identity_* qa-nuevo`. No se han borrado (el registro es append-only) y el instrumento ya usa una clave neutra
(`qa-omega`, `79da506`), así que futuras pasadas no las añaden. Las claves de equipo son datos, como `g2`.

Defectos encontrados por la QA de hoy y corregidos (cada corrección, con su candidata nueva y la QA repetida):
1. `36bda0e2`: con la liquidación en segundo plano, el aviso de recompensa no se enseñaba nunca → aviso compartido (`5451cf8`).
2. `6ed543a0`: el aviso no salía en la portada, que es inmersiva y es donde se llega al iniciar sesión → también en la
   portada, nunca en sobres, duelos ni lanzador (`0340fb3`).

Capturas: `docs/product/qa/colecciones-cierre/` en disco (la política del repositorio, `docs/product/qa/**/*.png` en
`.gitignore`, no versiona PNG; sí los `ui-*.json` con todos los resultados). La del aviso en la portada:
`40-es-1440-aviso-recompensa-en-portada.png`.

Detalle cosmético sin corregir: el aviso escribe los XP sin separador de miles («+12300»), igual que antes.

## 9. Plan de despliegue (requiere tu autorización; nada de esto se ha ejecutado)

Todo en el VPS como `nexusadmin`, con los guiones reales. `REL=drl-0.1.1-1-d523a42a`. Ficheros revisados en `/tmp/tc-deploy`
(copiar las dos migraciones, sus ROLLBACK y los guiones desde el tar de `d523a42a` y el repositorio; los sha256 de las migraciones son
`0075: adc8e1c2…f1aa26` y `0076: 4407dd75…5c404c0`).

1. **Precondiciones**: `readlink /opt/nexus/projects/valorosters/current` = `releases/drl-0.1.1-1-4b1f4c01`;
   `sha256sum -c valorosters-i18n-qa/rc/$REL.tar.sha256`; nadie desplegando; ventana sin tráfico (2 cuentas).
2. **Salud**: `/opt/nexus/projects/valorosters/bin/status.sh` → app healthy, `/api/ready` ok, túnel y público 200.
3. **Copia**: `DEST=/opt/nexus/backups/supabase-drlcards/pre-0075-0076 DRL_OFFSITE_CONFIG=/nonexistent bash
   releases/drl-0.1.1-1-4b1f4c01/scripts/ops/backup-drlcards.sh` → `BACKUP_OK <dir>`. La configuración vive en
   `secrets/app.env` y `compose.yml`, que no cambian (copiar ambos junto al backup si se quiere conservar).
4. **Integridad y restauración**: `SRC=<dir> bash releases/drl-0.1.1-1-4b1f4c01/scripts/ops/restore-drill.sh` → `DRILL_OK`;
   y el ensayo de migraciones sobre esa misma copia: `SRC=<dir> W=/tmp/tc-deploy EXPECT_SHA_0075=… EXPECT_SHA_0076=… bash
   /tmp/tc-deploy/_collections-migration-rehearsal.sh` → `REHEARSAL_OK`.
5. **0075**: `EXPECT_SHA_0075=… EXPECT_SHA_0076=… W=/tmp/tc-deploy bash /tmp/tc-deploy/_collections-apply-0075-0076.sh precheck`,
   después `… ensayo` (→ `ENSAYO_OK`) y `… aplicar-0075` (→ `APPLY_OK 0075`).
6. **Tras 0075**: `… verificar` (→ `VERIFICAR_OK`, 0075 3/3, 0 filas). La app vieja sigue funcionando (no la usa).
7. **0076**: `… aplicar-0076` (→ `APPLY_OK 0076`).
8. **Tras 0076**: `… verificar` (→ 0075 3/3, 0076 2/2, 0 filas, permisos y RLS correctos).
9. **Activar**: `cp valorosters-i18n-qa/rc/$REL.tar* /opt/nexus/projects/valorosters/incoming/` y
   `/opt/nexus/projects/valorosters/bin/deploy.sh $REL` (compila en contenedor, exige BUILD_ID = `$REL`, recrea solo
   `valorosters-app` y espera `/api/health` 200).
10. **Humo**: `bin/status.sh`; `https://valorosters.com/api/health` 200; con una cuenta propia: Colecciones carga (3 equipos
    y «Ver más equipos»), detalle de un equipo, perfil; `/admin/teams` muestra «Todos los equipos impresos del catálogo
    tienen identidad».
11. **XP e insignias** (solo lectura): `… verificar`; `select count(*) from user_team_completions` (hoy se espera 0: nadie
    tiene un equipo completo) y que `GET /api/game/team-collections` responda 200 sin `pending` para tu cuenta. No se
    hacen compras ni aperturas para probarlo.
12. **Logs**: `bin/status.sh --logs` y `docker logs --since 15m valorosters-app | grep -iE "error|team-collections"`.
13. **Abortar si**: cualquier `APPLY_STOP`/`REHEARSAL_FAIL`/`DRILL_FAIL`; huellas distintas en el aplicado; BUILD FALLIDA o
    BUILD_ID distinto; `/api/health` ≠ 200 tras activar; errores 5xx en Colecciones o `settle`.
14. **Recuperación**:
    - si falla 0075 o 0076: la transacción se revierte sola; no se activa el código; se investiga (no se improvisa).
    - si falla después de activar: `bin/deploy.sh --activate drl-0.1.1-1-4b1f4c01` (la release sigue en `releases/`). Es
      compatible con 0075/0076 puestas: el código anterior no las usa. **No hace falta tocar el esquema para volver.**
    - solo si hubiera que retirar el esquema: `0076…ROLLBACK.sql` y después `0075…ROLLBACK.sql` (en
      `docs/operations/rollback/`). Archivan las tablas en `ops_rollback_007x_*`, **no retiran XP ni insignias concedidas**
      y se niegan a repetirse. Para volver a aplicar: reaplicar y devolver el archivo (ensayado en §3, paso 7), nunca
      reaplicar sin restaurar (alguien podría cobrar otra vez en otra temporada).
    - último recurso: restaurar el backup del paso 3 (perdería lo escrito después).
15. **Incompatibilidades código/esquema**: código nuevo sin 0075 → `settle` 503 y la sincronización en segundo plano lo
    ignora (sin efectos); sin 0076 → el panel no deja dar de alta equipos. Código viejo con 0075/0076 → sin efecto. La
    cabeza obligatoria de `/api/ready` sigue en 0073 a propósito (0075/0076 son opcionales para arrancar).

## 10. Riesgos pendientes

1. Liquidación solo cuando el jugador usa la app (§4).
2. Sin temporada activa hasta el 30/11: los XP se guardan como pendientes.
3. 16 equipos sin logo oficial (subida disponible en `/admin/teams/<equipo>`; Storage fuera de la copia diaria).
4. `/admin/collection-sets` y el reclamo antiguo siguen activos (§6).
5. Versionar `personajes/` requiere tu visto bueno antes de cualquier push (§5).
6. El stack de QA guarda una cuenta sintética con saldo repuesto y una temporada «QA-TC»: solo QA.

## 11. Pasos que requieren intervención humana

1. Autorizar el despliegue y ejecutar §9.
2. Confirmar si se publican los originales de `personajes/`.
3. Logos oficiales de los 16 equipos.
4. Decidir el futuro de `/admin/collection-sets` y del reclamo antiguo.

## 12. Confirmación

No se ha hecho push (la rama no tiene upstream), no se ha desplegado, no se ha aplicado ninguna migración en producción, no
se ha reiniciado ningún servicio de producción (`valorosters-app` sigue arrancado desde el 13/10 16:38, 0 reinicios) y no se
ha modificado ningún dato real. Lo único escrito en el VPS fuera del stack de QA es la copia de seguridad
`pre-0075-0076-audit/20261014T124558Z`. Los cambios sin confirmar de otras tareas (F78, PNG de QA, configuración) siguen
intactos.

## 13. Cierre definitivo (2026-10-14, tarde)

**Candidato exacto: `drl-0.1.1-1-d523a42a`** — `valorosters-i18n-qa/rc/drl-0.1.1-1-d523a42a.tar`, sha256
`4acdf145c568514b1386692d9ff56bb9cc619f79d6fa2a540d69726132fa2df6` (`sha256sum -c` OK), NO en `incoming/`. Sustituye a
`fe98c81a`: el formato de los XP cambió un fichero de la release, así que `fe98c81a` ya no es el artefacto a desplegar.
Diferencia con `fe98c81a` comprobada por huellas: **solo** `src/components/trophies/CollectionRewardNotice.tsx` y
`src/lib/teamCollections/rewardNotice.test.tsx`. Migraciones y ROLLBACK, byte a byte los ensayados (0075 `adc8e1c2…`,
0076 `4407dd75…`).

**Git**: rama `feat/team-collections`, HEAD de código `9d474a7` (más este commit de documentación), sin upstream: nada
publicado. Los 33 ficheros ajenos sin confirmar (F78, PNG de QA, configuración) siguen intactos.

### Los siete fallos de la QA autenticada
- Los siete, comprobados en `out/vrqa_run_auth.17.log`: `admin-inicio · sin restos de español — ["qa-nuevo"]` en en, de,
  it, fr, pt-PT, pt-BR y ja (en español esa comprobación no se aplica). Ninguno más.
- Detector (`scripts/_i18n-auth-lib.ts`): una lista de palabras españolas por idioma (todas incluyen `nuevo`) con límite
  de palabra «no letra», así que el guion de `qa-nuevo` cuenta como límite.
- **Prueba aislada del detector ejecutada hoy** con su propia lista: `qa-nuevo` → marcado en los 4 grupos de palabras;
  `qa-omega`, `team_identity_create · qa-omega` y `g2` → no marcados.
- Cronología verificada: el alta sintética que creó `qa-nuevo` corrió a las 14:20–14:23 UTC con el instrumento antiguo; la
  clave neutra es `79da506` (14:35 UTC); la pasada autenticada, 14:35–15:04 UTC, leyó filas ya creadas. **No hay ninguna
  pasada autenticada posterior a la corrección.**
- La corrección es del **instrumento de QA**, no del producto: no forma parte de ninguna release (`scripts/_*` no entra).
  El candidato no contiene ni necesita cambio para esto.
- **Estado: causa demostrada y no funcional; instrumento corregido; sin evidencia de una pasada completa en verde.** Una
  pasada nueva seguiría marcando lo mismo mientras las 6 filas `qa-nuevo` estén entre las 12 últimas del registro de
  auditoría de QA (append-only: no se borran). No la he repetido: dura ~30 min y no aportaría evidencia distinta.

### Aviso de XP
- Corregido: `rewardText` usa `formatNumber` (ayuda de i18n del proyecto, `useGrouping: "always"`). Solo presentación;
  ni el valor ni la liquidación cambian. Clave de traducción sin cambios (auditor sin problemas).
- Pruebas: separador de cada uno de los 8 idiomas (12.300 · 12,300 · 12 300) con el mismo valor; texto completo en español.
  29/29 en las suites afectadas, tipos y lint de los ficheros tocados sin errores [L].
- Candidato `d523a42a`: puerta **6.587/6.587 · GATE_OK**; Colecciones en es, fr y ja (390 y 1440 + API) **446/0** [QA].
  Captura del navegador: «+12.300 XP DE TEMPORADA» en la portada tras iniciar sesión. Francés y japonés verificados solo
  por la prueba unitaria del formato (el paso del aviso del instrumento corre en español).
- Sigue sin salir en la apertura de sobres, los duelos ni el lanzador (prueba de `GameShell`).

### Originales de personajes (`a5f5f8f`)
- 58 ficheros, 2.765.268 bytes (el mayor, 497 KB): `personajes/cara/*` (29) y `personajes/entero/*` (29); 28 avif, 23 webp,
  4 png, 3 jpeg. El commit solo añade esos 58 y la excepción de `.gitignore` (`/cartas/` y `/sobres/`, 690 MB, siguen fuera).
- **Los 58 son exactamente las fuentes del manifiesto** (`agentArtManifest.ts`): ninguno sobra ni falta.
- Formato real = extensión en los 58. Sin EXIF, GPS, XMP, autor, copyright, rutas de usuario ni correos (barrido hoy).
- Clon limpio (LF) de la rama en `a5f5f8f`: 6.579/6.579 sin datos añadidos (ejecutado en esta sesión).
- **Recomendación**: es seguro publicarlos técnicamente (pequeños, sin datos privados, necesarios para CI). La única
  objeción posible es de derechos: son arte de agentes de Valorant, ya publicado en `public/agents/` como derivados
  (decisión F59). Si prefieres no tenerlos en el historial del remoto, saca `a5f5f8f` de la rama antes del push y CI
  volverá a fallar en esas 3 pruebas. Decisión tuya.

### Migraciones y recuperación — qué está verificado y con qué
| Afirmación | Evidencia |
|---|---|
| Ensayo sobre copia restaurada y aislada | contenedor con la imagen de producción y `--network none`; `rehearsal-restore.log` y recuento de 25 tablas = backup; contenedor ya no existe [V] |
| Filas existentes conservadas | `/tmp/tc-deploy/r-0.fp` = `r-3.fp` = `r-5.fp` (17 tablas) y `*-before.fp` = `*-after.fp` de cada aplicado [V, ficheros] |
| Fallo intermedio de 0076 recuperable | `0076-broken.out`: `ERROR: division by zero` (fallo inyectado al final de su transacción); después 0075 3/3, 0076 0/2 y huella igual [V] |
| Rollback conserva XP, cartas y créditos · rollback repetido rechazado · restaurar no duplica | **visto en la salida de la ejecución de esta sesión (`REHEARSAL_OK`), pero el guion no la guardó en fichero**: no queda artefacto en disco para estos tres pasos. Lo mismo lo prueban en QA `team-collections-0075.sh rollback/restore` (sesión anterior) |
| Comando de vuelta | `bin/deploy.sh --activate drl-0.1.1-1-4b1f4c01`: el código exige `releases/<rel>/.next/BUILD_ID`, que existe y vale `drl-0.1.1-1-4b1f4c01` [V]. Compatible con 0075/0076 puestas: `grep` en `releases/drl-0.1.1-1-4b1f4c01/src` de sus tablas y funciones → 0 ficheros [V] |
| Copia de seguridad | `pre-0075-0076-audit/20261014T124558Z`: `SHA256SUMS` OK hoy; simulacro de restauración DRILL_OK [V] |

No se ha vuelto a ensayar nada: las evidencias bastan y el ensayo cuesta un contenedor de producción.

### Logos y ruta antigua
- Los 16 logos que faltan no retrasan la publicación: el escudo con la etiqueta y el color de la región es el fallback
  probado en QA, y los logos oficiales se suben desde `/admin/teams/<equipo>`. No se ha inventado ninguno.
- `/admin/collection-sets` se mantiene sin cambios. Su ocultación o retirada (y la del reclamo antiguo) va en otra tarea:
  el perfil y los sondeos de salud dependen de `collection_sets`.

### Riesgos residuales
1. Los 7 fallos de la QA autenticada no tienen una pasada verde que los cierre (§13).
2. Rollback/restauración de 0075/0076 sobre la copia de producción: resultado visto, sin log guardado.
3. Aviso de XP en francés y japonés: verificado por prueba unitaria, no por captura.
4. Los de §10 (liquidación solo cuando el jugador usa la app; sin temporada activa hasta el 30/11; logos; ruta antigua).

### Despliegue y vuelta (sin ejecutar)
Igual que §9 con `REL=drl-0.1.1-1-d523a42a`: backup → simulacro → `_collections-apply-0075-0076.sh precheck · ensayo ·
aplicar-0075 · verificar · aplicar-0076 · verificar` → `cp` del tar a `incoming/` → `bin/deploy.sh drl-0.1.1-1-d523a42a` →
humo y logs. Vuelta: `bin/deploy.sh --activate drl-0.1.1-1-4b1f4c01`; el esquema no hace falta tocarlo.

### Confirmación
No se ha desplegado, no se ha hecho push, no se ha aplicado ninguna migración en producción, no se ha reiniciado nada allí
(`valorosters-app` arrancado desde el 13/10 16:38, 0 reinicios; `current` → `drl-0.1.1-1-4b1f4c01`; nada nuevo en
`incoming/`) y no se ha modificado ningún dato real ni borrado ningún registro de auditoría. No se han reiniciado las seis
esperas detenidas por falta de memoria.

## 14. Despliegue en producción (2026-10-14, autorizado por el propietario)

**Versión anterior**: `drl-0.1.1-1-4b1f4c01` · **versión activa ahora**: `drl-0.1.1-1-d523a42a` (`current` y `.next/BUILD_ID`
comprobados). Artefacto: sha256 `4acdf145c568514b1386692d9ff56bb9cc619f79d6fa2a540d69726132fa2df6` (`sha256sum -c` OK en
`rc/` y otra vez en `incoming/`). Registros completos en `logs/team-collections/deploy-2026-10-14/` (sin secretos).
Todo lo de esta sección se ha comprobado **directamente en producción** salvo lo marcado [QA].

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Comprobaciones previas | 16:36 | `current` = `4b1f4c01`; app healthy, `/api/ready` ready, túnel y público 200; 302 GB libres; sin otra operación (candado de copias libre, sin build ni QA en marcha); los 151 ficheros del tar = HEAD validado, los 2 retirados ausentes; migraciones del tar = ensayadas (sha) |
| `precheck` | 16:37 | dependencias de 0075/0076 presentes; 0075 0/3 y 0076 0/2; 2 cuentas, 130 cartas, `temporada-2` DRAFT |
| Copia de seguridad | 16:38:43 | `backup-drlcards.sh` → `/opt/nexus/backups/supabase-drlcards/pre-0075-0076-deploy/20261014T163843Z` (BD 2.954.142 B, Storage 0 objetos), `SHA256SUMS` OK, `COMPLETE`. Configuración (`compose.yml`, `secrets/app.env`, `current`) en `pre-0075-0076-deploy-config/20261014T163843Z` con su `SHA256SUMS`, permisos 600/700. Off-site no configurado (no se envió nada). Copias anteriores intactas |
| Copia utilizable | 16:39 | `restore-drill.sh` → DRILL_OK (25 tablas, 0 diferencias, 26 s) |
| Ensayo completo sobre esa copia | 16:39–16:40 | REHEARSAL_OK (`rehearsal.log`): incluye 0076 roto a mitad, funcional con cuentas reales, rollback con datos (XP, cartas y créditos intactos, segundo rollback rechazado) y restauración sin doble cobro |
| `ensayo` en producción | 16:40 | ENSAYO_OK: 0075+0076 en una transacción con ROLLBACK, sin rastro, 17 tablas intactas |
| **0075** | 16:41:05 | APPLY_OK en 188 ms; 0 filas cambiadas; funciones anteriores intactas (237); tablas, RLS sin políticas, permisos y SECURITY DEFINER verificados; `verificar` OK |
| Salud tras 0075 | 16:41 | app vieja healthy, ready 200, público 200, 0 errores |
| **0076** | 16:41:40 | APPLY_OK en 152 ms; 0 filas cambiadas; `verificar` OK (0075 3/3, 0076 2/2) |
| Restricciones de 0076 en producción (lectura) | 16:42 | región limitada a las 4, clave con formato, única e inmutable (la función devuelve TEAM_ID_LOCKED), etiqueta y nombre validados, la función exige `is_admin` y audita; 0 identidades; **0 cartas creadas desde el panel con equipo impreso**: no hay hoy ningún equipo sin identidad que pudiera convertirse en colección |
| **Despliegue** | 16:42:09 → 16:45:46 | `bin/deploy.sh drl-0.1.1-1-d523a42a`: build en contenedor, BUILD_ID = nombre, `ACTIVA drl-0.1.1-1-d523a42a`, `EXIT=0`; solo se recreó `valorosters-app` |

**Errores encontrados**: ninguno del despliegue. En el log de la base aparecen pares `NOT_ADMIN` / `permission denied for
table profiles` cada vez que se consulta `/api/ready`: son la sonda de privacidad (comprueba que anónimo NO puede), ya
estaban el 13/10 y a las 16:36 de hoy antes de tocar nada. No son un fallo.

### Pruebas de humo en producción (sin sesión, sin escribir nada)
- `status.sh`: app healthy (0 reinicios), `current` y BUILD_ID = `d523a42a`, `/api/ready` ready con todas sus
  comprobaciones en verde (incluidas las de perfil 0063, colecciones antiguas 0062 y privacidad 0058), túnel 4 conexiones,
  público 200.
- Páginas 200: `/`, `/coleccion`, `/coleccion/trofeos`, `/coleccion/trofeos/g2`, `/jugador/me`, `/temporada`, `/cuenta`,
  `/admin/teams` (esta última se protege en el cliente; sus datos, abajo).
- Sin sesión → **401**: `GET` y `POST settle` de `/api/game/team-collections`, `GET`/`POST` de `/api/admin/cms/teams`,
  `/api/admin/catalog?view=teams` y `/api/game/player?me=1`.
- Humo de invitado en los **8 idiomas** contra `https://valorosters.com`: **132 PASS · 0 FAIL** (`smoke.log`).
- Logs desde el arranque: 0 errores de la app; 0 errores de la base aparte de la sonda de privacidad.
- Datos: las 25 tablas del recuento del backup, iguales ahora; créditos totales 30.901, 130 cartas; compleciones,
  insignias, identidades y libro de XP de temporada: 0.

### Lo que NO se ha podido probar en producción (pendiente, necesita una sesión real)
No tengo credenciales de las cuentas de producción (ambas son del propietario) y no se crean cuentas ni datos para probar.
Por eso **no están verificados en producción**: iniciar sesión, la pantalla de Colecciones con datos (3 + «Ver más
equipos», detalle, ediciones, insignias), el perfil con insignias, `/admin/teams` con una sesión de administrador y la
liquidación de XP/insignias. Todo eso está probado **solo en QA** sobre este mismo código (§8 y §13). El abono de XP real
tampoco se puede ver hoy: nadie tiene un equipo completo y no hay temporada activa hasta el 30/11.
Comprobación recomendada al propietario: entrar con su cuenta, abrir Colecciones y `/admin/teams`, y revisar luego
`status.sh --logs`.

### Vuelta atrás (no ha hecho falta)
`bin/deploy.sh --activate drl-0.1.1-1-4b1f4c01`: `releases/drl-0.1.1-1-4b1f4c01` sigue con su build; el código anterior no
usa ninguna tabla ni función de 0075/0076, así que no hay que tocar el esquema. No borrar las tablas nuevas ni restaurar la
copia completa salvo pérdida de datos.

### Confirmación
No se ha hecho push (la rama no tiene upstream). No se han publicado los originales de `personajes/` (`a5f5f8f` solo existe
en local). No se ha cambiado ningún saldo, carta, crédito, recompensa, precio ni probabilidad, ni se ha borrado ningún dato,
tabla o registro de auditoría. No se ha tocado ningún otro proyecto ni servicio.

**Versión activa en producción: `drl-0.1.1-1-d523a42a`.**
