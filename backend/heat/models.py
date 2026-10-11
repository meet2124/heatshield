"""
HeatShield Heat Exposure — data models.

IMPORTANT SCIENTIFIC DISCLAIMERS:
- All scores are "estimated environmental exposure" only.
- No medical, physiological, or health-safety claims are made or implied.
- No AI/LLM computes numeric scores.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Literal


class TravelMode(str, Enum):
    WALKING = "walking"
    DELIVERY_RIDER = "delivery_rider"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MODERATE = "MODERATE"
    HIGH = "HIGH"
    VERY_HIGH = "VERY_HIGH"


class ConfidenceLevel(str, Enum):
    """
    How trustworthy is the environmental observation?

    DEMO         — Fixed demonstration values; not measured.
    LOW          — Observed but stale or incomplete.
    MEDIUM       — Reasonably fresh from a reliable source.
    HIGH         — Fresh, validated, multi-sensor data.
    """
    DEMO = "DEMO"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


@dataclass(frozen=True)
class DataFreshness:
    """
    Structured metadata about how current the environmental observation is.

    Fields:
        status          : ConfidenceLevel value describing the observation quality.
        observed_at     : ISO-8601 UTC timestamp of when data was collected
                          (None for DEMO data — no real observation exists).
        age_minutes     : Minutes since observation (None for DEMO data).
        source_label    : Human-readable description of the data source.
    """
    status: ConfidenceLevel
    observed_at: str | None        # ISO-8601 UTC, or None for DEMO
    age_minutes: float | None      # None for DEMO
    source_label: str


@dataclass(frozen=True)
class EnvironmentalObservation:
    """
    Snapshot of environmental conditions at a point in time.
    All fields are physically-measured or proxy values — not invented by AI.

    Units:
      temperature_c       : degrees Celsius
      humidity_pct        : relative humidity 0–100
      solar_index         : proxy for solar radiation intensity 0.0–10.0
                            (e.g. UV index, or clear-sky factor × 10)
      wind_speed_kmh      : wind speed in km/h
      cloud_cover_pct     : cloud cover 0–100 (0 = clear sky, 100 = overcast)
                            Used as a modifier on solar exposure.
      data_source         : identifier for where this observation came from
      is_demo             : True when no live data source is available
      confidence          : ConfidenceLevel indicating data quality
      freshness           : Structured freshness metadata
    """
    temperature_c: float
    humidity_pct: float
    solar_index: float              # 0.0–10.0
    wind_speed_kmh: float
    cloud_cover_pct: float          # 0–100
    data_source: str
    is_demo: bool = True
    confidence: ConfidenceLevel = ConfidenceLevel.DEMO
    freshness: DataFreshness | None = None

    def validate(self) -> list[str]:
        """Return a list of validation warnings. Empty list = all OK."""
        warnings: list[str] = []
        if not (-30 <= self.temperature_c <= 60):
            warnings.append(
                f"temperature_c={self.temperature_c} is outside plausible range (-30–60 °C)"
            )
        if not (0 <= self.humidity_pct <= 100):
            warnings.append(f"humidity_pct={self.humidity_pct} is outside 0–100")
        if not (0.0 <= self.solar_index <= 10.0):
            warnings.append(f"solar_index={self.solar_index} is outside 0.0–10.0")
        if not (0 <= self.wind_speed_kmh <= 200):
            warnings.append(f"wind_speed_kmh={self.wind_speed_kmh} is outside plausible range")
        if not (0 <= self.cloud_cover_pct <= 100):
            warnings.append(f"cloud_cover_pct={self.cloud_cover_pct} is outside 0–100")
        return warnings


@dataclass(frozen=True)
class RouteInput:
    """Minimal route information needed by the exposure engine."""
    distance_meters: float
    duration_seconds: float
    mode: TravelMode
    # geometry is not needed for scoring — only distance + duration matter


@dataclass
class ExposureContributor:
    """A single named factor and its numeric contribution to the final score."""
    name: str                       # internal key
    display_name: str               # human-readable label for UI
    raw_value: float                # the actual measured/derived value
    unit: str
    points_contributed: float       # contribution to the 0–100 score (negative = reduction)


@dataclass
class ExposureResult:
    """
    Output of the HeatExposureEngine.
    All fields are deterministic — no randomness, no AI inference.

    DISCLAIMER: This score represents estimated environmental exposure only.
    It is NOT a medical risk score, health safety assessment, or physiological prediction.
    """
    estimated_exposure_score: int           # 0–100
    risk_level: RiskLevel
    contributors: list[ExposureContributor]
    mode_exertion_multiplier: float
    data_source: str
    is_demo_data: bool
    confidence: ConfidenceLevel
    freshness: DataFreshness
    data_freshness_note: str
    validation_warnings: list[str] = field(default_factory=list)
    raw_unrounded_score: float = 0.0
