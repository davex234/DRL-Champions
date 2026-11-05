#!/usr/bin/env bash
# ValoRosters · stack de QA aislado (i18n). Se ejecuta EN EL VPS, dentro de su propia carpeta:
#   /opt/nexus/projects/valorosters-i18n-qa/{compose.yml,kong.yml.tpl,up.sh,down.sh,migrations/*.sql}
# No lee ni toca nada de `supabase-drlcards` ni de `valorosters` (producción). Idempotente.
set -euo pipefail
cd "$(dirname "$0")"
[ "$(basename "$PWD")" = "valorosters-i18n-qa" ] || { echo "ABORT: carpeta inesperada $PWD"; exit 2; }
DC="docker compose -p valorosters-i18n-qa"

# 1 · Los puertos de QA no pueden ser de otro proyecto.
for port in 54621 54622; do
  owner=$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E "127\.0\.0\.1:${port}->" | awk '{print $1}' || true)
  if [ -n "$owner" ] && [[ "$owner" != vrqa_* ]]; then echo "ABORT: el puerto $port es de $owner"; exit 2; fi
done

# 2 · Secretos PROPIOS (nunca los de producción), generados una vez.
mkdir -p secrets kong && chmod 700 secrets
if [ ! -s secrets/qa.env ]; then
  b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  jwt() { # $1 rol
    local h p s now exp
    now=$(date +%s); exp=$((now + 60 * 60 * 24 * 30))
    h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
    p=$(printf '{"role":"%s","iss":"valorosters-i18n-qa","iat":%s,"exp":%s}' "$1" "$now" "$exp" | b64)
    s=$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$QA_JWT_SECRET" -binary | b64)
    printf '%s.%s.%s' "$h" "$p" "$s"
  }
  QA_JWT_SECRET=$(openssl rand -hex 32)
  QA_DB_PASSWORD=$(openssl rand -hex 24)
  umask 077
  { echo "QA_JWT_SECRET=$QA_JWT_SECRET"; echo "QA_DB_PASSWORD=$QA_DB_PASSWORD"; echo "QA_ANON_KEY=$(jwt anon)"; echo "QA_SERVICE_KEY=$(jwt service_role)"; } > secrets/qa.env
fi
chmod 600 secrets/qa.env
cp secrets/qa.env .env && chmod 600 .env
set -a; . ./secrets/qa.env; set +a
sed -e "s|__ANON_KEY__|$QA_ANON_KEY|" -e "s|__SERVICE_KEY__|$QA_SERVICE_KEY|" kong.yml.tpl > kong/kong.yml
chmod 644 kong/kong.yml

