"""
HeatShield — unit tests for HeatExposureEngine  (v2 — 15 tests)

All tests are deterministic: same inputs always produce the same score.
No mocking of randomness, no network calls.

Coverage:
  T1   Low environmental conditions      → LOW
  T2   High temperature                  → increases exposure vs low temp
  T3   High humidity                     → increases exposure vs low humidity
  T4   Strong solar exposure             → increases exposure vs low solar
  T5   Longer duration                   → increases exposure vs short duration
  T6   Delivery Rider vs Walking         → rider score >= walking (exertion mult)
  T7   Stronger wind                     → reduces exposure
  T8   Score is always 0–100            → clamped at extremes
  T9   Risk thresholds                   → each band tested
  T10  Contributors match actual inputs  → keys and signs correct
  T11  Demo provider marks is_demo       → True, confidence=DEMO
  T12  Invalid/missing env data          → warnings produced, score still valid
  T13  Zero duration                     → duration_pts == 0, env still scores
  T14  Extremely long duration           → score bounded at 100
  T15  Determinism                       → identical inputs → identical outputs
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from heat.engine import (
    HeatExposureEngine,
    TEMP_WEIGHT, HUM_WEIGHT, SOLAR_WEIGHT, DURATION_WEIGHT,
    EXPOSURE_MODEL_CONFIG,
)
from heat.models import (
    ConfidenceLevel,
    EnvironmentalObservation,
    RiskLevel,
    RouteInput,
    TravelMode,
)
from heat.providers import DemoEnvironmentalProvider

engine = HeatExposureEngine()

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
_failures: list[str] = []


def _obs(
    temperature_c: float = 22.0,
    humidity_pct: float  = 45.0,
    solar_index: float   = 2.0,
    wind_speed_kmh: float = 15.0,
    cloud_cover_pct: float = 20.0,
    is_demo: bool = True,
) -> EnvironmentalObservation:
    return EnvironmentalObservation(
        temperature_c=temperature_c,
        humidity_pct=humidity_pct,
        solar_index=solar_index,
        wind_speed_kmh=wind_speed_kmh,
        cloud_cover_pct=cloud_cover_pct,
        data_source="TestFixture",
        is_demo=is_demo,
    )


def _route(distance_m: float = 3000, duration_s: float = 2160,
           mode: TravelMode = TravelMode.WALKING) -> RouteInput:
    return RouteInput(distance_meters=distance_m, duration_seconds=duration_s, mode=mode)


def _ok(name: str, condition: bool, detail: str = "") -> None:
    status = PASS if condition else FAIL
    if not condition:
        _failures.append(name)
    suffix = f"  [{detail}]" if detail else ""
    print(f"{status}  {name}{suffix}")


def _check(name: str, result, expected_risk: RiskLevel, score_range: tuple) -> None:
    lo, hi = score_range
    ok_risk  = result.risk_level == expected_risk
    ok_score = lo <= result.estimated_exposure_score <= hi
    status   = PASS if (ok_risk and ok_score) else FAIL
    if not (ok_risk and ok_score):
        _failures.append(name)
    print(
        f"{status}  {name:<58} "
        f"score={result.estimated_exposure_score:3d}  "
        f"risk={result.risk_level.value:<9} "
        f"demo={result.is_demo_data}"
    )
    if not ok_risk:
        print(f"       ^ expected risk {expected_risk.value}, got {result.risk_level.value}")
    if not ok_score:
        print(f"       ^ expected score in {score_range}, got {result.estimated_exposure_score}")


# ── T1: Low conditions → LOW ──────────────────────────────────────────────────
def test_t1_low_conditions():
    obs = _obs(temperature_c=18, humidity_pct=30, solar_index=1.0,
               wind_speed_kmh=20, cloud_cover_pct=70)
    short = _route(distance_m=1000, duration_s=720)
    r = engine.calculate(short, obs)
    _check("T1 low conditions / short walk", r, RiskLevel.LOW, (0, 25))


# ── T2: High temperature increases exposure ──────────────────────────────────
def test_t2_high_temp_increases():
    base = _obs(temperature_c=22, solar_index=2, humidity_pct=40,
                wind_speed_kmh=10, cloud_cover_pct=20)
    hot  = _obs(temperature_c=42, solar_index=2, humidity_pct=40,
                wind_speed_kmh=10, cloud_cover_pct=20)
    r_base = engine.calculate(_route(), base)
    r_hot  = engine.calculate(_route(), hot)
    _ok("T2 high temp increases exposure",
        r_hot.estimated_exposure_score > r_base.estimated_exposure_score,
        f"base={r_base.estimated_exposure_score} hot={r_hot.estimated_exposure_score}")


# ── T3: High humidity increases exposure ─────────────────────────────────────
def test_t3_high_humidity_increases():
    dry  = _obs(temperature_c=35, humidity_pct=20, solar_index=6,
                wind_speed_kmh=5, cloud_cover_pct=10)
    moist = _obs(temperature_c=35, humidity_pct=95, solar_index=6,
                 wind_speed_kmh=5, cloud_cover_pct=10)
    r_dry  = engine.calculate(_route(), dry)
    r_moist = engine.calculate(_route(), moist)
    _ok("T3 high humidity increases exposure",
        r_moist.estimated_exposure_score > r_dry.estimated_exposure_score,
        f"dry={r_dry.estimated_exposure_score} moist={r_moist.estimated_exposure_score}")


# ── T4: Strong solar increases exposure ──────────────────────────────────────
def test_t4_solar_increases():
    low_sun  = _obs(temperature_c=32, humidity_pct=50, solar_index=1.0,
                    wind_speed_kmh=8, cloud_cover_pct=80)
    high_sun = _obs(temperature_c=32, humidity_pct=50, solar_index=9.5,
                    wind_speed_kmh=8, cloud_cover_pct=5)
    r_low  = engine.calculate(_route(), low_sun)
    r_high = engine.calculate(_route(), high_sun)
    _ok("T4 strong solar increases exposure",
        r_high.estimated_exposure_score > r_low.estimated_exposure_score,
        f"low_sun={r_low.estimated_exposure_score} high_sun={r_high.estimated_exposure_score}")


# ── T5: Longer duration increases exposure ────────────────────────────────────
def test_t5_longer_duration_increases():
    obs = _obs(temperature_c=35, humidity_pct=50, solar_index=7,
               wind_speed_kmh=5, cloud_cover_pct=10)
    short  = _route(duration_s=600)     # 10 min
    medium = _route(duration_s=3600)    # 60 min
    r_short  = engine.calculate(short, obs)
    r_medium = engine.calculate(medium, obs)
    _ok("T5 longer duration increases exposure",
        r_medium.estimated_exposure_score > r_short.estimated_exposure_score,
        f"10min={r_short.estimated_exposure_score} 60min={r_medium.estimated_exposure_score}")


# ── T6: Delivery Rider has higher score than Walking (same conditions) ────────
def test_t6_delivery_rider_higher():
    obs = _obs(temperature_c=40, humidity_pct=30, solar_index=9.5,
               wind_speed_kmh=5, cloud_cover_pct=5)
    r_walk  = engine.calculate(_route(mode=TravelMode.WALKING), obs)
    r_rider = engine.calculate(_route(mode=TravelMode.DELIVERY_RIDER), obs)
    _ok("T6 delivery_rider >= walking (same conditions)",
        r_rider.estimated_exposure_score >= r_walk.estimated_exposure_score,
        f"walk={r_walk.estimated_exposure_score} rider={r_rider.estimated_exposure_score} "
        f"mult={r_rider.mode_exertion_multiplier}")


# ── T7: Stronger wind reduces exposure ──────────────────────────────────────
def test_t7_wind_reduces():
    calm   = _obs(temperature_c=36, humidity_pct=50, solar_index=7,
                  wind_speed_kmh=0, cloud_cover_pct=10)
    breezy = _obs(temperature_c=36, humidity_pct=50, solar_index=7,
                  wind_speed_kmh=28, cloud_cover_pct=10)
    r_calm   = engine.calculate(_route(), calm)
    r_breezy = engine.calculate(_route(), breezy)
    _ok("T7 strong wind reduces exposure",
        r_breezy.estimated_exposure_score < r_calm.estimated_exposure_score,
        f"calm={r_calm.estimated_exposure_score} breezy={r_breezy.estimated_exposure_score}")


# ── T8: Score always 0–100 at extremes ───────────────────────────────────────
def test_t8_score_bounded():
    # Worst possible scenario
    hot  = _obs(temperature_c=60, humidity_pct=100, solar_index=10,
                wind_speed_kmh=0, cloud_cover_pct=0)
    r_hot = engine.calculate(_route(duration_s=86400), hot)  # 24h
    # Best possible scenario
    cool = _obs(temperature_c=-30, humidity_pct=0, solar_index=0,
                wind_speed_kmh=200, cloud_cover_pct=100)
    r_cool = engine.calculate(_route(duration_s=1), cool)
    _ok("T8 worst conditions bounded at 100",
        0 <= r_hot.estimated_exposure_score <= 100,
        str(r_hot.estimated_exposure_score))
    _ok("T8 best conditions bounded at 0",
        0 <= r_cool.estimated_exposure_score <= 100,
        str(r_cool.estimated_exposure_score))


# ── T9: Risk thresholds correct ──────────────────────────────────────────────
def test_t9_risk_thresholds():
    from heat.engine import _classify_risk
    _ok("T9 score=0 → LOW",        _classify_risk(0)   == RiskLevel.LOW)
    _ok("T9 score=25 → LOW",       _classify_risk(25)  == RiskLevel.LOW)
    _ok("T9 score=26 → MODERATE",  _classify_risk(26)  == RiskLevel.MODERATE)
    _ok("T9 score=50 → MODERATE",  _classify_risk(50)  == RiskLevel.MODERATE)
    _ok("T9 score=51 → HIGH",      _classify_risk(51)  == RiskLevel.HIGH)
    _ok("T9 score=75 → HIGH",      _classify_risk(75)  == RiskLevel.HIGH)
    _ok("T9 score=76 → VERY_HIGH", _classify_risk(76)  == RiskLevel.VERY_HIGH)
    _ok("T9 score=100 → VERY_HIGH",_classify_risk(100) == RiskLevel.VERY_HIGH)


# ── T10: Contributors correspond to actual inputs ─────────────────────────────
def test_t10_contributors():
    obs = _obs(temperature_c=38, humidity_pct=65, solar_index=8,
               wind_speed_kmh=10, cloud_cover_pct=15)
    r = engine.calculate(_route(duration_s=1800), obs)
    names = {c.name for c in r.contributors}
    _ok("T10 temperature contributor present",     "temperature" in names)
    _ok("T10 humidity contributor present",        "humidity" in names)
    _ok("T10 solar_radiation contributor present", "solar_radiation" in names)
    _ok("T10 wind_speed contributor present",      "wind_speed" in names)
    _ok("T10 exposure_duration contributor present","exposure_duration" in names)
    _ok("T10 cloud_cover contributor present",     "cloud_cover" in names)
    # Wind and cloud cover must have <= 0 contribution (reduce or neutral)
    wind_c = next(c for c in r.contributors if c.name == "wind_speed")
    cloud_c = next(c for c in r.contributors if c.name == "cloud_cover")
    _ok("T10 wind contribution is non-positive",  wind_c.points_contributed <= 0,
        str(wind_c.points_contributed))
    _ok("T10 cloud contribution is zero (baked into solar)", cloud_c.points_contributed == 0.0,
        str(cloud_c.points_contributed))
    # All contributors have display_name populated
    for c in r.contributors:
        _ok(f"T10 display_name populated for {c.name}", bool(c.display_name))


# ── T11: Demo provider marks data correctly ───────────────────────────────────
def test_t11_demo_provider():
    provider = DemoEnvironmentalProvider(scenario="warm_midday")
    obs = provider.get_observation(lat=21.0, lng=72.0)
    _ok("T11 is_demo is True",                    obs.is_demo is True)
    _ok("T11 confidence is DEMO",                  obs.confidence == ConfidenceLevel.DEMO)
    _ok("T11 freshness.observed_at is None",       obs.freshness.observed_at is None,
        "no fabricated timestamp")
    _ok("T11 freshness.age_minutes is None",       obs.freshness.age_minutes is None)
    _ok("T11 data_source mentions Demo",
        "Demo" in obs.data_source or "demo" in obs.data_source.lower())
    r = engine.calculate(_route(), obs)
    _ok("T11 result.is_demo_data is True",         r.is_demo_data is True)
    _ok("T11 result.confidence is DEMO",           r.confidence == ConfidenceLevel.DEMO)
    _ok("T11 freshness_note mentions DEMO",
        "DEMO" in r.data_freshness_note.upper())


# ── T12: Invalid/missing environmental data handled safely ────────────────────
def test_t12_invalid_data():
    bad_obs = EnvironmentalObservation(
        temperature_c=999, humidity_pct=150,
        solar_index=12.0,  wind_speed_kmh=-5,
        cloud_cover_pct=150,
        data_source="BadSensor", is_demo=False,
    )
    r = engine.calculate(_route(), bad_obs)
    _ok("T12 warnings produced for bad data",  len(r.validation_warnings) > 0,
        str(len(r.validation_warnings)))
    _ok("T12 score still 0–100 with bad data", 0 <= r.estimated_exposure_score <= 100,
        str(r.estimated_exposure_score))


# ── T13: Zero duration → duration_pts == 0 ───────────────────────────────────
def test_t13_zero_duration():
    obs = _obs(temperature_c=40, humidity_pct=30, solar_index=9.5,
               wind_speed_kmh=5, cloud_cover_pct=5)
    r = engine.calculate(_route(distance_m=0, duration_s=0), obs)
    dur = next(c for c in r.contributors if c.name == "exposure_duration")
    _ok("T13 zero duration → duration_pts = 0", dur.points_contributed == 0.0,
        str(dur.points_contributed))
    _ok("T13 env factors still produce non-zero score", r.estimated_exposure_score > 0,
        str(r.estimated_exposure_score))


# ── T14: Extremely long duration is bounded ───────────────────────────────────
def test_t14_long_duration_bounded():
    obs = _obs(temperature_c=40, humidity_pct=80, solar_index=9.5,
               wind_speed_kmh=2, cloud_cover_pct=0)
    # 24 hours — far beyond DURATION_MAX_MINUTES
    r = engine.calculate(_route(duration_s=86400), obs)
    _ok("T14 very long duration score <= 100", r.estimated_exposure_score <= 100,
        str(r.estimated_exposure_score))
    _ok("T14 very long duration score >= 0",   r.estimated_exposure_score >= 0,
        str(r.estimated_exposure_score))


# ── T15: Determinism ─────────────────────────────────────────────────────────
def test_t15_determinism():
    obs = _obs(temperature_c=32, humidity_pct=60, solar_index=7.0,
               wind_speed_kmh=8, cloud_cover_pct=20)
    r1 = engine.calculate(_route(), obs)
    r2 = engine.calculate(_route(), obs)
    _ok("T15 score reproducible",
        r1.estimated_exposure_score == r2.estimated_exposure_score,
        f"run1={r1.estimated_exposure_score} run2={r2.estimated_exposure_score}")
    _ok("T15 risk_level reproducible",
        r1.risk_level == r2.risk_level)


if __name__ == "__main__":
    print("\n" + "=" * 72)
    print("HeatShield HeatExposureEngine — Unit Tests  (v2 — 15 tests)")
    print("=" * 72 + "\n")

    test_t1_low_conditions()
    test_t2_high_temp_increases()
    test_t3_high_humidity_increases()
    test_t4_solar_increases()
    test_t5_longer_duration_increases()
    test_t6_delivery_rider_higher()
    test_t7_wind_reduces()
    test_t8_score_bounded()
    test_t9_risk_thresholds()
    test_t10_contributors()
    test_t11_demo_provider()
    test_t12_invalid_data()
    test_t13_zero_duration()
    test_t14_long_duration_bounded()
    test_t15_determinism()

    print("\n" + "-" * 72)
    if _failures:
        print(f"FAILED: {len(_failures)} test(s) — {_failures}")
        sys.exit(1)
    else:
        print("All 15 engine tests passed.")
    print("-" * 72 + "\n")
