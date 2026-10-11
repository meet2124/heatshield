from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Literal

import os
import logging
from dotenv import load_dotenv

env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=env_path)

from heat.engine import HeatExposureEngine
from heat.models import RouteInput, TravelMode, EnvironmentalObservation, ConfidenceLevel
from heat.providers import DemoEnvironmentalProvider
from heat.open_meteo import OpenMeteoEnvironmentalProvider
from routing.ors import ORSRoutingProvider
from routing.osrm import OSRMRoutingProvider
from recommender import RouteRecommender

app = FastAPI(
    title="HeatShield API",
    description="Backend for HeatShield route recommendation app",
    version="0.1.0"
)

# ---------------------------------------------------------------------------
# CORS — read allowed origins from environment.
# In production set CORS_ORIGINS to the exact Amplify/CDN URL.
# Multiple origins: comma-separated, e.g. "https://main.d1abc.amplifyapp.com"
# Default to localhost for local development.
# ---------------------------------------------------------------------------
_RAW_CORS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
)
_CORS_ORIGINS = [o.strip() for o in _RAW_CORS.split(",") if o.strip()]

# In AWS Lambda, the Function URL built-in CORS configuration handles CORS.
# Adding CORSMiddleware here causes duplicate Access-Control-Allow-Origin headers.
if not os.getenv("AWS_LAMBDA_FUNCTION_NAME"):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

class Location(BaseModel):
    lat: float
    lng: float

class RouteRequest(BaseModel):
    origin: Location
    destination: Location
    mode: Literal["walking", "delivery_rider"] = "walking"

class HeatScoreRequest(BaseModel):
    """
    Request body for POST /api/heat-score.
    Accepts route metrics produced by /api/routes plus travel mode.
    """
    distance_meters: float
    duration_seconds: float
    mode: Literal["walking", "delivery_rider"] = "walking"
    # Optional: origin lat/lng for future live weather lookup
    origin_lat: float | None = None
    origin_lng: float | None = None


_engine = HeatExposureEngine()

# ---------------------------------------------------------------------------
# Provider selection via ENVIRONMENTAL_PROVIDER environment variable.
#   demo       → DemoEnvironmentalProvider (default; no external API needed)
#   open_meteo → OpenMeteoEnvironmentalProvider (live Open-Meteo weather API)
#
# If ENVIRONMENTAL_PROVIDER is absent, defaults to "demo".
# If set to "open_meteo" and the request fails, the error surfaces explicitly;
# it does NOT silently fall back to demo data.
# ---------------------------------------------------------------------------

_LOGGER = logging.getLogger("heatshield.main")
_ENV_PROVIDER_NAME = os.getenv("ENVIRONMENTAL_PROVIDER", "demo").strip().lower()

if _ENV_PROVIDER_NAME == "open_meteo":
    _env_provider = OpenMeteoEnvironmentalProvider()
    _LOGGER.info("Environmental provider: Open-Meteo (live weather)")
elif _ENV_PROVIDER_NAME == "demo":
    _env_provider = DemoEnvironmentalProvider(scenario="warm_midday")
    _LOGGER.info("Environmental provider: Demo (warm_midday scenario)")
else:
    raise RuntimeError(
        f"Unknown ENVIRONMENTAL_PROVIDER='{_ENV_PROVIDER_NAME}'. "
        "Valid values: 'demo' or 'open_meteo'."
    )

_routing_provider = ORSRoutingProvider()
_recommender = RouteRecommender(
    engine=_engine,
    env_provider=_env_provider,
)

import urllib.request
import json
import math

logger = logging.getLogger("heatshield.routes")


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "HeatShield backend is running"}


