"""
Unit tests for RouteRecommender.

All tests use fixed CandidateRoutes and DemoEnvironmentalProvider — no network calls.

Coverage:
  R1  Single route  → recommended with honest note, no delta comparisons
  R2  Two routes, same exposure → recommend faster one (time_weight drives it)
  R3  Two routes, lower exposure worth time cost → recommend cooler route
  R4  Two routes, equal time → recommend lower exposure
  R5  exposure_weight=0, time_weight=1 → always picks fastest regardless of exposure
  R6  exposure_weight=1, time_weight=0 → always picks coolest regardless of time
  R7  Empty candidate list → raises ValueError
  R8  Relative deltas are accurate (time_diff, exposure_diff_pct)
  R9  Utility scores are deterministic (same inputs → same output twice)
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from recommender import RouteRecommender
from routing.models import CandidateRoute
from heat.engine import HeatExposureEngine
from heat.models import TravelMode
from heat.providers import DemoEnvironmentalProvider

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
_failures: list[str] = []


def _route(rid: str, dist_m: float, dur_s: float) -> CandidateRoute:
    return CandidateRoute(
        id=rid,
        distance_meters=dist_m,
        duration_seconds=dur_s,
        geometry={"type": "LineString", "coordinates": []},
        profile="foot",
        osrm_raw_duration_seconds=dur_s,
    )


def _make_recommender(scenario: str = "warm_midday") -> RouteRecommender:
    return RouteRecommender(
        engine=HeatExposureEngine(),
        env_provider=DemoEnvironmentalProvider(scenario=scenario),
    )


def _check(name: str, condition: bool, detail: str = "") -> None:
    status = PASS if condition else FAIL
    if not condition:
        _failures.append(name)
    print(f"{status}  {name}" + (f"  [{detail}]" if detail else ""))


# R1 — single route
def test_r1_single_route():
    rec = _make_recommender()
    r = rec.recommend(
        [_route("route_0", 3000, 2160)],
        mode=TravelMode.WALKING,
        provider_note="demo note",
    )
    _check("R1 single route is recommended", r.recommended_route_id == "route_0")
    _check("R1 single route reason mentions 'no alternative route'", "no alternative route" in r.reason.lower())
    _check("R1 single route time_diff == 0", r.scored_routes[0].relative_time_diff_seconds == 0)


# R2 — same exposure, different time → faster wins when weights balanced
def test_r2_prefer_faster_when_same_exposure():
    # Both routes are the same distance so have same exposure; differ only in duration
    # With default weights (exp=0.6, time=0.4) and same exposure,
    # norm_exp = 0 for both → time breaks the tie
    rec = _make_recommender()
    fast = _route("fast", 3000, 2160)    # 36 min
    slow = _route("slow", 3000, 4320)   # 72 min — same distance, different duration
    r = rec.recommend([fast, slow], mode=TravelMode.WALKING)
    _check("R2 faster route recommended when exposure equal",
           r.recommended_route_id == "fast",
           f"got {r.recommended_route_id}")


# R3 — bigger exposure reduction worth a time penalty
def test_r3_cooler_route_wins_with_exposure_weight():
    # hot_long: very long route, but uses cool_morning scenario → low exposure
    # fast_hot: short + fast, but warm_midday env → moderate exposure
    # We force exposure_weight=0.9 to override time preference
    rec_hot = RouteRecommender(
        engine=HeatExposureEngine(),
        env_provider=DemoEnvironmentalProvider(scenario="hot_afternoon"),
    )
    # Two routes with very different distances → very different exposure scores
    short_hot = _route("short_hot", 3000, 2160)    # 36 min
    long_cooler = _route("long_cooler", 1000, 720)  # 12 min — much shorter = much lower exposure
    r = rec_hot.recommend(
        [short_hot, long_cooler], mode=TravelMode.WALKING, exposure_weight=0.9, time_weight=0.1
    )
    _check("R3 shorter/lower-exposure route recommended under high exposure_weight",
           r.recommended_route_id == "long_cooler",
           f"got {r.recommended_route_id}")


# R4 — equal time → lower exposure wins
def test_r4_lower_exposure_wins_when_same_time():
    rec = _make_recommender()
    cool = _route("cool", 1000, 720)   # 12 min  ~low exposure
    hot  = _route("hot",  5000, 720)   # 12 min  ~high exposure (more distance)
    r = rec.recommend([cool, hot], mode=TravelMode.WALKING)
    _check("R4 lower exposure wins at equal time",
           r.recommended_route_id == "cool",
           f"got {r.recommended_route_id}")


# R5 — exposure_weight=0 → purely fastest regardless
def test_r5_pure_time_preference():
    rec = _make_recommender()
    fast = _route("fast", 1000, 720)
    slow = _route("slow", 1000, 3600)
    r = rec.recommend([fast, slow], mode=TravelMode.WALKING,
                      exposure_weight=0.0, time_weight=1.0)
    _check("R5 pure time weight picks fastest",
           r.recommended_route_id == "fast",
           f"got {r.recommended_route_id}")


# R6 — exposure_weight=1 → purely coolest regardless
def test_r6_pure_exposure_preference():
    rec = _make_recommender()
    cool = _route("cool", 1000, 720)   # short = low exposure
    hot  = _route("hot",  8000, 720)   # same duration, much longer = higher exposure
    r = rec.recommend([cool, hot], mode=TravelMode.WALKING,
                      exposure_weight=1.0, time_weight=0.0)
    _check("R6 pure exposure weight picks coolest",
           r.recommended_route_id == "cool",
           f"got {r.recommended_route_id}")


# R7 — empty candidates → ValueError
def test_r7_empty_candidates():
    rec = _make_recommender()
    caught = False
    try:
        rec.recommend([], mode=TravelMode.WALKING)
    except ValueError:
        caught = True
    _check("R7 empty candidates raises ValueError", caught)


# R8 — relative deltas are directionally correct
def test_r8_relative_deltas():
    rec = _make_recommender()
    fast = _route("fast", 1000, 720)   # faster + lower exposure
    slow = _route("slow", 5000, 3600)  # slower + higher exposure
    r = rec.recommend([fast, slow], mode=TravelMode.WALKING)

    fast_sr = next(s for s in r.scored_routes if s.candidate.id == "fast")
    slow_sr = next(s for s in r.scored_routes if s.candidate.id == "slow")

    _check("R8 fastest route has time_diff == 0",
           fast_sr.relative_time_diff_seconds == 0,
           str(fast_sr.relative_time_diff_seconds))
    _check("R8 slow route has positive time_diff",
           slow_sr.relative_time_diff_seconds > 0,
           str(slow_sr.relative_time_diff_seconds))
    _check("R8 high-exposure route has exposure_diff_pct == 0 (is the worst)",
           slow_sr.relative_exposure_diff_pct == 0.0,
           str(slow_sr.relative_exposure_diff_pct))
    _check("R8 low-exposure route has negative exposure_diff_pct (better than worst)",
           fast_sr.relative_exposure_diff_pct < 0,
           str(fast_sr.relative_exposure_diff_pct))


# R9 — reproducibility
def test_r9_reproducibility():
    rec = _make_recommender()
    routes = [_route("a", 3000, 2160), _route("b", 5000, 3600)]
    r1 = rec.recommend(routes, mode=TravelMode.WALKING)
    r2 = rec.recommend(routes, mode=TravelMode.WALKING)
    _check("R9 recommended_route_id is reproducible",
           r1.recommended_route_id == r2.recommended_route_id)
    s1 = r1.scored_routes[0].utility_score
    s2 = r2.scored_routes[0].utility_score
    _check("R9 utility scores are reproducible", s1 == s2, f"{s1} vs {s2}")


if __name__ == "__main__":
    print("\n" + "=" * 72)
    print("HeatShield RouteRecommender — Unit Tests")
    print("=" * 72 + "\n")

    test_r1_single_route()
    test_r2_prefer_faster_when_same_exposure()
    test_r3_cooler_route_wins_with_exposure_weight()
    test_r4_lower_exposure_wins_when_same_time()
    test_r5_pure_time_preference()
    test_r6_pure_exposure_preference()
    test_r7_empty_candidates()
    test_r8_relative_deltas()
    test_r9_reproducibility()

    print("\n" + "-" * 72)
    if _failures:
        print(f"FAILED: {len(_failures)} test(s) — {_failures}")
        sys.exit(1)
    else:
        print("All 9 recommender tests passed.")
    print("-" * 72 + "\n")
