const PRIMARY_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://localhost:8080";
const API_BASES = Array.from(
  new Set([
    PRIMARY_API_BASE,
    "https://isosehat-vertex-api-lmbh2nopoq-et.a.run.app",
    "https://isosehat-vertex-api-803998559535.asia-southeast2.run.app",
  ].filter(Boolean))
);

async function requestJsonWithFallback(path: string, init?: RequestInit) {
  const errors: string[] = [];

  for (const base of API_BASES) {
    try {
      const response = await fetch(`${base}${path}`, init);
      if (!response.ok) {
        const detail = await response.text();
        errors.push(`${base}: ${response.status} ${detail}`);
        continue;
      }
      return await response.json();
    } catch (error) {
      errors.push(`${base}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

export type LocationContext = {
  city: string;
  address: string;
  country: string;
  state: string;
};

export type GeospatialMetricsPayload = {
  coverageConfidence: number;
  servicePressure: number;
  hazardPressure: number;
  supportReadiness: number;
  accessFriction: number;
  resilienceScore: number;
  forecastDemand: number;
  multimodalReach: number;
  networkRedundancy: number;
  referralPressure: number;
  facilityDiversity: number;
  hazardAdjustedDemand: number;
  spatialClusterPressure: number;
};

export type GeostatisticalContextPayload = {
  localDemandIndex: number;
  neighborhoodDemandMean: number;
  demandDelta: number;
  neighborhoodGapShare: number;
  spatialClusterPressure: number;
  clusterType: "underserved_hotspot" | "resilient_cluster" | "isolated_gap" | "balanced_transition";
  neighborCount: number;
};

export type ForecastCandidatePayload = {
  title: string;
  facility_type: "hospital" | "puskesmas" | "clinic";
  priority_score: number;
  rationale: string;
};

export type LocationAnalysisRequest = {
  latitude: number;
  longitude: number;
  population_density: number;
  settlement_profile?: "urban" | "peri-urban" | "rural";
  coverage_status: string;
  hazards: string[];
  nearby_facilities: Array<{ nama: string; tipe_label?: string; distance: number }>;
  location_context?: LocationContext | null;
  geospatial_metrics?: GeospatialMetricsPayload;
  geostatistical_context?: GeostatisticalContextPayload;
  forecast_candidates?: ForecastCandidatePayload[];
};

export type LocationCoverageStatus = "covered" | "watch" | "gap" | "critical";

export type GeospatialInsight = {
  title: string;
  value: string;
  interpretation: string;
};

export type ForecastFacilityInsight = {
  title: string;
  facility_type: "hospital" | "puskesmas" | "clinic";
  priority_score: number;
  rationale: string;
};

export type LocationAnalysisResponse = {
  analysis: string;
  provider?: string;
  errors?: string[];
  strategic_summary?: string;
  coverage_status?: LocationCoverageStatus;
  recommended_facility_type?: "hospital" | "puskesmas" | "clinic" | "none";
  facility_priority_score?: number;
  priority_actions?: string[];
  geospatial_insights?: GeospatialInsight[];
  geostatistical_summary?: string;
  forecast_facilities?: ForecastFacilityInsight[];
};

export async function reverseGeocodeLocation(lat: number, lng: number): Promise<LocationContext | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
    });
    return await requestJsonWithFallback(`/api/location/reverse-geocode?${params.toString()}`);
  } catch (e) {
    console.error("Error fetching location details:", e);
    return null;
  }
}

export async function analyzeLocation(data: LocationAnalysisRequest): Promise<LocationAnalysisResponse | null> {
  try {
    return await requestJsonWithFallback("/api/location/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error("Error calling Vertex AI API:", e);
    return null;
  }
}
