export interface GeoJsonGeometry {
  type: "Polygon" | "MultiPolygon" | "Point";
  coordinates: any;
}

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry;
  properties: Record<string, any> | null;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface DashboardArea {
  geohash6: string;
  lat: number;
  lon: number;
  pop_proxy: number;
  puskesmas_count: number;
  klinik_count: number;
  rs_count: number;
  faskes_aplicares_count: number;
  rs_iso_coverage_ratio?: number;
  any_iso_coverage_ratio?: number;
  nearest_rs_minutes_p95_proxy: number | null;
  equity_index_proxy: number;
  flood_risk?: number;
  earthquake_risk?: number;
  landslide_risk?: number;
  is_covered: boolean;
}

export interface DashboardImpact {
  geohash6: string;
  lat: number;
  lon: number;
  pop_proxy: number;
  impacted_pop_ratio_proxy: number | null;
  nearest_reachable_rs_minutes_p95_proxy: number | null;
  mitigation_actions: string[];
  requires_attention: boolean;
}

export interface HazardScenario {
  id: string;
  name: string;
  type: "flood" | "earthquake" | "landslide";
  severity: number;
  description: string;
  feature: GeoJsonFeature | GeoJsonFeatureCollection;
}

export interface FaskesPoint {
  id: string;
  nama: string;
  tipe_kode: string;
  tipe_label: string;
  lat: number;
  lon: number;
}

export interface IsochroneData {
  faskes_id: string;
  faskes_nama: string;
  lat: number;
  lon: number;
  "5km": GeoJsonFeature;
  "10km": GeoJsonFeature;
  "15km": GeoJsonFeature;
}

export interface DashboardData {
  generated_at: string;
  project_id: string;
  dataset: string;
  boundary: GeoJsonFeature | null;
  default_hazard: HazardScenario | null;
  hazard_scenarios: HazardScenario[];
  impact_by_scenario: Record<string, DashboardImpact[]>;
  areas: DashboardArea[];
  top5: DashboardArea[];
  impact: DashboardImpact[];
  faskes: FaskesPoint[];
  isochrones: IsochroneData[];
}
