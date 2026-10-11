"""
HeatShield Deterministic Environmental Exposure Engine  (v2)

IMPORTANT DISCLAIMERS:
- This engine produces an "Estimated Environmental Exposure" score only.
- It does NOT claim medical safety, health protection, or individual risk.
- It does NOT claim scientific or physiological precision.
- All calculations are deterministic and fully inspectable.
- No AI/LLM is involved in producing the numeric score.
- "Risk level" means estimated exposure band, NOT a medical risk classification.

=========================================================================
EXPOSURE MODEL v2 — formula reference
=========================================================================

Step 1 — Environmental component (0–85 pts max)

  Factor             Max pts  Formula
  ─────────────────────────────────────────────────────────────────────
  Temperature        0–40     linear_scale(T, TEMP_MIN, TEMP_MAX, 40)
  Humidity           0–25     linear_scale(H, HUM_MIN,  HUM_MAX,  25)
  Solar × cloud      0–20     linear_scale(effective_solar, 0, 10, 20)
                               effective_solar = solar_index × (1 - cloud_factor)
                               cloud_factor    = cloud_cover_pct / 100
  Wind (reduces)     0–10     linear_scale(W, 0, WIND_MAX, 10)  [subtracted]
  ─────────────────────────────────────────────────────────────────────
  env_score = clamp(temp + hum + solar_adj - wind_reduction, 0, 85)

Step 2 — Duration component (0–15 pts max)

  duration_minutes = duration_seconds / 60
  duration_pts     = linear_scale(duration_minutes, 0, DURATION_MAX, 15)

Step 3 — Mode exertion multiplier

  walking         → ×1.00
  delivery_rider  → ×1.15

Step 4 — Final score

  combined    = env_score + duration_pts
  final_score = clamp(round(combined × mode_multiplier), 0, 100)

Risk thresholds (estimated exposure bands — NOT medical risk levels):
  0–25   → LOW
  26–50  → MODERATE
  51–75  → HIGH
  76–100 → VERY_HIGH
=========================================================================
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from heat.models import (
    ConfidenceLevel,
    DataFreshness,
    EnvironmentalObservation,
    ExposureContributor,
    ExposureResult,
    RiskLevel,
    RouteInput,
    TravelMode,
)

logger = logging.getLogger("heatshield.engine")

# ---------------------------------------------------------------------------
# EXPOSURE_MODEL_CONFIG — single source of truth for all model constants.
# Adjust here; every calculation derives from these values.
# ---------------------------------------------------------------------------

EXPOSURE_MODEL_CONFIG = {
    # Temperature scoring
    "TEMP_MIN_C": 20.0,       # below this → 0 temperature points
    "TEMP_MAX_C": 45.0,       # at or above → TEMP_WEIGHT points
    "TEMP_WEIGHT": 40.0,      # max contribution from temperature

    # Humidity scoring
    "HUM_MIN_PCT": 30.0,      # below this → 0 humidity points
    "HUM_MAX_PCT": 100.0,     # at or above → HUM_WEIGHT points
    "HUM_WEIGHT": 25.0,       # max contribution from humidity

    # Solar scoring
    # solar_index is modulated by cloud_cover_pct before scoring.
    "SOLAR_MAX_INDEX": 10.0,  # maximum plausible solar index value
    "SOLAR_WEIGHT": 20.0,     # max contribution from solar radiation

    # Wind (reduces score)
    "WIND_MAX_KMH": 30.0,     # at or above → full WIND_REDUCTION_MAX reduction
    "WIND_REDUCTION_MAX": 10.0,

    # Duration
    "DURATION_MAX_MINUTES": 120.0,  # at or above → full DURATION_WEIGHT pts
    "DURATION_WEIGHT": 15.0,        # max contribution from trip duration

    # Environmental component cap (before duration + mode)
    "ENV_SCORE_CAP": 85.0,

    # Mode exertion multipliers
    # These represent relative cardiovascular exertion load, NOT physiological measurements.
    "MODE_EXERTION": {
        "walking": 1.00,
        "delivery_rider": 1.15,
    },

    # Risk thresholds (estimated exposure bands, NOT medical classifications)
    # Score → risk_level: score <= threshold maps to that level.
    "RISK_THRESHOLDS": [
        (25,  "LOW"),
        (50,  "MODERATE"),
        (75,  "HIGH"),
        (100, "VERY_HIGH"),
    ],
}

# Convenience aliases so engine code stays readable
_C = EXPOSURE_MODEL_CONFIG
TEMP_MIN_C          = _C["TEMP_MIN_C"]
TEMP_MAX_C          = _C["TEMP_MAX_C"]
TEMP_WEIGHT         = _C["TEMP_WEIGHT"]
HUM_MIN_PCT         = _C["HUM_MIN_PCT"]
HUM_MAX_PCT         = _C["HUM_MAX_PCT"]
HUM_WEIGHT          = _C["HUM_WEIGHT"]
SOLAR_MAX_INDEX     = _C["SOLAR_MAX_INDEX"]
SOLAR_WEIGHT        = _C["SOLAR_WEIGHT"]
WIND_MAX_KMH        = _C["WIND_MAX_KMH"]
WIND_REDUCTION_MAX  = _C["WIND_REDUCTION_MAX"]
DURATION_MAX_MINUTES= _C["DURATION_MAX_MINUTES"]
DURATION_WEIGHT     = _C["DURATION_WEIGHT"]
ENV_SCORE_CAP       = _C["ENV_SCORE_CAP"]

MODE_EXERTION: dict[TravelMode, float] = {
    TravelMode(k): v for k, v in _C["MODE_EXERTION"].items()
}

RISK_THRESHOLDS: list[tuple[int, RiskLevel]] = [
    (threshold, RiskLevel(level))
    for threshold, level in _C["RISK_THRESHOLDS"]
]

# ---------------------------------------------------------------------------
# Pure helper functions — no state, fully testable in isolation
# ---------------------------------------------------------------------------

def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _linear_scale(value: float, v_min: float, v_max: float, weight: float) -> float:
    """Map value linearly from [v_min, v_max] → [0, weight], clamped at both ends."""
    if v_max <= v_min:
        return 0.0
    fraction = (value - v_min) / (v_max - v_min)
    return _clamp(fraction * weight, 0.0, weight)


def _effective_solar(solar_index: float, cloud_cover_pct: float) -> float:
    """
    Apply cloud cover as a linear reduction to the raw solar index.
    100% cloud cover halves solar; 0% cloud cover leaves it unchanged.
    This is a directional proxy, not a radiative transfer model.
    """
    cloud_factor = _clamp(cloud_cover_pct, 0.0, 100.0) / 100.0
    return solar_index * (1.0 - 0.5 * cloud_factor)


def _classify_risk(score: int) -> RiskLevel:
    for threshold, level in RISK_THRESHOLDS:
        if score <= threshold:
            return level
    return RiskLevel.VERY_HIGH


def _demo_freshness_note(source: str) -> str:
    return (
        "DEMO ENVIRONMENTAL DATA — not live weather. "
        "Environmental values are fixed demonstration data, not real measurements. "
        "Replace DemoEnvironmentalProvider with a live source before production."
    )


def _live_freshness_note(freshness: DataFreshness | None) -> str:
    if freshness and freshness.age_minutes is not None:
        return f"Live data from '{freshness.source_label}', {freshness.age_minutes:.0f} min old."
    return "Live data."


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class HeatExposureEngine:
    """
    Deterministic environmental exposure engine.

    Same inputs → same output, every time. No randomness. No AI inference.
    Environmental providers can be swapped without modifying this class.

    DISCLAIMER: Produces "estimated environmental exposure" scores only.
    Not a medical, clinical, or physiological assessment tool.
    """

    def calculate(
        self,
        route: RouteInput,
        observation: EnvironmentalObservation,
    ) -> ExposureResult:
        """
        Compute an ExposureResult for a route + environmental snapshot.

        Args:
            route       : RouteInput (distance_meters, duration_seconds, mode)
            observation : EnvironmentalObservation from any provider

        Returns:
            ExposureResult with score, risk band, contributors, confidence, freshness.
        """
        validation_warnings = observation.validate()
        if validation_warnings:
            for w in validation_warnings:
                logger.warning("Environmental observation validation: %s", w)

        contributors: list[ExposureContributor] = []

        # ── 1. Temperature ──────────────────────────────────────────────────
        temp_pts = _linear_scale(
            observation.temperature_c, TEMP_MIN_C, TEMP_MAX_C, TEMP_WEIGHT
        )
        contributors.append(ExposureContributor(
            name="temperature",
            display_name="High temperature" if temp_pts >= TEMP_WEIGHT * 0.5 else "Temperature",
            raw_value=observation.temperature_c,
            unit="°C",
            points_contributed=round(temp_pts, 2),
        ))

        # ── 2. Humidity ─────────────────────────────────────────────────────
        humidity_pts = _linear_scale(
            observation.humidity_pct, HUM_MIN_PCT, HUM_MAX_PCT, HUM_WEIGHT
        )
        contributors.append(ExposureContributor(
            name="humidity",
            display_name="Elevated humidity" if humidity_pts >= HUM_WEIGHT * 0.4 else "Humidity",
            raw_value=observation.humidity_pct,
            unit="%",
            points_contributed=round(humidity_pts, 2),
        ))

        # ── 3. Solar radiation (cloud-adjusted) ─────────────────────────────
        eff_solar = _effective_solar(observation.solar_index, observation.cloud_cover_pct)
        solar_pts = _linear_scale(eff_solar, 0.0, SOLAR_MAX_INDEX, SOLAR_WEIGHT)
        contributors.append(ExposureContributor(
            name="solar_radiation",
            display_name=(
                "Strong solar exposure" if solar_pts >= SOLAR_WEIGHT * 0.6
                else "Moderate solar exposure" if solar_pts >= SOLAR_WEIGHT * 0.3
                else "Low solar exposure"
            ),
            raw_value=round(eff_solar, 2),
            unit="effective index (0–10)",
            points_contributed=round(solar_pts, 2),
        ))

        # ── 4. Wind (reduces score) ─────────────────────────────────────────
        wind_reduction = _linear_scale(
            observation.wind_speed_kmh, 0.0, WIND_MAX_KMH, WIND_REDUCTION_MAX
        )
        contributors.append(ExposureContributor(
            name="wind_speed",
            display_name=(
                "Good wind cooling" if wind_reduction >= WIND_REDUCTION_MAX * 0.5
                else "Limited wind cooling"
            ),
            raw_value=observation.wind_speed_kmh,
            unit="km/h",
            points_contributed=round(-wind_reduction, 2),  # negative = exposure reduction
        ))

        # ── 5. Cloud cover (informational — already baked into solar_pts) ───
        # We record cloud cover as a contributor for transparency.
        # Its effect is already captured via _effective_solar; this entry
        # is informational only (points_contributed = 0).
        contributors.append(ExposureContributor(
            name="cloud_cover",
            display_name=(
                "Cloud cover reduces solar load"
                if observation.cloud_cover_pct >= 40.0
                else "Mostly clear sky"
            ),
            raw_value=observation.cloud_cover_pct,
            unit="%",
            points_contributed=0.0,   # effect already in solar_pts
        ))

        # ── 6. Exposure duration ─────────────────────────────────────────────
        duration_minutes = route.duration_seconds / 60.0
        duration_pts = _linear_scale(
            duration_minutes, 0.0, DURATION_MAX_MINUTES, DURATION_WEIGHT
        )
        contributors.append(ExposureContributor(
            name="exposure_duration",
            display_name=f"{round(duration_minutes)} min outdoor duration",
            raw_value=round(duration_minutes, 1),
            unit="minutes",
            points_contributed=round(duration_pts, 2),
        ))

        # ── 7. Combine env score ─────────────────────────────────────────────
        env_score = _clamp(
            temp_pts + humidity_pts + solar_pts - wind_reduction,
            0.0,
            ENV_SCORE_CAP,
        )
        combined = env_score + duration_pts

        # ── 8. Mode exertion multiplier ─────────────────────────────────────
        mode_mult = MODE_EXERTION.get(route.mode, 1.00)
        raw_final = combined * mode_mult
        final_score = int(_clamp(round(raw_final), 0, 100))

        # ── 9. Risk classification ───────────────────────────────────────────
        risk = _classify_risk(final_score)

        # ── 10. Freshness metadata ───────────────────────────────────────────
        obs_freshness = observation.freshness or DataFreshness(
            status=observation.confidence,
            observed_at=None,
            age_minutes=None,
            source_label=observation.data_source,
        )
        freshness_note = (
            _demo_freshness_note(observation.data_source)
            if observation.is_demo
            else _live_freshness_note(obs_freshness)
        )

        logger.info(
            "Exposure score: %d (%s) | mode=%s mult=%.2f | "
            "T=%.1fC H=%.0f%% solar=%.1f cloud=%.0f%% wind=%.1fkm/h dur=%.1fmin",
            final_score, risk.value, route.mode.value, mode_mult,
            observation.temperature_c, observation.humidity_pct,
            observation.solar_index, observation.cloud_cover_pct,
            observation.wind_speed_kmh, duration_minutes,
        )

        return ExposureResult(
            estimated_exposure_score=final_score,
            risk_level=risk,
            contributors=contributors,
            mode_exertion_multiplier=mode_mult,
            data_source=observation.data_source,
            is_demo_data=observation.is_demo,
            confidence=observation.confidence,
            freshness=obs_freshness,
            data_freshness_note=freshness_note,
            validation_warnings=validation_warnings,
            raw_unrounded_score=round(raw_final, 4),
        )
