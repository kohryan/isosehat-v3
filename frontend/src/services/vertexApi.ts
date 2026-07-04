const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://localhost:8080";

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
  forecast_facilities?: ForecastFacilityInsight[];
};

export async function reverseGeocodeLocation(lat: number, lng: number): Promise<LocationContext | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
    });
    const response = await fetch(`${API_BASE}/api/location/reverse-geocode?${params.toString()}`);
    if (!response.ok) throw new Error(`LocationIQ request failed: ${response.status}`);

    return await response.json();
  } catch (e) {
    console.error("Error fetching location details:", e);
    return null;
  }
}

export async function analyzeLocation(data: LocationAnalysisRequest): Promise<LocationAnalysisResponse | null> {
  try {
    const response = await fetch(`${API_BASE}/api/location/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to analyze location: ${response.status} ${detail}`);
    }
    return await response.json();
  } catch (e) {
    console.error("Error calling Vertex AI API:", e);
    return null;
  }
}
