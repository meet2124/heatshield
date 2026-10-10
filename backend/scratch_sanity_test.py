import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from heat.engine import HeatExposureEngine
from heat.models import EnvironmentalObservation, RouteInput, TravelMode

engine = HeatExposureEngine()

# Scenarios
scenarios = {
    "A": {
        "obs": EnvironmentalObservation(
            temperature_c=22.0, humidity_pct=45.0, solar_index=2.0, wind_speed_kmh=15.0, cloud_cover_pct=30.0, data_source="demo"
        ),
        "route": RouteInput(distance_meters=1000, duration_seconds=10*60, mode=TravelMode.WALKING)
    },
    "B": {
        "obs": EnvironmentalObservation(
            temperature_c=40.0, humidity_pct=60.0, solar_index=9.0, wind_speed_kmh=5.0, cloud_cover_pct=5.0, data_source="demo"
        ),
        "route": RouteInput(distance_meters=3000, duration_seconds=30*60, mode=TravelMode.WALKING)
    },
    "C": {
        "obs": EnvironmentalObservation(
            temperature_c=40.0, humidity_pct=60.0, solar_index=9.0, wind_speed_kmh=5.0, cloud_cover_pct=5.0, data_source="demo"
        ),
        "route": RouteInput(distance_meters=3000, duration_seconds=30*60, mode=TravelMode.DELIVERY_RIDER)
    },
    "D": {
        "obs": EnvironmentalObservation(
            temperature_c=40.0, humidity_pct=60.0, solar_index=9.0, wind_speed_kmh=5.0, cloud_cover_pct=5.0, data_source="demo"
        ),
        "route": RouteInput(distance_meters=6000, duration_seconds=60*60, mode=TravelMode.WALKING)
    }
}

print("--- EXPOSURE SCORES ---")
for key, data in scenarios.items():
    result = engine.calculate(data["route"], data["obs"])
    print(f"{key}: {result.estimated_exposure_score} ({result.risk_level.value})")
