"""
Unit tests for OpenMeteoEnvironmentalProvider.

All tests use mocked HTTP responses.
NO live network requests are made during this test suite.

Coverage:
  OM1   Correct request URL structure and parameters
  OM2   Temperature mapping (°C → temperature_c, no conversion)
  OM3   Humidity mapping (% → humidity_pct, no conversion)
  OM4   Wind speed unit conversion (m/s × 3.6 → km/h)
  OM5   Cloud cover mapping (% → cloud_cover_pct, no conversion)
  OM6   Solar index: UV index clamped to [0, 10]
  OM7   Timestamp parsed correctly to ISO-8601 UTC with Z suffix
  OM8   Real observations marked as is_demo=False
  OM9   Missing observation timestamp → age_minutes=None, confidence=LOW
  OM10  Stale observation (>30 min old) → confidence=LOW
  OM11  Fresh observation (<=30 min old) → confidence=MEDIUM
  OM12  Invalid latitude raises ValueError (no network call)
  OM13  Invalid longitude raises ValueError (no network call)
  OM14  Network timeout raises RuntimeError, not silently swallowed
  OM15  HTTP 4xx error raises RuntimeError
  OM16  HTTP 429 raises RuntimeError mentioning rate limit
  OM17  Malformed JSON raises RuntimeError
  OM18  Missing 'current' key in response raises RuntimeError
  OM19  Missing individual field raises RuntimeError
  OM20  Non-finite field value raises RuntimeError
  OM21  UV index above 10 is clamped to 10.0
  OM22  One observation is reused across multiple routes (recommender integration)
  OM23  Selected real-provider failure does NOT fall back to demo
  OM24  Demo provider still marks is_demo=True (not affected by new provider)
  OM25  Future-dated observation beyond clock-skew tolerance → LOW confidence
  OM26  Future-dated observation within clock-skew tolerance → MEDIUM confidence
"""
import sys
import os
import json
import unittest
from unittest.mock import patch, MagicMock
from datetime import datetime, timezone, timedelta
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from heat.open_meteo import OpenMeteoEnvironmentalProvider, _parse_timestamp, _build_url
from heat.models import ConfidenceLevel
from heat.providers import DemoEnvironmentalProvider


def _make_current(**overrides) -> dict:
    """Build a minimal valid Open-Meteo current dict, with optional overrides."""
    base = {
        "time": "2026-10-09T12:00",
        "interval": 900,
        "temperature_2m": 25.0,
        "relative_humidity_2m": 55.0,
        "wind_speed_10m": 3.0,
        "cloud_cover": 40.0,
        "uv_index": 5.0,
    }
    base.update(overrides)
    return base


def _make_response(current: dict | None = None) -> bytes:
    """Wrap a current dict in a minimal Open-Meteo FeatureCollection-style response."""
    payload = {
        "latitude": 51.49,
        "longitude": -0.13,
        "timezone": "GMT",
        "current_units": {
            "temperature_2m": "°C",
            "relative_humidity_2m": "%",
            "wind_speed_10m": "m/s",
            "cloud_cover": "%",
            "uv_index": "",
        },
        "current": current if current is not None else _make_current(),
    }
    return json.dumps(payload).encode("utf-8")


def _mock_urlopen(response_bytes: bytes):
    """Return a context manager mock that yields a response with given bytes."""
    mock_resp = MagicMock()
    mock_resp.read.return_value = response_bytes
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)
    return mock_resp


