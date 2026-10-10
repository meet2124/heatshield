"""
End-to-end test for the /api/routes endpoint.
Verifies: compilation, distance, corrected walking duration, implied speed plausibility.
"""
import urllib.request
import json
import sys

BASE_URL = "http://localhost:8000"

# Times Square -> Central Park (well-known test pair)
PAYLOAD = {
    "origin": {"lat": 40.7580, "lng": -73.9855},
    "destination": {"lat": 40.7851, "lng": -73.9683},
}

WALKING_SPEED_MS = 5.0 / 3.6  # 1.389 m/s
WALKING_MAX_MS = 3.0           # plausibility ceiling

def test_health():
    req = urllib.request.Request(f"{BASE_URL}/health")
    with urllib.request.urlopen(req, timeout=5) as res:
        body = json.loads(res.read())
    assert res.status == 200
    assert body["status"] == "ok"
    print("PASS  GET /health -> 200")

def test_routes():
    body = json.dumps(PAYLOAD).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/api/routes",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Origin": "http://localhost:5173",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        data = json.loads(res.read())

    assert res.status == 200, f"Expected 200, got {res.status}"
    routes = data["data"]["routes"]
    assert len(routes) > 0, "No routes returned"

    r = routes[0]
    dist = r["distance_meters"]
    dur  = r["duration_seconds"]
    raw_dur = r["osrm_raw_duration_seconds"]
    profile = r["profile"]

    print(f"\nRoute (profile={profile}):")
    print(f"  distance_meters          : {dist:.1f} m  ({dist/1000:.3f} km)")
    print(f"  duration_seconds         : {dur} s  ({dur/60:.1f} min)  [walking-overridden]")
    print(f"  osrm_raw_duration_seconds: {raw_dur:.1f} s  ({raw_dur/60:.1f} min)  [car speed]")

    implied_walking_speed = dist / dur
    implied_osrm_speed = dist / raw_dur if raw_dur else 0

    print(f"  implied walking speed    : {implied_walking_speed:.3f} m/s ({implied_walking_speed*3.6:.2f} km/h)")
    print(f"  implied OSRM speed       : {implied_osrm_speed:.3f} m/s ({implied_osrm_speed*3.6:.2f} km/h)")

    # Assert the overridden duration is plausible
    assert implied_walking_speed <= WALKING_MAX_MS, (
        f"FAIL: overridden speed {implied_walking_speed:.2f} m/s still exceeds "
        f"walking ceiling {WALKING_MAX_MS} m/s"
    )
    # Assert OSRM raw was actually car-speed (demonstrates the bug we fixed)
    assert implied_osrm_speed > WALKING_MAX_MS, (
        f"OSRM raw speed {implied_osrm_speed:.2f} m/s unexpectedly looks like walking — "
        "the public server may have changed behaviour."
    )
    print(f"\nPASS  POST /api/routes -> 200, walking duration is plausible")
    print(f"      Display values: {dist/1000:.2f} km / {round(dur/60)} min")

if __name__ == "__main__":
    errors = []
    for fn in [test_health, test_routes]:
        try:
            fn()
        except AssertionError as e:
            errors.append(f"FAIL  {fn.__name__}: {e}")
            print(errors[-1])
        except Exception as e:
            errors.append(f"ERROR {fn.__name__}: {e}")
            print(errors[-1])
    if errors:
        sys.exit(1)
    print("\nAll tests passed.")
