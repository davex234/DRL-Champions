# I18N + ICON — Activación controlada de `drl-0.1.1-1-24091e6c` (2026-10-12)

Informe de autorización. **No se ha desplegado ni escrito nada en producción.** De producción solo se ha leído
(consultas con `default_transaction_read_only=on`, huellas, estado de contenedores) y se ha tomado un backup, que es una
lectura de la base. Continúa `docs/product/i18n-final-release-2026-10-11.md`.

`VPS` = `nexusadmin@212.95.40.144`. `V` = `/opt/nexus/projects/valorosters`. `QA` = `/opt/nexus/projects/valorosters-i18n-qa`.

## 1. Estado previo (comprobado 2026-10-12 ~10:45–11:10 UTC)

| Comprobación | Resultado |
|---|---|
| Release viva | `current → releases/drl-0.1.1-1-e5db60b6`, `BUILD_ID` igual |
| Salud | `/api/health` 200 y `/api/ready` `ready` (cabeza 0073) por la URL pública y por loopback; contenedor `healthy`, 0 reinicios, 200 MB de 2 GB; túnel con 4 conexiones; 0 errores de servidor en 24 h |
| Candidata | `QA/rc/drl-0.1.1-1-24091e6c.tar`, `sha256sum -c` OK (`c2536469…5510`); no está en `incoming/` |
| Código local = artefacto | 0 ficheros de diferencia |
| Entorno | La RC no usa ninguna variable de entorno nueva y su `package-lock.json` es idéntico al de producción |
| Scripts SQL | Las 8 variantes (receta y pool × ensayo/commit/revert/revert-commit) son idénticas a las ensayadas el 2026-10-11, salvo la fecha de la cabecera. Copia congelada con huellas: `logs/icon-data/activacion/` |
| Datos de producción = base del ensayo | Mismas huellas que el estado inicial del acta: otras recetas, otros pools, 5.027 entradas, vínculos, 331 cartas, versión de distribución 950. Las 4 RPC del pool existen |
| Receta / pool | `pack-champions-icon` 2:1 versión 1, ACTIVE. `pack-icon-single` no existe |
| Inventarios | 0 unidades de `icon`, `icon-single` y `champions`. En todo el juego hay 1 sobre sin abrir (Plata) |
| Operaciones en curso | 2 cuentas (las dos tuyas, admin). Último movimiento de créditos: 2026-10-11 14:06 UTC. Cola PvP vacía. 0 bloqueos y 0 transacciones largas en la base. Sin deploy, backup ni `pg_dump` en marcha |
| Otros proyectos NEXUS | No se tocan: `deploy.sh` solo recrea `valorosters-app` (`--no-deps`). El build usa un contenedor desechable de 8 GB / 6 CPU; el VPS tiene 47 GB disponibles y 312 GB de disco |

Observaciones que no afectan:
- Una partida `DRAFT_GAUNTLET` consta `IN_PROGRESS` desde el 2026-10-01, sin actividad: es una run abandonada.
- `supabase_edge_runtime_*` y `supabase_vector_*` (DRLCards y sportcoach) están en bucle de reinicio desde hace semanas
  (15.000 y 42.000 reinicios). Es anterior y ajeno a esta release; la app no los usa. Conviene mirarlo aparte.
- Las copias siguen siendo solo locales al VPS (off-site sin configurar).

## 2. Backup

**Tomado y verificado hoy**: `/opt/nexus/backups/supabase-drlcards/pre-i18n-icon/20261012T105654Z`
- `BACKUP_OK`, `SHA256SUMS` verificado, marca `COMPLETE`, 2.434 entradas, release `e5db60b6`, sin envío off-site.
- **Prueba de restauración**: restaurado en una base desechable del stack de QA: `pg_restore` salida 0, 0 errores, las
  34 tablas del manifiesto con el mismo recuento, 129 tablas y 236 funciones en `public`, receta 2:1 v1. Base borrada.
- El diario de hoy (04:30) también verifica su sha256.

El manifiesto dice `migrationHeadByState: 0061`: el script solo sabe reconocer hasta 0061. No es un fallo del backup.