class TestOpenMeteoProvider(unittest.TestCase):

    def setUp(self):
        self.provider = OpenMeteoEnvironmentalProvider()

    # ── OM1: URL structure ────────────────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om1_request_url_structure(self, mock_urlopen):
        mock_urlopen.return_value = _mock_urlopen(_make_response())
        self.provider.get_observation(lat=51.5, lng=-0.12)

        req = mock_urlopen.call_args[0][0]
        url = req.full_url
        self.assertIn("api.open-meteo.com", url)
        self.assertIn("latitude=51.5", url)
        self.assertIn("longitude=-0.12", url)
        self.assertIn("temperature_2m", url)
        self.assertIn("relative_humidity_2m", url)
        self.assertIn("wind_speed_10m", url)
        self.assertIn("cloud_cover", url)
        self.assertIn("uv_index", url)
        self.assertIn("wind_speed_unit=ms", url)
        self.assertIn("timezone=UTC", url)

    # ── OM2: Temperature ─────────────────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om2_temperature_mapping(self, mock_urlopen):
        current = _make_current(temperature_2m=38.5)
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        obs = self.provider.get_observation(0.0, 0.0)
        self.assertAlmostEqual(obs.temperature_c, 38.5)

    # ── OM3: Humidity ─────────────────────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om3_humidity_mapping(self, mock_urlopen):
        current = _make_current(relative_humidity_2m=72.0)
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        obs = self.provider.get_observation(0.0, 0.0)
        self.assertAlmostEqual(obs.humidity_pct, 72.0)

    # ── OM4: Wind speed unit conversion ──────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om4_wind_speed_conversion(self, mock_urlopen):
        # ORS returns m/s; we expect km/h (× 3.6)
        current = _make_current(wind_speed_10m=5.0)
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        obs = self.provider.get_observation(0.0, 0.0)
        self.assertAlmostEqual(obs.wind_speed_kmh, 5.0 * 3.6)

    # ── OM5: Cloud cover ─────────────────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om5_cloud_cover_mapping(self, mock_urlopen):
        current = _make_current(cloud_cover=85.0)
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        obs = self.provider.get_observation(0.0, 0.0)
        self.assertAlmostEqual(obs.cloud_cover_pct, 85.0)

    # ── OM6: UV index → solar_index (normal range) ──────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om6_solar_index_from_uv(self, mock_urlopen):
        current = _make_current(uv_index=6.5)
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        obs = self.provider.get_observation(0.0, 0.0)
        self.assertAlmostEqual(obs.solar_index, 6.5)

    # ── OM7: Timestamp parsing ────────────────────────────────────────────────
    def test_om7_timestamp_parsing(self):
        # Standard format from Open-Meteo (no seconds, no Z)
        observed_at, age = _parse_timestamp("2026-10-09T12:00")
        self.assertIsNotNone(observed_at)
        self.assertTrue(observed_at.endswith("Z"), f"expected Z suffix, got {observed_at!r}")
        self.assertIn("2026-10-09T12:00:00Z", observed_at)
        self.assertIsNotNone(age)

    # ── OM8: is_demo=False for real provider ─────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om8_real_provider_not_demo(self, mock_urlopen):
        mock_urlopen.return_value = _mock_urlopen(_make_response())
        obs = self.provider.get_observation(0.0, 0.0)
        self.assertFalse(obs.is_demo)
        self.assertIsNotNone(obs.freshness)
        self.assertIsNotNone(obs.freshness.observed_at)

    # ── OM9: Missing timestamp → age=None, confidence=LOW ───────────────────
    def test_om9_missing_timestamp(self):
        observed_at, age = _parse_timestamp("")
        self.assertIsNone(observed_at)
        self.assertIsNone(age)
        # Missing age → should classify as LOW confidence
        from heat.open_meteo import _classify_freshness
        confidence = _classify_freshness(None)
        self.assertEqual(confidence, ConfidenceLevel.LOW)

    # ── OM10: Stale observation (>30 min old) ────────────────────────────────
    def test_om10_stale_observation(self):
        from heat.open_meteo import _classify_freshness
        confidence = _classify_freshness(45.0)   # 45 minutes
        self.assertEqual(confidence, ConfidenceLevel.LOW)

    # ── OM11: Fresh observation (<=30 min old) ───────────────────────────────
    def test_om11_fresh_observation(self):
        from heat.open_meteo import _classify_freshness
        confidence = _classify_freshness(10.0)   # 10 minutes
        self.assertEqual(confidence, ConfidenceLevel.MEDIUM)

    # ── OM12: Invalid latitude ────────────────────────────────────────────────
    def test_om12_invalid_latitude(self):
        with self.assertRaises(ValueError):
            self.provider.get_observation(lat=95.0, lng=0.0)

    # ── OM13: Invalid longitude ───────────────────────────────────────────────
    def test_om13_invalid_longitude(self):
        with self.assertRaises(ValueError):
            self.provider.get_observation(lat=0.0, lng=200.0)

    # ── OM14: Timeout ─────────────────────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om14_timeout_raises(self, mock_urlopen):
        mock_urlopen.side_effect = TimeoutError()
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            self.provider.get_observation(0.0, 0.0)

    # ── OM15: HTTP 4xx ───────────────────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om15_http_error_raises(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            "url", 404, "Not Found", {}, None
        )
        with self.assertRaisesRegex(RuntimeError, "HTTP 404"):
            self.provider.get_observation(0.0, 0.0)

    # ── OM16: HTTP 429 rate limiting ─────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om16_rate_limit_raises(self, mock_urlopen):
        mock_urlopen.side_effect = urllib.error.HTTPError(
            "url", 429, "Too Many Requests", {}, None
        )
        with self.assertRaisesRegex(RuntimeError, "rate limit"):
            self.provider.get_observation(0.0, 0.0)

    # ── OM17: Malformed JSON ─────────────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om17_malformed_json(self, mock_urlopen):
        mock_urlopen.return_value = _mock_urlopen(b"not json!!")
        with self.assertRaisesRegex(RuntimeError, "malformed JSON"):
            self.provider.get_observation(0.0, 0.0)

    # ── OM18: Missing 'current' key ──────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om18_missing_current_key(self, mock_urlopen):
        payload = json.dumps({"latitude": 0, "longitude": 0}).encode()
        mock_urlopen.return_value = _mock_urlopen(payload)
        with self.assertRaisesRegex(RuntimeError, "missing 'current'"):
            self.provider.get_observation(0.0, 0.0)

    # ── OM19: Missing individual field ───────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om19_missing_field(self, mock_urlopen):
        current = _make_current()
        del current["temperature_2m"]   # remove required field
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        with self.assertRaisesRegex(RuntimeError, "temperature_2m"):
            self.provider.get_observation(0.0, 0.0)

    # ── OM20: Non-finite field value ─────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om20_non_finite_value(self, mock_urlopen):
        import math
        current = _make_current(temperature_2m=float("nan"))
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        # nan is not finite → should raise
        with self.assertRaises(RuntimeError):
            self.provider.get_observation(0.0, 0.0)

    # ── OM21: UV index > 10 clamped ──────────────────────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om21_uv_index_clamped(self, mock_urlopen):
        current = _make_current(uv_index=12.5)
        mock_urlopen.return_value = _mock_urlopen(_make_response(current))
        obs = self.provider.get_observation(0.0, 0.0)
        self.assertAlmostEqual(obs.solar_index, 10.0)

    # ── OM22: One observation reused across routes ───────────────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om22_single_observation_per_request(self, mock_urlopen):
        """Recommender should call get_observation once, not once per route."""
        from recommender import RouteRecommender
        from routing.models import CandidateRoute
        from heat.engine import HeatExposureEngine
        from heat.models import TravelMode

        call_count = 0
        original_get = self.provider.get_observation

        def counting_get(lat, lng):
            nonlocal call_count
            call_count += 1
            return original_get(lat, lng)

        self.provider.get_observation = counting_get

        mock_urlopen.return_value = _mock_urlopen(_make_response())

        recommender = RouteRecommender(
            engine=HeatExposureEngine(),
            env_provider=self.provider,
        )
        candidates = [
            CandidateRoute("r0", 1000, 720, {"type": "LineString", "coordinates": []}, "foot-walking", 720),
            CandidateRoute("r1", 1500, 900, {"type": "LineString", "coordinates": []}, "foot-walking", 900),
            CandidateRoute("r2", 2000, 1200, {"type": "LineString", "coordinates": []}, "foot-walking", 1200),
        ]
        recommender.recommend(candidates, mode=TravelMode.WALKING, origin_lat=51.5, origin_lng=-0.12)

        # get_observation must be called exactly once regardless of route count
        self.assertEqual(call_count, 1,
            f"Expected 1 call to get_observation, got {call_count}")

    # ── OM23: Real provider failure doesn't fall back to demo ────────────────
    @patch("heat.open_meteo.urllib.request.urlopen")
    def test_om23_failure_does_not_fallback(self, mock_urlopen):
        """If open_meteo fails, it must raise, not return demo-like data."""
        mock_urlopen.side_effect = TimeoutError()
        with self.assertRaises(RuntimeError):
            self.provider.get_observation(51.5, -0.12)
        # The exception propagates; we do NOT get a DemoEnvironmentalObservation

    # ── OM24: Demo provider still marks is_demo=True ─────────────────────────
    def test_om24_demo_provider_still_demo(self):
        demo = DemoEnvironmentalProvider(scenario="warm_midday")
        obs = demo.get_observation(lat=0.0, lng=0.0)
        self.assertTrue(obs.is_demo)
        self.assertEqual(obs.confidence, ConfidenceLevel.DEMO)
        self.assertIsNone(obs.freshness.observed_at)

    # ── OM25: Future-dated beyond tolerance → LOW (not silently MEDIUM) ──────
    def test_om25_future_dated_beyond_tolerance_is_low(self):
        """
        An observation timestamped more than CLOCK_SKEW_TOLERANCE_MINUTES in
        the future must NOT be classified as MEDIUM (fresh).
        It must be classified LOW to prevent incorrect confidence signals.
        """
        from heat.open_meteo import _classify_freshness, _CLOCK_SKEW_TOLERANCE_MINUTES
        # age_minutes is negative when the observation is in the future
        # -10 minutes is well beyond the 5-minute tolerance
        future_age = -(_CLOCK_SKEW_TOLERANCE_MINUTES + 5.0)
        confidence = _classify_freshness(future_age)
        self.assertEqual(
            confidence,
            ConfidenceLevel.LOW,
            f"Expected LOW for age={future_age} min (future beyond tolerance), "
            f"got {confidence.value}",
        )

    # ── OM26: Future-dated within tolerance → MEDIUM (normal NWP lag) ────────
    def test_om26_future_dated_within_tolerance_is_medium(self):
        """
        A small negative age within CLOCK_SKEW_TOLERANCE_MINUTES is normal
        because Open-Meteo publishes NWP output slightly before the 15-minute
        slot boundary.  It should be classified MEDIUM (acceptable).
        """
        from heat.open_meteo import _classify_freshness, _CLOCK_SKEW_TOLERANCE_MINUTES
        # -2 minutes is within the 5-minute tolerance
        small_negative_age = -2.0
        confidence = _classify_freshness(small_negative_age)
        self.assertEqual(
            confidence,
            ConfidenceLevel.MEDIUM,
            f"Expected MEDIUM for age={small_negative_age} min (within tolerance), "
            f"got {confidence.value}",
        )


if __name__ == "__main__":
    unittest.main()
