import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from google.cloud import bigquery


@dataclass(frozen=True)
class Config:
    project_id: str
    dataset: str
    location: str
    areas_limit: int
    faskes_limit: int


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _feature(geometry: Optional[dict[str, Any]], properties: dict[str, Any]) -> Optional[dict[str, Any]]:
    if geometry is None:
        return None
    return {"type": "Feature", "geometry": geometry, "properties": properties}


def _read_env_config() -> Config:
    project_id = os.environ.get("PROJECT_ID")
    if not project_id:
        raise SystemExit("PROJECT_ID belum diset")
    dataset = os.environ.get("DATASET", "isosehat_jatim")
    location = os.environ.get("BQ_LOCATION", "asia-southeast2")
    areas_limit = int(os.environ.get("AREAS_LIMIT", "3000"))
    faskes_limit = int(os.environ.get("FASKES_LIMIT", "6000"))
    return Config(
        project_id=project_id,
        dataset=dataset,
        location=location,
        areas_limit=areas_limit,
        faskes_limit=faskes_limit,
    )


def _query_one_geojson(client: bigquery.Client, sql: str) -> Optional[dict[str, Any]]:
    rows = list(client.query(sql).result())
    if not rows:
        return None
    v = rows[0].get("geojson")
    if not v:
        return None
    return json.loads(v)


def main() -> None:
    cfg = _read_env_config()
    client = bigquery.Client(project=cfg.project_id, location=cfg.location)

    boundary_geom = _query_one_geojson(
        client,
        f"""
        SELECT ST_ASGEOJSON(geom) AS geojson
        FROM `{cfg.project_id}.{cfg.dataset}.boundary_provinsi`
        LIMIT 1
        """,
    )

    scenarios_sql = f"""
    SELECT
      scenario_id,
      name,
      CAST(severity AS INT64) AS severity,
      geojson
    FROM `{cfg.project_id}.{cfg.dataset}.v_flood_scenarios`
    ORDER BY severity DESC, scenario_id ASC
    """
    scenarios_rows = [dict(r.items()) for r in client.query(scenarios_sql).result()]
    flood_scenarios = []
    for s in scenarios_rows:
        geom = json.loads(s["geojson"]) if s.get("geojson") else None
        if geom is None:
            continue
        flood_scenarios.append(
            {
                "id": s["scenario_id"],
                "name": s["name"],
                "severity": int(s["severity"]),
                "feature": _feature(geom, {"id": s["scenario_id"], "name": s["name"], "severity": int(s["severity"])}),
            }
        )

    default_scenario_id = flood_scenarios[0]["id"] if flood_scenarios else None
    default_flood_feature = None
    if default_scenario_id:
        default_flood_feature = next((x["feature"] for x in flood_scenarios if x["id"] == default_scenario_id), None)

    areas_sql = f"""
    SELECT
      geohash6,
      CAST(pop_proxy AS FLOAT64) AS pop_proxy,
      CAST(puskesmas_count AS INT64) AS puskesmas_count,
      CAST(faskes_aplicares_count AS INT64) AS faskes_aplicares_count,
      CAST(rs_count AS INT64) AS rs_count,
      CAST(rs_iso_coverage_ratio AS FLOAT64) AS rs_iso_coverage_ratio,
      CAST(any_iso_coverage_ratio AS FLOAT64) AS any_iso_coverage_ratio,
      CAST(nearest_rs_minutes_p95_proxy AS FLOAT64) AS nearest_rs_minutes_p95_proxy,
      CAST(equity_index_proxy AS FLOAT64) AS equity_index_proxy
    FROM `{cfg.project_id}.{cfg.dataset}.v_area_metrics_geohash6`
    ORDER BY pop_proxy DESC
    LIMIT @limit
    """
    areas_job = client.query(
        areas_sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("limit", "INT64", cfg.areas_limit)]
        ),
    )
    areas = [dict(r.items()) for r in areas_job.result()]

    top5_sql = f"""
    SELECT
      geohash6,
      CAST(pop_proxy AS FLOAT64) AS pop_proxy,
      CAST(puskesmas_count AS INT64) AS puskesmas_count,
      CAST(faskes_aplicares_count AS INT64) AS faskes_aplicares_count,
      CAST(rs_count AS INT64) AS rs_count,
      CAST(rs_iso_coverage_ratio AS FLOAT64) AS rs_iso_coverage_ratio,
      CAST(any_iso_coverage_ratio AS FLOAT64) AS any_iso_coverage_ratio,
      CAST(nearest_rs_minutes_p95_proxy AS FLOAT64) AS nearest_rs_minutes_p95_proxy,
      CAST(equity_index_proxy AS FLOAT64) AS equity_index_proxy
    FROM `{cfg.project_id}.{cfg.dataset}.v_top5_underserved_geohash6`
    """
    top5 = [dict(r.items()) for r in client.query(top5_sql).result()]

    resilience_all_sql = f"""
    SELECT
      scenario_id,
      geohash6,
      CAST(pop_proxy AS FLOAT64) AS pop_proxy,
      CAST(impacted_pop_ratio_proxy AS FLOAT64) AS impacted_pop_ratio_proxy,
      CAST(nearest_reachable_rs_minutes_p95_proxy AS FLOAT64) AS nearest_reachable_rs_minutes_p95_proxy
    FROM `{cfg.project_id}.{cfg.dataset}.v_resilience_area_geohash6_all`
    QUALIFY ROW_NUMBER() OVER (PARTITION BY scenario_id ORDER BY pop_proxy DESC) <= @limit
    """
    resilience_all_job = client.query(
        resilience_all_sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("limit", "INT64", cfg.areas_limit)]
        ),
    )
    resilience_by_scenario: dict[str, list[dict[str, Any]]] = {}
    for r in resilience_all_job.result():
        row = dict(r.items())
        sid = row.pop("scenario_id")
        resilience_by_scenario.setdefault(sid, []).append(row)

    resilience = []
    if default_scenario_id and default_scenario_id in resilience_by_scenario:
        resilience = resilience_by_scenario[default_scenario_id]

    faskes_sql = f"""
    SELECT
      id,
      nama,
      tipe_kode,
      tipe_label,
      CAST(lat AS FLOAT64) AS lat,
      CAST(lon AS FLOAT64) AS lon
    FROM `{cfg.project_id}.{cfg.dataset}.faskes_aplicares`
    WHERE lat IS NOT NULL AND lon IS NOT NULL
    LIMIT @limit
    """
    faskes_job = client.query(
        faskes_sql,
        job_config=bigquery.QueryJobConfig(
            query_parameters=[bigquery.ScalarQueryParameter("limit", "INT64", cfg.faskes_limit)]
        ),
    )
    faskes = [dict(r.items()) for r in faskes_job.result()]

    repo_root = Path(__file__).resolve().parents[2]
    out_path = repo_root / "frontend" / "public" / "data" / "dashboard.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "generated_at": _now_iso(),
        "project_id": cfg.project_id,
        "dataset": cfg.dataset,
        "boundary": _feature(boundary_geom, {"name": "Jawa Timur"}),
        "flood_zone": default_flood_feature,
        "flood_scenarios": flood_scenarios,
        "resilience_by_scenario": resilience_by_scenario,
        "areas": areas,
        "top5": top5,
        "resilience": resilience,
        "faskes": faskes,
    }

    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
