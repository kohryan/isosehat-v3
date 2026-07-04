CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET}}.v_grid_nearest_rs` AS
WITH rs AS (
  SELECT id, nama, geom
  FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_aplicares`
  WHERE tipe_kode = "R" AND geom IS NOT NULL
),
grid AS (
  SELECT lon, lat, densitas, geom
  FROM `{{PROJECT_ID}}.{{DATASET}}.population_grid`
  WHERE geom IS NOT NULL
)
SELECT
  g.lon,
  g.lat,
  g.densitas,
  g.geom,
  ST_GEOHASH(g.geom, 6) AS geohash6,
  (
    SELECT AS STRUCT
      r.id AS rs_id,
      r.nama AS rs_nama,
      ST_DISTANCE(g.geom, r.geom) AS distance_m
    FROM rs r
    ORDER BY ST_DISTANCE(g.geom, r.geom)
    LIMIT 1
  ) AS nearest_rs
FROM grid g;

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET}}.v_area_metrics_geohash6` AS
WITH grid_rs AS (
  SELECT
    geohash6,
    densitas,
    geom,
    nearest_rs.distance_m AS nearest_rs_distance_m,
    nearest_rs.distance_m / 666.6667 AS nearest_rs_minutes_proxy
  FROM `{{PROJECT_ID}}.{{DATASET}}.v_grid_nearest_rs`
),
iso_rs AS (
  SELECT geom
  FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_isochrone`
  WHERE tipe_kode = "R"
),
iso_any AS (
  SELECT geom
  FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_isochrone`
),
puskesmas_area AS (
  SELECT
    ST_GEOHASH(geom, 6) AS geohash6,
    COUNT(*) AS puskesmas_count
  FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_master_jatim`
  WHERE LOWER(jenis) = "puskesmas"
  GROUP BY 1
),
aplicares_area AS (
  SELECT
    ST_GEOHASH(geom, 6) AS geohash6,
    COUNT(*) AS faskes_aplicares_count,
    COUNTIF(tipe_kode = "R") AS rs_count
  FROM `{{PROJECT_ID}}.{{DATASET}}.faskes_aplicares`
  GROUP BY 1
),
agg AS (
  SELECT
    geohash6,
    SUM(densitas) AS pop_proxy,
    COUNT(*) AS grid_points,
    SAFE_DIVIDE(
      COUNTIF(EXISTS(SELECT 1 FROM iso_rs i WHERE ST_WITHIN(grid_rs.geom, i.geom))),
      COUNT(*)
    ) AS rs_iso_coverage_ratio,
    SAFE_DIVIDE(
      COUNTIF(EXISTS(SELECT 1 FROM iso_any i WHERE ST_WITHIN(grid_rs.geom, i.geom))),
      COUNT(*)
    ) AS any_iso_coverage_ratio,
    APPROX_QUANTILES(nearest_rs_minutes_proxy, 100)[OFFSET(95)] AS nearest_rs_minutes_p95_proxy
  FROM grid_rs
  GROUP BY 1
)
SELECT
  a.geohash6,
  a.pop_proxy,
  COALESCE(p.puskesmas_count, 0) AS puskesmas_count,
  COALESCE(f.faskes_aplicares_count, 0) AS faskes_aplicares_count,
  COALESCE(f.rs_count, 0) AS rs_count,
  a.rs_iso_coverage_ratio,
  a.any_iso_coverage_ratio,
  a.nearest_rs_minutes_p95_proxy,
  SAFE_DIVIDE(a.pop_proxy, NULLIF(COALESCE(p.puskesmas_count, 0), 0)) * SAFE_DIVIDE(1.0, GREATEST(a.rs_iso_coverage_ratio, 0.05)) AS equity_index_proxy
FROM agg a
LEFT JOIN puskesmas_area p USING (geohash6)
LEFT JOIN aplicares_area f USING (geohash6);

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET}}.v_top5_underserved_geohash6` AS
SELECT *
FROM `{{PROJECT_ID}}.{{DATASET}}.v_area_metrics_geohash6`
WHERE pop_proxy >= 5000
ORDER BY equity_index_proxy DESC
LIMIT 5;

