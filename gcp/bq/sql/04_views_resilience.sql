CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET}}.v_flood_scenarios` AS
SELECT
  scenario_id,
  name,
  severity,
  ST_ASGEOJSON(geom) AS geojson
FROM `{{PROJECT_ID}}.{{DATASET}}.scenario_flood_zone`;

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET}}.v_faskes_unreachable_by_scenario` AS
SELECT
  s.scenario_id,
  r.id,
  r.nama,
  r.tipe_kode,
  r.tipe_label,
  r.lat,
  r.lon,
  r.geom
FROM `{{PROJECT_ID}}.{{DATASET}}.scenario_flood_zone` s
JOIN `{{PROJECT_ID}}.{{DATASET}}.faskes_aplicares` r
ON r.geom IS NOT NULL
WHERE ST_WITHIN(r.geom, s.geom);

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET}}.v_resilience_area_geohash6_all` AS
WITH scenarios AS (
  SELECT scenario_id, severity, geom
  FROM `{{PROJECT_ID}}.{{DATASET}}.scenario_flood_zone`
),
reachable_rs AS (
  SELECT
    s.scenario_id,
    r.id,
    r.geom
  FROM scenarios s
  JOIN `{{PROJECT_ID}}.{{DATASET}}.faskes_aplicares` r
  ON r.tipe_kode = "R" AND r.geom IS NOT NULL
  WHERE NOT ST_WITHIN(r.geom, s.geom)
),
grid AS (
  SELECT densitas, geom, ST_GEOHASH(geom, 6) AS geohash6
  FROM `{{PROJECT_ID}}.{{DATASET}}.population_grid`
  WHERE geom IS NOT NULL
),
grid_nearest AS (
  SELECT
    s.scenario_id,
    s.severity,
    g.geohash6,
    g.densitas,
    (
      SELECT ST_DISTANCE(g.geom, r.geom)
      FROM reachable_rs r
      WHERE r.scenario_id = s.scenario_id
      ORDER BY ST_DISTANCE(g.geom, r.geom)
      LIMIT 1
    ) AS nearest_reachable_rs_distance_m
  FROM scenarios s
  CROSS JOIN grid g
),
grid_scored AS (
  SELECT
    scenario_id,
    severity,
    geohash6,
    densitas,
    nearest_reachable_rs_distance_m,
    nearest_reachable_rs_distance_m / 666.6667 AS nearest_reachable_rs_minutes_proxy
  FROM grid_nearest
)
SELECT
  scenario_id,
  geohash6,
  SUM(densitas) AS pop_proxy,
  SAFE_DIVIDE(
    SUM(IF(nearest_reachable_rs_distance_m IS NULL OR nearest_reachable_rs_minutes_proxy > 60, densitas, 0)),
    SUM(densitas)
  ) AS impacted_pop_ratio_proxy,
  APPROX_QUANTILES(nearest_reachable_rs_minutes_proxy, 100)[OFFSET(95)] AS nearest_reachable_rs_minutes_p95_proxy
FROM grid_scored
GROUP BY 1, 2;

CREATE OR REPLACE VIEW `{{PROJECT_ID}}.{{DATASET}}.v_resilience_area_geohash6` AS
SELECT
  geohash6,
  pop_proxy,
  impacted_pop_ratio_proxy,
  nearest_reachable_rs_minutes_p95_proxy
FROM `{{PROJECT_ID}}.{{DATASET}}.v_resilience_area_geohash6_all`
WHERE scenario_id = "sby_sidoarjo";