En la ventana se toma **otro**, justo antes del primer cambio (paso 1), y se copia al PC.

## 3. Cambios de datos

| | Receta `pack-champions-icon` 2:1 → 3:1 | Pool `pack-icon-single` |
|---|---|---|
| Ensayo transaccional | termina en ROLLBACK | termina en ROLLBACK |
| Idempotencia | «YA APLICADO», no escribe | «YA APLICADO», no escribe |
| Reversión | 3 → 2, versión +1, auditada | desvincula y deja el pool RETIRED |
| Reaplicar tras revertir | sí | sí (reactiva por la RPC oficial) |
| Otras recetas / pools | huella idéntica en los 18 pasos | huella idéntica en los 18 pasos |

Acta: `logs/icon-data/acta-final.txt` (18 pasos, 18 con salida 0). Válida para hoy porque producción no ha cambiado.

Compatibilidad con inventarios:
- Receta: nadie tiene Champions ni ICON sin abrir, así que no hay crafteos a medias. Solo cambia la cantidad exigida.
- Pool: no es necesario para abrir. Un sobre sin pool usa las reglas de su definición en código; así corrió toda la QA.
  El pool lo deja igual que el resto de la línea de cara al panel.
- El id `icon` cambia de producto con el código: hoy es «3 cartas 70 % Prime / 30 % Icon» a 60.000; pasa a «3 ICON» a
  80.000. Las unidades ya poseídas se beneficiarían, pero hay 0.

No se ha ejecutado ningún `--commit`, ni tampoco el ensayo contra producción (es el paso 3 y 6 de la ventana).

## 4. Riesgos

| Riesgo | Probabilidad | Qué lo contiene |
|---|---|---|
| El build falla o su `BUILD_ID` no coincide | baja | `deploy.sh` aborta antes de activar. Producción no se entera |
| 1–3 s de 502 al cambiar de contenedor | segura | Inevitable con un solo contenedor |
| Código nuevo con receta 2:1 (2 Champions, 70.000 → ICON Premium de 80.000) | — | La receta se aplica **antes** del código (§5). Con el código viejo, 3:1 solo encarece un crafteo |
| **Rollback de código con sobres ICON sin abrir** | solo si hay rollback | Ver §6. Ensayado: la release vieja abrió un ICON Premium de 80.000 como 2 Prime + 1 Icon |
| Texto sin traducir en pantallas no revisadas a ojo | media, cosmético | La pasada visual completa es de `b7f0be1e` (5 ficheros de diferencia); el detector es una lista de palabras |
| La apertura real y el WALKOUT no se pueden verificar en producción sin gastar créditos reales | — | Decisión tuya (§7) |
| El build de producción usa otro entorno que el de QA | baja | Misma fuente y mismo `BUILD_ID`; sin variables nuevas |
| Backups solo en el VPS | — | Copia del backup al PC en el paso 1 |

Ventana de mantenimiento: **no hace falta**. No existe un interruptor de compras en caliente y no lo necesita: las dos
únicas cuentas son tuyas. Basta con que no compres ni craftees durante los ~15 minutos de la activación.

## 5. Procedimiento exacto

Cada paso se detiene si el anterior no da lo esperado. Los SQL son los de `logs/icon-data/activacion/` (comprobar antes
`sha256sum -c SHA256SUMS`). `PSQL` = `ssh VPS 'docker exec -i supabase_db_DRLCards psql -U postgres -d postgres -X'`.

**0 · Puerta de entrada** (lectura)
```
ssh VPS 'readlink V/current; cd QA/rc && sha256sum -c drl-0.1.1-1-24091e6c.tar.sha256; V/bin/status.sh'
```
Esperado: `releases/drl-0.1.1-1-e5db60b6`, `OK`, `ready`. Si `current` es otra release, parar: hay que rehacer el overlay.

**1 · Backup fresco y copia fuera del VPS**
```
ssh VPS 'DEST=/opt/nexus/backups/supabase-drlcards/pre-i18n-icon EXPECTED_HEAD=0073_pickems_launch_guard \
  /opt/nexus/projects/supabase-drlcards/backup/bin/backup-drlcards.sh'          # debe acabar en BACKUP_OK
scp -r VPS:/opt/nexus/backups/supabase-drlcards/pre-i18n-icon/<ID> <carpeta del PC fuera del repo>
```

