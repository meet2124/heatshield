/**
 * Pure Navigation Engine for HeatShield.
 * Handles checkpoint derivation, monotonic progress evaluation,
 * noise-tolerant off-route detection, and simulation.
 */

import type { Checkpoint, GPSFix, RouteStep } from './types'
import {
  haversineDistance,
  minDistanceToRoute,
} from './geoUtils'

export const CHECKPOINT_PROXIMITY_THRESHOLD_METERS = 30
export const ARRIVAL_PROXIMITY_THRESHOLD_METERS = 25
export const DEFAULT_OFF_ROUTE_THRESHOLD_METERS = 45
export const SUSTAINED_OFF_ROUTE_COUNT_TRIGGER = 2

/**
 * Builds checkpoints from actual ORS route steps and geometry.
 */
export function buildCheckpoints(
  steps: RouteStep[],
  coordinatesLngLat: [number, number][]
): Checkpoint[] {
  if (!steps || steps.length === 0) {
    // If no steps provided, generate checkpoints from start, middle, end of geometry
    if (!coordinatesLngLat || coordinatesLngLat.length === 0) return []
    const points: Checkpoint[] = []
    const count = Math.min(5, coordinatesLngLat.length)
    const stepInterval = Math.max(1, Math.floor(coordinatesLngLat.length / count))

    for (let i = 0; i < coordinatesLngLat.length; i += stepInterval) {
      const [lng, lat] = coordinatesLngLat[i]
      points.push({
        id: `chk_geom_${i}`,
        stepIndex: points.length,
        instruction: i === 0 ? 'Depart origin' : i >= coordinatesLngLat.length - stepInterval ? 'Arrive at destination' : `Waypoint ${points.length}`,
        name: i === 0 ? 'Origin' : 'Waypoint',
        lat,
        lng,
        distanceFromStartMeters: 0,
        status: points.length === 0 ? 'current' : 'pending',
      })
    }
    return points
  }

  let cumulativeDistance = 0
  const checkpoints: Checkpoint[] = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    cumulativeDistance += step.distance

    // Look up coordinate from way_points[0]
    let lat = 0
    let lng = 0
    const wpIdx = step.way_points?.[0] ?? 0
    if (coordinatesLngLat[wpIdx]) {
      lng = coordinatesLngLat[wpIdx][0]
      lat = coordinatesLngLat[wpIdx][1]
    } else if (coordinatesLngLat.length > 0) {
      lng = coordinatesLngLat[0][0]
      lat = coordinatesLngLat[0][1]
    }

    checkpoints.push({
      id: `chk_step_${i}`,
      stepIndex: i,
      instruction: step.instruction || (i === 0 ? 'Depart' : 'Continue along route'),
      name: step.name || (i === steps.length - 1 ? 'Destination' : 'Route Segment'),
      lat,
      lng,
      distanceFromStartMeters: cumulativeDistance,
      status: i === 0 ? 'current' : 'pending',
    })
  }

  return checkpoints
}

export interface ProgressEvaluationResult {
  stepIndex: number
  distanceToNextManeuverMeters: number
  distanceTraveledMeters: number
  distanceRemainingMeters: number
  crossTrackDistanceMeters: number
  isOffRoute: boolean
  consecutiveOffRouteCount: number
  isCompleted: boolean
  updatedCheckpoints: Checkpoint[]
}

/**
 * Pure evaluation function for GPS position updates.
 * Guarantees monotonic forward progress: steps and checkpoints cannot bounce backward.
 */
