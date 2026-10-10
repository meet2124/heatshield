"""
OpenMeteoEnvironmentalProvider — integrates the Open-Meteo forecast API.

Open-Meteo is a free, open-source weather API for non-commercial use.
Documentation: https://open-meteo.com/en/docs
Terms:         https://open-meteo.com/en/terms

SCIENTIFIC LIMITATIONS (documented honestly):
  1. Open-Meteo "current" conditions are derived from the latest NWP model run,
     NOT direct measurements from a weather station at the given coordinates.
     The label used is "Current Weather Estimate" to reflect this accurately.
     Conditions may differ from exact point values on the ground.
  2. solar_index is mapped from Open-Meteo's UV index (0–11+ scale), clamped
     to 0–10.  UV index and solar irradiance are correlated but not identical:
     UV index reflects the erythemally-weighted part of the solar spectrum,
     not total solar energy.  This mapping is a directional proxy used to
     estimate solar load on the exposure score; it does not claim radiometric
     precision or represent measured solar irradiance.
  3. cloud_cover is % sky obscured by cloud.  It is used as a modifier on the
     solar proxy in HeatExposureEngine.  It is NOT a direct shade measurement
     along the route.
  4. The environmental observation is taken at the route's ORIGIN coordinates.
     Conditions may vary along the route.  This is documented in the response.
  5. Open-Meteo current data has a 15-minute update interval (interval=900 s).
     NWP model output may be published slightly ahead of the wall-clock boundary,
     which can produce a small negative age (see CLOCK_SKEW_TOLERANCE below).
     Any age more negative than the tolerance is classified LOW confidence.

UNIT CONVERSIONS:
  temperature_2m        →  temperature_c      : no conversion (both °C)
  relative_humidity_2m  →  humidity_pct       : no conversion (both %)
  wind_speed_10m (m/s)  →  wind_speed_kmh     : multiply by 3.6
  cloud_cover           →  cloud_cover_pct    : no conversion (both %)
  uv_index              →  solar_index        : clamp to [0.0, 10.0]
  current.time (ISO8601) → observed_at (UTC ISO-8601 with 'Z' suffix)

FRESHNESS THRESHOLDS:
  -CLOCK_SKEW_TOLERANCE <= age <= FRESH_THRESHOLD  → MEDIUM confidence
  age > FRESH_THRESHOLD                             → LOW confidence (stale)
  age < -CLOCK_SKEW_TOLERANCE                      → LOW confidence (future-dated)
  missing/unparseable timestamp                     → LOW confidence (unknown)

  CLOCK_SKEW_TOLERANCE = 5 minutes.
  Justification: Open-Meteo quantizes timestamps to 15-minute slots and
  publishes model output that may arrive up to a few minutes before the
  wall-clock reaches that slot boundary.  A 5-minute tolerance accommodates
  normal NWP publication timing without hiding genuinely future-dated data.
"""
from __future__ import annotations

import json
import logging
import math
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta

from heat.models import ConfidenceLevel, DataFreshness, EnvironmentalObservation

logger = logging.getLogger("heatshield.providers.open_meteo")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE_URL = "https://api.open-meteo.com/v1/forecast"
_USER_AGENT = "HeatShield/1.0 (hackathon; non-commercial)"

# Variables requested from Open-Meteo current conditions
_CURRENT_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "cloud_cover",
    "uv_index",
]

# Connection and read timeouts (seconds)
_TIMEOUT_SECONDS = 10

# Freshness thresholds
_FRESH_THRESHOLD_MINUTES = 30.0   # <= 30 min → MEDIUM confidence

# Maximum tolerated negative age (minutes) before an observation is classified
# as suspiciously future-dated.
#
# Justification: Open-Meteo quantizes timestamps to 15-minute slots and NWP
# model output can be published slightly before the wall-clock reaches the slot
# boundary, producing a small negative age.  A 5-minute tolerance accommodates
# normal NWP publication latency without silently accepting genuinely future
# timestamps as fresh.
_CLOCK_SKEW_TOLERANCE_MINUTES = 5.0

