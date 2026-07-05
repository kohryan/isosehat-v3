import { useEffect, useMemo, useRef, useState } from "react";
import { GeoJSON, LayerGroup, MapContainer, Marker, Popup, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import {
  LuActivity,
  LuBrainCircuit,
  LuCircleGauge,
  LuCrosshair,
  LuDatabase,
  LuExternalLink,
  LuInfo,
  LuLayers3,
  LuLocateFixed,
  LuMap,
  LuMapPinned,
  LuNavigation,
  LuOrbit,
  LuPanelRightClose,
  LuRadar,
  LuRoute,
  LuShieldAlert,
  LuShieldCheck,
  LuTrendingUp,
  LuWorkflow,
  LuX,
} from "react-icons/lu";
import { RiGovernmentFill, RiHospitalFill, RiMedicineBottleFill, RiRadarLine } from "react-icons/ri";
import "./leafletIcons";
import {
  clinicIcon,
  getPlannedFacilityPriorityIcon,
  hospitalIcon,
  locationPinIcon,
  puskesmasIcon,
} from "./leafletIcons";
import { colorRampRedWhite8Class } from "./lib/geohash";
import {
  analyzeLocation,
  reverseGeocodeLocation,
  type ForecastCandidatePayload,
  type GeospatialInsight,
  type GeospatialMetricsPayload,
  type LocationAnalysisRequest,
  type LocationAnalysisResponse,
  type LocationContext,
  type LocationCoverageStatus,
} from "./services/vertexApi";
import type { DashboardArea, FaskesPoint, GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonGeometry, HazardScenario } from "./types";

type ClickedLocation = {
  lat: number;
  lng: number;
};

type Facility = {
  id?: string;
  nama: string;
  tipe_kode?: string;
  tipe_label?: string;
  kategori?: string;
  lat: number;
  lon: number;
};

type FacilityWithDistance = Facility & {
  distance: number;
};

type IsochroneTemplate = {
  id: string;
  profile_id: string;
  label: string;
  mode: string;
  minutes: number;
  lat: number;
  lng: number;
  name?: string | null;
  amenity?: string | null;
  geometry: GeoJsonGeometry;
};

type EstimatedIsochrone = {
  profileId: string;
  label: string;
  color: string;
  fillOpacity: number;
  weight: number;
  feature: GeoJsonFeature;
  templateName?: string | null;
  reachableFaskesCount: number;
  reachableSupportCount: number;
  reachablePlannedCount: number;
};

type ForecastFacilityType = "hospital" | "puskesmas" | "clinic";
type SettlementProfile = "urban" | "peri-urban" | "rural";
type BasemapMode = "dark" | "terrain";
type ActiveModal = "about" | "metadata" | null;

type ForecastFacility = {
  id: string;
  title: string;
  facilityType: ForecastFacilityType;
  priorityScore: number;
  rationale: string;
  lat: number;
  lon: number;
  estimatedPopulation: number;
  accessGapMinutes: number;
  settlementProfile: SettlementProfile;
};

type GeospatialMetrics = GeospatialMetricsPayload & {
  nearestHospitalKm: number | null;
};

type CoverageStatus = LocationCoverageStatus;

type AdvancedGeoSignal = {
  id: string;
  title: string;
  value: string;
  description: string;
  tone: "strong" | "moderate" | "weak";
};

type PriorityCellProperties = {
  title: string;
  priorityScore: number;
  facilityType: ForecastFacilityType;
  settlementProfile: SettlementProfile;
  fill: string;
  stroke: string;
};

type FacilityDensityProperties = {
  facilityCount: number;
  fill: string;
  label: string;
};

type AnalysisData = {
  nearbyFaskes: FacilityWithDistance[];
  nearbySupportFacilities: FacilityWithDistance[];
  forecastFacilities: ForecastFacility[];
  populationDensity: number;
  hazards: string[];
  isochroneSummaries: EstimatedIsochrone[];
  activeIsochroneLabel: string;
  coverageStatus: CoverageStatus;
  coverageSource: "local" | "ai";
  geospatialMetrics: GeospatialMetrics;
  advancedSignals: AdvancedGeoSignal[];
  settlementProfile: SettlementProfile;
  prioritySurface: GeoJsonFeatureCollection;
};

const ISOCHRONE_PROFILES = [
  { profileId: "driving-car-10m", label: "Driving 10 min", color: "#38bdf8", fillOpacity: 0.14, weight: 2.6 },
  { profileId: "driving-car-20m", label: "Driving 20 min", color: "#2563eb", fillOpacity: 0.1, weight: 2.3 },
  { profileId: "cycling-road-10m", label: "Motorcycling 10 min", color: "#14b8a6", fillOpacity: 0.12, weight: 2.2 },
  { profileId: "cycling-road-20m", label: "Motorcycling 20 min", color: "#10b981", fillOpacity: 0.08, weight: 2 },
] as const;

const BASEMAP_OPTIONS: Array<{ id: BasemapMode; label: string; detail: string }> = [
  { id: "terrain", label: "Terrain Dark", detail: "dark terrain + hillshade" },
  { id: "dark", label: "Dark Matter", detail: "clean tactical base" },
];

const FACILITY_DENSITY_BANDS = [
  { min: 1, max: 1, label: "1 facility cell", color: "#0f3d5e" },
  { min: 2, max: 2, label: "2 facility cell", color: "#0f766e" },
  { min: 3, max: 4, label: "3-4 facility cell", color: "#0d9488" },
  { min: 5, max: 7, label: "5-7 facility cell", color: "#14b8a6" },
  { min: 8, max: Number.POSITIVE_INFINITY, label: "8+ facility cell", color: "#67e8f9" },
] as const;

const mapCenter: [number, number] = [-7.418, 112.617];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function parseCsvRows<T>(text: string): T[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",");
  return lines
    .slice(1)
    .map((line) => {
      const values = line.split(",");
      const obj: Record<string, any> = {};
      headers.forEach((header, idx) => {
        const raw = values[idx] ?? "";
        const num = Number(raw);
        obj[header] = raw !== "" && Number.isFinite(num) ? num : raw;
      });
      return obj as T;
    })
    .filter((row: any) => {
      if ("lat" in row && "lon" in row) {
        return Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lon));
      }
      return true;
    });
}

function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function translateGeometry(geometry: GeoJsonGeometry, deltaLng: number, deltaLat: number): GeoJsonGeometry {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring: number[][]) =>
        ring.map(([lng, lat]) => [lng + deltaLng, lat + deltaLat])
      ),
    };
  }

  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((polygon: number[][][]) =>
        polygon.map((ring: number[][]) => ring.map(([lng, lat]) => [lng + deltaLng, lat + deltaLat]))
      ),
    };
  }

  return geometry;
}

