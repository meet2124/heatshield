"""
Unit tests for OSRMRoutingProvider and related integrity requirements.
"""
import sys
import os
import unittest
from unittest.mock import patch, MagicMock
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routing.osrm import OSRMRoutingProvider
from heat.models import TravelMode

class TestOSRMProvider(unittest.TestCase):

    @patch('routing.osrm.urllib.request.urlopen')
    def test_duration_is_not_fabricated(self, mock_urlopen):
        # Setup mock response
        mock_response = MagicMock()

        # Raw OSRM returns duration in seconds, let's say 4321.5 seconds and 5000 meters
        fake_osrm_data = {
            "code": "Ok",
            "routes": [
                {
                    "distance": 5000.0,
                    "duration": 4321.5,
                    "geometry": {"type": "LineString", "coordinates": []}
                }
            ]
        }

        mock_response.read.return_value = json.dumps(fake_osrm_data).encode('utf-8')
        mock_response.__enter__.return_value = mock_response
        mock_urlopen.return_value = mock_response

        provider = OSRMRoutingProvider()
        result = provider.get_routes(0, 0, 1, 1, mode="walking")

        self.assertEqual(len(result.routes), 1)
        route = result.routes[0]

        # Verify the raw duration is exactly what OSRM provided
        self.assertEqual(route.osrm_raw_duration_seconds, 4321.5)
        # Verify the final duration is exactly the raw duration, not overridden
        self.assertEqual(route.duration_seconds, 4321.5)

        # Ensure it didn't fabricate a standard walking speed duration (5000 / 1.389 = ~3600)
        self.assertNotEqual(route.duration_seconds, 3600)

        # Provider note should not claim duration is overridden
        self.assertNotIn("overridden locally", result.provider_note)

if __name__ == '__main__':
    unittest.main()
