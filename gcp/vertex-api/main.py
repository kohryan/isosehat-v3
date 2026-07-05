import json
import os
import traceback
from typing import Any
from urllib.parse import urlencode
from urllib.request import urlopen
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="Isosehat Vertex AI API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PROJECT_ID = os.getenv("PROJECT_ID", "genai-apac-497712")
REGION = os.getenv("REGION", "asia-southeast2")
PRIMARY_VERTEX_MODEL = os.getenv("VERTEX_MODEL", "gemini-2.5-flash")
FALLBACK_VERTEX_MODEL = os.getenv("VERTEX_FALLBACK_MODEL", "gemini-1.5-flash-001")
FALLBACK_VERTEX_REGION = os.getenv("VERTEX_FALLBACK_REGION", "us-central1")
LOCATIONIQ_API_KEY = os.getenv("LOCATIONIQ_API_KEY", "").strip()

try:
    from google.cloud import aiplatform
    from vertexai.preview.generative_models import GenerativeModel
    vertex_sdk_available = True
except Exception as e:
    print(f"Vertex AI not available: {e}")
    vertex_sdk_available = False


class LocationContext(BaseModel):
    city: str = "Unknown Location"
    address: str = "Unknown address"
    country: str = "Unknown country"
    state: str = "Unknown state"


class GeospatialMetrics(BaseModel):
    coverageConfidence: float = 0
    servicePressure: float = 0
    hazardPressure: float = 0
    supportReadiness: float = 0
    accessFriction: float = 0
    resilienceScore: float = 0
    forecastDemand: float = 0
    multimodalReach: float = 0
    networkRedundancy: float = 0
    referralPressure: float = 0
    facilityDiversity: float = 0
    hazardAdjustedDemand: float = 0
    spatialClusterPressure: float = 0


class GeostatisticalContext(BaseModel):
    localDemandIndex: float = 0
    neighborhoodDemandMean: float = 0
    demandDelta: float = 0
    neighborhoodGapShare: float = 0
    spatialClusterPressure: float = 0
    clusterType: str = "balanced_transition"
    neighborCount: int = 0


class ForecastCandidate(BaseModel):
    title: str
    facility_type: str
    priority_score: float = 0
    rationale: str


class LocationAnalysisRequest(BaseModel):
    latitude: float
    longitude: float
    population_density: float
    settlement_profile: str | None = None
    coverage_status: str
    hazards: list[str]
    nearby_facilities: list[dict]
    location_context: LocationContext | None = None
    geospatial_metrics: GeospatialMetrics | None = None
    geostatistical_context: GeostatisticalContext | None = None
    forecast_candidates: list[ForecastCandidate] = Field(default_factory=list)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def safe_json_loads(raw_text: str) -> dict[str, Any]:
    candidate = raw_text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        if "\n" in candidate:
            candidate = candidate.split("\n", 1)[1]
        if candidate.endswith("```"):
            candidate = candidate[:-3]
        candidate = candidate.strip()

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        return json.loads(candidate[start:end + 1])


def reverse_geocode_with_locationiq(latitude: float, longitude: float) -> LocationContext:
    if not LOCATIONIQ_API_KEY:
        raise RuntimeError("LOCATIONIQ_API_KEY is not configured on the backend.")

    query = urlencode({
        "key": LOCATIONIQ_API_KEY,
        "lat": latitude,
        "lon": longitude,
        "format": "json",
    })
    url = f"https://us1.locationiq.com/v1/reverse.php?{query}"

    with urlopen(url, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError(f"LocationIQ request failed with status {response.status}.")
        payload = json.loads(response.read().decode("utf-8"))

    address = payload.get("address", {}) if isinstance(payload, dict) else {}
    city = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("county")
        or "Unknown Location"
    )

    return LocationContext(
        city=city,
        address=str(payload.get("display_name", "Unknown address")),
        country=str(address.get("country", "Unknown country")),
        state=str(address.get("state", "Unknown state")),
    )