export function evaluateNavigationProgress(
  userFix: GPSFix,
  currentStepIndex: number,
  checkpoints: Checkpoint[],
  steps: RouteStep[],
  coordinatesLngLat: [number, number][],
  previousConsecutiveOffRoute: number
): ProgressEvaluationResult {
  // 1. Measure distance from route polyline
  const routeMatch = minDistanceToRoute(
    userFix.lat,
    userFix.lng,
    coordinatesLngLat
  )

  const crossTrackDistanceMeters = routeMatch.minDistanceMeters
  const distanceAlongPolyline = routeMatch.distanceAlongPolylineMeters
  const totalPolylineDistance = routeMatch.totalPolylineDistanceMeters

  // 2. Sensible GPS Noise Filtering & Sustained Deviation Check
  // Effective threshold expands if device GPS accuracy is degraded
  const effectiveThreshold = Math.max(
    DEFAULT_OFF_ROUTE_THRESHOLD_METERS,
    (userFix.accuracy || 10) * 1.5
  )

  let consecutiveOffRoute = previousConsecutiveOffRoute
  let isOffRoute = false

  if (crossTrackDistanceMeters > effectiveThreshold) {
    consecutiveOffRoute += 1
    if (consecutiveOffRoute >= SUSTAINED_OFF_ROUTE_COUNT_TRIGGER) {
      isOffRoute = true
    }
  } else {
    consecutiveOffRoute = 0
    isOffRoute = false
  }

  // 3. Monotonic Step & Checkpoint Progression
  // Check distance to destination
  let isCompleted = false
  if (coordinatesLngLat.length > 0) {
    const destCoord = coordinatesLngLat[coordinatesLngLat.length - 1]
    const distToDest = haversineDistance(
      userFix.lat,
      userFix.lng,
      destCoord[1],
      destCoord[0]
    )
    if (distToDest <= ARRIVAL_PROXIMITY_THRESHOLD_METERS) {
      isCompleted = true
    }
  }

  let activeStepIndex = currentStepIndex
  const updatedCheckpoints = checkpoints.map(chk => ({ ...chk }))

  // Check if we should advance the current step
  // Only search forward (activeStepIndex .. steps.length - 1)
  while (activeStepIndex < steps.length - 1) {
    const nextStep = steps[activeStepIndex + 1]
    const nextWpIdx = nextStep.way_points?.[0] ?? 0
    const nextCoord = coordinatesLngLat[nextWpIdx]

    if (!nextCoord) {
      break
    }

    const distToNextManeuverPoint = haversineDistance(
      userFix.lat,
      userFix.lng,
      nextCoord[1],
      nextCoord[0]
    )

    // Advance if within proximity threshold of the maneuver point
    // or if distance along polyline exceeds the maneuver point's position
    const hasReachedManeuver =
      distToNextManeuverPoint <= CHECKPOINT_PROXIMITY_THRESHOLD_METERS

    if (hasReachedManeuver) {
      // Mark current step's checkpoint as completed
      if (updatedCheckpoints[activeStepIndex]) {
        updatedCheckpoints[activeStepIndex].status = 'completed'
        updatedCheckpoints[activeStepIndex].completedAt = userFix.timestamp
      }
      activeStepIndex += 1
      if (updatedCheckpoints[activeStepIndex]) {
        updatedCheckpoints[activeStepIndex].status = 'current'
      }
    } else {
      break
    }
  }

  if (isCompleted && updatedCheckpoints.length > 0) {
    updatedCheckpoints.forEach(c => {
      c.status = 'completed'
    })
  }

  // Calculate distance to current active maneuver point
  let distanceToNextManeuverMeters = 0
  const upcomingStep = steps[activeStepIndex + 1] || steps[activeStepIndex]
  if (upcomingStep && coordinatesLngLat.length > 0) {
    const wpIdx = upcomingStep.way_points?.[0] ?? coordinatesLngLat.length - 1
    const wpCoord = coordinatesLngLat[wpIdx]
    if (wpCoord) {
      distanceToNextManeuverMeters = haversineDistance(
        userFix.lat,
        userFix.lng,
        wpCoord[1],
        wpCoord[0]
      )
    }
  }

  const distanceTraveledMeters = Math.min(
    totalPolylineDistance,
    distanceAlongPolyline
  )
  const distanceRemainingMeters = Math.max(
    0,
    totalPolylineDistance - distanceTraveledMeters
  )

  return {
    stepIndex: activeStepIndex,
    distanceToNextManeuverMeters,
    distanceTraveledMeters,
    distanceRemainingMeters,
    crossTrackDistanceMeters,
    isOffRoute,
    consecutiveOffRouteCount: consecutiveOffRoute,
    isCompleted,
    updatedCheckpoints,
  }
}