function isPointInRing(pointLng: number, pointLat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > pointLat !== yj > pointLat &&
      pointLng < ((xj - xi) * (pointLat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInPolygon(pointLat: number, pointLng: number, polygon: number[][][]): boolean {
  if (!polygon.length || !isPointInRing(pointLng, pointLat, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (isPointInRing(pointLng, pointLat, polygon[i])) return false;
  }
  return true;
}

function isPointInGeometry(pointLat: number, pointLng: number, geometry: GeoJsonGeometry): boolean {
  if (geometry.type === "Polygon") {
    return isPointInPolygon(pointLat, pointLng, geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon: number[][][]) => isPointInPolygon(pointLat, pointLng, polygon));
  }
  return false;
}

function translateHazardName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("gempa")) return "Earthquake hazard";
  if (lower.includes("tanah") || lower.includes("gerak")) return "Ground movement hazard";
  if (lower.includes("banjir")) return "Flood hazard";
  return name;
}

function getFeaturesFromGeoJson(data: GeoJsonFeature | GeoJsonFeatureCollection | null | undefined): GeoJsonFeature[] {
  if (!data) return [];
  if (data.type === "FeatureCollection") return data.features ?? [];
  return [data];
}

function getHazardsAtPoint(
  lat: number,
  lng: number,
  hazardScenarios: HazardScenario[],
  hazardFeatures: Record<string, GeoJsonFeature | GeoJsonFeatureCollection>
) {
  const active: string[] = [];
  for (const hazard of hazardScenarios) {
    const candidate = hazardFeatures[hazard.id];
    const matches = getFeaturesFromGeoJson(candidate).some((feature) => isPointInGeometry(lat, lng, feature.geometry));
    if (matches) active.push(translateHazardName(hazard.name));
  }
  return active;
}

function getFacilityTypeLabel(type: ForecastFacilityType | "none") {
  if (type === "hospital") return "Hospital";
  if (type === "puskesmas") return "Puskesmas";
  if (type === "clinic") return "Clinic";
  return "No new facility";
}

function getCoverageMeta(status: CoverageStatus) {
  switch (status) {
    case "critical":
      return { label: "Critical Gap", tone: "critical" };
    case "gap":
      return { label: "Coverage Gap", tone: "gap" };
    case "watch":
      return { label: "Watch Zone", tone: "watch" };
    default:
      return { label: "Covered", tone: "covered" };
  }
}

function classifyFacilityType(facility: Pick<Facility, "tipe_kode" | "tipe_label">): ForecastFacilityType {
  if (facility.tipe_kode === "R" || facility.tipe_label?.toLowerCase().includes("rumah sakit")) return "hospital";
  if (
    (facility.tipe_kode && ["0", "1", "2", "3"].includes(facility.tipe_kode)) ||
    facility.tipe_label?.toLowerCase().includes("puskesmas")
  ) {
    return "puskesmas";
  }
  return "clinic";
}

function getAreaServiceGap(area: DashboardArea) {
  return clamp(
    (area.rs_count === 0 ? 28 : 0) +
      (area.puskesmas_count === 0 ? 20 : 0) +
      (area.klinik_count === 0 ? 10 : 0) +
      (!area.is_covered ? 18 : 0),
    0,
    100
  );
}

function normalizeEquityIndex(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 50;
  return clamp(value <= 1 ? value * 100 : value, 0, 100);
}

function getAreaCellGeometry(lat: number, lon: number): GeoJsonGeometry {
  return {
    type: "Polygon",
    coordinates: [[
      [lon - 0.0041665, lat - 0.0041665],
      [lon + 0.0041665, lat - 0.0041665],
      [lon + 0.0041665, lat + 0.0041665],
      [lon - 0.0041665, lat + 0.0041665],
      [lon - 0.0041665, lat - 0.0041665],
    ]],
  };
}

function getPriorityColor(score: number) {
  if (score >= 85) return "#f97316";
  if (score >= 70) return "#fbbf24";
  if (score >= 55) return "#38bdf8";
  return "#64748b";
}

function getProfileColor(profile: SettlementProfile) {
  if (profile === "urban") return "#c084fc";
  if (profile === "peri-urban") return "#38bdf8";
  return "#34d399";
}

function getFacilityDensityBand(count: number) {
  return FACILITY_DENSITY_BANDS.find((band) => count >= band.min && count <= band.max) ?? FACILITY_DENSITY_BANDS[0];
}

function getSettlementProfileLabel(profile: SettlementProfile) {
  if (profile === "urban") return "Urban";
  if (profile === "peri-urban") return "Peri-urban";
  return "Rural";
}

function getSettlementProfile(
  area: DashboardArea | null,
  nearbyFaskesCount: number,
  nearbySupportCount: number,
  nearestHospitalKm: number | null
): SettlementProfile {
  if (!area) return "peri-urban";

  const urbanSignal =
    (area.pop_proxy >= 2600 ? 1 : 0) +
    (nearbyFaskesCount >= 5 ? 1 : 0) +
    (nearbySupportCount >= 4 ? 1 : 0) +
    ((nearestHospitalKm ?? 99) <= 12 ? 1 : 0);
  if (urbanSignal >= 2) return "urban";

  const periSignal =
    (area.pop_proxy >= 900 ? 1 : 0) +
    (nearbyFaskesCount >= 3 ? 1 : 0) +
    (nearbySupportCount >= 2 ? 1 : 0) +
    ((nearestHospitalKm ?? 99) <= 24 ? 1 : 0);
  if (periSignal >= 1) return "peri-urban";

  return "rural";
}

function getSettlementConfig(profile: SettlementProfile) {
  if (profile === "urban") {
    return {
      criticalConfidence: 32,
      gapConfidence: 41,
      watchReachFloor: 48,
      hospitalDensity: 2400,
      hospitalTravel: 28,
      hospitalHazardDemand: 78,
      puskesmasDensity: 1300,
      puskesmasReachFloor: 50,
      clinicDiversityFloor: 44,
      weights: {
        population: 0.3,
        access: 0.11,
        hazard: 0.15,
        referral: 0.17,
        serviceGap: 0.1,
        multimodal: 0.04,
        redundancy: 0.03,
        equity: 0.1,
        distancePenalty: 0.52,
      },
    };
  }

  if (profile === "rural") {
    return {
      criticalConfidence: 28,
      gapConfidence: 48,
      watchReachFloor: 34,
      hospitalDensity: 4300,
      hospitalTravel: 46,
      hospitalHazardDemand: 72,
      puskesmasDensity: 650,
      puskesmasReachFloor: 34,
      clinicDiversityFloor: 28,
      weights: {
        population: 0.17,
        access: 0.2,
        hazard: 0.2,
        referral: 0.17,
        serviceGap: 0.13,
        multimodal: 0.08,
        redundancy: 0.02,
        equity: 0.03,
        distancePenalty: 0.36,
      },
    };
  }

  return {
    criticalConfidence: 30,
    gapConfidence: 45,
    watchReachFloor: 40,
    hospitalDensity: 3200,
    hospitalTravel: 36,
    hospitalHazardDemand: 74,
    puskesmasDensity: 950,
    puskesmasReachFloor: 42,
    clinicDiversityFloor: 36,
    weights: {
      population: 0.26,
      access: 0.16,
      hazard: 0.18,
      referral: 0.14,
      serviceGap: 0.12,
      multimodal: 0.06,
      redundancy: 0.03,
      equity: 0.05,
      distancePenalty: 0.45,
    },
  };
}

function inferCoverageStatus(area: DashboardArea | null, metrics: GeospatialMetrics, settlementProfile: SettlementProfile): CoverageStatus {
  const config = getSettlementConfig(settlementProfile);
  const areaCovered = Boolean(area?.is_covered);
  if (!areaCovered && metrics.coverageConfidence < config.criticalConfidence && metrics.hazardAdjustedDemand > 64) {
    return "critical";
  }
  if (!areaCovered || metrics.coverageConfidence < config.gapConfidence || metrics.accessFriction > 72 || metrics.referralPressure > 70) {
    return "gap";
  }
  if (
    metrics.servicePressure > 58 ||
    metrics.hazardPressure > 45 ||
    metrics.resilienceScore < 48 ||
    metrics.multimodalReach < config.watchReachFloor
  ) {
    return "watch";
  }
  return "covered";
}

function resolveFacilityType(area: DashboardArea, metrics: GeospatialMetrics, settlementProfile: SettlementProfile): ForecastFacilityType {
  const config = getSettlementConfig(settlementProfile);
  const travelMinutes = area.nearest_rs_minutes_p95_proxy ?? 45;
  if (
    settlementProfile === "urban" &&
    (area.pop_proxy > config.hospitalDensity || metrics.referralPressure > 72 || travelMinutes > config.hospitalTravel)
  ) {
    return "hospital";
  }
  if (
    settlementProfile === "rural" &&
    travelMinutes > config.hospitalTravel &&
    metrics.referralPressure > 74 &&
    metrics.hazardAdjustedDemand > config.hospitalHazardDemand &&
    area.pop_proxy > 1500
  ) {
    return "hospital";
  }
  if (
    (area.pop_proxy > config.hospitalDensity && travelMinutes > config.hospitalTravel) ||
    (metrics.hazardAdjustedDemand > config.hospitalHazardDemand && area.rs_count === 0)
  ) {
    return "hospital";
  }
  if (
    !area.is_covered ||
    area.puskesmas_count === 0 ||
    area.pop_proxy > config.puskesmasDensity ||
    metrics.multimodalReach < config.puskesmasReachFloor
  ) {
    return "puskesmas";
  }
  if (metrics.facilityDiversity < config.clinicDiversityFloor || area.klinik_count === 0) {
    return "clinic";
  }
  return "clinic";
}

function scoreForecastArea(area: DashboardArea, clickedLocation: ClickedLocation, metrics: GeospatialMetrics, settlementProfile: SettlementProfile) {
  const config = getSettlementConfig(settlementProfile);
  const facilityType = resolveFacilityType(area, metrics, settlementProfile);
  const distanceToCell = getDistance(clickedLocation.lat, clickedLocation.lng, area.lat, area.lon);
  const populationScore = clamp((area.pop_proxy / 4500) * 100, 0, 100);
  const accessScore = clamp(((area.nearest_rs_minutes_p95_proxy ?? 40) / 60) * 100, 0, 100);
  const serviceGap = getAreaServiceGap(area);
  const equityScore = normalizeEquityIndex(area.equity_index_proxy);
  const priorityScore = clamp(
    populationScore * config.weights.population +
      accessScore * config.weights.access +
      metrics.hazardAdjustedDemand * config.weights.hazard +
      metrics.referralPressure * config.weights.referral +
      serviceGap * config.weights.serviceGap +
      (100 - metrics.multimodalReach) * config.weights.multimodal +
      (100 - metrics.networkRedundancy) * config.weights.redundancy +
      equityScore * config.weights.equity -
      distanceToCell * config.weights.distancePenalty,
    0,
    100
  );

  return {
    id: `forecast-${area.geohash6}`,
    title: `Planning cell ${area.geohash6.toUpperCase()}`,
    facilityType,
    priorityScore: Math.round(priorityScore),
    rationale: `${getFacilityTypeLabel(facilityType)} is favored for ${getSettlementProfileLabel(settlementProfile).toLowerCase()} conditions by hazard-adjusted demand, referral pressure, multimodal reach, and service gap.`,
    lat: area.lat,
    lon: area.lon,
    estimatedPopulation: Math.round(area.pop_proxy),
    accessGapMinutes: Math.round(area.nearest_rs_minutes_p95_proxy ?? 0),
    settlementProfile,
  };
}

function buildForecastFacilities(
  areas: DashboardArea[],
  clickedLocation: ClickedLocation,
  metrics: GeospatialMetrics,
  settlementProfile: SettlementProfile
): ForecastFacility[] {
  return areas
    .filter((area) => getDistance(clickedLocation.lat, clickedLocation.lng, area.lat, area.lon) <= 18)
    .filter((area) => !area.is_covered || area.pop_proxy > 250)
    .map((area) => scoreForecastArea(area, clickedLocation, metrics, settlementProfile))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 5);
}