def build_prompt(request_data: LocationAnalysisRequest) -> str:
    location = request_data.location_context or LocationContext()
    metrics = request_data.geospatial_metrics or GeospatialMetrics()
    geostat = request_data.geostatistical_context or GeostatisticalContext()
    nearby_lines = []
    for facility in request_data.nearby_facilities[:10]:
        nearby_lines.append(
            f"- {facility.get('nama', 'Unknown facility')} ({facility.get('tipe_label', 'Unknown type')}), {facility.get('distance', '-'):.1f} km away"
            if isinstance(facility.get("distance"), (int, float))
            else f"- {facility.get('nama', 'Unknown facility')} ({facility.get('tipe_label', 'Unknown type')})"
        )

    nearby_facilities_text = "\n".join(nearby_lines) if nearby_lines else "- No nearby facilities captured in the active isochrone."
    hazards_text = ", ".join(request_data.hazards) if request_data.hazards else "No major hazards listed."
    candidate_lines = []
    for candidate in request_data.forecast_candidates[:5]:
        candidate_lines.append(
            f"- {candidate.title} | suggested type: {candidate.facility_type} | priority: {candidate.priority_score:.0f} | rationale: {candidate.rationale}"
        )
    candidate_text = "\n".join(candidate_lines) if candidate_lines else "- No precomputed forecast candidates were supplied."

    return f"""
You are an expert regional health intelligence analyst for East Java, Indonesia.

Return valid JSON only. Do not wrap the JSON in markdown fences.

Evaluate the clicked location below:
- City / area: {location.city}
- Address: {location.address}
- State: {location.state}
- Country: {location.country}
- Coordinates: {request_data.latitude}, {request_data.longitude}
- Population density: {request_data.population_density} people/km²
- Settlement profile: {request_data.settlement_profile or "peri-urban"}
- Current local coverage status: {request_data.coverage_status}
- Hazard exposure: {hazards_text}
- Nearby facilities inside the active isochrone:
{nearby_facilities_text}

Geospatial metrics:
- Coverage confidence: {metrics.coverageConfidence:.1f}/100
- Service pressure: {metrics.servicePressure:.1f}/100
- Hazard pressure: {metrics.hazardPressure:.1f}/100
- Support readiness: {metrics.supportReadiness:.1f}/100
- Access friction: {metrics.accessFriction:.1f}/100
- Resilience score: {metrics.resilienceScore:.1f}/100
- Forecast demand: {metrics.forecastDemand:.1f}/100
- Multimodal reach: {metrics.multimodalReach:.1f}/100
- Network redundancy: {metrics.networkRedundancy:.1f}/100
- Referral pressure: {metrics.referralPressure:.1f}/100
- Facility diversity: {metrics.facilityDiversity:.1f}/100
- Hazard-adjusted demand: {metrics.hazardAdjustedDemand:.1f}/100
- Spatial cluster pressure: {metrics.spatialClusterPressure:.1f}/100

Geostatistical neighborhood context:
- Local demand index: {geostat.localDemandIndex:.1f}/100
- Neighborhood demand mean: {geostat.neighborhoodDemandMean:.1f}/100
- Local vs neighborhood delta: {geostat.demandDelta:+.1f}
- Neighborhood gap share: {geostat.neighborhoodGapShare:.1f}%
- Neighbor cells evaluated: {geostat.neighborCount}
- Derived spatial pattern: {geostat.clusterType}

Precomputed forecast candidates:
{candidate_text}

Use a planning mindset that combines healthcare access, hazard resilience, service readiness, spatial demand, and local geostatistical pattern detection.

JSON schema:
{{
  "analysis": "short markdown narrative in English with sections Place Overview, Health Access, Planning Signal",
  "strategic_summary": "single concise paragraph in English",
  "coverage_status": "covered|watch|gap|critical",
  "recommended_facility_type": "hospital|puskesmas|clinic|none",
  "facility_priority_score": 0,
  "priority_actions": ["action 1", "action 2", "action 3"],
  "geospatial_insights": [
    {{"title": "Service pressure", "value": "High", "interpretation": "brief explanation"}}
  ],
  "geostatistical_summary": "single concise paragraph in English explaining the spatial pattern using the full 13-indicator stack",
  "forecast_facilities": [
    {{"title": "Candidate label", "facility_type": "hospital|puskesmas|clinic", "priority_score": 0, "rationale": "brief explanation"}}
  ]
}}

Rules:
- Keep the output grounded in the supplied data.
- Never invent exact administrative facts beyond the supplied location context.
- Use the full 13-indicator stack, including spatial cluster pressure, when reasoning about urgency.
- Treat the geostatistical context as a neighborhood comparison, not as a province-wide claim.
- Use at most 4 geospatial insights and 3 forecast facilities.
- If no new facility is justified, set recommended_facility_type to "none".
""".strip()


def get_vertex_candidates() -> list[tuple[str, str]]:
    ordered = [
        (REGION, PRIMARY_VERTEX_MODEL),
        (FALLBACK_VERTEX_REGION, PRIMARY_VERTEX_MODEL),
        (REGION, FALLBACK_VERTEX_MODEL),
        (FALLBACK_VERTEX_REGION, FALLBACK_VERTEX_MODEL),
    ]
    unique: list[tuple[str, str]] = []
    for candidate in ordered:
        if candidate not in unique:
            unique.append(candidate)
    return unique


