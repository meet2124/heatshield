"""
Unit tests for ORSRoutingProvider.
"""
import sys
import os
import unittest
from unittest.mock import patch, MagicMock
import json
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routing.ors import ORSRoutingProvider

class TestORSProvider(unittest.TestCase):
    def setUp(self):
        self.provider = ORSRoutingProvider()

    @patch.dict(os.environ, {}, clear=True)
    def test_missing_api_key(self):
        with self.assertRaisesRegex(RuntimeError, "ORS_API_KEY environment variable is missing"):
            self.provider.get_routes(0, 0, 1, 1, mode="walking")

    @patch.dict(os.environ, {"ORS_API_KEY": "fake_key"})
    @patch("routing.ors.urllib.request.urlopen")
    def test_mode_mapping_walking(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "type": "FeatureCollection",
            "features": [{
                "geometry": {"type": "LineString", "coordinates": [[0,0], [1,1]]},
                "properties": {"summary": {"distance": 100, "duration": 50}}
            }]
        }).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        result = self.provider.get_routes(0, 0, 1, 1, mode="walking")
        self.assertEqual(result.routes[0].profile, "foot-walking")

        # Verify request structure
        req = mock_urlopen.call_args[0][0]
        self.assertIn("foot-walking", req.full_url)
        self.assertEqual(req.headers.get("Authorization"), "fake_key")
        self.assertIn("alternative_routes", json.loads(req.data.decode("utf-8")))

    @patch.dict(os.environ, {"ORS_API_KEY": "fake_key"})
    @patch("routing.ors.urllib.request.urlopen")
    def test_mode_mapping_delivery_rider(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.read.return_value = json.dumps({
            "type": "FeatureCollection",
            "features": [{
                "geometry": {"type": "LineString", "coordinates": [[0,0], [1,1]]},
                "properties": {"summary": {"distance": 100, "duration": 50}}
            }]
        }).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        result = self.provider.get_routes(0, 0, 1, 1, mode="delivery_rider")
        self.assertEqual(result.routes[0].profile, "cycling-regular")

    @patch.dict(os.environ, {"ORS_API_KEY": "fake_key"})
    def test_unsupported_mode(self):
        with self.assertRaisesRegex(RuntimeError, "Unsupported travel mode"):
            self.provider.get_routes(0, 0, 1, 1, mode="flying")

    @patch.dict(os.environ, {"ORS_API_KEY": "fake_key"})
    @patch("routing.ors.urllib.request.urlopen")
    def test_parsing_multi_route(self, mock_urlopen):
        mock_response = MagicMock()
        fake_data = {
            "type": "FeatureCollection",
            "features": [
                {
                    "geometry": {"type": "LineString", "coordinates": [[0,0], [1,1]]},
                    "properties": {"summary": {"distance": 100.5, "duration": 50.5}}
                },
                {
                    "geometry": {"type": "LineString", "coordinates": [[0,0], [1,0], [1,1]]},
                    "properties": {"summary": {"distance": 120.0, "duration": 60.0}}
                }
            ]
        }
        mock_response.read.return_value = json.dumps(fake_data).encode("utf-8")
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        result = self.provider.get_routes(0, 0, 1, 1, mode="walking")
        self.assertEqual(len(result.routes), 2)

        self.assertEqual(result.routes[0].distance_meters, 100.5)
        self.assertEqual(result.routes[0].duration_seconds, 50.5)
        self.assertEqual(result.routes[0].geometry["coordinates"], [[0,0], [1,1]])

        self.assertEqual(result.routes[1].distance_meters, 120.0)
        self.assertEqual(result.routes[1].duration_seconds, 60.0)
        self.assertIn("genuine route alternatives", result.provider_note)

    @patch.dict(os.environ, {"ORS_API_KEY": "fake_secret_key_123"})
    @patch("routing.ors.urllib.request.urlopen")
    def test_error_handling(self, mock_urlopen):
        # 401 Unauthorized
        err = urllib.error.HTTPError("url", 401, "Unauthorized", {}, None)
        mock_urlopen.side_effect = err
        with self.assertRaises(RuntimeError) as cm:
            self.provider.get_routes(0, 0, 1, 1)
        self.assertNotIn("fake_secret_key_123", str(cm.exception))
        self.assertIn("authorization failed", str(cm.exception))

        # 429 Too Many Requests
        err = urllib.error.HTTPError("url", 429, "Too Many Requests", {}, None)
        mock_urlopen.side_effect = err
        with self.assertRaises(RuntimeError) as cm:
            self.provider.get_routes(0, 0, 1, 1)
        self.assertIn("rate limit exceeded", str(cm.exception))

        # Timeout
        mock_urlopen.side_effect = TimeoutError()
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            self.provider.get_routes(0, 0, 1, 1)

    @patch.dict(os.environ, {"ORS_API_KEY": "fake_key"})
    @patch("routing.ors.urllib.request.urlopen")
    def test_malformed_responses(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        # Invalid JSON
        mock_response.read.return_value = b"Not a json"
        with self.assertRaisesRegex(RuntimeError, "invalid JSON"):
            self.provider.get_routes(0, 0, 1, 1)

        # Not a FeatureCollection
        mock_response.read.return_value = json.dumps({"type": "Feature"}).encode()
        with self.assertRaisesRegex(RuntimeError, "expected FeatureCollection"):
            self.provider.get_routes(0, 0, 1, 1)

        # No routes
        mock_response.read.return_value = json.dumps({"type": "FeatureCollection", "features": []}).encode()
        with self.assertRaisesRegex(RuntimeError, "returned no routes"):
            self.provider.get_routes(0, 0, 1, 1)

if __name__ == '__main__':
    unittest.main()
