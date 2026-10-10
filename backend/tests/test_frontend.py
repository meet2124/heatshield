"""
Static analysis tests to verify UI requirements in App.tsx.
"""
import unittest
import os

class TestFrontendLogic(unittest.TestCase):
    def setUp(self):
        self.app_tsx_path = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "App.tsx")
        with open(self.app_tsx_path, "r", encoding="utf-8") as f:
            self.content = f.read()

    def test_single_route_no_comparisons(self):
        # The comparison chips block must be guarded by totalRoutes > 1
        self.assertIn("{totalRoutes > 1 && (timeDiff !== 0 || expDiff !== 0) && (", self.content)

    def test_single_route_badge(self):
        # Should display 'Available Route' for single routes instead of 'Recommended'
        self.assertIn("totalRoutes === 1 ? (", self.content)
        self.assertIn("Available Route", self.content)
        self.assertIn("isRecommended && totalRoutes > 1 ? (", self.content)

    def test_travel_time_wording(self):
        # Should say 'Est. Travel Time', not 'Est. Walking Time'
        self.assertIn("Est. Travel Time", self.content)
        self.assertNotIn("Est. Walking Time", self.content)

    def test_demo_label_prominent(self):
        # DEMO notice must be visually prominent — checks for the bold uppercase label
        self.assertIn("Demo Environmental Data", self.content)
        self.assertIn("Not live weather", self.content)
        # Old inline text should be gone
        self.assertNotIn("Demo conditions", self.content)

    def test_contributor_display_name(self):
        # Contributors are rendered using display_name, not name
        self.assertIn("c.display_name", self.content)

    def test_exposure_label(self):
        # The exposure section must use 'Estimated Environmental Exposure'
        self.assertIn("Estimated Environmental Exposure", self.content)

if __name__ == '__main__':
    unittest.main()
