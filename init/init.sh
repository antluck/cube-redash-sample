#!/bin/bash
set -euo pipefail

DB_PATH="${DUCKDB_PATH:-/data/analytics.duckdb}"
RAW_DIR="${MOVIELENS_RAW_DIR:-/data/raw/ml-latest-small}"

# Skip if DuckDB already exists (persisted volume)
if [ -f "$DB_PATH" ]; then
  echo "[init] DuckDB already exists at $DB_PATH — skipping."
  exit 0
fi

mkdir -p "$(dirname "$DB_PATH")"

echo "[init] Downloading MovieLens ml-latest-small..."
mkdir -p "$RAW_DIR"
cd /tmp
curl -fsSL -o ml-latest-small.zip \
  https://files.grouplens.org/datasets/movielens/ml-latest-small.zip
unzip -o ml-latest-small.zip
cp ml-latest-small/*.csv "$RAW_DIR/"

echo "[init] Loading CSVs into DuckDB..."
cd /app
python3 scripts/load_movielens.py

echo "[init] Running dbt transformations..."
cd /app/dbt_project
dbt run --profiles-dir . --project-dir .

echo "[init] Adding CHECKPOINT..."
python3 -c "import duckdb; c=duckdb.connect('$DB_PATH'); c.execute('CHECKPOINT'); c.close()"

echo "[init] Done. DuckDB ready at $DB_PATH"
