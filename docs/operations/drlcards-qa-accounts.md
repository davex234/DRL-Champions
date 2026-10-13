# DRLCards · Cuentas QA y credenciales

F70. Cómo se autentican los scripts de QA sin contraseñas en el código, cómo se reconocen las cuentas QA
en producción y cómo retirarlas antes de exponer la API al público.

## Regla

En el repositorio no hay ninguna contraseña literal. El helper único es `scripts/lib/qaCredentials.ts`:

- `ephemeralQaPassword()`: contraseña aleatoria nueva en cada ejecución (`crypto.randomBytes(18)`, base64url).
  La usan todos los verificadores y los instrumentos `_fase*` que crean su propia cuenta desechable con
  `auth.admin.createUser`. La contraseña no sale del proceso: nadie la conoce después.
- `qaPassword("QA_<ALGO>_PASSWORD")`: lee la contraseña de una cuenta QA que ya existe desde una variable de
  entorno. No tiene valor por defecto. Si falta, falla con `Falta QA_<ALGO>_PASSWORD (credencial QA; …)`.

## Variables de entorno

Hoy **ningún script consume una variable QA**: todos crean su cuenta desechable. Para scripts futuros que
necesiten entrar con una cuenta persistente, se reserva este convenio (en `.env.local`, nunca en el repo):

| Variable | Uso |
|---|---|
| `QA_<PERSONA>_EMAIL` | Email de la cuenta QA persistente (`…@example.invalid`) |
| `QA_<PERSONA>_PASSWORD` | Su contraseña, leída con `qaPassword()` |

Los instrumentos «live» de F61–F69 (`scripts/_fase6x-*`) no llevan credenciales: las leen de ficheros JSON
del scratchpad de la sesión, fuera del repositorio.

## Cómo se reconocen las cuentas QA en producción

- Email en el dominio reservado **`@example.invalid`** (RFC 2606: no puede recibir correo). Es el único
  criterio fiable y el que usan los guards SQL.
- Nombre de usuario de tipo `QA-xxxxxxxx` (prefijo del id) o `qa…`, `loopqa…`, `duelqa…`. Es informativo:
  no sirve como guard.
- Ninguna cuenta QA es admin (`profiles.is_admin = false`). El listado lo comprueba.

## Cuentas que usan los gates finales

No se pueden borrar ni bloquear hasta que pasen los gates finales de F70:

- **QA 8c326e52** (persona B de F61/F66 y E2E local de F35.2) y **QA 1ff2c0ef** (persona A).
- **QA 225e1fce** (persona D de F69, Coach).
- **Cuentas de F63** (onboarding: persona E «Returning» de F68 con historial).
- **9 cuentas `qa-f68-*@example.invalid`** de la beta cerrada (escalera QA: C y E).
- Las 12 cuentas de la conciliación de F69 (`docs/product/fase-69-beta-hardening.md`).

## Procedimiento seguro (después de los gates finales)

1. **Copia de seguridad** (`docs/operations/drlcards-backup-restore.md`).
2. **Listado de solo lectura**: `scripts/ops/qa-accounts.sql` (`begin read only … rollback`). Comprobar que
   `qa_admins = 0` y que el número coincide con lo esperado.
3. **Ensayo**: `scripts/ops/qa-accounts-purge.sql` tal cual. Termina en `ROLLBACK`, así que solo enseña qué
   cuentas tocaría. Guards: solo `@example.invalid`, nunca admin, lista `qa_keep` de excepciones, y aborta si
   el objetivo incluye algo que no sea QA.
4. Elegir la opción:
   - **A · borrado**: `delete from auth.users` arrastra en cascada perfil, cartas, libro mayor y seriales.
   - **B · bloqueo/rotación** (recomendada si hay que conservar historial y escalera): `banned_until =
     'infinity'`, contraseña aleatoria nueva y cierre de sesiones.
5. **Aplicar**: cambiar `ROLLBACK` por `COMMIT` **solo con autorización humana explícita**, por escrito, y
   volver a ejecutar el listado para comprobar el resultado.

Ningún agente ejecuta estos SQL contra la BD de producción por su cuenta.