function buildPrioritySurface(
  areas: DashboardArea[],
  clickedLocation: ClickedLocation,
  metrics: GeospatialMetrics,
  settlementProfile: SettlementProfile
): GeoJsonFeatureCollection {
  const features = areas
    .filter((area) => getDistance(clickedLocation.lat, clickedLocation.lng, area.lat, area.lon) <= 22)
    .filter((area) => area.pop_proxy > 180 || !area.is_covered)
    .map((area) => {
      const scored = scoreForecastArea(area, clickedLocation, metrics, settlementProfile);
      const fill = getPriorityColor(scored.priorityScore);
      const stroke = getProfileColor(settlementProfile);
      return {
        type: "Feature" as const,
        geometry: getAreaCellGeometry(area.lat, area.lon),
        properties: {
          title: scored.title,
          priorityScore: scored.priorityScore,
          facilityType: scored.facilityType,
          settlementProfile,
          fill,
          stroke,
        } satisfies PriorityCellProperties,
      };
    })
    .sort((a, b) => (b.properties.priorityScore as number) - (a.properties.priorityScore as number))
    .slice(0, 18);

  return {
    type: "FeatureCollection",
    features,
  };
}

function buildGeospatialMetrics(params: {
  area: DashboardArea | null;
  nearbyFaskes: FacilityWithDistance[];
  nearbySupport: FacilityWithDistance[];
  nearestHospital: FacilityWithDistance | null;
  hazards: string[];
  isochroneSummaries: EstimatedIsochrone[];
}): GeospatialMetrics {
  const { area, nearbyFaskes, nearbySupport, nearestHospital, hazards, isochroneSummaries } = params;
  const populationDensity = area?.pop_proxy ?? 0;
  const populationScore = clamp((populationDensity / 4500) * 100, 0, 100);
  const hospitalCount = nearbyFaskes.filter((item) => classifyFacilityType(item) === "hospital").length;
  const distinctTypes = new Set(nearbyFaskes.map((item) => classifyFacilityType(item))).size;
  const driving10 = isochroneSummaries.find((item) => item.profileId === "driving-car-10m");
  const driving20 = isochroneSummaries.find((item) => item.profileId === "driving-car-20m");
  const cycling10 = isochroneSummaries.find((item) => item.profileId === "cycling-road-10m");
  const cycling20 = isochroneSummaries.find((item) => item.profileId === "cycling-road-20m");
  const coverageConfidence = clamp(
    (area?.is_covered ? 35 : 10) +
      nearbyFaskes.length * 9 +
      nearbySupport.length * 4 +
      (nearestHospital ? Math.max(0, 26 - nearestHospital.distance * 2) : 0),
    0,
    100
  );
  const servicePressure = clamp(
    populationScore * 0.58 + (area?.is_covered ? 0 : 24) + Math.max(0, 30 - nearbyFaskes.length * 5),
    0,
    100
  );
  const hazardPressure = clamp(hazards.length * 28 + (area?.is_covered ? 0 : 10), 0, 100);
  const supportReadiness = clamp(
    nearbySupport.length * 11 +
      nearbyFaskes.length * 8 +
      (nearestHospital ? Math.max(0, 25 - nearestHospital.distance * 1.5) : 0),
    0,
    100
  );
  const accessFriction = clamp(
    (area?.nearest_rs_minutes_p95_proxy ? area.nearest_rs_minutes_p95_proxy * 1.6 : 42) +
      (nearestHospital ? nearestHospital.distance * 2.2 : 24),
    0,
    100
  );
  const resilienceScore = clamp(
    100 - hazardPressure * 0.28 - accessFriction * 0.22 - servicePressure * 0.2 + supportReadiness * 0.34,
    0,
    100
  );
  const forecastDemand = clamp(
    servicePressure * 0.44 + (100 - coverageConfidence) * 0.24 + accessFriction * 0.18 + hazardPressure * 0.14,
    0,
    100
  );
  const multimodalReach = clamp(
    ((driving10?.reachableFaskesCount ?? 0) * 1.4 +
      (driving20?.reachableFaskesCount ?? 0) * 1.1 +
      (cycling10?.reachableFaskesCount ?? 0) * 1.2 +
      (cycling20?.reachableFaskesCount ?? 0) * 0.9 +
      (driving20?.reachableSupportCount ?? 0) * 0.35) *
      9,
    0,
    100
  );
  const networkRedundancy = clamp(
    hospitalCount * 24 +
      nearbySupport.length * 6 +
      Math.max(0, nearbyFaskes.length - 1) * 5 +
      (driving20?.reachableFaskesCount ?? 0) * 2,
    0,
    100
  );
  const referralPressure = clamp(
    (area?.nearest_rs_minutes_p95_proxy ?? 42) * 1.05 +
      (nearestHospital ? nearestHospital.distance * 2.8 : 32) +
      Math.max(0, 18 - hospitalCount * 8),
    0,
    100
  );
  const facilityDiversity = clamp(
    (distinctTypes / 3) * 70 + Math.min(nearbySupport.length, 5) * 6 + Math.min(hospitalCount, 2) * 10,
    0,
    100
  );
  const hazardAdjustedDemand = clamp(
    forecastDemand * 0.52 + hazardPressure * 0.22 + referralPressure * 0.18 + (100 - multimodalReach) * 0.08,
    0,
    100
  );
  return {
    coverageConfidence,
    servicePressure,
    hazardPressure,
    supportReadiness,
    accessFriction,
    resilienceScore,
    forecastDemand,
    multimodalReach,
    networkRedundancy,
    referralPressure,
    facilityDiversity,
    hazardAdjustedDemand,
    nearestHospitalKm: nearestHospital?.distance ?? null,
  };
}