_DATA_SOURCE_LABEL = "Open-Meteo · Current Weather Estimate (NWP model)"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _validate_coordinates(lat: float, lng: float) -> None:
    """Raise ValueError for coordinates that are out of WGS-84 bounds."""
    if not math.isfinite(lat) or not (-90.0 <= lat <= 90.0):
        raise ValueError(f"Invalid latitude: {lat!r}. Must be -90 to +90.")
    if not math.isfinite(lng) or not (-180.0 <= lng <= 180.0):
        raise ValueError(f"Invalid longitude: {lng!r}. Must be -180 to +180.")


def _build_url(lat: float, lng: float) -> str:
    """Build the Open-Meteo request URL for current conditions."""
    params = {
        "latitude": str(round(lat, 6)),
        "longitude": str(round(lng, 6)),
        "current": ",".join(_CURRENT_VARS),
        "wind_speed_unit": "ms",   # request m/s; we convert to km/h ourselves
        "timezone": "UTC",          # always UTC to simplify timestamp arithmetic
    }
    return f"{_BASE_URL}?{urllib.parse.urlencode(params)}"


def _parse_timestamp(raw_time: str) -> tuple[str, float | None]:
    """
    Parse the Open-Meteo current.time field (ISO 8601, no seconds, no Z suffix)
    and return (observed_at_iso_z, age_minutes).

    Open-Meteo returns e.g. "2026-10-09T14:45" in the timezone requested
    (we always request UTC).  We normalise to UTC ISO-8601 with 'Z' suffix.

    Returns (observed_at, age_minutes).
    If parsing fails, returns (None, None).
    """
    if not raw_time:
        return (None, None)  # type: ignore[return-value]
    try:
        # Tolerate both "2026-10-09T14:45" and "2026-10-09T14:45:00"
        for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
            try:
                dt = datetime.strptime(raw_time, fmt).replace(tzinfo=timezone.utc)
                break
            except ValueError:
                continue
        else:
            logger.warning("Could not parse Open-Meteo timestamp: %r", raw_time)
            return (None, None)  # type: ignore[return-value]

        now_utc = datetime.now(tz=timezone.utc)
        age_minutes = (now_utc - dt).total_seconds() / 60.0
        observed_at = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        return observed_at, age_minutes
    except Exception as exc:
        logger.warning("Timestamp parse error (%s): %r", exc, raw_time)
        return (None, None)  # type: ignore[return-value]


def _classify_freshness(age_minutes: float | None) -> ConfidenceLevel:
    """
    Classify data freshness into a ConfidenceLevel.

    age_minutes is the signed age: positive means past, negative means the
    observation timestamp is in the future relative to the server clock.

    Future-dated observations beyond the clock-skew tolerance are classified
    LOW (suspicious).  Small negative ages within the tolerance are treated
    as MEDIUM (normal NWP publication timing).
    """
    if age_minutes is None:
        return ConfidenceLevel.LOW   # unknown age → conservative
    if age_minutes < -_CLOCK_SKEW_TOLERANCE_MINUTES:
        # Observation timestamp is more than tolerance minutes in the future.
        # This should not happen from a correctly operating provider.
        # Log it and return LOW rather than silently treating it as fresh.
        logger.warning(
            "Open-Meteo observation timestamp is %.1f min in the future "
            "(beyond clock-skew tolerance of %.1f min). Classifying as LOW confidence.",
            -age_minutes,
            _CLOCK_SKEW_TOLERANCE_MINUTES,
        )
        return ConfidenceLevel.LOW
    if age_minutes <= _FRESH_THRESHOLD_MINUTES:
        return ConfidenceLevel.MEDIUM
    return ConfidenceLevel.LOW


