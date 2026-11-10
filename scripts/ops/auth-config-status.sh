#!/usr/bin/env bash
# F69 · Configuración de correo/callbacks de GoTrue (DRLCards) — SOLO LECTURA, se ejecuta en el VPS por `bash -s`.
# Imprime ÚNICAMENTE claves de una lista blanca sin secretos (nunca contraseñas SMTP, JWT ni claves).
set -u
docker inspect supabase_auth_DRLCards --format '{{range .Config.Env}}{{println .}}{{end}}' </dev/null 2>/dev/null \
  | grep -E '^(GOTRUE_SITE_URL|GOTRUE_URI_ALLOW_LIST|GOTRUE_SMTP_HOST|GOTRUE_SMTP_PORT|GOTRUE_MAILER_AUTOCONFIRM|GOTRUE_DISABLE_SIGNUP|GOTRUE_EXTERNAL_EMAIL_ENABLED)=' \
  || echo "AUTH_CONTAINER_MISSING"
echo "AUTH_STATUS_DONE"
