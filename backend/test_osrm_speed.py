import urllib.request
import json

def test_route(profile: str):
    # Example route from Washington Square Park to Union Square (approx 1 km)
    # Washington Sq Park: -73.9973, 40.7308
    # Union Square: -73.9903, 40.7359
    origin = "-73.9973,40.7308"
    dest = "-73.9903,40.7359"
    url = f"http://router.project-osrm.org/route/v1/{profile}/{origin};{dest}?overview=full&geometries=geojson&alternatives=true"

    req = urllib.request.Request(url, headers={"User-Agent": "HeatShield/1.0 (Hackathon MVP)"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())

    print(f"--- PROFILE: {profile} ---")
    print(f"Status Code: {data.get('code')}")
    routes = data.get("routes", [])
    print(f"Number of routes returned: {len(routes)}")

    if routes:
        route = routes[0]
        dist_m = route.get('distance', 0)
        dur_s = route.get('duration', 0)
        speed_kmh = (dist_m / 1000) / (dur_s / 3600) if dur_s > 0 else 0
        print(f"Distance: {dist_m} m")
        print(f"Duration: {dur_s} s")
        print(f"Implied Speed: {speed_kmh:.2f} km/h")
    print("")

test_route("foot")
test_route("bike")
test_route("car")
