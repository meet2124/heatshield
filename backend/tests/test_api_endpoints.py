"""
Unit tests for HeatShield FastAPI endpoints in main.py.

Coverage:
  EP1: /api/routes forwards mode='walking' to routing provider
  EP2: /api/routes forwards mode='delivery_rider' to routing provider
  EP3: /api/recommend preserves existing response schema + includes raw_unrounded_score
  EP4: /api/weather/hourly validates coordinates (lat/lng out of bounds -> 400)
  EP5: /api/weather/hourly validates duration_seconds (< 0 -> 400)
  EP6: /api/weather/hourly parses mocked Open-Meteo forecast correctly
  EP7: /api/weather/hourly handles missing/None values safely
  EP8: /api/weather/hourly translates Open-Meteo HTTP 429 to 429
  EP9: /api/weather/hourly translates timeout to 504
  EP10: /api/weather/hourly returns unavailable when in demo mode
"""
import sys
import os
import json
import unittest
from unittest.mock import patch, MagicMock
from fastapi import HTTPException
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import (
    generate_routes,
    get_hourly_forecast,
    recommend_route,
    RouteRequest,
    RecommendRequest,
    Location,
)
from routing.models import CandidateRoute
from routing.provider import RoutingResult


class TestAPIEndpoints(unittest.TestCase):

    # ── EP1 & EP2: /api/routes mode forwarding ────────────────────────────────
    @patch("main._routing_provider.get_routes")
    def test_routes_mode_walking(self, mock_get_routes):
        mock_get_routes.return_value = RoutingResult(
            routes=[
                CandidateRoute(
                    id="route_0",
                    distance_meters=1500.0,
                    duration_seconds=1200.0,
                    geometry={"type": "LineString", "coordinates": []},
                    profile="foot-walking",
                    osrm_raw_duration_seconds=1200.0,
                )
            ],
            provider="OpenRouteService",
            provider_note="Single route",
            supports_alternatives=True,
        )

        req = RouteRequest(
            origin=Location(lat=21.17, lng=72.83),
            destination=Location(lat=21.12, lng=73.11),
            mode="walking",
        )
        resp = generate_routes(req)

        self.assertEqual(resp["status"], "success")
        self.assertIn("steps", resp["data"]["routes"][0])
        mock_get_routes.assert_called_once_with(
            origin_lat=21.17,
            origin_lng=72.83,
            dest_lat=21.12,
            dest_lng=73.11,
            mode="walking",
        )
        routes = resp["data"]["routes"]
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0]["profile"], "foot-walking")
        self.assertEqual(routes[0]["distance_meters"], 1500.0)
        self.assertEqual(routes[0]["duration_seconds"], 1200.0)

    @patch("main._routing_provider.get_routes")
    def test_routes_mode_delivery_rider(self, mock_get_routes):
        mock_get_routes.return_value = RoutingResult(
            routes=[
                CandidateRoute(
                    id="route_0",
                    distance_meters=35000.0,
                    duration_seconds=7200.0,
                    geometry={"type": "LineString", "coordinates": []},
                    profile="cycling-regular",
                    osrm_raw_duration_seconds=7200.0,
                )
            ],
            provider="OpenRouteService",
            provider_note="Alternatives provided",
            supports_alternatives=True,
        )

        req = RouteRequest(
            origin=Location(lat=21.17, lng=72.83),
            destination=Location(lat=21.12, lng=73.11),
            mode="delivery_rider",
        )
        resp = generate_routes(req)

        mock_get_routes.assert_called_once_with(
            origin_lat=21.17,
            origin_lng=72.83,
            dest_lat=21.12,
            dest_lng=73.11,
            mode="delivery_rider",
        )
        routes = resp["data"]["routes"]
        self.assertEqual(routes[0]["profile"], "cycling-regular")

    # ── EP3: /api/recommend schema compatibility ──────────────────────────────
    @patch("main._routing_provider.get_routes")
    def test_recommend_schema_compatibility(self, mock_get_routes):
        mock_get_routes.return_value = RoutingResult(
            routes=[
                CandidateRoute(
                    id="route_0",
                    distance_meters=2000.0,
                    duration_seconds=1500.0,
                    geometry={"type": "LineString", "coordinates": []},
                    profile="foot-walking",
                    osrm_raw_duration_seconds=1500.0,
                )
            ],
            provider="OpenRouteService",
            provider_note="Single route",
            supports_alternatives=False,
        )

        req = RecommendRequest(
            origin=Location(lat=21.17, lng=72.83),
            destination=Location(lat=21.12, lng=73.11),
            mode="walking",
        )
        resp = recommend_route(req)

        self.assertEqual(resp["status"], "success")
        data = resp["data"]
        # Required existing keys
        self.assertIn("recommended_route_id", data)
        self.assertIn("reason", data)
        self.assertIn("provider_note", data)
        self.assertIn("exposure_weight", data)
        self.assertIn("time_weight", data)
        self.assertIn("is_demo_data", data)
        self.assertIn("routes", data)

        r0 = data["routes"][0]
        self.assertIn("id", r0)
        self.assertIn("distance_meters", r0)
        self.assertIn("duration_seconds", r0)
        self.assertIn("exposure_score", r0)
        self.assertIn("risk_level", r0)
        self.assertIn("major_contributors", r0)
        self.assertIn("raw_unrounded_score", r0)
        self.assertIn("all_contributors", r0)
        self.assertIn("profile", r0)
        self.assertIn("steps", r0)

    # ── EP4 & EP5: /api/weather/hourly validation ─────────────────────────────
    def test_hourly_invalid_lat(self):
        with self.assertRaises(HTTPException) as ctx:
            get_hourly_forecast(lat=95.0, lng=72.0)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("latitude", ctx.exception.detail.lower())

    def test_hourly_invalid_lng(self):
        with self.assertRaises(HTTPException) as ctx:
            get_hourly_forecast(lat=21.0, lng=200.0)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("longitude", ctx.exception.detail.lower())

    def test_hourly_invalid_duration(self):
        with self.assertRaises(HTTPException) as ctx:
            get_hourly_forecast(lat=21.0, lng=72.0, duration_seconds=-50.0)
        self.assertEqual(ctx.exception.status_code, 400)

    # ── EP6: /api/weather/hourly mock parsing ─────────────────────────────────
    @patch("main._ENV_PROVIDER_NAME", "open_meteo")
    @patch("main.urllib.request.urlopen")
    def test_hourly_mock_parsing(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_data = {
            "hourly": {
                "time": ["2026-10-11T12:00", "2026-10-11T13:00"],
                "temperature_2m": [34.0, 35.5],
                "relative_humidity_2m": [45.0, 40.0],
                "wind_speed_10m": [3.5, 4.0],
                "cloud_cover": [20.0, 10.0],
                "uv_index": [6.5, 7.0],
            }
        }
        mock_resp.read.return_value = json.dumps(mock_data).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        res = get_hourly_forecast(lat=21.17, lng=72.83, mode="delivery_rider", duration_seconds=3600.0)

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["is_forecast"])
        self.assertIn("timeline", res)
        self.assertEqual(len(res["timeline"]), 2)

        item = res["timeline"][0]
        self.assertEqual(item["time_iso"], "2026-10-11T12:00:00Z")
        self.assertEqual(item["hour_label"], "12:00")
        self.assertEqual(item["temperature_c"], 34.0)
        self.assertIn("exposure_score", item)
        self.assertIn("raw_unrounded_score", item)
        self.assertIn("risk_level", item)

    # ── EP7: /api/weather/hourly missing/None values safely handled ────────────
    @patch("main._ENV_PROVIDER_NAME", "open_meteo")
    @patch("main.urllib.request.urlopen")
    def test_hourly_missing_values(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_data = {
            "hourly": {
                "time": ["2026-10-11T12:00", "2026-10-11T13:00"],
                "temperature_2m": [None, 35.5],  # First hour has None temp
                "relative_humidity_2m": [45.0, 40.0],
                "wind_speed_10m": [3.5, None],
                "cloud_cover": [20.0, 10.0],
                "uv_index": [None, 7.0],
            }
        }
        mock_resp.read.return_value = json.dumps(mock_data).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp
        mock_urlopen.return_value = mock_resp

        res = get_hourly_forecast(lat=21.17, lng=72.83)

        self.assertEqual(res["status"], "success")
        # Hour 0 was safely skipped due to None temperature
        self.assertEqual(len(res["timeline"]), 1)
        self.assertEqual(res["timeline"][0]["hour_label"], "13:00")

    # ── EP8: Open-Meteo HTTP 429 ──────────────────────────────────────────────
    @patch("main._ENV_PROVIDER_NAME", "open_meteo")
    @patch("main.urllib.request.urlopen")
    def test_hourly_http_429(self, mock_urlopen):
        err = urllib.error.HTTPError(
            url="http://mock",
            code=429,
            msg="Rate limit",
            hdrs={},
            fp=None
        )
        mock_urlopen.side_effect = err

        with self.assertRaises(HTTPException) as ctx:
            get_hourly_forecast(lat=21.17, lng=72.83)
        self.assertEqual(ctx.exception.status_code, 429)

    # ── EP9: Open-Meteo timeout ───────────────────────────────────────────────
    @patch("main._ENV_PROVIDER_NAME", "open_meteo")
    @patch("main.urllib.request.urlopen")
    def test_hourly_timeout(self, mock_urlopen):
        mock_urlopen.side_effect = TimeoutError("Request timed out")

        with self.assertRaises(HTTPException) as ctx:
            get_hourly_forecast(lat=21.17, lng=72.83)
        self.assertEqual(ctx.exception.status_code, 504)

    # ── EP10: Demo provider unavailable status ────────────────────────────────
    @patch("main._ENV_PROVIDER_NAME", "demo")
    def test_hourly_demo_unavailable(self):
        res = get_hourly_forecast(lat=21.17, lng=72.83)
        self.assertEqual(res["status"], "unavailable")
        self.assertTrue(res["is_demo_data"])
        self.assertFalse(res["is_forecast"])


if __name__ == "__main__":
    unittest.main()