def _extract_float(current: dict, key: str) -> float:
    """
    Extract a required float field from Open-Meteo's current dict.
    Raises RuntimeError if missing, None, or not finite.
    """
    value = current.get(key)
    if value is None:
        raise RuntimeError(
            f"Open-Meteo response missing required field '{key}'."
        )
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise RuntimeError(
            f"Open-Meteo field '{key}' is not a valid number: {value!r}"
        )
    if not math.isfinite(f):
        raise RuntimeError(
            f"Open-Meteo field '{key}' is not finite: {f!r}"
        )
    return f


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class OpenMeteoEnvironmentalProvider:
    """
    Real environmental data provider backed by Open-Meteo.

    Conforms to the EnvironmentalProvider interface (duck-typed).

    Returns EnvironmentalObservation with:
      is_demo = False
      data_source = "Open-Meteo (NWP model-derived current conditions)"
      freshness.observed_at = actual UTC timestamp from the API response
      confidence = MEDIUM (fresh) or LOW (stale/unknown)

    Does NOT fall back silently to demo data on failure — raises RuntimeError.
    Callers must handle the error and surface it appropriately.
    """

    def get_observation(self, lat: float, lng: float) -> EnvironmentalObservation:
        """
        Fetch current conditions from Open-Meteo for (lat, lng).

        Raises:
            ValueError    — invalid coordinates
            RuntimeError  — network failure, API error, malformed response,
                            missing/invalid fields
        """
        _validate_coordinates(lat, lng)

        url = _build_url(lat, lng)
        req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})

        try:
            with urllib.request.urlopen(req, timeout=_TIMEOUT_SECONDS) as resp:
                body = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                raise RuntimeError(
                    "Open-Meteo rate limit exceeded (HTTP 429). Try again later."
                )
            raise RuntimeError(
                f"Open-Meteo returned HTTP {exc.code}: {exc.reason}"
            )
        except urllib.error.URLError as exc:
            raise RuntimeError(
                f"Open-Meteo connection failure: {exc.reason}"
            )
        except TimeoutError:
            raise RuntimeError(
                f"Open-Meteo request timed out after {_TIMEOUT_SECONDS}s."
            )

        # Parse JSON
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            raise RuntimeError("Open-Meteo returned malformed JSON.")

        current = data.get("current")
        if not isinstance(current, dict):
            raise RuntimeError(
                "Open-Meteo response missing 'current' object."
            )

        # Extract required fields — each raises RuntimeError on failure
        temperature_c   = _extract_float(current, "temperature_2m")
        humidity_pct    = _extract_float(current, "relative_humidity_2m")
        wind_speed_ms   = _extract_float(current, "wind_speed_10m")
        cloud_cover_pct = _extract_float(current, "cloud_cover")
        uv_index        = _extract_float(current, "uv_index")

        # Unit conversions
        # wind: m/s → km/h
        wind_speed_kmh = wind_speed_ms * 3.6

        # solar_index: UV index is correlated with solar radiation.
        # Open-Meteo UV index runs from 0 to ~11+ (theoretically unbounded).
        # We map it to 0–10 by clamping.  This is a directional proxy only;
        # UV index measures erythemally-weighted UV, not total solar irradiance.
        solar_index = max(0.0, min(10.0, uv_index))

        # Timestamp and freshness
        raw_time = current.get("time", "")
        observed_at, age_minutes = _parse_timestamp(raw_time)
        confidence = _classify_freshness(age_minutes)

        freshness = DataFreshness(
            status=confidence,
            observed_at=observed_at,
            age_minutes=round(age_minutes, 1) if age_minutes is not None else None,
            source_label=_DATA_SOURCE_LABEL,
        )

        logger.info(
            "Open-Meteo observation: lat=%.4f lng=%.4f T=%.1f°C RH=%.0f%% "
            "wind=%.2fm/s(%.2fkm/h) cloud=%.0f%% UV=%.2f→solar=%.2f "
            "observed_at=%s age=%.1fmin confidence=%s",
            lat, lng,
            temperature_c, humidity_pct,
            wind_speed_ms, wind_speed_kmh,
            cloud_cover_pct, uv_index, solar_index,
            observed_at, age_minutes if age_minutes is not None else -1,
            confidence.value,
        )

        return EnvironmentalObservation(
            temperature_c=temperature_c,
            humidity_pct=humidity_pct,
            solar_index=solar_index,
            wind_speed_kmh=wind_speed_kmh,
            cloud_cover_pct=cloud_cover_pct,
            data_source=_DATA_SOURCE_LABEL,
            is_demo=False,
            confidence=confidence,
            freshness=freshness,
        )
