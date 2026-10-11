"""
HeatShield routing models.

CandidateRoute is the single shared type flowing from any RoutingProvider
into the RouteRecommender and HeatExposureEngine.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class CandidateRoute:
    """
    A single candidate route returned by a RoutingProvider.

    Fields:
        id                         : Unique identifier within this request (e.g. "route_0")
        distance_meters            : Geometric route length in metres
        duration_seconds           : Travel-mode-corrected duration in seconds
                                     (for walking this is distance / 1.389 m/s)
        geometry                   : GeoJSON geometry dict (type=LineString)
        profile                    : Routing profile string used (e.g. "foot")
        osrm_raw_duration_seconds  : Raw duration from OSRM before correction (debug only)
        steps                      : List of turn-by-turn step dicts from ORS directions
    """
    id: str
    distance_meters: float
    duration_seconds: float
    geometry: dict
    profile: str
    osrm_raw_duration_seconds: float
    steps: list[dict] = field(default_factory=list)
