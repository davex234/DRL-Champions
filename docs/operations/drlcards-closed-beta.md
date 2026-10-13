# DRLCards · Beta cerrada

> Estado a 2026-09-27 (F68). **Beta cerrada, sin despliegue público**: la app corre en el PC del operador (`127.0.0.1:3005`) y la base de datos en el VPS, por túnel SSH. Sin dominio, sin HTTPS, sin SMTP real. Ver `drlcards-production.md` para la arquitectura completa.

## 1. Cómo dar acceso a un tester

La app **solo escucha en `127.0.0.1`** (F67, CFG-2). Hoy hay dos formas honestas de que alguien juegue:

1. **En el equipo del operador** (lo que se ha probado en F68): el tester usa un navegador de ese PC y abre `http://localhost:3005`.
2. **Un tester remoto** necesita un acceso privado a ese puerto (por ejemplo, un túnel SSH desde su máquina o una VPN privada). **No está montado**: abrir `next start` a la LAN o a Internet queda fuera de la beta cerrada y depende de los bloqueos públicos (dominio + HTTPS). No se hace sin decisión explícita.

Antes de cada sesión de beta:

```powershell
# túnel a la BD del VPS (proceso independiente)
Start-Process ssh -ArgumentList "-N","-o","ServerAliveInterval=15","-o","ServerAliveCountMax=8","-o","ExitOnForwardFailure=yes","-L","54521:127.0.0.1:54521","-L","54522:127.0.0.1:54522","-i","$env:USERPROFILE\.ssh\id_ed25519","nexusadmin@212.95.40.144" -WindowStyle Hidden
# app (build ya hecha; production:check dice si hay que reconstruir)
npm run start            # = next start -H 127.0.0.1 -p 3005
npm run production:check -- --app --vps   # esperado: solo FAIL backup-offsite
```

## 2. Qué cuenta usar o crear

- **Cada tester crea la suya** en `/cuenta → Registro` (nombre de jugador, correo y contraseña de al menos 8 caracteres). GoTrue tiene **autoconfirmación**: la cuenta queda activa al momento, sin correo.
- Recibe lo mismo que cualquier jugador: 6.000 créditos, 3 Sobres Iniciales y 1 Sobre Bronce, y la guía de la primera sesión (unos 90 s automatizada; 5–8 min estimados para una persona).
- **No** se reparten créditos, cartas ni sobres a mano. La economía (F57.6) está congelada.
- Las cuentas QA del equipo usan correos `@example.invalid`. Sus credenciales viven fuera del repositorio.
- **Nunca** se usa la cuenta del propietario (prefijo `2f86cbe8`) para pruebas.

## 3. Limitaciones conocidas (díselas al tester)

| Qué | Por qué |
|---|---|
| «Recuperar contraseña» dice «Te enviamos un enlace», pero no llega ningún correo | SMTP = Inbucket (capturador local). Bloqueo público: SMTP real. |
| El Tactical Coach enseña créditos/nivel tras un partido que **desaparecen** al recargar | P1 conocido (F68-010): la recompensa del Coach solo existe en el navegador. Pendiente de una decisión de economía. **No es un fallo de tu cuenta.** |
| En `/cuenta` aparece un rango tipo «Bronce I» y en Competitivo una escalera con Elo | Son dos sistemas distintos: puntos (duelos y Pick'ems) frente a ranked PvP. Pendiente de decisión de producto (F68-013). |
| Mercado y pagos | Desactivados a propósito. Los precios en euros dicen «Próximamente». |
| Pick'ems | Solo hay predicciones en eventos abiertos. Los resultados los trae el worker del VPS cada 2 min. |
| Una sola instancia | Si el PC del operador se apaga o el túnel se cae, la app deja de responder. |

## 4. Cómo reportar un bug

Usa la plantilla de `drlcards-beta-feedback-template.md` (qué intentabas, qué esperabas, qué pasó, captura, hora y navegador).

El operador lo registra en el formato de `docs/product/qa/fase68-beta/bugs.json`: id, severidad (BLOCKER, CRITICAL, MAJOR, MINOR o POLISH), recorrido, reproducción, esperado, obtenido, evidencia y estado. Para localizar el fallo en el servidor:

- Cada respuesta de `/api` lleva `x-request-id`.
- Los errores 500 enseñan «Código: XXXXXX» (el `errorId` de los logs JSON).

## 5. Qué NO probar en la beta

- Carga o estrés (el techo es el túnel: unas 60 RPS, F67). Tampoco caos de red extremo (eso se hizo en F66).
- `/admin` y cualquier ruta de administración.
- Correo real, dominio o HTTPS (no existen).
- Mercado y pagos (apagados).
- Scripts, SQL o edición directa de la BD para «ayudar» a una cuenta: rompe el libro y el inventario (F68 los concilia).

## 6. Cómo recuperar el servicio

1. `curl http://127.0.0.1:3005/api/health` y `.../api/ready`.
   - `ready` falla en `database` → el túnel está caído: relanzarlo.
2. La app no responde → buscar el proceso real y reiniciarlo:
   ```powershell
   Get-NetTCPConnection -LocalPort 3005 -State Listen | % { Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" } | select ProcessId, CommandLine
   Stop-Process -Id <pid> -Force
   npm run start
   ```
3. Tras un cambio de código: `npm run build`, reiniciar y `npm run production:check -- --app --vps` (BUILD_ID = huella).
4. Humo funcional: `npm run smoke:production` (esperado: 67/67).
5. BD o VPS: `drlcards-backup-restore.md`, `drlcards-disaster-recovery.md`, `drlcards-rollback.md`.

## 7. Cómo detener la beta

1. Parar la app: el proceso real de `:3005` (ver arriba).
2. Cerrar el túnel: `Stop-Process` del `ssh.exe` con `-L 54521…`.
3. Si hace falta cortar el acceso a una cuenta concreta, usar sanciones del Admin Control Center (F58, `/admin`, auditado). Nunca borrar cuentas: rompe el historial, el libro y los seriales.
4. Los datos de la beta se quedan en la BD. Para excluirlos de las métricas: correos `@example.invalid` / `qa%` (ver `docs/product/qa/fase67-production/qa-data.json`).