psql_admin() { docker exec -i -e PGPASSWORD="$QA_DB_PASSWORD" vrqa_db psql -U supabase_admin -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -At "$@"; }
psql_pg()    { docker exec -i -e PGPASSWORD="$QA_DB_PASSWORD" vrqa_db psql -U postgres -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

# 3 · Base de datos. La imagen reinicia Postgres al terminar su init: se espera a 5 conexiones seguidas.
$DC up -d db
ok=0
for i in $(seq 1 120); do
  if docker exec -e PGPASSWORD="$QA_DB_PASSWORD" vrqa_db psql -U supabase_admin -h 127.0.0.1 -d postgres -Atc 'select 1' >/dev/null 2>&1 </dev/null; then ok=$((ok + 1)); else ok=0; fi
  [ "$ok" -ge 5 ] && break
  sleep 2
done
[ "$ok" -ge 5 ] || { echo "ABORT: la base de datos no arranca"; docker logs --tail 40 vrqa_db; exit 3; }

psql_admin <<SQL
alter user postgres with password '$QA_DB_PASSWORD';
alter user authenticator with password '$QA_DB_PASSWORD';
alter user supabase_auth_admin with password '$QA_DB_PASSWORD';
alter user supabase_storage_admin with password '$QA_DB_PASSWORD';
alter database postgres set "app.settings.jwt_secret" to '$QA_JWT_SECRET';
alter database postgres set "app.settings.jwt_exp" to '3600';
SQL

# 4 · Auth y Storage migran SUS esquemas antes de las migraciones de la app (que referencian auth.users y storage.*).
$DC --profile services up -d auth storage
for i in $(seq 1 90); do
  a=$(psql_admin -c "select count(*) from information_schema.columns where table_schema='auth' and table_name='users' and column_name='is_anonymous'" </dev/null || echo 0)
  s=$(psql_admin -c "select count(*) from information_schema.tables where table_schema='storage' and table_name='objects'" </dev/null || echo 0)
  [ "$a" = "1" ] && [ "$s" = "1" ] && break
  sleep 2
done
[ "$a" = "1" ] && [ "$s" = "1" ] || { echo "ABORT: auth=$a storage=$s sin migrar"; docker logs --tail 30 vrqa_auth; docker logs --tail 30 vrqa_storage; exit 4; }
sleep 6 # las últimas migraciones de storage

# 5 · API (antes de las migraciones: la cuenta admin QA se crea por GoTrue).
$DC --profile api up -d rest kong
for i in $(seq 1 60); do
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "apikey: $QA_ANON_KEY" http://127.0.0.1:54621/auth/v1/health || true)
  [ "$code" = "200" ] && break
  sleep 2
done
# Cuentas QA sintéticas (contraseñas generadas aquí; nunca en el repo).
grep -q '^QA_ADMIN_PASSWORD=' secrets/qa.env || { umask 077; { echo "QA_ADMIN_EMAIL=qa-admin-i18n@example.invalid"; echo "QA_ADMIN_PASSWORD=$(openssl rand -hex 12)"; echo "QA_PLAYER_EMAIL=qa-player-i18n@example.invalid"; echo "QA_PLAYER_PASSWORD=$(openssl rand -hex 12)"; } >> secrets/qa.env; cp secrets/qa.env .env; chmod 600 .env; set -a; . ./secrets/qa.env; set +a; }
qa_user() { # $1 correo · $2 contraseña → crea la cuenta por la API de administración de GoTrue (idempotente)
  curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54621/auth/v1/admin/users -H "apikey: $QA_SERVICE_KEY" -H "Authorization: Bearer $QA_SERVICE_KEY" -H 'content-type: application/json' -d "{\"email\":\"$1\",\"password\":\"$2\",\"email_confirm\":true,\"user_metadata\":{\"qa\":true}}"
}

# 6 · Esquema de la app: las migraciones del repo, una por transacción, en orden. Un registro propio evita repetirlas.
psql_pg -c "create table if not exists public._qa_migrations (name text primary key, applied_at timestamptz not null default now())" </dev/null
applied=0
for f in $(ls migrations/*.sql | sort); do
  n=$(basename "$f")
  done_=$(psql_pg -c "select count(*) from public._qa_migrations where name='$n'" </dev/null)
  [ "$done_" = "1" ] && continue
  if [ "$n" = "0067_admin_management.sql" ]; then
    # 0067 exige que exista al menos un administrador: aquí es la cuenta QA sintética (antes de 0067 no hay guardia).
    echo "admin QA: $(qa_user "$QA_ADMIN_EMAIL" "$QA_ADMIN_PASSWORD")"
    psql_pg -c "update public.profiles set is_admin = true where id = (select id from auth.users where email = '$QA_ADMIN_EMAIL')" </dev/null
  fi
  if ! psql_pg -1 -q -f - < "$f" > "logs-$n.txt" 2>&1; then
    echo "MIGRATION_FAILED $n"; tail -15 "logs-$n.txt"; exit 5
  fi
  rm -f "logs-$n.txt"
  psql_pg -c "insert into public._qa_migrations(name) values ('$n')" </dev/null >/dev/null
  applied=$((applied + 1))
done
echo "migraciones aplicadas ahora: $applied · total: $(psql_pg -c 'select count(*) from public._qa_migrations' </dev/null) · cabeza: $(psql_pg -c 'select max(name) from public._qa_migrations' </dev/null)"

echo "jugador QA: $(qa_user "$QA_PLAYER_EMAIL" "$QA_PLAYER_PASSWORD")"
echo "auth/health: $code"
echo "rest: $(curl -s -m 10 -o /dev/null -w '%{http_code}' -H "apikey: $QA_ANON_KEY" -H "Authorization: Bearer $QA_ANON_KEY" http://127.0.0.1:54621/rest/v1/)"
echo "storage: $(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:54621/storage/v1/status)"
echo "tablas public: $(psql_pg -c "select count(*) from information_schema.tables where table_schema='public'" </dev/null) · usuarios: $(psql_admin -c 'select count(*) from auth.users' </dev/null)"
docker ps --format '{{.Names}}\t{{.Status}}' | grep '^vrqa_' | sort
[ "$code" = "200" ] && echo QA_STACK_OK
