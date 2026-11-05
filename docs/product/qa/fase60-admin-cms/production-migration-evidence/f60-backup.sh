set -euo pipefail
D=/opt/nexus/backups/supabase-drlcards/pre-0057
mkdir -p "$D"
cd "$D"
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec supabase_db_DRLCards pg_dump -U postgres -Fc postgres > "full_pre0057_$TS.dump"
docker exec supabase_db_DRLCards pg_dump -U postgres -Fc \
  -t public.agents -t public.assets -t public.content_cards -t public.content_players -t public.events \
  -t public.admin_event_drafts -t public.content_pack_pools -t public.content_pools -t public.content_pool_entries \
  -t public.content_audit_log postgres > "touched_tables_pre0057_$TS.dump"
docker exec supabase_db_DRLCards psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "\copy (select * from public.agents order by id) to stdout with csv header" > "agents_pre0057_$TS.csv"
sha256sum ./*_"$TS".* > "SHA256SUMS_$TS"
echo "== verificación =="
for f in ./*_"$TS".dump; do echo "$f entries=$(docker exec -i supabase_db_DRLCards pg_restore -l < "$f" | grep -vc '^;')"; done
docker exec -i supabase_db_DRLCards pg_restore -l < "touched_tables_pre0057_$TS.dump" | grep -c "TABLE DATA public"
wc -l ./agents_pre0057_"$TS".csv
ls -l "$D"
cat "SHA256SUMS_$TS"
echo "TS=$TS"