@app.post("/api/routes")
def generate_routes(request: RouteRequest):
    try:
        routing_result = _routing_provider.get_routes(
            origin_lat=request.origin.lat,
            origin_lng=request.origin.lng,
            dest_lat=request.destination.lat,
            dest_lng=request.destination.lng,
            mode=request.mode
        )

        routes = []
        for route in routing_result.routes:
            routes.append({
                "distance_meters": route.distance_meters,
                "duration_seconds": route.duration_seconds,
                "osrm_raw_duration_seconds": route.osrm_raw_duration_seconds,
                "geometry": route.geometry,
                "profile": route.profile,
                "steps": getattr(route, "steps", []),
            })

        return {
            "status": "success",
            "message": "Routes generated successfully",
            "data": {
                "origin": request.origin,
                "destination": request.destination,
                "routes": routes,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Routing service error: {str(e)}")

@app.post("/api/heat-score")
def calculate_heat_score(request: HeatScoreRequest):
    """
    Calculate estimated heat exposure for a given route segment.

    NOTE: Returns ESTIMATED heat exposure only.
    Does not claim medical safety, health protection, or individual risk.
    """
    try:
        lat = request.origin_lat or 0.0
        lng = request.origin_lng or 0.0
        observation = _env_provider.get_observation(lat=lat, lng=lng)

        route = RouteInput(
            distance_meters=request.distance_meters,
            duration_seconds=request.duration_seconds,
            mode=TravelMode(request.mode),
        )

        result = _engine.calculate(route, observation)

        return {
            "status": "success",
            "data": {
                "estimated_exposure_score": result.estimated_exposure_score,
                "raw_unrounded_score": result.raw_unrounded_score,
                "risk_level": result.risk_level.value,
                "major_contributors": [
                    {
                        "name": c.name,
                        "display_name": c.display_name,
                        "raw_value": c.raw_value,
                        "unit": c.unit,
                        "points_contributed": c.points_contributed,
                    }
                    for c in sorted(
                        result.contributors,
                        key=lambda c: abs(c.points_contributed),
                        reverse=True,
                    )[:4]
                    if c.name != "cloud_cover"
                ][:3],
                "mode_exertion_multiplier": result.mode_exertion_multiplier,
                "confidence": result.confidence.value,
                "freshness": {
                    "status": result.freshness.status.value,
                    "observed_at": result.freshness.observed_at,
                    "age_minutes": result.freshness.age_minutes,
                    "source_label": result.freshness.source_label,
                },
                "data_source": result.data_source,
                "is_demo_data": result.is_demo_data,
                "data_freshness_note": result.data_freshness_note,
                "validation_warnings": result.validation_warnings,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Heat score error: {str(e)}")


# ---------------------------------------------------------------------------
# /api/recommend — unified heat-aware route recommendation
# ---------------------------------------------------------------------------

class RecommendRequest(BaseModel):
    """
    Request body for POST /api/recommend.
    Geocoding is performed on the frontend; this endpoint receives coordinates.
    """
    origin: Location
    destination: Location
    mode: Literal["walking", "delivery_rider"] = "walking"
    # Optional weight overrides. Must sum to 1.0 if both provided.
    exposure_weight: float | None = None
    time_weight: float | None = None


@app.post("/api/recommend")
def recommend_route(request: RecommendRequest):
    """
    Main decision endpoint. Returns candidate routes scored for heat exposure
    and a recommended route selected by utility function.

    NOTE: Estimated heat exposure only. Does not claim medical safety.
    """
    try:
        mode = TravelMode(request.mode)

        # 1. Fetch candidates from routing provider
        routing_result = _routing_provider.get_routes(
            origin_lat=request.origin.lat,
            origin_lng=request.origin.lng,
            dest_lat=request.destination.lat,
            dest_lng=request.destination.lng,
            mode=request.mode,
        )

        # 2. Score + recommend
        recommendation = _recommender.recommend(
            candidates=routing_result.routes,
            mode=mode,
            origin_lat=request.origin.lat,
            origin_lng=request.origin.lng,
            provider_note=routing_result.provider_note,
            exposure_weight=request.exposure_weight,
            time_weight=request.time_weight,
        )

        # 3. Serialise
        routes_out = []
        for sr in recommendation.scored_routes:
            c = sr.candidate
            exp = sr.exposure_result
            routes_out.append({
                "id": c.id,
                "distance_meters": c.distance_meters,
                "duration_seconds": c.duration_seconds,
                "exposure_score": exp.estimated_exposure_score,
                "raw_unrounded_score": exp.raw_unrounded_score,
                "risk_level": exp.risk_level.value,
                "utility_score": round(sr.utility_score, 4),
                "relative_time_diff_seconds": round(sr.relative_time_diff_seconds),
                "relative_exposure_diff_pct": round(sr.relative_exposure_diff_pct, 1),
                "is_recommended": sr.is_recommended,
                "geometry": c.geometry,
                "profile": getattr(c, "profile", "foot-walking"),
                "steps": getattr(c, "steps", []),
                "major_contributors": [
                    {
                        "name": cont.name,
                        "display_name": cont.display_name,
                        "raw_value": cont.raw_value,
                        "unit": cont.unit,
                        "points_contributed": cont.points_contributed,
                    }
                    for cont in sorted(
                        exp.contributors,
                        key=lambda x: abs(x.points_contributed),
                        reverse=True,
                    )[:4]   # top 4 excluding informational cloud_cover
                    if cont.name != "cloud_cover"
                ][:3],
                "all_contributors": [
                    {
                        "name": cont.name,
                        "display_name": cont.display_name,
                        "raw_value": cont.raw_value,
                        "unit": cont.unit,
                        "points_contributed": cont.points_contributed,
                    }
                    for cont in exp.contributors
                ],
                "is_demo_data": exp.is_demo_data,
                "confidence": exp.confidence.value,
                "freshness": {
                    "status": exp.freshness.status.value,
                    "observed_at": exp.freshness.observed_at,
                    "age_minutes": exp.freshness.age_minutes,
                    "source_label": exp.freshness.source_label,
                },
                "data_freshness_note": exp.data_freshness_note,
            })

        return {
            "status": "success",
            "data": {
                "recommended_route_id": recommendation.recommended_route_id,
                "reason": recommendation.reason,
                "provider_note": recommendation.provider_note,
                "exposure_weight": recommendation.exposure_weight,
                "time_weight": recommendation.time_weight,
                "is_demo_data": recommendation.is_demo_data,
                "routes": routes_out,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recommendation error: {str(e)}")


@app.get("/api/weather/hourly")
def get_hourly_forecast(
    lat: float,
    lng: float,
    mode: Literal["walking", "delivery_rider"] = "walking",
    duration_seconds: float = 1800.0,
):
    """
    Fetch 24-hour NWP model hourly weather from Open-Meteo and compute
    projected HeatShield exposure scores for each hour.

    Distinguishes live forecast from demo data honestly.
    """
    if not math.isfinite(lat) or not (-90.0 <= lat <= 90.0):
        raise HTTPException(status_code=400, detail="Invalid latitude. Must be between -90 and 90.")
    if not math.isfinite(lng) or not (-180.0 <= lng <= 180.0):
        raise HTTPException(status_code=400, detail="Invalid longitude. Must be between -180 and 180.")
    if not math.isfinite(duration_seconds) or duration_seconds < 0:
        raise HTTPException(status_code=400, detail="duration_seconds must be a non-negative number.")

    if _ENV_PROVIDER_NAME != "open_meteo":
        return {
            "status": "unavailable",
            "is_demo_data": True,
            "is_forecast": False,
            "message": "Hourly exposure timeline requires live Open-Meteo environmental provider.",
            "data": None,
        }

    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={round(lat, 6)}&longitude={round(lng, 6)}&"
            f"hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,uv_index&"
            f"timezone=UTC&forecast_days=1"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "HeatShield/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        hourly = data.get("hourly", {})
        times = hourly.get("time", [])
        temps = hourly.get("temperature_2m", [])
        hums = hourly.get("relative_humidity_2m", [])
        winds = hourly.get("wind_speed_10m", [])
        clouds = hourly.get("cloud_cover", [])
        uvs = hourly.get("uv_index", [])

        travel_mode = TravelMode(mode)
        route_sample = RouteInput(
            distance_meters=1000.0,
            duration_seconds=duration_seconds,
            mode=travel_mode,
        )

        timeline = []
        for i in range(min(24, len(times))):
            raw_time = times[i] if i < len(times) else None
            if not raw_time:
                continue

            # Standardize ISO 8601 UTC timestamp format
            t_base = raw_time if len(raw_time) >= 19 else (raw_time + ":00" if len(raw_time) == 16 else raw_time)
            t_iso = t_base + "Z" if not t_base.endswith("Z") else t_base

            try:
                temp_val = temps[i] if i < len(temps) and temps[i] is not None else None
                hum_val = hums[i] if i < len(hums) and hums[i] is not None else None
                wind_val = winds[i] if i < len(winds) and winds[i] is not None else None
                cloud_val = clouds[i] if i < len(clouds) and clouds[i] is not None else None
                uv_val = uvs[i] if i < len(uvs) and uvs[i] is not None else None

                if temp_val is None or hum_val is None:
                    continue

                temp_c = float(temp_val)
                hum_pct = float(hum_val)
                wind_kmh = float(wind_val) * 3.6 if wind_val is not None else 0.0
                cloud_pct = float(cloud_val) if cloud_val is not None else 0.0
                solar_idx = max(0.0, min(10.0, float(uv_val))) if uv_val is not None else 0.0
            except (ValueError, TypeError):
                continue

            obs = EnvironmentalObservation(
                temperature_c=temp_c,
                humidity_pct=hum_pct,
                solar_index=solar_idx,
                wind_speed_kmh=wind_kmh,
                cloud_cover_pct=cloud_pct,
                data_source="Open-Meteo · Hourly Forecast (NWP model)",
                is_demo=False,
                confidence=ConfidenceLevel.MEDIUM,
            )
            result = _engine.calculate(route_sample, obs)

            timeline.append({
                "time_iso": t_iso,
                "hour_label": raw_time.split("T")[-1][:5] if "T" in raw_time else raw_time,
                "temperature_c": round(temp_c, 1),
                "humidity_pct": round(hum_pct, 1),
                "wind_speed_kmh": round(wind_kmh, 1),
                "uv_index": round(solar_idx, 1),
                "cloud_cover_pct": round(cloud_pct, 1),
                "exposure_score": result.estimated_exposure_score,
                "raw_unrounded_score": result.raw_unrounded_score,
                "risk_level": result.risk_level.value,
            })

        return {
            "status": "success",
            "is_demo_data": False,
            "is_forecast": True,
            "data_source": "Open-Meteo · NWP Model Hourly Forecast",
            "disclaimer": "Projected departure exposure scores are calculated estimates based on numerical weather forecast models. Not measured future exposure.",
            "timeline": timeline,
        }
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise HTTPException(status_code=429, detail="Open-Meteo rate limit exceeded.")
        raise HTTPException(status_code=502, detail=f"Open-Meteo upstream error: HTTP {exc.code}")
    except (urllib.error.URLError, TimeoutError):
        raise HTTPException(status_code=504, detail="Open-Meteo upstream request timed out.")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Hourly forecast error: {str(exc)}")
