"""
ORSRoutingProvider — wraps OpenRouteService directions API.
"""
from __future__ import annotations

import json
import logging
import os
import urllib.request
import urllib.error
from typing import Any

from routing.models import CandidateRoute
from routing.provider import RoutingProvider, RoutingResult

logger = logging.getLogger("heatshield.routing.ors")

ORS_BASE_URL = "https://api.openrouteservice.org/v2/directions"
USER_AGENT = "HeatShield/1.0"

def _ors_profile(mode: str) -> str:
    """Map HeatShield travel mode to ORS profile string."""
    mapping = {
        "walking": "foot-walking",
        "delivery_rider": "cycling-regular",
    }
    if mode not in mapping:
        raise ValueError(f"Unsupported travel mode: {mode}")
    return mapping[mode]


class ORSRoutingProvider(RoutingProvider):
    """
    Routing provider backed by OpenRouteService.

    Supports genuine alternative routes (up to 3).
    """

    @property
    def name(self) -> str:
        return "OpenRouteService"

    @property
    def supports_alternatives(self) -> bool:
        return True

    def get_routes(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
        mode: str = "walking",
    ) -> RoutingResult:

        api_key = os.getenv("ORS_API_KEY")
        if not api_key:
            raise RuntimeError(
                "ORS configuration error: ORS_API_KEY environment variable is missing. "
                "Please configure an OpenRouteService API key in your environment."
            )

        try:
            profile = _ors_profile(mode)
        except ValueError as e:
            raise RuntimeError(str(e))

        url = f"{ORS_BASE_URL}/{profile}/geojson"

        payload = {
            "coordinates": [[origin_lng, origin_lat], [dest_lng, dest_lat]],
            "alternative_routes": {
                "target_count": 3
            },
            "instructions": True,
        }

        data = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": api_key,
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": USER_AGENT,
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                response_data = resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            # Hide the API key in all error messages
            err_msg = f"ORS HTTP Error {e.code}: {e.reason}"
            if e.code in (401, 403):
                raise RuntimeError("ORS authorization failed. Please check your ORS_API_KEY.")
            elif e.code == 429:
                raise RuntimeError("ORS rate limit exceeded (HTTP 429). Please try again later.")
            elif e.code >= 500:
                raise RuntimeError(f"ORS server error (HTTP {e.code}). Please try again later.")
            else:
                try:
                    err_body = e.read().decode("utf-8")
                    err_json = json.loads(err_body)
                    detail = err_json.get("error", err_body)
                except Exception:
                    detail = "No additional details."
                raise RuntimeError(f"{err_msg}. Details: {detail}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"ORS connection failure: {e.reason}")
        except TimeoutError:
            raise RuntimeError("ORS request timed out.")

        try:
            parsed = json.loads(response_data)
        except json.JSONDecodeError:
            raise RuntimeError("Malformed response from ORS (invalid JSON).")

        if parsed.get("type") != "FeatureCollection":
            raise RuntimeError("Malformed response from ORS (expected FeatureCollection).")

        features = parsed.get("features", [])
        if not features:
            raise RuntimeError("ORS returned no routes.")

        candidates: list[CandidateRoute] = []
        for i, feature in enumerate(features):
            try:
                geometry = feature["geometry"]
                properties = feature["properties"]
                summary = properties["summary"]
                distance = float(summary["distance"])
                duration = float(summary["duration"]) # ORS duration is in seconds
            except (KeyError, TypeError, ValueError):
                continue

            steps: list[dict] = []
            segments = properties.get("segments", [])
            if isinstance(segments, list):
                for seg in segments:
                    if not isinstance(seg, dict):
                        continue
                    for st in seg.get("steps", []):
                        if not isinstance(st, dict):
                            continue
                        steps.append({
                            "distance": float(st.get("distance", 0.0)),
                            "duration": float(st.get("duration", 0.0)),
                            "type": int(st.get("type", 0)),
                            "instruction": str(st.get("instruction", "")),
                            "name": str(st.get("name", "")),
                            "way_points": list(st.get("way_points", [])),
                        })

            candidates.append(CandidateRoute(
                id=f"route_{i}",
                distance_meters=distance,
                duration_seconds=duration,
                geometry=geometry,
                profile=profile,
                osrm_raw_duration_seconds=duration, # Reusing field for raw duration tracking
                steps=steps,
            ))

        if not candidates:
            raise RuntimeError("ORS returned routes, but none could be parsed.")

        provider_note = (
            "OpenRouteService provided genuine route alternatives."
            if len(candidates) > 1
            else "OpenRouteService found only one viable route for this request."
        )

        return RoutingResult(
            routes=candidates,
            provider=self.name,
            provider_note=provider_note,
            supports_alternatives=self.supports_alternatives,
        )