**2 · Foto de inventarios** (lectura; es la referencia T0 del rollback)
```
PSQL -At -c "select now(), pack_id, count(*), coalesce(sum(qty),0) from user_packs where pack_id in ('icon','icon-single','champions') group by 2"
```
Esperado: 0 unidades.

**3 · Receta 3:1** (con el código viejo todavía activo)
```
PSQL < logs/icon-data/activacion/recipe.sql            # ensayo: debe acabar en ROLLBACK con la receta en 2 | 1
PSQL < logs/icon-data/activacion/recipe-commit.sql     # debe acabar en COMMIT con 3 | 2
```

**4 · Código**
```
ssh VPS 'cp QA/rc/drl-0.1.1-1-24091e6c.tar V/incoming/ && cd V/incoming && sha256sum drl-0.1.1-1-24091e6c.tar'   # c2536469…5510
ssh VPS 'V/bin/deploy.sh drl-0.1.1-1-24091e6c'
```
Unos 8 minutos de build con producción sirviendo la release vieja; después 1–3 s de 502. Esperado: `ACTIVA
drl-0.1.1-1-24091e6c` y `/api/ready` en `ready`. Si dice `BUILD FALLIDA` o `BUILD_ID … ≠ …`, no se ha activado nada:
revertir la receta (`recipe-revert-commit.sql`) y parar.

**5 · Salud inmediata**
```
ssh VPS 'V/bin/status.sh --logs'
BASE_URL=https://valorosters.com npm run production:check -- --app --vps
```

**6 · Pool**
```
PSQL < logs/icon-data/activacion/pool.sql              # ensayo: ROLLBACK, sin pool, versión 950
PSQL < logs/icon-data/activacion/pool-commit.sql       # COMMIT: pool ACTIVE/EXPLICIT, 331 entradas, vínculo @100
```

**7 · Comprobaciones posteriores** (§7).

Tiempo en que código y datos no casan: de 3 a 4, código viejo con receta 3:1 (inofensivo). De 4 a 6, código nuevo sin
pool (inofensivo). Nunca código nuevo con receta 2:1.

## 6. Rollback

**Primera opción: corregir hacia delante.** Si la app está sana y el problema es de un texto o una pantalla, se arregla
con otra release. El rollback de código es para una app rota.

**Antes de activar la release nueva o sin sobres ICON vendidos** (lo normal en los primeros minutos):
```
ssh VPS 'V/bin/deploy.sh --activate drl-0.1.1-1-e5db60b6'          # segundos; existe con build
PSQL < logs/icon-data/activacion/recipe-revert-commit.sql          # 3 → 2
PSQL < logs/icon-data/activacion/pool-revert-commit.sql            # desvincula y retira (si se aplicó)
```
Sin migración no hay esquema que deshacer. El idioma guardado es inocuo para la release vieja.

**Con sobres `icon-single` o `icon` sin abrir adquiridos con la release nueva.** Ensayado hoy de extremo a extremo en el
stack de QA con la release vieja construida de verdad (`logs/icon-data/acta-rollback-custodia-2026-10-12.txt`):

| Qué hace la release vieja | Resultado medido |
|---|---|
| `icon-single` en el inventario | Lo tolera: estado 200, páginas sin errores de consola, el sobre no se muestra. Abrirlo o comprarlo da 404 «Sobre no encontrado» y **no consume nada** |
| `icon` (ICON Premium de 80.000) | Lo abre como su producto antiguo: salieron 2 Prime y 1 Icon. **El comprador pierde lo que pagó** |
| Cartas ICON ya abiertas, libro de créditos | Intactos: el catálogo de cartas es el mismo |