function metricTone(value: number, inverse = false) {
  const effective = inverse ? 100 - value : value;
  if (effective >= 70) return "strong";
  if (effective >= 45) return "moderate";
  return "weak";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInlineRichText(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderTextToHtml(raw: string) {
  if (!raw.trim()) return "<p>No AI narrative is available for this selection.</p>";

  const lines = raw.replace(/\r/g, "").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${formatInlineRichText(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul>${listItems.map((item) => `<li>${formatInlineRichText(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(6, Math.max(3, headingMatch[1].length + 2));
      blocks.push(`<h${level}>${formatInlineRichText(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      flushParagraph();
      listItems.push(trimmed.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function buildAdvancedGeoSignals(metrics: GeospatialMetrics): AdvancedGeoSignal[] {
  return [
    {
      id: "multimodal-reach",
      title: "Multimodal reach",
      value: `${formatNumber(metrics.multimodalReach, 0)}/100`,
      description:
        metrics.multimodalReach >= 65
          ? "Driving and cycling channels both maintain workable healthcare reach."
          : metrics.multimodalReach >= 40
            ? "Access is available, but one or more travel modes degrade quickly."
            : "The service catchment collapses across modes and needs closer care capacity.",
      tone: metricTone(metrics.multimodalReach),
    },
    {
      id: "network-redundancy",
      title: "Network redundancy",
      value: `${formatNumber(metrics.networkRedundancy, 0)}/100`,
      description:
        metrics.networkRedundancy >= 65
          ? "The local network has overlap and backup pathways if one node fails."
          : metrics.networkRedundancy >= 40
            ? "Some redundancy exists, but failure at a few nodes could destabilize access."
            : "The local healthcare network is brittle and depends on too few accessible nodes.",
      tone: metricTone(metrics.networkRedundancy),
    },
    {
      id: "referral-pressure",
      title: "Referral pressure",
      value: `${formatNumber(metrics.referralPressure, 0)}/100`,
      description:
        metrics.referralPressure >= 70
          ? "Referral hospitals are strained by distance, time, or thin hospital coverage."
          : metrics.referralPressure >= 45
            ? "Referral pathways are usable, but still create planning friction."
            : "Referral escalation looks relatively stable from the selected point.",
      tone: metricTone(metrics.referralPressure, true),
    },
    {
      id: "facility-diversity",
      title: "Facility diversity",
      value: `${formatNumber(metrics.facilityDiversity, 0)}/100`,
      description:
        metrics.facilityDiversity >= 65
          ? "Primary care, hospital access, and support assets show a balanced local mix."
          : metrics.facilityDiversity >= 40
            ? "The service mix is partial and may miss one layer of care continuity."
            : "The service mix is narrow and likely needs another facility type nearby.",
      tone: metricTone(metrics.facilityDiversity),
    },
    {
      id: "hazard-adjusted-demand",
      title: "Hazard-adjusted demand",
      value: `${formatNumber(metrics.hazardAdjustedDemand, 0)}/100`,
      description:
        metrics.hazardAdjustedDemand >= 70
          ? "Demand and hazard exposure stack together, raising urgency for resilient siting."
          : metrics.hazardAdjustedDemand >= 45
            ? "Demand is meaningful, with hazard exposure still shaping the design requirement."
            : "Demand remains moderate after accounting for hazard and network conditions.",
      tone: metricTone(metrics.hazardAdjustedDemand, true),
    },
  ];
}

export default function App() {
  const [areas, setAreas] = useState<DashboardArea[]>([]);
  const [faskes, setFaskes] = useState<FaskesPoint[]>([]);
  const [supportFacilities, setSupportFacilities] = useState<Facility[]>([]);
  const [isochroneTemplates, setIsochroneTemplates] = useState<IsochroneTemplate[]>([]);
  const [hazardScenarios, setHazardScenarios] = useState<HazardScenario[]>([]);
  const [hazardFeatures, setHazardFeatures] = useState<Record<string, GeoJsonFeature | GeoJsonFeatureCollection>>({});
  const [provinceBoundary, setProvinceBoundary] = useState<GeoJsonFeature | GeoJsonFeatureCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clickedLocation, setClickedLocation] = useState<ClickedLocation | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [locationContext, setLocationContext] = useState<LocationContext | null>(null);
  const [aiInsight, setAiInsight] = useState<LocationAnalysisResponse | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>("terrain");
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);
  const activeRequestRef = useRef(0);

  useEffect(() => {
    Promise.all([
      fetch("/data/boundary.geojson").then((r) => r.json()),
      fetch("/data/faskes.csv").then((r) => r.text()).then(parseCsvRows),
      fetch("/data/areas.csv").then((r) => r.text()).then(parseCsvRows),
      fetch("/data/isochrones.json").then((r) => r.json()),
      fetch("/data/hazard_scenarios.json").then((r) => r.json()),
      fetch("/fasilitas_pendukung_jatim.csv").then((r) => r.text()).then(parseCsvRows),
    ]).then(async ([boundary, faskesData, areasData, isochroneTemplateData, hazardScenariosData, supportData]) => {
      const parsedFaskes = faskesData.map((f: any) => ({ ...f, lat: parseFloat(f.lat), lon: parseFloat(f.lon) }));
      const parsedAreas = areasData.map((a: any) => ({
        ...a,
        lat: parseFloat(a.lat),
        lon: parseFloat(a.lon),
        pop_proxy: parseFloat(a.pop_proxy),
        puskesmas_count: parseInt(a.puskesmas_count),
        klinik_count: parseInt(a.klinik_count),
        rs_count: parseInt(a.rs_count),
        faskes_aplicares_count: parseInt(a.faskes_aplicares_count),
        nearest_rs_minutes_p95_proxy: a.nearest_rs_minutes_p95_proxy ? parseFloat(a.nearest_rs_minutes_p95_proxy) : null,
        equity_index_proxy: parseFloat(a.equity_index_proxy),
        is_covered: a.is_covered === "true" || a.is_covered === true,
      }));

      const parsedSupport = supportData.map((f: any) => ({
        ...f,
        lat: parseFloat(f.lat),
        lon: parseFloat(f.lon),
      }));

      const parsedIsochroneTemplates = (isochroneTemplateData as IsochroneTemplate[]).filter(
        (item: any) => item?.geometry?.type === "Polygon" || item?.geometry?.type === "MultiPolygon"
      );

      const featuresMap: Record<string, GeoJsonFeature | GeoJsonFeatureCollection> = {};
      for (const hazard of hazardScenariosData) {
        try {
          const featureData = await fetch(`/data/hazard_${hazard.id}.geojson`).then((r) => r.json());
          featuresMap[hazard.id] = featureData;
        } catch (error) {
          console.error("Error loading hazard", hazard.id, error);
        }
      }

      setProvinceBoundary(boundary);
      setFaskes(parsedFaskes);
      setAreas(parsedAreas);
      setSupportFacilities(parsedSupport);
      setIsochroneTemplates(parsedIsochroneTemplates);
      setHazardScenarios(hazardScenariosData);
      setHazardFeatures(featuresMap);
      setIsLoading(false);
    });
  }, []);

  const isochroneTemplatesByProfile = useMemo(() => {
    return ISOCHRONE_PROFILES.reduce<Record<string, IsochroneTemplate[]>>((acc, profile) => {
      acc[profile.profileId] = isochroneTemplates.filter((template) => template.profile_id === profile.profileId);
      return acc;
    }, {});
  }, [isochroneTemplates]);

  const visibleAreaFeatureCollection = useMemo(() => {
    if (!areas.length) return { type: "FeatureCollection", features: [] };
    const stats = {
      min: Math.min(...areas.map((a) => a.pop_proxy)),
      max: Math.max(...areas.map((a) => a.pop_proxy)),
    };

    return {
      type: "FeatureCollection",
      features: areas
        .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
        .map((a) => {
          const t = (a.pop_proxy - stats.min) / (stats.max - stats.min || 1);
          return {
            type: "Feature",
            geometry: getAreaCellGeometry(a.lat, a.lon),
            properties: {
              ...a,
              fill: colorRampRedWhite8Class(clamp(t, 0, 1)),
            },
          };
        }),
    };
  }, [areas]);

  const facilityDensityFeatureCollection = useMemo<GeoJsonFeatureCollection>(() => {
    return {
      type: "FeatureCollection",
      features: areas
        .filter((area) => Number.isFinite(area.lat) && Number.isFinite(area.lon) && area.faskes_aplicares_count > 0)
        .map((area) => {
          const band = getFacilityDensityBand(area.faskes_aplicares_count);
          return {
            type: "Feature",
            geometry: getAreaCellGeometry(area.lat, area.lon),
            properties: {
              facilityCount: area.faskes_aplicares_count,
              fill: band.color,
              label: band.label,
            } satisfies FacilityDensityProperties,
          };
        }),
    };
  }, [areas]);

  const activeSelectionKey = clickedLocation ? `${clickedLocation.lat.toFixed(6)}-${clickedLocation.lng.toFixed(6)}` : "none";

  function resetSelection() {
    setClickedLocation(null);
    setAnalysis(null);
    setLocationContext(null);
    setAiInsight(null);
    setIsAiLoading(false);
  }

  async function handleMapClick(e: any) {
    const location = { lat: e.latlng.lat, lng: e.latlng.lng };
    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;

    setClickedLocation(location);
    setLocationContext(null);
    setAiInsight(null);
    setIsAiLoading(false);

    const allFaskesWithDistance: FacilityWithDistance[] = faskes.map((f: any) => ({
      ...f,
      distance: getDistance(location.lat, location.lng, f.lat, f.lon),
    }));
    const allSupportWithDistance: FacilityWithDistance[] = supportFacilities.map((f: any) => ({
      ...f,
      distance: getDistance(location.lat, location.lng, f.lat, f.lon),
    }));

    let nearestArea: DashboardArea | null = null;
    let minDistance = Infinity;
    for (const area of areas) {
      const dist = getDistance(location.lat, location.lng, area.lat, area.lon);
      if (dist < minDistance) {
        minDistance = dist;
        nearestArea = area;
      }
    }

    const hazardsAtLocation = getHazardsAtPoint(location.lat, location.lng, hazardScenarios, hazardFeatures);

    const isochroneSummaries: EstimatedIsochrone[] = ISOCHRONE_PROFILES.map((profile) => {
      const candidates = isochroneTemplatesByProfile[profile.profileId] ?? [];
      if (!candidates.length) return null;

      const nearestTemplate = candidates.reduce((closest, current) => {
        const currentDistance = getDistance(location.lat, location.lng, current.lat, current.lng);
        const closestDistance = getDistance(location.lat, location.lng, closest.lat, closest.lng);
        return currentDistance < closestDistance ? current : closest;
      }, candidates[0]);

      const translatedGeometry = translateGeometry(
        nearestTemplate.geometry,
        location.lng - nearestTemplate.lng,
        location.lat - nearestTemplate.lat
      );

      const feature: GeoJsonFeature = {
        type: "Feature",
        geometry: translatedGeometry,
        properties: {
          profileId: profile.profileId,
          label: profile.label,
          sourceTemplate: nearestTemplate.name ?? null,
        },
      };

      return {
        profileId: profile.profileId,
        label: profile.label,
        color: profile.color,
        fillOpacity: profile.fillOpacity,
        weight: profile.weight,
        feature,
        templateName: nearestTemplate.name ?? null,
        reachableFaskesCount: allFaskesWithDistance.filter((item) => isPointInGeometry(item.lat, item.lon, translatedGeometry)).length,
        reachableSupportCount: allSupportWithDistance.filter((item) => isPointInGeometry(item.lat, item.lon, translatedGeometry)).length,
        reachablePlannedCount: 0,
      };
    }).filter(Boolean) as EstimatedIsochrone[];

    const primaryIsochrone =
      isochroneSummaries.find((item) => item.profileId === "driving-car-20m") ??
      isochroneSummaries.find((item) => item.profileId === "driving-car-10m") ??
      isochroneSummaries[0];

    const nearbyFaskes = primaryIsochrone
      ? allFaskesWithDistance
          .filter((item) => isPointInGeometry(item.lat, item.lon, primaryIsochrone.feature.geometry))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 12)
      : [];

    const nearbySupport = primaryIsochrone
      ? allSupportWithDistance
          .filter((item) => isPointInGeometry(item.lat, item.lon, primaryIsochrone.feature.geometry))
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 10)
      : [];

    const nearestHospital =
      allFaskesWithDistance
        .filter((item) => item.tipe_kode === "R" || item.tipe_label?.toLowerCase().includes("rumah sakit"))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;

    const geospatialMetrics = buildGeospatialMetrics({
      area: nearestArea,
      nearbyFaskes,
      nearbySupport,
      nearestHospital,
      hazards: hazardsAtLocation,
      isochroneSummaries,
    });
    const settlementProfile = getSettlementProfile(
      nearestArea,
      nearbyFaskes.length,
      nearbySupport.length,
      geospatialMetrics.nearestHospitalKm
    );
    const coverageStatus = inferCoverageStatus(nearestArea, geospatialMetrics, settlementProfile);
    const forecastFacilities = buildForecastFacilities(areas, location, geospatialMetrics, settlementProfile);
    const prioritySurface = buildPrioritySurface(areas, location, geospatialMetrics, settlementProfile);
    const updatedIsochrones = isochroneSummaries.map((summary) => ({
      ...summary,
      reachablePlannedCount: forecastFacilities.filter((item) => isPointInGeometry(item.lat, item.lon, summary.feature.geometry)).length,
    }));
    const advancedSignals = buildAdvancedGeoSignals(geospatialMetrics);

    const newAnalysis: AnalysisData = {
      nearbyFaskes,
      nearbySupportFacilities: nearbySupport,
      forecastFacilities,
      populationDensity: nearestArea?.pop_proxy || 0,
      hazards: hazardsAtLocation.length ? hazardsAtLocation : ["No mapped hazard overlap"],
      isochroneSummaries: updatedIsochrones,
      activeIsochroneLabel: primaryIsochrone?.label ?? "Estimated isochrone",
      coverageStatus,
      coverageSource: "local",
      geospatialMetrics,
      advancedSignals,
      settlementProfile,
      prioritySurface,
    };
    setAnalysis(newAnalysis);

    const resolvedLocationContext = await reverseGeocodeLocation(location.lat, location.lng);
    if (requestId !== activeRequestRef.current) return;
    setLocationContext(resolvedLocationContext);

    setIsAiLoading(true);
    const forecastPayload: ForecastCandidatePayload[] = forecastFacilities.slice(0, 3).map((item) => ({
      title: item.title,
      facility_type: item.facilityType,
      priority_score: item.priorityScore,
      rationale: item.rationale,
    }));
    const req: LocationAnalysisRequest = {
      latitude: location.lat,
      longitude: location.lng,
      population_density: newAnalysis.populationDensity,
      settlement_profile: newAnalysis.settlementProfile,
      coverage_status: newAnalysis.coverageStatus,
      hazards: newAnalysis.hazards,
      nearby_facilities: newAnalysis.nearbyFaskes.map((facility) => ({
        nama: facility.nama,
        tipe_label: facility.tipe_label,
        distance: facility.distance,
      })),
      location_context: resolvedLocationContext,
      geospatial_metrics: {
        coverageConfidence: geospatialMetrics.coverageConfidence,
        servicePressure: geospatialMetrics.servicePressure,
        hazardPressure: geospatialMetrics.hazardPressure,
        supportReadiness: geospatialMetrics.supportReadiness,
        accessFriction: geospatialMetrics.accessFriction,
        resilienceScore: geospatialMetrics.resilienceScore,
        forecastDemand: geospatialMetrics.forecastDemand,
        multimodalReach: geospatialMetrics.multimodalReach,
        networkRedundancy: geospatialMetrics.networkRedundancy,
        referralPressure: geospatialMetrics.referralPressure,
        facilityDiversity: geospatialMetrics.facilityDiversity,
        hazardAdjustedDemand: geospatialMetrics.hazardAdjustedDemand,
      },
      forecast_candidates: forecastPayload,
    };

    const response = await analyzeLocation(req);
    if (requestId !== activeRequestRef.current) return;

    setIsAiLoading(false);
    if (!response) {
      setAiInsight({
        analysis: "AI insight is temporarily unavailable. Local geospatial forecasting remains active.",
        provider: "Local fallback",
      });
      return;
    }

    setAiInsight(response);
    setAnalysis((prev) => {
      if (!prev) return prev;
      const aiForecasts = response.forecast_facilities ?? [];
      const mergedForecasts =
        aiForecasts.length > 0
          ? prev.forecastFacilities.map((item, index) => {
              const aiItem = aiForecasts[index];
              if (!aiItem) return item;
              return {
                ...item,
                title: aiItem.title || item.title,
                facilityType: aiItem.facility_type,
                priorityScore: aiItem.priority_score,
                rationale: aiItem.rationale || item.rationale,
              };
            })
          : response.recommended_facility_type && response.recommended_facility_type !== "none"
            ? prev.forecastFacilities.map((item, index) =>
                index === 0
                  ? {
                      ...item,
                      facilityType: response.recommended_facility_type as ForecastFacilityType,
                      priorityScore: Math.max(item.priorityScore, response.facility_priority_score ?? item.priorityScore),
                    }
                  : item
              )
            : prev.forecastFacilities;

      const refreshedIsochrones = prev.isochroneSummaries.map((summary) => ({
        ...summary,
        reachablePlannedCount: mergedForecasts.filter((item) => isPointInGeometry(item.lat, item.lon, summary.feature.geometry)).length,
      }));

      return {
        ...prev,
        coverageStatus: response.coverage_status ?? prev.coverageStatus,
        coverageSource: response.coverage_status ? "ai" : prev.coverageSource,
        forecastFacilities: mergedForecasts,
        isochroneSummaries: refreshedIsochrones,
      };
    });
  }

  function MapClickHandler() {
    useMapEvents({
      click: handleMapClick,
    });
    return null;
  }

  if (isLoading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">
          <div className="loading-card">
            <img src="/isosehat.svg" alt="Isosehat v3" className="loading-logo" />
            <div className="loading-ring" />
            <div className="loading-title">Initializing Geo-Health Command Deck</div>
            <div className="loading-subtitle">Loading East Java population, facilities, hazards, and isochrone channels.</div>
          </div>
        </div>
      </div>
    );
  }

  const coverageMeta = analysis ? getCoverageMeta(analysis.coverageStatus) : null;
  const activeInsights: GeospatialInsight[] = aiInsight?.geospatial_insights ?? [];
  const aiAnalysisHtml = renderTextToHtml(
    isAiLoading
      ? "Generating Gemini planning response with geospatial telemetry."
      : aiInsight?.analysis || "AI insight is waiting for the current selection."
  );
  const aiSummaryHtml = aiInsight?.strategic_summary ? renderTextToHtml(aiInsight.strategic_summary) : "";
  const aiErrorsHtml = aiInsight?.errors?.length ? renderTextToHtml(aiInsight.errors.map((item) => `- ${item}`).join("\n")) : "";

  return (
    <div className="app-shell">
      <div className="map-stage">
        <MapContainer center={mapCenter} zoom={10.5} className="map-canvas" preferCanvas zoomControl={false}>
          <MapClickHandler />
          {basemapMode === "dark" ? (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            />
          ) : (
            <>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO'
                url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
              />
              <TileLayer
                attribution='Tiles &copy; Esri'
                opacity={0.36}
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"
              />
              <TileLayer
                attribution='&copy; CARTO'
                opacity={0.94}
                url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png"
              />
            </>
          )}

          {provinceBoundary && (
            <GeoJSON
              data={provinceBoundary as any}
              pathOptions={{ color: "#7dd3fc", weight: 2.4, fillOpacity: 0, interactive: false }}
            />
          )}

          <GeoJSON
            data={visibleAreaFeatureCollection as any}
            style={(feature: any) => ({
              color: "transparent",
              weight: 0,
              fillColor: feature?.properties?.fill ?? "#ef4444",
              fillOpacity: 0.32,
              opacity: 1,
            })}
            pathOptions={{ renderer: L.canvas() as any, interactive: false }}
          />

          <GeoJSON
            data={facilityDensityFeatureCollection as any}
            style={(feature: any) => ({
              color: "rgba(103, 232, 249, 0.24)",
              weight: 0.35,
              fillColor: feature?.properties?.fill ?? "#14b8a6",
              fillOpacity: 0.28,
              opacity: 0.92,
            })}
            pathOptions={{ renderer: L.canvas() as any, interactive: false }}
          />

          {clickedLocation && analysis && (
            <>
              <GeoJSON
                key={`priority-surface-${activeSelectionKey}`}
                data={analysis.prioritySurface as any}
                style={(feature: any) => ({
                  color: feature?.properties?.stroke ?? "#38bdf8",
                  weight: 1.2,
                  fillColor: feature?.properties?.fill ?? "#38bdf8",
                  fillOpacity: 0.26,
                  dashArray:
                    feature?.properties?.settlementProfile === "urban"
                      ? undefined
                      : feature?.properties?.settlementProfile === "peri-urban"
                        ? "4 4"
                        : "2 6",
                  interactive: false,
                })}
                pathOptions={{ renderer: L.canvas() as any, interactive: false }}
              />

              {analysis.isochroneSummaries.map((summary) => (
                <GeoJSON
                  key={`${summary.profileId}-${activeSelectionKey}`}
                  data={summary.feature as any}
                  pathOptions={{
                    color: summary.color,
                    weight: summary.weight,
                    fillColor: summary.color,
                    fillOpacity: summary.fillOpacity,
                    interactive: false,
                  }}
                />
              ))}

              <LayerGroup>
                {analysis.nearbyFaskes.map((facility) => {
                  let icon = clinicIcon;
                  const facilityType = classifyFacilityType(facility);
                  if (facilityType === "hospital") icon = hospitalIcon;
                  else if (facilityType === "puskesmas") icon = puskesmasIcon;
                  return (
                    <Marker key={facility.id} position={[facility.lat, facility.lon]} icon={icon}>
                      <Popup>
                        <div className="popup-title">{facility.nama}</div>
                        <div className="popup-row">
                          <span className="popup-label">Type</span>
                          <span className="popup-value">{facility.tipe_label || "Healthcare"}</span>
                        </div>
                        <div className="popup-row">
                          <span className="popup-label">Distance</span>
                          <span className="popup-value">{formatNumber(facility.distance, 1)} km</span>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

                {analysis.forecastFacilities.map((facility) => (
                  <Marker
                    key={facility.id}
                    position={[facility.lat, facility.lon]}
                    icon={getPlannedFacilityPriorityIcon(facility.facilityType, facility.priorityScore)}
                  >
                    <Popup>
                      <div className="popup-title">{facility.title}</div>
                      <div className="popup-row">
                        <span className="popup-label">Suggested type</span>
                        <span className="popup-value">{getFacilityTypeLabel(facility.facilityType)}</span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-label">Priority</span>
                        <span className="popup-value">{facility.priorityScore}/100</span>
                      </div>
                      <div className="popup-row">
                        <span className="popup-label">Context</span>
                        <span className="popup-value">{getSettlementProfileLabel(facility.settlementProfile)}</span>
                      </div>
                      <div className="popup-metric">{facility.rationale}</div>
                    </Popup>
                  </Marker>
                ))}
              </LayerGroup>

              <Marker position={[clickedLocation.lat, clickedLocation.lng]} icon={locationPinIcon}>
                <Popup>
                  <div className="popup-title">Analysis Location</div>
                  <div className="popup-row">
                    <span className="popup-label">Lat</span>
                    <span className="popup-value">{formatNumber(clickedLocation.lat, 5)}</span>
                  </div>
                  <div className="popup-row">
                    <span className="popup-label">Lng</span>
                    <span className="popup-value">{formatNumber(clickedLocation.lng, 5)}</span>
                  </div>
                </Popup>
              </Marker>
            </>
          )}
        </MapContainer>

        <div className="hud hud-left">
          <div className="hud-kicker">Geo-Health Command Deck</div>
          <div className="hud-title">Isosehat East Java</div>
          <div className="hud-copy">
            A tactical monitoring interface for healthcare access, resilience, and facility planning across East Java.
          </div>
          <div className="basemap-switch">
            {BASEMAP_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`mode-chip ${basemapMode === option.id ? "active" : ""}`}
                onClick={() => setBasemapMode(option.id)}
              >
                <span>{option.label}</span>
                <small>{option.detail}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="hud hud-right">
          <div className="brand-box">
            <img src="/isosehat.svg" alt="Isosehat v3" className="brand-logo" />
            <div className="brand-menu">
              <button type="button" className="brand-menu-button" onClick={() => setActiveModal("about")}>
                <LuInfo size={14} />
                <span>About</span>
              </button>
              <button type="button" className="brand-menu-button" onClick={() => setActiveModal("metadata")}>
                <LuDatabase size={14} />
                <span>Metadata</span>
              </button>
            </div>
          </div>
        </div>

        <div className="hud hud-bottom">
          <div className="hud-legend">
            <span className="legend-chip"><span className="legend-dot cyan" />Population signal</span>
            <span className="legend-chip"><span className="legend-dot teal" />Healthcare density surface</span>
            <span className="legend-chip"><span className="legend-dot blue" />Driving isochrones</span>
            <span className="legend-chip"><span className="legend-dot green" />Motorcycling isochrones</span>
            <span className="legend-chip"><span className="legend-dot violet" />Priority surface</span>
            <span className="legend-chip"><span className="legend-dot amber" />Forecast facilities</span>
          </div>
        </div>

        <div className="hud hud-density">
          <div className="density-kicker">Healthcare facility density</div>
          <div className="density-title">Initial Healthcare choropleth</div>
          <div className="density-copy">
            Grid cells with registered healthcare facilities are preloaded so dense service clusters are visible before any click analysis.
          </div>
          <div className="density-scale">
            {FACILITY_DENSITY_BANDS.map((band) => (
              <div className="density-row" key={band.label}>
                <span className="density-swatch" style={{ backgroundColor: band.color }} />
                <span>{band.label}</span>
              </div>
            ))}
          </div>
        </div>

        {!clickedLocation && (
          <div className="intro-panel">
            <div className="intro-header">
              <LuRadar size={18} />
              <span>Ready for mission analysis</span>
            </div>
            <h2>Click any map location to open the planning cockpit.</h2>
            <p>
              The system preloads a healthcare-density choropleth, then estimates multimodal isochrones, evaluates hazard
              exposure, scores local service pressure, and generates AI-assisted healthcare facility forecasts.
            </p>
          </div>
        )}
      </div>

      <aside className={`command-panel ${clickedLocation && analysis ? "open" : ""}`}>
        {clickedLocation && analysis && coverageMeta ? (
          <>
            <div className="command-header">
              <div>
                <div className="command-kicker">Pilot View</div>
                <h2>Location Intelligence</h2>
              </div>
              <button className="command-close" onClick={resetSelection} aria-label="Close panel">
                <LuPanelRightClose size={18} />
              </button>
            </div>

            <div className="command-scroll">
              <section className="glass-card hero-card">
                <div className="hero-row">
                  <div>
                    <div className="hero-title">{locationContext?.city || "Resolving location context"}</div>
                    <div className="hero-subtitle">{locationContext?.address || "Reverse geocoding in progress"}</div>
                    <div className={`profile-chip ${analysis.settlementProfile.replace("-", "")}`}>
                      {getSettlementProfileLabel(analysis.settlementProfile)} operating context
                    </div>
                  </div>
                  <div className={`status-pill ${coverageMeta.tone}`}>
                    {coverageMeta.label}
                    <span className="status-source">{analysis.coverageSource === "ai" ? "AI-assisted" : "Local model"}</span>
                  </div>
                </div>

                <div className="hero-metrics">
                  <div className="metric-panel">
                    <div className="metric-panel-label">Population density</div>
                    <div className="metric-panel-value">{formatNumber(analysis.populationDensity, 0)}</div>
                    <div className="metric-panel-unit">people/km²</div>
                  </div>
                  <div className="metric-panel">
                    <div className="metric-panel-label">Priority signal</div>
                    <div className="metric-panel-value">{formatNumber(aiInsight?.facility_priority_score ?? analysis.geospatialMetrics.forecastDemand, 0)}</div>
                    <div className="metric-panel-unit">/ 100</div>
                  </div>
                </div>
              </section>

              <section className="data-grid">
                <div className={`telemetry-card ${metricTone(analysis.geospatialMetrics.servicePressure)}`}>
                  <div className="telemetry-icon"><LuActivity size={16} /></div>
                  <div className="telemetry-label">Service pressure</div>
                  <div className="telemetry-value">{formatNumber(analysis.geospatialMetrics.servicePressure, 0)}</div>
                </div>
                <div className={`telemetry-card ${metricTone(analysis.geospatialMetrics.hazardPressure)}`}>
                  <div className="telemetry-icon"><LuShieldAlert size={16} /></div>
                  <div className="telemetry-label">Hazard pressure</div>
                  <div className="telemetry-value">{formatNumber(analysis.geospatialMetrics.hazardPressure, 0)}</div>
                </div>
                <div className={`telemetry-card ${metricTone(analysis.geospatialMetrics.supportReadiness)}`}>
                  <div className="telemetry-icon"><LuShieldCheck size={16} /></div>
                  <div className="telemetry-label">Support readiness</div>
                  <div className="telemetry-value">{formatNumber(analysis.geospatialMetrics.supportReadiness, 0)}</div>
                </div>
                <div className={`telemetry-card ${metricTone(analysis.geospatialMetrics.resilienceScore)}`}>
                  <div className="telemetry-icon"><LuOrbit size={16} /></div>
                  <div className="telemetry-label">Resilience score</div>
                  <div className="telemetry-value">{formatNumber(analysis.geospatialMetrics.resilienceScore, 0)}</div>
                </div>
                <div className={`telemetry-card ${metricTone(analysis.geospatialMetrics.accessFriction, true)}`}>
                  <div className="telemetry-icon"><LuRoute size={16} /></div>
                  <div className="telemetry-label">Access friction</div>
                  <div className="telemetry-value">{formatNumber(analysis.geospatialMetrics.accessFriction, 0)}</div>
                </div>
                <div className={`telemetry-card ${metricTone(analysis.geospatialMetrics.coverageConfidence)}`}>
                  <div className="telemetry-icon"><LuCircleGauge size={16} /></div>
                  <div className="telemetry-label">Coverage confidence</div>
                  <div className="telemetry-value">{formatNumber(analysis.geospatialMetrics.coverageConfidence, 0)}</div>
                </div>
              </section>

              <section className="glass-card">
                <div className="section-heading">
                  <LuMapPinned size={16} />
                  <h3>Coordinates and context</h3>
                </div>
                <div className="detail-grid">
                  <div className="detail-row"><span>Latitude</span><strong>{formatNumber(clickedLocation.lat, 6)}</strong></div>
                  <div className="detail-row"><span>Longitude</span><strong>{formatNumber(clickedLocation.lng, 6)}</strong></div>
                  <div className="detail-row"><span>State</span><strong>{locationContext?.state || "Loading"}</strong></div>
                  <div className="detail-row"><span>Country</span><strong>{locationContext?.country || "Loading"}</strong></div>
                  <div className="detail-row"><span>Nearest hospital</span><strong>{analysis.geospatialMetrics.nearestHospitalKm !== null ? `${formatNumber(analysis.geospatialMetrics.nearestHospitalKm, 1)} km` : "No hospital in range"}</strong></div>
                  <div className="detail-row"><span>Primary analysis ring</span><strong>{analysis.activeIsochroneLabel}</strong></div>
                </div>
              </section>

              <section className="glass-card">
                <div className="section-heading">
                  <RiRadarLine size={16} />
                  <h3>Isochrone channels</h3>
                </div>
                <div className="stack-list">
                  {analysis.isochroneSummaries.map((summary) => (
                    <div key={summary.profileId} className="stack-item">
                      <div className="stack-top">
                        <strong>{summary.label}</strong>
                        <span className="mono">{summary.reachableFaskesCount} health • {summary.reachableSupportCount} support</span>
                      </div>
                      <div className="stack-bottom">
                        <span>Forecast markers: {summary.reachablePlannedCount}</span>
                        <span>{summary.templateName ? `Template ${summary.templateName}` : "Template estimated"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="glass-card">
                <div className="section-heading">
                  <LuWorkflow size={16} />
                  <h3>AI insight</h3>
                </div>
                {aiSummaryHtml ? (
                  <div className="ai-summary">
                    <div className="ai-summary-label">Strategic summary</div>
                    <div className="ai-rich" dangerouslySetInnerHTML={{ __html: aiSummaryHtml }} />
                  </div>
                ) : null}
                <div className="ai-box">
                  <div className="ai-provider">{isAiLoading ? "Vertex AI is processing..." : `Source: ${aiInsight?.provider || "Awaiting AI"}`}</div>
                  <div className="ai-rich" dangerouslySetInnerHTML={{ __html: aiAnalysisHtml }} />
                </div>
                {aiErrorsHtml ? (
                  <div className="ai-errors">
                    <div className="ai-summary-label">Backend notes</div>
                    <div className="ai-rich" dangerouslySetInnerHTML={{ __html: aiErrorsHtml }} />
                  </div>
                ) : null}
                {aiInsight?.priority_actions?.length ? (
                  <div className="action-list">
                    {aiInsight.priority_actions.map((action, index) => (
                      <div className="action-item" key={`${action}-${index}`}>
                        <LuNavigation size={14} />
                        <span>{action}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="glass-card">
                <div className="section-heading">
                  <LuBrainCircuit size={16} />
                  <h3>AI-augmented facility forecast</h3>
                </div>
                <div className="forecast-list">
                  {analysis.forecastFacilities.length ? (
                    analysis.forecastFacilities.map((facility) => (
                      <div className="forecast-card" key={facility.id}>
                        <div className="forecast-header">
                          <div className="forecast-type">
                            {facility.facilityType === "hospital" ? <RiHospitalFill size={16} /> : facility.facilityType === "puskesmas" ? <RiGovernmentFill size={16} /> : <RiMedicineBottleFill size={16} />}
                            <span>{getFacilityTypeLabel(facility.facilityType)}</span>
                          </div>
                          <div className="forecast-score">{facility.priorityScore}/100</div>
                        </div>
                        <div className="forecast-title">{facility.title}</div>
                        <div className="forecast-meta">
                          <span>Projected demand {formatNumber(facility.estimatedPopulation, 0)} people/km²</span>
                          <span>RS travel gap {facility.accessGapMinutes} min</span>
                        </div>
                        <div className="forecast-rationale">{facility.rationale}</div>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state">No forecast facility candidate is currently justified for the selected point.</div>
                  )}
                </div>
              </section>

              <section className="glass-card">
                <div className="section-heading">
                  <LuLayers3 size={16} />
                  <h3>Additional geospatial signals</h3>
                </div>
                <div className="insight-grid">
                  <div className="insight-card">
                    <div className="insight-label">Hazard overlap</div>
                    <div className="insight-value">{analysis.hazards.length}</div>
                    <div className="insight-desc">{analysis.hazards.join(" • ")}</div>
                  </div>
                  <div className="insight-card">
                    <div className="insight-label">Support facilities</div>
                    <div className="insight-value">{analysis.nearbySupportFacilities.length}</div>
                    <div className="insight-desc">Within {analysis.activeIsochroneLabel}</div>
                  </div>
                  <div className="insight-card">
                    <div className="insight-label">Healthcare nodes</div>
                    <div className="insight-value">{analysis.nearbyFaskes.length}</div>
                    <div className="insight-desc">Accessible inside active polygon</div>
                  </div>
                  <div className="insight-card">
                    <div className="insight-label">Forecast demand</div>
                    <div className="insight-value">{formatNumber(analysis.geospatialMetrics.forecastDemand, 0)}</div>
                    <div className="insight-desc">Composite geospatial planning score</div>
                  </div>
                </div>

                {activeInsights.length ? (
                  <div className="stack-list top-gap">
                    {activeInsights.map((insight, index) => (
                      <div className="stack-item" key={`${insight.title}-${index}`}>
                        <div className="stack-top">
                          <strong>{insight.title}</strong>
                          <span className="mono">{insight.value}</span>
                        </div>
                        <div className="stack-bottom">
                          <span>{insight.interpretation}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="glass-card">
                <div className="section-heading">
                  <LuTrendingUp size={16} />
                  <h3>Advanced geo analysis</h3>
                </div>
                <div className="insight-grid">
                  {analysis.advancedSignals.map((signal) => (
                    <div className={`insight-card ${signal.tone}`} key={signal.id}>
                      <div className="insight-label">{signal.title}</div>
                      <div className="insight-value">{signal.value}</div>
                      <div className="insight-desc">{signal.description}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="glass-card">
                <div className="section-heading">
                  <LuLocateFixed size={16} />
                  <h3>Accessible healthcare network</h3>
                </div>
                <div className="list-block">
                  {analysis.nearbyFaskes.slice(0, 8).map((facility) => (
                    <div className="list-line" key={facility.id}>
                      <span>{facility.nama}</span>
                      <strong>{facility.tipe_label || "Healthcare"} • {formatNumber(facility.distance, 1)} km</strong>
                    </div>
                  ))}
                  {!analysis.nearbyFaskes.length && <div className="empty-state">No healthcare facility is captured inside the active polygon.</div>}
                </div>
              </section>
            </div>
          </>
        ) : (
          <div className="command-empty">
            <div className="command-empty-icon"><LuMap size={22} /></div>
            <h3>Spatial analysis idle</h3>
            <p>Select a location on the map to open AI-assisted facility planning, isochrone telemetry, and resilience signals.</p>
            <div className="command-empty-grid">
              <div className="empty-chip"><LuRadar size={14} /> Hazard overlap</div>
              <div className="empty-chip"><LuTrendingUp size={14} /> Demand forecast</div>
              <div className="empty-chip"><LuRoute size={14} /> Access friction</div>
              <div className="empty-chip"><LuCrosshair size={14} /> Tactical siting</div>
            </div>
          </div>
        )}
      </aside>

      {activeModal ? (
        <div className="modal-backdrop" onClick={() => setActiveModal(null)} role="presentation">
          <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <div>
                <div className="command-kicker">{activeModal === "about" ? "About module" : "Metadata module"}</div>
                <h3>{activeModal === "about" ? "About Isosehat v3" : "Metadata and methodology"}</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => setActiveModal(null)} aria-label="Close dialog">
                <LuX size={16} />
              </button>
            </div>

            {activeModal === "about" ? (
              <div className="modal-content">
                <p>
                  Isosehat v3 is a Geospatial AI command deck for healthcare intelligence in East Java, combining hazard
                  exposure, population pressure, access analysis, isochrones, facility coverage, and AI-assisted planning.
                </p>
                <p>
                  This version is developed by{" "}
                  <a href="https://github.com/kohryan/" target="_blank" rel="noreferrer">
                    Ryan W. Januardi <LuExternalLink size={13} />
                  </a>
                  .
                </p>
                <p>
                  The system is inspired by the earlier non-AI prototype{" "}
                  <a href="https://isosehat.netlify.app/" target="_blank" rel="noreferrer">
                    IsoSehat v2 <LuExternalLink size={13} />
                  </a>
                  , then extended into an AI-assisted geospatial planning platform.
                </p>
              </div>
            ) : (
              <div className="modal-content">
                <section className="modal-section">
                  <h4>Data sources</h4>
                  <div className="modal-list">
                    <div className="modal-list-row"><strong>Population density</strong><span>WorldPop population raster</span></div>
                    <div className="modal-list-row"><strong>Healthcare facilities</strong><span>BPJS Kesehatan facility registry</span></div>
                    <div className="modal-list-row"><strong>Earthquake and ground movement hazards</strong><span>Volcanology and Geological Hazard Mitigation Center, Ministry of Energy and Mineral Resources</span></div>
                    <div className="modal-list-row"><strong>Supporting facilities</strong><span>InaRisk, National Disaster Management Agency</span></div>
                    <div className="modal-list-row"><strong>Isochrone network</strong><span>OpenStreetMap-based routing templates</span></div>
                  </div>
                </section>

                <section className="modal-section">
                  <h4>Indicators used</h4>
                  <div className="metric-definition-grid">
                    <article className="metric-definition-card">
                      <h5>Population density</h5>
                      <p>Concept: local care demand intensity per square kilometer.</p>
                      <p>Definition: uses the nearest population cell proxy around the clicked location.</p>
                      <p>Method: direct value from the nearest grid cell, displayed as `people/km²`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Coverage confidence</h5>
                      <p>Concept: confidence that the point is already served by reachable care capacity.</p>
                      <p>Definition: increases when the area is covered, nearby facilities are numerous, and a hospital is close.</p>
                      <p>Method: `base covered score + nearby healthcare count + support count + nearest hospital bonus`, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Service pressure</h5>
                      <p>Concept: expected stress on the local health service system.</p>
                      <p>Definition: higher when population is dense, formal coverage is low, and nearby healthcare nodes are limited.</p>
                      <p>Method: weighted sum of population score, uncovered penalty, and low-facility penalty, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Hazard pressure</h5>
                      <p>Concept: disruption potential from active hazards affecting the selected point.</p>
                      <p>Definition: reflects overlap with earthquake and ground movement hazard polygons.</p>
                      <p>Method: `hazard count × fixed hazard weight + uncovered penalty`, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Support readiness</h5>
                      <p>Concept: how ready the surrounding support ecosystem is to sustain care operations.</p>
                      <p>Definition: rises with support facilities, healthcare nodes, and hospital proximity.</p>
                      <p>Method: additive score from support count, healthcare count, and nearest hospital bonus, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Access friction</h5>
                      <p>Concept: operational difficulty to reach referral care from the selected point.</p>
                      <p>Definition: higher when modeled travel time and nearest hospital distance are large.</p>
                      <p>Method: `hospital travel-time proxy + nearest hospital distance penalty`, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Resilience score</h5>
                      <p>Concept: capacity of the local system to absorb hazard and access stress.</p>
                      <p>Definition: summarizes positive support against hazard, access, and service burden.</p>
                      <p>Method: `100 - hazard pressure - access friction - service pressure + support readiness`, normalized to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Forecast demand</h5>
                      <p>Concept: composite urgency for future facility planning.</p>
                      <p>Definition: combines service pressure, weak coverage, access friction, and hazard load.</p>
                      <p>Method: weighted score from demand-side and risk-side signals, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Multimodal reach</h5>
                      <p>Concept: how well the point connects to care by more than one travel mode.</p>
                      <p>Definition: counts reachable healthcare and support nodes across driving and motorcycling templates.</p>
                      <p>Method: weighted reach score from four isochrone channels, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Network redundancy</h5>
                      <p>Concept: backup strength of the local healthcare network.</p>
                      <p>Definition: higher when multiple hospitals, nearby facilities, and support nodes overlap in reach.</p>
                      <p>Method: additive redundancy score from hospital count, facility count, support count, and extended reach, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Referral pressure</h5>
                      <p>Concept: strain placed on referral pathways to hospitals.</p>
                      <p>Definition: rises when hospital travel time is long, nearest hospital is far, or hospital count is thin.</p>
                      <p>Method: weighted combination of time proxy, distance penalty, and hospital scarcity penalty, clamped to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Facility diversity</h5>
                      <p>Concept: completeness of the local care mix.</p>
                      <p>Definition: measures whether hospitals, puskesmas, clinics, and support assets exist in combination.</p>
                      <p>Method: score derived from distinct healthcare types plus support presence, normalized to `0-100`.</p>
                    </article>
                    <article className="metric-definition-card">
                      <h5>Hazard-adjusted demand</h5>
                      <p>Concept: facility demand after accounting for both risk exposure and network weakness.</p>
                      <p>Definition: prioritizes places where demand, hazard, and weak access stack together.</p>
                      <p>Method: weighted blend of forecast demand, hazard pressure, referral pressure, and low multimodal reach, clamped to `0-100`.</p>
                    </article>
                  </div>
                </section>

                <section className="modal-section">
                  <h4>Methodology</h4>
                  <p>
                    The application evaluates the clicked location against the nearest population cell, hazard polygons,
                    healthcare network, support facilities, and translated isochrone templates. Local geospatial scoring
                    then classifies the area into urban, peri-urban, or rural context to calibrate facility planning weights.
                  </p>
                  <p>
                    Forecast candidates are ranked from combined access friction, service gap, hazard-adjusted demand,
                    redundancy, equity signal, and settlement profile. The structured telemetry is then sent to Gemini on
                    Vertex AI, which refines coverage status, strategic narrative, and recommended facility priorities.
                  </p>
                </section>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
