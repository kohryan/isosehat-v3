CREATE OR REPLACE TABLE `{{PROJECT_ID}}.{{DATASET}}.boundary_provinsi` AS
SELECT
  nama,
  ST_GEOGFROMTEXT(wkt) AS geom
FROM `{{PROJECT_ID}}.{{DATASET}}.boundary_provinsi_raw`;

CREATE OR REPLACE TABLE `{{PROJECT_ID}}.{{DATASET}}.population_grid` AS
SELECT
  CAST(lon AS FLOAT64) AS lon,
  CAST(lat AS FLOAT64) AS lat,
  CAST(densitas AS FLOAT64) AS densitas,
  ST_GEOGFROMTEXT(wkt) AS geom
FROM `{{PROJECT_ID}}.{{DATASET}}.population_grid_raw`;

CREATE OR REPLACE TABLE `{{PROJECT_ID}}.{{DATASET}}.faskes_aplicares` AS
SELECT
  id,
  nama,
  tipe_kode,
  tipe_label,
  CAST(lat AS FLOAT64) AS lat,
  CAST(lon AS FLOAT64) AS lon,
  ST_GEOGFROMTEXT(wkt_point) AS geom,
  CAST(punya_isochrone AS BOOL) AS punya_isochrone
FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_aplicares_raw`
WHERE wkt_point IS NOT NULL;

CREATE OR REPLACE TABLE `{{PROJECT_ID}}.{{DATASET}}.faskes_isochrone` AS
SELECT
  id,
  nama,
  tipe_kode,
  ST_GEOGFROMTEXT(wkt_polygon) AS geom
FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_isochrone_raw`
WHERE wkt_polygon IS NOT NULL;

CREATE OR REPLACE TABLE `{{PROJECT_ID}}.{{DATASET}}.faskes_master_jatim` AS
SELECT
  jenis,
  nama,
  CAST(lat AS FLOAT64) AS lat,
  CAST(lon AS FLOAT64) AS lon,
  status_verifikasi,
  CAST(jarak_pencocokan_m AS FLOAT64) AS jarak_pencocokan_m,
  ST_GEOGPOINT(CAST(lon AS FLOAT64), CAST(lat AS FLOAT64)) AS geom
FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_master_jatim_raw`
WHERE lat IS NOT NULL AND lon IS NOT NULL;

CREATE OR REPLACE TABLE `{{PROJECT_ID}}.{{DATASET}}.fasilitas_pendukung_jatim` AS
SELECT
  kategori,
  sumber,
  nama,
  detail,
  alamat,
  kecamatan,
  kabupaten,
  CAST(lat AS FLOAT64) AS lat,
  CAST(lon AS FLOAT64) AS lon,
  ST_GEOGPOINT(CAST(lon AS FLOAT64), CAST(lat AS FLOAT64)) AS geom
FROM `{{PROJECT_ID}}.{{DATASET}}.fasilitas_pendukung_jatim_raw`
WHERE lat IS NOT NULL AND lon IS NOT NULL;

CREATE OR REPLACE TABLE `{{PROJECT_ID}}.{{DATASET}}.scenario_flood_zone` AS
SELECT "sby_sidoarjo" AS scenario_id, "Banjir Surabaya–Sidoarjo" AS name, 3 AS severity,
  ST_GEOGFROMTEXT("POLYGON((112.55 -7.55, 112.95 -7.55, 112.95 -7.10, 112.55 -7.10, 112.55 -7.55))") AS geom
UNION ALL
SELECT "malang" AS scenario_id, "Banjir Malang Raya" AS name, 2 AS severity,
  ST_GEOGFROMTEXT("POLYGON((112.30 -8.25, 112.85 -8.25, 112.85 -7.70, 112.30 -7.70, 112.30 -8.25))") AS geom
UNION ALL
SELECT "jember" AS scenario_id, "Banjir Jember" AS name, 2 AS severity,
  ST_GEOGFROMTEXT("POLYGON((113.35 -8.45, 113.95 -8.45, 113.95 -8.00, 113.35 -8.00, 113.35 -8.45))") AS geom
UNION ALL
SELECT "bojonegoro" AS scenario_id, "Banjir Bengawan Solo (Bojonegoro)" AS name, 1 AS severity,
  ST_GEOGFROMTEXT("POLYGON((111.60 -7.35, 112.15 -7.35, 112.15 -6.85, 111.60 -6.85, 111.60 -7.35))") AS geom;
