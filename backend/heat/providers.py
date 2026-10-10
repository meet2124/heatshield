"""
HeatShield Environmental Providers.

Defines the EnvironmentalProvider interface and available implementations.

IMPORTANT: DemoEnvironmentalProvider returns clearly-labelled DEMO DATA.
It is NOT live weather. It is NOT scientifically measured.
It exists solely to allow local development and testing without external API keys.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone

from heat.models import ConfidenceLevel, DataFreshness, EnvironmentalObservation


class EnvironmentalProvider(ABC):
    """
    Abstract interface for all environmental data sources.

    Implementations must be deterministic given the same inputs.
    Providers must label data correctly via is_demo, confidence, and freshness.

    Contract:
    - get_observation() must always return a fully-populated EnvironmentalObservation.
    - is_demo must be True unless the data comes from a verified live source.
    - confidence must accurately reflect data quality.
    - freshness.observed_at must be None for DEMO data.
    """

    @abstractmethod
    def get_observation(self, lat: float, lng: float) -> EnvironmentalObservation:
        """
        Return an EnvironmentalObservation for the given location.

        Args:
            lat: latitude of the midpoint or origin of the route
            lng: longitude of the midpoint or origin of the route

        Returns:
            EnvironmentalObservation with all required fields populated.
        """
        ...


# ---------------------------------------------------------------------------
# DEMO PROVIDER
# ---------------------------------------------------------------------------

_DEMO_FRESHNESS = DataFreshness(
    status=ConfidenceLevel.DEMO,
    observed_at=None,       # No real observation — do not fabricate a timestamp
    age_minutes=None,
    source_label="HeatShield Demo Environmental Provider",
)

# Pre-defined deterministic demo scenarios keyed by a readable label.
# These are NOT real measurements. They are fixed reference points for
# development, testing, and demo purposes only.
#
# HOT INDIAN SUMMER scenario added as the primary hackathon demo:
# Represents typical summer afternoon conditions in inland India (Gujarat/Rajasthan band).
# Does NOT claim to represent weather at any specific location or time.
DEMO_SCENARIOS: dict[str, dict] = {
    "cool_morning": {
        "temperature_c": 22.0,
        "humidity_pct": 45.0,
        "solar_index": 2.0,
        "wind_speed_kmh": 15.0,
        "cloud_cover_pct": 30.0,
    },
    "warm_midday": {
        "temperature_c": 32.0,
        "humidity_pct": 60.0,
        "solar_index": 7.0,
        "wind_speed_kmh": 8.0,
        "cloud_cover_pct": 20.0,
    },
    "hot_afternoon": {
        "temperature_c": 40.0,
        "humidity_pct": 30.0,
        "solar_index": 9.5,
        "wind_speed_kmh": 5.0,
        "cloud_cover_pct": 5.0,
    },
    "humid_tropical": {
        "temperature_c": 35.0,
        "humidity_pct": 90.0,
        "solar_index": 6.0,
        "wind_speed_kmh": 3.0,
        "cloud_cover_pct": 40.0,
    },
    # Primary hackathon demo scenario:
    # Typical hot Indian summer afternoon — inland plains (Gujarat/Rajasthan band).
    # Temp ~42°C, high solar load, low humidity, light wind.
    # Does NOT claim to represent Bardoli, Ahmedabad, or any specific location.
    "hot_indian_summer": {
        "temperature_c": 42.0,
        "humidity_pct": 25.0,
        "solar_index": 9.8,
        "wind_speed_kmh": 4.0,
        "cloud_cover_pct": 5.0,
    },
}

_DEFAULT_DEMO_SCENARIO = "warm_midday"


class DemoEnvironmentalProvider(EnvironmentalProvider):
    """
    DEMO DATA — NOT LIVE WEATHER.

    Returns a fixed, pre-defined environmental observation.
    Designed for local development and hackathon demos only.
    Will be replaced by a real weather API provider before production.

    The scenario can be set at construction time to simulate different
    conditions deterministically (used by unit tests).

    All returned observations have:
      is_demo     = True
      confidence  = DEMO
      freshness.observed_at = None  (no real timestamp — we do not fabricate one)
    """

    def __init__(self, scenario: str = _DEFAULT_DEMO_SCENARIO) -> None:
        if scenario not in DEMO_SCENARIOS:
            raise ValueError(
                f"Unknown demo scenario '{scenario}'. "
                f"Valid options: {list(DEMO_SCENARIOS.keys())}"
            )
        self._scenario = scenario
        self._data = DEMO_SCENARIOS[scenario]

    def get_observation(self, lat: float, lng: float) -> EnvironmentalObservation:  # noqa: ARG002
        # lat/lng ignored in demo mode — observation is scenario-fixed.
        return EnvironmentalObservation(
            temperature_c=self._data["temperature_c"],
            humidity_pct=self._data["humidity_pct"],
            solar_index=self._data["solar_index"],
            wind_speed_kmh=self._data["wind_speed_kmh"],
            cloud_cover_pct=self._data["cloud_cover_pct"],
            data_source=f"DemoEnvironmentalProvider[scenario={self._scenario}]",
            is_demo=True,
            confidence=ConfidenceLevel.DEMO,
            freshness=_DEMO_FRESHNESS,
        )