Por eso el rollback con sobres vendidos lleva un paso más, **antes** de activar la release vieja:
```
PSQL -v batch=i18n-icon-2026-10 < scripts/_icon-odds/rollback-hold.sql                 # ensayo
PSQL -v batch=i18n-icon-2026-10 -v commit=1 < scripts/_icon-odds/rollback-hold.sql     # custodia
ssh VPS 'V/bin/deploy.sh --activate drl-0.1.1-1-e5db60b6'
PSQL -At -c "select pack_id, sum(qty) from user_packs where pack_id in ('icon','icon-single') and qty>0 group by 1"   # debe salir vacío
```
`rollback-hold.sql` mueve las unidades sin abrir de `icon` e `icon-single` a una tabla de custodia
(`ops_pack_escrow`: mismo usuario, misma cantidad, con RLS y sin permisos de cliente). No borra inventario, no devuelve
créditos, no compensa a nadie y no toca el libro. Es idempotente. Al volver a publicar una release que conozca los dos
sobres:
```
PSQL -v batch=i18n-icon-2026-10 -v commit=1 < scripts/_icon-odds/rollback-release.sql  # devuelve 1:1
```
En el ensayo, los sobres devueltos entregaron lo comprado: 1 ICON y 3 ICON.

Límites del rollback:
- Entre la custodia y la activación de la release vieja pasan segundos sin interruptor de compras. Una compra en ese
  hueco quedaría fuera; la consulta final la detecta (`icon-single` > 0) y se repite la custodia. Un `icon` comprado
  **después** de activar la release vieja es el producto antiguo y no se custodia.
- La custodia crea una tabla nueva en `public`. Es reversible (queda vacía de pendientes), pero es un cambio de esquema
  fuera de migraciones: si se llega a usar, hay que registrarlo.
- La receta y el pool se revierten de forma lógica: versión y auditoría siguen subiendo.
- Restaurar el backup entero es el último recurso y perdería todo lo ocurrido después del paso 1.

## 7. Comprobaciones posteriores

Automáticas, de solo lectura:

| Qué | Cómo | Esperado |
|---|---|---|
| Salud y errores de servidor | `status.sh --logs`, `production:check -- --app --vps` | `ready`, cabeza 0073, sin errores nuevos |
| Tienda en es, en, de, it; precios ICON 30.000 y Premium 80.000 | `ssh VPS 'QA/prod-smoke.sh'` (invitado, sin sesión, sin compras) | 64 PASS · 0 FAIL (validado hoy contra la RC en QA) |
| Receta Champions 3:1 | `PSQL -At -c "select input_qty, version from craft_recipes where id='pack-champions-icon'"` | `3 \| 2` |
| Pool | `PSQL -At -c "select lifecycle from content_pools where id='pack-icon-single'"` | `ACTIVE` |
| Inventarios y saldos sin cambios | la consulta del paso 2 y `select credits from profiles` | igual que antes |

Manuales, con tu cuenta, sin gastar: cambiar de idioma en `/cuenta`, ficha de los dos sobres ICON («Icon guaranteed /
garantiert / garantita»), `/misiones/crafting/sobres` con 3 Champions, y `/admin/walkout` para ver WALKOUT 0.9 en 3D.

**Apertura real de 1 y 3 ICON en producción: no la puedo hacer sin una autorización más.** Exige gastar créditos reales
o conceder sobres a una cuenta real. Las opciones son:
- Darla por cubierta con la QA (misma fuente y `BUILD_ID`; 12 aperturas de `icon-single` y la de `icon` en el ensayo).
- Que la abras tú. Ninguna de tus cuentas llega a 80.000 (tienes 74.960 y 8.711), así que el Premium necesitaría una
  concesión de administrador, que queda auditada.

## 8. ¿Es seguro activar?

**Sí.** Producción está sana y quieta, la candidata es íntegra, los datos coinciden con los del ensayo, hay un backup
que restaura y el rollback está ensayado en sus dos variantes. El riesgo real es bajo porque hoy solo existen tus dos
cuentas y no hay ningún sobre ICON en inventarios.

Autorizaciones que necesito, por separado:
1. Ejecutar los pasos 0–7 de §5 (despliegue de `24091e6c` + `recipe-commit` + `pool-commit` en la base de producción).
2. Cómo verificar la apertura real en producción (§7): con la QA, o con una concesión de sobres a una cuenta tuya.
3. Commit del trabajo local, si lo quieres antes o después.
