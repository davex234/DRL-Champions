# F77 · Auditoría de Auth/SMTP (2026-10-01, antes de cambiar nada)

Estado: **BLOCKED ON MANUAL ACTION — SMTP_PROVIDER_REQUIRED**. No se ha modificado nada.

## Auth (GoTrue `v2.196.0`, contenedor `supabase_auth_DRLCards`)
Configuración en `/opt/nexus/projects/supabase-drlcards/compose.yml`, servicio `auth`.

| Ajuste | Valor actual | Problema |
|---|---|---|
| SMTP | `supabase_inbucket_DRLCards:1025` (Inbucket), remitente `admin@email.com` / `Admin` | **No entrega correo real** |
| `API_EXTERNAL_URL`, `MAILER_URLPATHS_{RECOVERY,CONFIRMATION,INVITE,EMAIL_CHANGE}` | `http://127.0.0.1:54521/auth/v1/verify` | **Los enlaces de correo irían a localhost** |
| `SITE_URL` | `https://valorosters.com` | Correcto |
| `URI_ALLOW_LIST` | `https://valorosters.com`, `https://valorosters.com/**`, `http://127.0.0.1:3005/**` | Sobra el de loopback |
| `MAILER_AUTOCONFIRM` | `true` | Registro sin confirmación de correo |
| `RATE_LIMIT_EMAIL_SENT` | `360000` por hora | **En la práctica, sin límite** |
| `SMTP_MAX_FREQUENCY` | `1s` (frecuencia por usuario) | |
| OTP | 3600 s, 6 dígitos | |
| Cambio de correo seguro | activado | |
| Plantillas | por defecto (sin personalizar; recarga activada) | |
| Contraseña | mínimo 6, sin caracteres exigidos | |
| Reautenticación al cambiar contraseña | `false` | |
| Refresh token | rotación activada (reuso 10 s) | |
| JWT | expira a los 3600 s | |
| CAPTCHA | desactivado | |
| Otros proveedores | OAuth, teléfono y MFA desactivados | |

## App
- `src/lib/supabase/auth.tsx`:
  - `signUp` con `emailRedirectTo=<origin>/cuenta`;
  - `resetPasswordForEmail` con `redirectTo=<origin>/cuenta`;
  - el evento `PASSWORD_RECOVERY` pide la contraseña nueva;
  - `updateUser({password})` la guarda.
- UI en `/cuenta` (`AuthForms.tsx`). No existe una UI de cambio de correo.

## DNS de valorosters.com (Cloudflare: kayden/venus)
| Registro | Estado |
|---|---|
| A | proxied (túnel) |
| MX | **ninguno** |
| TXT / SPF | **ninguno** |
| `_dmarc` | **NXDOMAIN** |
| CAA | ninguno |

Sin acceso API a esta zona: el DNS lo crea el usuario a mano.

## SMTP disponible en la infraestructura
Ninguno: no hay variables SMTP ni de proveedor en los env de los proyectos del VPS. Hotel usa Mailpit (desarrollo).
