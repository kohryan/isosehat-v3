set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID belum diset}"

DATASET="${DATASET:-isosehat_jatim}"
BQ_LOCATION="${BQ_LOCATION:-asia-southeast2}"

command -v bq >/dev/null 2>&1 || { echo "bq tidak ditemukan (install Google Cloud CLI)"; exit 1; }

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${ROOT_DIR}/data"
SQL_DIR="${ROOT_DIR}/gcp/bq/sql"

ensure_dataset() {
  if ! bq --location="$BQ_LOCATION" show "${PROJECT_ID}:${DATASET}" >/dev/null 2>&1; then
    bq --location="$BQ_LOCATION" mk -d --description "Isosehat Jatim (geospatial AI MVP)" "${PROJECT_ID}:${DATASET}" >/dev/null
  fi
}

ensure_table() {
  local table="$1"
  local schema="$2"
  if ! bq show "${PROJECT_ID}:${DATASET}.${table}" >/dev/null 2>&1; then
    bq mk --table "${PROJECT_ID}:${DATASET}.${table}" "$schema" >/dev/null
  fi
}

load_csv() {
  local table="$1"
  local file="$2"
  local schema="$3"
  bq load \
    --replace \
    --source_format=CSV \
    --skip_leading_rows=1 \
    "${PROJECT_ID}:${DATASET}.${table}" \
    "$file" \
    "$schema" >/dev/null
}

ensure_dataset

ensure_table "boundary_provinsi_raw" "nama:STRING,wkt:STRING"
ensure_table "population_grid_raw" "lon:FLOAT,lat:FLOAT,densitas:FLOAT,wkt:STRING"
ensure_table "faskes_aplicares_raw" "id:STRING,nama:STRING,tipe_kode:STRING,tipe_label:STRING,lat:FLOAT,lon:FLOAT,wkt_point:STRING,punya_isochrone:BOOL"
ensure_table "faskes_isochrone_raw" "id:STRING,nama:STRING,tipe_kode:STRING,wkt_polygon:STRING"
ensure_table "faskes_master_jatim_raw" "jenis:STRING,nama:STRING,lat:FLOAT,lon:FLOAT,status_verifikasi:STRING,jarak_pencocokan_m:FLOAT"
ensure_table "fasilitas_pendukung_jatim_raw" "kategori:STRING,sumber:STRING,nama:STRING,detail:STRING,alamat:STRING,kecamatan:STRING,kabupaten:STRING,lat:FLOAT,lon:FLOAT"

load_csv "boundary_provinsi_raw" "${DATA_DIR}/boundary_provinsi.csv" "nama:STRING,wkt:STRING"
load_csv "population_grid_raw" "${DATA_DIR}/population_grid.csv" "lon:FLOAT,lat:FLOAT,densitas:FLOAT,wkt:STRING"
load_csv "faskes_aplicares_raw" "${DATA_DIR}/faskes_aplicares.csv" "id:STRING,nama:STRING,tipe_kode:STRING,tipe_label:STRING,lat:FLOAT,lon:FLOAT,wkt_point:STRING,punya_isochrone:BOOL"
load_csv "faskes_isochrone_raw" "${DATA_DIR}/faskes_isochrone.csv" "id:STRING,nama:STRING,tipe_kode:STRING,wkt_polygon:STRING"
load_csv "faskes_master_jatim_raw" "${DATA_DIR}/faskes_master_jatim.csv" "jenis:STRING,nama:STRING,lat:FLOAT,lon:FLOAT,status_verifikasi:STRING,jarak_pencocokan_m:FLOAT"
load_csv "fasilitas_pendukung_jatim_raw" "${DATA_DIR}/fasilitas_pendukung_jatim.csv" "kategori:STRING,sumber:STRING,nama:STRING,detail:STRING,alamat:STRING,kecamatan:STRING,kabupaten:STRING,lat:FLOAT,lon:FLOAT"

SQL_BUILD="$(sed "s/{{PROJECT_ID}}/${PROJECT_ID}/g; s/{{DATASET}}/${DATASET}/g" "${SQL_DIR}/02_build_typed_tables.sql")"
SQL_VIEWS_POLICY="$(sed "s/{{PROJECT_ID}}/${PROJECT_ID}/g; s/{{DATASET}}/${DATASET}/g" "${SQL_DIR}/03_views_policy.sql")"
SQL_VIEWS_RESILIENCE="$(sed "s/{{PROJECT_ID}}/${PROJECT_ID}/g; s/{{DATASET}}/${DATASET}/g" "${SQL_DIR}/04_views_resilience.sql")"

bq query --use_legacy_sql=false --quiet "$SQL_BUILD" >/dev/null
bq query --use_legacy_sql=false --quiet "$SQL_VIEWS_POLICY" >/dev/null
bq query --use_legacy_sql=false --quiet "$SQL_VIEWS_RESILIENCE" >/dev/null

echo "OK: BigQuery dataset ${PROJECT_ID}:${DATASET} siap (tables + views)"

