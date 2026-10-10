"""
HeatShield RoutingProvider interface.

Any routing backend (OSRM, Valhalla, Google Maps, etc.) must implement this
ABC so the recommender layer is completely decoupled from the routing source.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from routing.models import CandidateRoute


@dataclass
class RoutingResult:
    """
    Output of a RoutingProvider.get_routes() call.

    routes      : Ordered list of candidate routes (may be length 1).
    provider    : Human-readable name of the backing service.
    provider_note: Honest description of limitations (e.g. single-route only).
    supports_alternatives: Whether this provider can return multiple candidates.
    """
    routes: list[CandidateRoute]
    provider: str
    provider_note: str
    supports_alternatives: bool


class RoutingProvider(ABC):
    """
    Abstract interface for all routing backends.

    Implementations must be honest about alternative-route support.
    The recommender handles the single-route degenerate case gracefully.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable provider name."""
        ...

    @property
    @abstractmethod
    def supports_alternatives(self) -> bool:
        """True if this provider can return genuinely different candidate routes."""
        ...

    @abstractmethod
    def get_routes(
        self,
        origin_lat: float,
        origin_lng: float,
        dest_lat: float,
        dest_lng: float,
        mode: str = "walking",
    ) -> RoutingResult:
        """
        Fetch candidate routes between origin and destination.

        Args:
            origin_lat, origin_lng: WGS-84 coordinates of start point
            dest_lat, dest_lng    : WGS-84 coordinates of end point
            mode                  : Travel mode string ("walking" | "delivery_rider")

        Returns:
            RoutingResult with at least one CandidateRoute, or raises on failure.
        """
        ...
