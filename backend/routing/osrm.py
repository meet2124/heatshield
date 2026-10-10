"""
OSRMRoutingProvider — wraps the public OSRM demo server.

KNOWN LIMITATIONS (documented honestly):
1. The public demo server (router.project-osrm.org) does NOT support
   the `alternatives=true` parameter reliably — it always returns one route.
2. The server ignores the foot/bike profile and routes by car speed. However, we preserve the raw OSRM duration exactly as provided, in seconds.
3. This provider must NOT be used in production without a self-hosted OSRM
   instance or a paid routing API with genuine foot-profile support.
"""
from __future__ import annotations

import json
import logging
import math
import urllib.request

from routing.models import CandidateRoute
from routing.provider import RoutingProvider, RoutingResult

logger = logging.getLogger("heatshield.routing.osrm")

OSRM_BASE_URL = "http://router.project-osrm.org/route/v1"
USER_AGENT = "HeatShield/1.0 (Hackathon MVP)"

def _osrm_profile(mode: str) -> str:
    """Map HeatShield travel mode to OSRM profile string."""
    return {
        "walking": "foot",
        "delivery_rider": "bike",
    }.get(mode, "foot")


class OSRMRoutingProvider(RoutingProvider):
    """
    Routing provider backed by the public OSRM demo server.

    supports_alternatives = False (public server limitation; see module docstring).
    """

    @property
    def name(self) -> str:
        return "OSRM (public demo server)"

    @property
    def supports_alternatives(self) -> bool:
        return False

    def get_routes(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
        mode: str = "walking",
    ) -> RoutingResult:
        osrm_profile = _osrm_profile(mode)

        url = (
            f"{OSRM_BASE_URL}/{osrm_profile}/"
            f"{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
            f"?overview=full&geometries=geojson"
        )

        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        if data.get("code") != "Ok":
            raise RuntimeError(f"OSRM error code: {data.get('code')}")

        raw_routes = data.get("routes", [])
        if not raw_routes:
            raise RuntimeError("OSRM returned no routes.")

        candidates: list[CandidateRoute] = []
        for i, r in enumerate(raw_routes):
            osrm_dist: float = r.get("distance", 0.0)
            osrm_dur: float = r.get("duration", 0.0)

            # OSRM returns duration in seconds. We use it directly.
            final_duration_s = osrm_dur

            candidates.append(CandidateRoute(
                id=f"route_{i}",
                distance_meters=osrm_dist,
                duration_seconds=final_duration_s,
                geometry=r.get("geometry"),
                profile=osrm_profile,
                osrm_raw_duration_seconds=osrm_dur,
            ))

        return RoutingResult(
            routes=candidates,
            provider=self.name,
            provider_note=(
                "The public OSRM demo server returns only one candidate route. "
                "To enable genuine route alternatives, deploy a self-hosted OSRM instance."
            ),
            supports_alternatives=self.supports_alternatives,
        )
