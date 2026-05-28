#!/usr/bin/env bash
# apply_updates_example_script.sh — DANGEROUS=OFF BY DEFAULT
# NO EJECUTAR sin revisar update_sql_suggested.sql y backup de public.moobiz_drivers.
set -euo pipefail
echo "DANGEROUS=OFF — descomentar y configurar DATABASE_URL para aplicar updates."
exit 1
# Ejemplo (psql):
# psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
# BEGIN;
# -- UPDATE ...
# COMMIT;
# SQL
