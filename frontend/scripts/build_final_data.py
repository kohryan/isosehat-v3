#!/usr/bin/env python3
import csv
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

try:
    from shapely.geometry import shape, mapping
    SHAPEFILES_AVAILABLE = True
    print("✅ Shapefile libraries available")
except ImportError as e:
    print(f"⚠️ Some libraries not found: {e}")
    SHAPEFILES_AVAILABLE = False


def now_iso() -> str:
    return datetime.now().isoformat()


def generate_isochrone_circle(lat: float, lon: float, radius_km: float, num_points: int = 32) -> List[List[float]]:
    coords = []
    for i in range(num_points):
        angle = 2 * math.pi * i / num_points
        lat_offset = (radius_km / 111.0) * math.cos(angle)
        lon_offset = (radius_km / (111.0 * math.cos(math.radians(lat)))) * math.sin(angle)
        coords.append([lon + lon_offset, lat + lat_offset])
    coords.append(coords[0])
    return coords


def load_geojson(file_path: Path) -> Optional[Dict[str, Any]]:
    try:
        with file_path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️ Failed to load {file_path}: {e}")
        return None


def load_json(file_path: Path) -> Optional[Any]:
    try:
        with file_path.open('r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️ Failed to load {file_path}: {e}")
        return None


def save_csv(file_path: Path, data: List[Dict], fieldnames: List[str]):
    with file_path.open('w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in data:
            # Convert any non-string/number to string
            cleaned_row = {}
            for key, value in row.items():
                if key in fieldnames:
                    if isinstance(value, (list, dict)):
                        cleaned_row[key] = json.dumps(value, ensure_ascii=False)
                    elif value is None:
                        cleaned_row[key] = ""
                    else:
                        cleaned_row[key] = value
            writer.writerow(cleaned_row)


def normalize_isochrone_ring(coords: List[Any]) -> Optional[List[List[float]]]:
    ring: List[List[float]] = []
    for point in coords:
        if not isinstance(point, list) or len(point) < 2:
            continue
        lat, lng = point[0], point[1]
        try:
            ring.append([float(lng), float(lat)])
        except (TypeError, ValueError):
            continue

    if len(ring) < 3:
        return None

    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def load_isochrone_templates(
    data_dir: Path,
    province_boundary: Dict[str, Any]
) -> List[Dict[str, Any]]:
    templates: List[Dict[str, Any]] = []
    boundary_geom = None
    if SHAPEFILES_AVAILABLE:
        try:
            boundary_geom = shape(province_boundary["geometry"])
        except Exception as e:
            print(f"⚠️ Failed to build province boundary geometry for clipping: {e}")

    profile_configs = [
        ("driving-car--10m.json", "driving-car-10m", "Driving 10 menit", "driving", 10),
        ("driving-car--20m.json", "driving-car-20m", "Driving 20 menit", "driving", 20),
        ("cycling-road--10m.json", "cycling-road-10m", "Cycling 10 menit", "cycling", 10),
        ("cycling-road--20m.json", "cycling-road-20m", "Cycling 20 menit", "cycling", 20),
    ]

    print(f"\n6. Loading isochrone templates clipped to Jawa Timur...")
    for filename, profile_id, label, mode, minutes in profile_configs:
        src_path = data_dir / filename
        raw_items = load_json(src_path)
        if not isinstance(raw_items, list):
            print(f"   ⚠️ Skipping {filename}: invalid JSON structure")
            continue

        kept_count = 0
        for idx, item in enumerate(raw_items):
            if item.get("prov") != "Jawa Timur":
                continue

            ring = normalize_isochrone_ring(item.get("isochrone", []))
            if not ring:
                continue

            geometry: Dict[str, Any] = {
                "type": "Polygon",
                "coordinates": [ring]
            }

            if boundary_geom is not None:
                try:
                    geom = shape(geometry)
                    if not geom.is_valid:
                        geom = geom.buffer(0)
                    clipped = geom.intersection(boundary_geom)
                    if clipped.is_empty:
                        continue
                    geometry = mapping(clipped)
                except Exception:
                    # Fallback to filtered-but-unclipped geometry if clipping fails.
                    pass

            try:
                bounds = shape(geometry).bounds
            except Exception:
                continue

            try:
                center_lat = float(item["lat"])
                center_lng = float(item["lng"])
            except (KeyError, TypeError, ValueError):
                continue

            templates.append({
                "id": f"{profile_id}-{idx}",
                "profile_id": profile_id,
                "label": label,
                "mode": mode,
                "minutes": minutes,
                "lat": center_lat,
                "lng": center_lng,
                "name": item.get("name"),
                "amenity": item.get("amenity"),
                "geometry": geometry,
                "bbox": {
                    "min_lon": bounds[0],
                    "min_lat": bounds[1],
                    "max_lon": bounds[2],
                    "max_lat": bounds[3],
                }
            })
            kept_count += 1

        print(f"   ✅ {label}: {kept_count} template Jawa Timur")

    return templates


def main():
    repo_root = Path(__file__).resolve().parents[2]
    data_dir = repo_root / "data"
    gcp_geojson_dir = repo_root / "gcp" / "geojson"
    output_dir = repo_root / "frontend" / "public" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("=" * 80)
    print("🏥 Building Final Comprehensive Data for Isosehat - Jawa Timur (CSV Optimized)")
    print("=" * 80)
    
    # 0. Load province boundary first
    province_boundary = {
        "type": "Feature",
        "properties": {
            "name": "Jawa Timur",
            "name:id": "Jawa Timur"
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [110.9, -8.8],
                [114.6, -8.8],
                [114.6, -6.9],
                [110.9, -6.9],
                [110.9, -8.8]
            ]]
        }
    }
    
    # Try to use real province boundary
    boundary_path = gcp_geojson_dir / "province-boundary.output.geojson"
    if boundary_path.exists():
        gj = load_geojson(boundary_path)
        if gj and gj.get("features"):
            for feat in gj["features"]:
                name = feat.get("properties", {}).get("name", "").lower()
                if "jawa" in name and "timur" in name:
                    province_boundary = feat
                    print(f"   ✅ Using real Jawa Timur province boundary")
                    break
    
    # 1. Load Healthcare Facilities
    faskes = []
    faskes_path = data_dir / "faskes_aplicares.csv"
    print(f"\n1. Loading healthcare facilities from {faskes_path.name}...")
    with faskes_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            faskes.append({
                "id": row["id"],
                "nama": row["nama"],
                "tipe_kode": row["tipe_kode"],
                "tipe_label": row["tipe_label"],
                "lat": float(row["lat"]),
                "lon": float(row["lon"])
            })
    print(f"   ✅ Loaded {len(faskes)} healthcare facilities")
    
    # 2. Load REAL Population Grid from gcp/geojson/
    population_grid = []
    pop_path = gcp_geojson_dir / "population_grid.csv"
    print(f"\n2. Loading REAL population grid from {pop_path.name}...")
    with pop_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            population_grid.append({
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "densitas": float(row["densitas"])
            })
    print(f"   ✅ Loaded {len(population_grid)} grid points with REAL density data")
    
    # 3. Load REAL Hazard GeoJSONs from gcp/geojson/
    hazard_scenarios: List[Dict[str, Any]] = []
    hazard_files = [
        ("gempa", "Zonasi Gempa Bumi Jawa Timur", "earthquake", gcp_geojson_dir / "hazard_gempa_jatim.geojson"),
        ("tanah_gerak", "Zonasi Tanah Gerak Jawa Timur", "landslide", gcp_geojson_dir / "hazard_tanah_gerak_jatim.geojson"),
    ]
    for hazard_id, hazard_name, hazard_type, hazard_path in hazard_files:
        if hazard_path.exists():
            print(f"\n   Loading hazard {hazard_name}...")
            gj = load_geojson(hazard_path)
            if gj:
                hazard_scenarios.append({
                    "id": hazard_id,
                    "name": hazard_name,
                    "type": hazard_type,
                    "severity": 4 if hazard_type in ("earthquake", "landslide") else 3,
                    "description": f"{hazard_name} di Jawa Timur",
                    "feature": gj
                })
                print(f"   ✅ Loaded {hazard_name} successfully")
    
    print(f"\n3. Total hazard scenarios: {len(hazard_scenarios)}")
    
    # 4. Build grid cells with REAL population data
    print(f"\n4. Building grid cells with real density data...")
    cell_size = 0.0083  # Match the grid spacing in population_grid.csv
    grid_cells: Dict[str, Dict] = {}
    
    # Initialize cells with population density from original population_grid.csv only
    for pop_point in population_grid:
        cell_lat = pop_point["lat"]  # Use exact lat/lon, no rounding!
        cell_lon = pop_point["lon"]
        cell_key = f"{cell_lat:.6f}_{cell_lon:.6f}"
        
        if cell_key not in grid_cells:
            grid_cells[cell_key] = {
                "geohash6": cell_key,
                "lat": cell_lat,
                "lon": cell_lon,
                "pop_proxy": 0.0,
                "puskesmas_count": 0,
                "klinik_count": 0,
                "rs_count": 0,
                "faskes_aplicares_count": 0,
                "nearest_rs_minutes_p95_proxy": None,
                "equity_index_proxy": 0.0,
                "flood_risk": 0.0,
                "earthquake_risk": 0.0,
                "landslide_risk": 0.0
            }
        
        grid_cells[cell_key]["pop_proxy"] += pop_point["densitas"]
    
    # Count facilities in each cell
    for facility in faskes:
        # Find which cell this facility falls into
        # Use same cell size 0.0083 to find the cell
        cell_lat = round(facility["lat"] / cell_size) * cell_size
        cell_lon = round(facility["lon"] / cell_size) * cell_size
        cell_key = f"{cell_lat:.6f}_{cell_lon:.6f}"
        
        # Find the closest area key
        # Let's just find the closest area in grid_cells
        closest_key = None
        min_dist = float("inf")
        for key in grid_cells:
            a_lat, a_lon = map(float, key.split("_"))
            dist = (a_lat - facility["lat"])**2 + (a_lon - facility["lon"])**2
            if dist < min_dist:
                min_dist = dist
                closest_key = key
        
        if closest_key:
            cell = grid_cells[closest_key]
            cell["faskes_aplicares_count"] += 1
            
            if facility["tipe_kode"] == "R":
                cell["rs_count"] += 1
            elif "puskesmas" in facility["tipe_label"].lower() or facility["tipe_kode"] in ("0", "1", "2", "3"):
                cell["puskesmas_count"] += 1
            else:
                cell["klinik_count"] += 1
    
    # Calculate equity metrics and nearest RS proxy
    area_list = list(grid_cells.values())
    for area in area_list:
        total_facilities = area["rs_count"] + area["puskesmas_count"] + area["klinik_count"]
        if area["rs_count"] == 0:
            area["nearest_rs_minutes_p95_proxy"] = 45.0 + (area["pop_proxy"] / 1000.0)
        else:
            area["nearest_rs_minutes_p95_proxy"] = 10.0 + (10.0 / (area["rs_count"] + 1))
        
        if total_facilities == 0:
            area["equity_index_proxy"] = area["pop_proxy"] / 10.0  # Higher priority if no facilities
        else:
            area["equity_index_proxy"] = area["pop_proxy"] / (total_facilities + 1)
    
    print(f"   ✅ Processed {len(area_list)} grid cells")
    
    # Sort for top 5 areas
    top5 = sorted(area_list, key=lambda x: x["equity_index_proxy"], reverse=True)[:5]
    print(f"5. Top 5 high-priority areas identified")
    
    # 6. Generate coverage isochrones for ALL faskes (used for coverage gap)
    print(f"\n6. Generating coverage isochrones for faskes...")
    coverage_isochrones = []
    for f in faskes:
        # Generate 5km isochrone for each faskes
        coverage_isochrones.append({
            "faskes_id": f["id"],
            "faskes_nama": f["nama"],
            "lat": f["lat"],
            "lon": f["lon"],
            "5km": {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [generate_isochrone_circle(f["lat"], f["lon"], 5)]
                },
                "properties": {}
            }
        })
    print(f"   ✅ Generated coverage isochrones for {len(coverage_isochrones)} faskes")

    isochrone_templates = load_isochrone_templates(data_dir, province_boundary)
    
    # 7. Calculate coverage gaps: which grid points are NOT covered by any isochrone
    print(f"\n7. Calculating coverage gaps...")
    for area in area_list:
        # Check if this area is covered by ANY isochrone
        is_covered = False
        for iso in coverage_isochrones:
            # Check if area center is inside isochrone polygon
            # Using simple point-in-polygon check for circles
            dist = ((area["lat"] - iso["lat"])**2 + (area["lon"] - iso["lon"])**2)**0.5
            # 5km isochrone: convert km to degrees (approx 0.0083 degrees per km)
            if dist < 5 * 0.0083:
                is_covered = True
                break
        area["is_covered"] = is_covered
    print(f"   ✅ Calculated coverage gaps")
    
    # 7. Build impacts for each scenario
    impact_by_scenario: Dict[str, List[Dict]] = {}
    print(f"\n7. Calculating impacts for hazard scenarios...")
    for scenario in hazard_scenarios:
        impacts = []
        for area in area_list:
            # Simple impact logic based on scenario type
            requires_attention = False
            impact_ratio = 0.0
            
            if scenario["type"] == "flood":
                if "surabaya" in scenario["id"] and 112.2 < area["lon"] < 113.0 and -7.8 < area["lat"] < -7.0:
                    requires_attention = True
                    impact_ratio = 0.7
                elif "malang" in scenario["id"] and 112.1 < area["lon"] < 112.9 and -8.4 < area["lat"] < -7.7:
                    requires_attention = True
                    impact_ratio = 0.6
            
            impacts.append({
                "geohash6": area["geohash6"],
                "lat": area["lat"],
                "lon": area["lon"],
                "pop_proxy": area["pop_proxy"],
                "impacted_pop_ratio_proxy": impact_ratio,
                "nearest_reachable_rs_minutes_p95_proxy": area["nearest_rs_minutes_p95_proxy"] * (1.5 if requires_attention else 1),
                "requires_attention": requires_attention
            })
        
        impact_by_scenario[scenario["id"]] = impacts
    
    # 8. Save files - optimized CSV format
    print(f"\n8. Saving optimized CSV files...")
    
    # Save boundary as JSON (complex geometry)
    with (output_dir / "boundary.geojson").open("w", encoding="utf-8") as f:
        json.dump(province_boundary, f, ensure_ascii=False)
    
    # Save faskes as CSV
    save_csv(
        output_dir / "faskes.csv",
        faskes,
        ["id", "nama", "tipe_kode", "tipe_label", "lat", "lon"]
    )
    print(f"   ✅ Saved faskes.csv")
    
    # Save areas as CSV
    save_csv(
        output_dir / "areas.csv",
        area_list,
        ["geohash6", "lat", "lon", "pop_proxy", "puskesmas_count", "klinik_count", "rs_count", 
         "faskes_aplicares_count", "nearest_rs_minutes_p95_proxy", "equity_index_proxy", "is_covered"]
    )
    print(f"   ✅ Saved areas.csv ({len(area_list)} rows)")
    
    # Save top5 as CSV
    save_csv(
        output_dir / "top5.csv",
        top5,
        ["geohash6", "lat", "lon", "pop_proxy", "puskesmas_count", "klinik_count", "rs_count", 
         "nearest_rs_minutes_p95_proxy", "equity_index_proxy", "is_covered"]
    )
    print(f"   ✅ Saved top5.csv")
    
    # Save hazard scenarios as JSON (keep GeoJSON features for hazards)
    hazard_scenarios_simplified = []
    for hazard in hazard_scenarios:
        hazard_simplified = {
            "id": hazard["id"],
            "name": hazard["name"],
            "type": hazard["type"],
            "severity": hazard["severity"],
            "description": hazard["description"]
        }
        hazard_scenarios_simplified.append(hazard_simplified)
        
        # Save each hazard feature as separate file
        with (output_dir / f"hazard_{hazard['id']}.geojson").open("w", encoding="utf-8") as f:
            json.dump(hazard["feature"], f, ensure_ascii=False)
        print(f"   ✅ Saved hazard_{hazard['id']}.geojson")
    
    with (output_dir / "hazard_scenarios.json").open("w", encoding="utf-8") as f:
        json.dump(hazard_scenarios_simplified, f, ensure_ascii=False)
    print(f"   ✅ Saved hazard_scenarios.json")
    
    # Save impacts as CSV (one file per hazard)
    for hazard_id, impacts in impact_by_scenario.items():
        save_csv(
            output_dir / f"impact_{hazard_id}.csv",
            impacts,
            ["geohash6", "lat", "lon", "pop_proxy", "impacted_pop_ratio_proxy", 
             "nearest_reachable_rs_minutes_p95_proxy", "requires_attention"]
        )
        print(f"   ✅ Saved impact_{hazard_id}.csv")
    
    # Save isochrone templates as JSON for location-based estimation
    with (output_dir / "isochrones.json").open("w", encoding="utf-8") as f:
        json.dump(isochrone_templates, f, ensure_ascii=False)
    print(f"   ✅ Saved isochrones.json ({len(isochrone_templates)} templates)")
    
    # Save metadata
    metadata = {
        "generated_at": now_iso(),
        "project_id": "isosehat-jatim",
        "dataset": "jawa-timur-real-data",
        "default_hazard_id": hazard_scenarios[0]["id"] if hazard_scenarios else None
    }
    with (output_dir / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False)
    
    print("\n" + "=" * 80)
    print("✅ SUCCESS! Semua data CSV telah dibuat dan disimpan dengan ringkas!")
    print("=" * 80)


if __name__ == "__main__":
    main()
