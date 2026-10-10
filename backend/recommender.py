"""
HeatShield RouteRecommender.

Given a list of CandidateRoutes scored by HeatExposureEngine, selects
the recommended route using a transparent, configurable utility function.

UTILITY FUNCTION (lower = better):
    utility = exposure_weight * norm_exposure + time_weight * norm_duration

    norm_exposure = (score - min_score) / (max_score - min_score)
    norm_duration = (dur   - min_dur)   / (max_dur   - min_dur)

    With a single route both normalized values = 0 (degenerate case);
    the route is recommended with an explanatory note.

DEFAULT WEIGHTS:
    exposure_weight = 0.6   (prefer exposure reduction)
    time_weight     = 0.4   (accept moderate time cost)

These can be overridden per-request.

IMPORTANT:
- This module does NOT modify or fabricate route geometry or environmental data.
- It only ranks existing scored candidates.
- "Recommended" means lowest utility score — not medically safest.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

from heat.engine import HeatExposureEngine
from heat.models import ExposureResult, RouteInput, TravelMode
from heat.providers import EnvironmentalProvider
from routing.models import CandidateRoute

logger = logging.getLogger("heatshield.recommender")

DEFAULT_EXPOSURE_WEIGHT = 0.6
DEFAULT_TIME_WEIGHT = 0.4


@dataclass
class ScoredRoute:
    """A CandidateRoute with its heat exposure score and comparison deltas."""
    candidate: CandidateRoute
    exposure_result: ExposureResult

    # Utility score (lower = better).  Populated by recommender after ranking.
    utility_score: float = 0.0

    # Deltas relative to the set minimum (0 = this IS the reference value)
    relative_time_diff_seconds: float = 0.0      # positive = slower than fastest
    relative_exposure_diff_pct: float = 0.0       # negative = lower exposure than worst

    is_recommended: bool = False


@dataclass
class RecommendationResult:
    """Full output of RouteRecommender.recommend()."""
    recommended_route_id: str
    reason: str
    provider_note: str
    exposure_weight: float
    time_weight: float
    scored_routes: list[ScoredRoute]
    is_demo_data: bool
    data_freshness_note: str


def _clamp_norm(value: float, lo: float, hi: float) -> float:
    """Normalise value to [0, 1] within [lo, hi]. Returns 0.5 if range is 0."""
    if hi <= lo:
        return 0.5
    return (value - lo) / (hi - lo)


def _build_reason(
    recommended: ScoredRoute,
    all_routes: list[ScoredRoute],
    exposure_weight: float,
    time_weight: float,
    single_route: bool,
) -> str:
    if single_route:
        return "No alternative route available from current routing provider."

    time_diff = recommended.relative_time_diff_seconds
    exp_diff = recommended.relative_exposure_diff_pct

    time_str = (
        "fastest available"
        if abs(time_diff) < 60
        else f"{abs(round(time_diff / 60))} min slower"
    )
    exp_str = (
        f"{abs(round(exp_diff))}% lower estimated heat exposure"
        if exp_diff < -2
        else "lowest heat exposure"
    )

    return (
        f"Selected using utility = {exposure_weight:.0%} exposure + {time_weight:.0%} time. "
        f"This route is {time_str} and has {exp_str} compared to the most exposed option. "
        f"Risk level: {recommended.exposure_result.risk_level.value}. "
        f"Estimated exposure score: {recommended.exposure_result.estimated_exposure_score}/100."
    )


class RouteRecommender:
    """
    Scores candidate routes and selects the best using a configurable utility function.

    Usage:
        recommender = RouteRecommender(engine, env_provider)
        result = recommender.recommend(candidates, mode, routing_result_note)
    """

    def __init__(
        self,
        engine: HeatExposureEngine,
        env_provider: EnvironmentalProvider,
        default_exposure_weight: float = DEFAULT_EXPOSURE_WEIGHT,
        default_time_weight: float = DEFAULT_TIME_WEIGHT,
    ) -> None:
        self._engine = engine
        self._env_provider = env_provider
        self._default_exp_w = default_exposure_weight
        self._default_time_w = default_time_weight

    def recommend(
        self,
        candidates: list[CandidateRoute],
        mode: TravelMode,
        origin_lat: float = 0.0,
        origin_lng: float = 0.0,
        provider_note: str = "",
        exposure_weight: float | None = None,
        time_weight: float | None = None,
    ) -> RecommendationResult:
        """
        Score each candidate and return a RecommendationResult.

        Args:
            candidates      : List of CandidateRoutes from a RoutingProvider
            mode            : TravelMode (walking | delivery_rider)
            origin_lat/lng  : For live weather lookup (passed to EnvProvider)
            provider_note   : Limitation note from the RoutingProvider
            exposure_weight : Override (default 0.6)
            time_weight     : Override (default 0.4)
        """
        if not candidates:
            raise ValueError("Cannot recommend from an empty candidate list.")

        exp_w = exposure_weight if exposure_weight is not None else self._default_exp_w
        time_w = time_weight if time_weight is not None else self._default_time_w

        observation = self._env_provider.get_observation(origin_lat, origin_lng)

        # ── Score each candidate ─────────────────────────────────────────────
        scored: list[ScoredRoute] = []
        for candidate in candidates:
            route_input = RouteInput(
                distance_meters=candidate.distance_meters,
                duration_seconds=candidate.duration_seconds,
                mode=mode,
            )
            result = self._engine.calculate(route_input, observation)
            scored.append(ScoredRoute(candidate=candidate, exposure_result=result))

        # ── Compute comparison deltas ─────────────────────────────────────────
        min_dur = min(s.candidate.duration_seconds for s in scored)
        max_dur = max(s.candidate.duration_seconds for s in scored)
        min_exp = min(s.exposure_result.estimated_exposure_score for s in scored)
        max_exp = max(s.exposure_result.estimated_exposure_score for s in scored)

        for s in scored:
            s.relative_time_diff_seconds = s.candidate.duration_seconds - min_dur
            # negative = better than worst; 0 = worst exposure in set
            if max_exp > 0:
                s.relative_exposure_diff_pct = (
                    (s.exposure_result.estimated_exposure_score - max_exp) / max_exp * 100
                )

        # ── Utility function ─────────────────────────────────────────────────
        for s in scored:
            norm_exp = _clamp_norm(
                s.exposure_result.estimated_exposure_score, min_exp, max_exp
            )
            norm_dur = _clamp_norm(s.candidate.duration_seconds, min_dur, max_dur)
            s.utility_score = exp_w * norm_exp + time_w * norm_dur

        # ── Select best ──────────────────────────────────────────────────────
        best = min(scored, key=lambda s: s.utility_score)
        best.is_recommended = True

        single_route = len(scored) == 1

        reason = _build_reason(best, scored, exp_w, time_w, single_route)

        logger.info(
            "Recommendation: %s (utility=%.3f, exposure=%d, duration=%ds) | "
            "weights: exp=%.2f time=%.2f | candidates=%d",
            best.candidate.id,
            best.utility_score,
            best.exposure_result.estimated_exposure_score,
            best.candidate.duration_seconds,
            exp_w, time_w, len(scored),
        )

        return RecommendationResult(
            recommended_route_id=best.candidate.id,
            reason=reason,
            provider_note=provider_note,
            exposure_weight=exp_w,
            time_weight=time_w,
            scored_routes=scored,
            is_demo_data=observation.is_demo,
            # Use the engine's computed freshness note (from the first scored route)
            # so it reflects the actual observation confidence level.
            data_freshness_note=scored[0].exposure_result.data_freshness_note,
        )