def generate_with_vertex(prompt: str) -> tuple[str, str]:
    if not vertex_sdk_available:
        raise RuntimeError("Vertex SDK is not installed or failed to import.")

    attempts: list[str] = []
    for region, model_name in get_vertex_candidates():
        try:
            aiplatform.init(project=PROJECT_ID, location=region)
            model = GenerativeModel(model_name)
            response = model.generate_content(prompt)
            if not getattr(response, "text", None):
                raise RuntimeError("Vertex AI returned an empty response.")
            provider = f"Vertex AI ({model_name} @ {region})"
            return response.text.strip(), provider
        except Exception as exc:
            attempts.append(f"{model_name}@{region}: {exc}")

    raise RuntimeError(" | ".join(attempts[-4:]))


def normalize_forecast_facilities(raw_items: Any, fallback_items: list[ForecastCandidate]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    if isinstance(raw_items, list):
        for item in raw_items[:3]:
            if not isinstance(item, dict):
                continue
            facility_type = item.get("facility_type", "clinic")
            if facility_type not in {"hospital", "puskesmas", "clinic"}:
                facility_type = "clinic"
            normalized.append({
                "title": str(item.get("title", "Candidate facility")),
                "facility_type": facility_type,
                "priority_score": int(clamp(float(item.get("priority_score", 50)), 0, 100)),
                "rationale": str(item.get("rationale", "AI identified this location as a planning priority."))
            })

    if normalized:
        return normalized

    return [
        {
            "title": item.title,
            "facility_type": item.facility_type if item.facility_type in {"hospital", "puskesmas", "clinic"} else "clinic",
            "priority_score": int(clamp(item.priority_score, 0, 100)),
            "rationale": item.rationale,
        }
        for item in fallback_items[:3]
    ]


def normalize_ai_response(raw_text: str, request_data: LocationAnalysisRequest, provider: str) -> dict[str, Any]:
    data = safe_json_loads(raw_text)

    coverage_status = str(data.get("coverage_status", request_data.coverage_status)).lower()
    if coverage_status not in {"covered", "watch", "gap", "critical"}:
        coverage_status = request_data.coverage_status if request_data.coverage_status in {"covered", "watch", "gap", "critical"} else "watch"

    facility_type = str(data.get("recommended_facility_type", "none")).lower()
    if facility_type not in {"hospital", "puskesmas", "clinic", "none"}:
        facility_type = "none"

    insights: list[dict[str, str]] = []
    raw_insights = data.get("geospatial_insights", [])
    if isinstance(raw_insights, list):
        for item in raw_insights[:4]:
            if not isinstance(item, dict):
                continue
            insights.append({
                "title": str(item.get("title", "Geospatial signal")),
                "value": str(item.get("value", "Review")),
                "interpretation": str(item.get("interpretation", "Additional review is recommended."))
            })

    priority_actions = data.get("priority_actions", [])
    if not isinstance(priority_actions, list):
        priority_actions = []

    return {
        "analysis": str(data.get("analysis", "")).strip() or build_fallback_analysis(request_data)["analysis"],
        "strategic_summary": str(data.get("strategic_summary", "")).strip(),
        "coverage_status": coverage_status,
        "recommended_facility_type": facility_type,
        "facility_priority_score": int(clamp(float(data.get("facility_priority_score", 50)), 0, 100)),
        "priority_actions": [str(item) for item in priority_actions[:3]],
        "geospatial_insights": insights,
        "geostatistical_summary": str(data.get("geostatistical_summary", "")).strip(),
        "forecast_facilities": normalize_forecast_facilities(data.get("forecast_facilities"), request_data.forecast_candidates),
        "provider": provider,
    }


def build_fallback_analysis(request_data: LocationAnalysisRequest) -> dict[str, Any]:
    location = request_data.location_context or LocationContext()
    metrics = request_data.geospatial_metrics or GeospatialMetrics()
    geostat = request_data.geostatistical_context or GeostatisticalContext()
    hazards_text = ", ".join(request_data.hazards) if request_data.hazards else "No major hazards listed"
    facility_count = len(request_data.nearby_facilities)
    if request_data.population_density >= 4000 or metrics.accessFriction >= 70:
        facility_type = "hospital"
    elif request_data.coverage_status in {"gap", "critical"} or metrics.servicePressure >= 55:
        facility_type = "puskesmas"
    elif facility_count <= 2:
        facility_type = "clinic"
    else:
        facility_type = "none"

    if request_data.coverage_status == "critical":
        coverage_status = "critical"
    elif request_data.coverage_status == "gap":
        coverage_status = "gap"
    elif metrics.hazardPressure >= 65 or metrics.servicePressure >= 60:
        coverage_status = "watch"
    else:
        coverage_status = "covered"

    priority_score = int(clamp(
        (metrics.forecastDemand * 0.3) +
        (metrics.servicePressure * 0.25) +
        (metrics.hazardPressure * 0.15) +
        (metrics.accessFriction * 0.2) +
        ((100 - metrics.supportReadiness) * 0.04) +
        (metrics.referralPressure * 0.04) +
        (metrics.hazardAdjustedDemand * 0.06),
        0,
        100
    ))

    analysis = (
        f"### Place Overview\n"
        f"{location.city} is located in {location.state}, {location.country}. The selected area shows approximately "
        f"{request_data.population_density:.0f} people per km².\n\n"
        f"### Health Access\n"
        f"The local coverage signal is '{coverage_status}' with {facility_count} facilities captured inside the active isochrone. "
        f"Hazard exposure currently includes: {hazards_text}.\n\n"
        f"### Planning Signal\n"
        f"The strongest planning need is to improve resilience, service reach, and referral continuity around this point."
    )

    if geostat.clusterType == "underserved_hotspot":
        geostat_summary = (
            f"The selected cell behaves like an underserved hotspot: its local demand index ({geostat.localDemandIndex:.0f}/100) "
            f"sits {geostat.demandDelta:+.0f} points above the surrounding neighborhood mean, and {geostat.neighborhoodGapShare:.0f}% "
            f"of nearby cells also show gap-like conditions."
        )
    elif geostat.clusterType == "isolated_gap":
        geostat_summary = (
            f"The point looks like an isolated gap rather than a broad cluster: local pressure is elevated, but the surrounding cells are "
            f"more mixed, so targeted access fixes may matter more than a large-area rollout."
        )
    elif geostat.clusterType == "resilient_cluster":
        geostat_summary = (
            f"The selected area sits inside a relatively resilient local cluster: nearby cells show lower demand stress and the local "
            f"network appears more stable than high-risk hotspots."
        )
    else:
        geostat_summary = (
            f"The point sits in a transition zone: local pressure is close to neighborhood conditions, so planning should balance local "
            f"service fixes with surrounding network continuity."
        )

    return {
        "analysis": analysis,
        "strategic_summary": (
            f"{location.city} shows a {coverage_status} access signal with notable pressure from population demand, travel friction, "
            f"and hazard exposure."
        ),
        "coverage_status": coverage_status,
        "recommended_facility_type": facility_type,
        "facility_priority_score": priority_score,
        "priority_actions": [
            "Audit last-mile travel time to primary care and referral hospitals.",
            "Review hazard-ready service continuity and emergency routing.",
            "Validate whether nearby support facilities can absorb surge demand."
        ],
        "geospatial_insights": [
            {
                "title": "Service pressure",
                "value": f"{metrics.servicePressure:.0f}/100",
                "interpretation": "Higher values indicate stronger mismatch between demand and current service access."
            },
            {
                "title": "Hazard pressure",
                "value": f"{metrics.hazardPressure:.0f}/100",
                "interpretation": "Higher values indicate stronger resilience requirements for healthcare planning."
            },
            {
                "title": "Spatial cluster pressure",
                "value": f"{metrics.spatialClusterPressure:.0f}/100",
                "interpretation": "Higher values indicate that surrounding cells reinforce the same access and demand stress seen at the selected point."
            },
            {
                "title": "Hazard-adjusted demand",
                "value": f"{metrics.hazardAdjustedDemand:.0f}/100",
                "interpretation": "Higher values indicate stronger need to place resilient capacity where demand and hazard pressure stack together."
            }
        ],
        "geostatistical_summary": geostat_summary,
        "forecast_facilities": normalize_forecast_facilities(None, request_data.forecast_candidates),
        "provider": "Deterministic geo-forecast fallback",
    }


@app.post("/api/location/analyze")
async def analyze_location(request: LocationAnalysisRequest):
    try:
        prompt = build_prompt(request)
        errors: list[str] = []

        if vertex_sdk_available:
            try:
                response_text, provider = generate_with_vertex(prompt)
                return normalize_ai_response(response_text, request, provider)
            except Exception as exc:
                message = f"Vertex AI error: {exc}"
                errors.append(message)
                print(message)
                traceback.print_exc()

        fallback_payload = build_fallback_analysis(request)
        fallback_payload["errors"] = errors
        return fallback_payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/location/reverse-geocode")
async def reverse_geocode(latitude: float, longitude: float):
    try:
        context = reverse_geocode_with_locationiq(latitude, longitude)
        return context.model_dump()
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Reverse geocoding failed: {exc}")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "vertex_sdk_available": vertex_sdk_available,
        "locationiq_configured": bool(LOCATIONIQ_API_KEY),
        "project_id": PROJECT_ID,
        "primary_region": REGION,
        "fallback_region": FALLBACK_VERTEX_REGION,
        "primary_model": PRIMARY_VERTEX_MODEL
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8080)))
