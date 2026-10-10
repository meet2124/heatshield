import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from datetime import datetime, timezone
from heat.open_meteo import OpenMeteoEnvironmentalProvider

check_time_utc = datetime.now(tz=timezone.utc)
provider = OpenMeteoEnvironmentalProvider()
obs = provider.get_observation(lat=21.17, lng=72.83)

isoformat = check_time_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
print("=== Open-Meteo Live Sanity Check ===")
print("Server UTC check time :", isoformat)
print("Observation timestamp :", obs.freshness.observed_at)
print("Age (minutes)         :", obs.freshness.age_minutes)
print("Confidence            :", obs.confidence.value)
print("temperature_c         :", obs.temperature_c)
print("humidity_pct          :", obs.humidity_pct)
print("wind_speed_kmh        :", obs.wind_speed_kmh)
print("cloud_cover_pct       :", obs.cloud_cover_pct)
print("solar_index           :", obs.solar_index)
print("is_demo               :", obs.is_demo)
print("source_label          :", obs.freshness.source_label)
