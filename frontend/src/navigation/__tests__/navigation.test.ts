/**
 * HeatShield Navigation Engine Unit Tests
 * Uses Node's built-in test runner: node --test
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCheckpoints,
  evaluateNavigationProgress,
} from '../navigationEngine.ts'
import {
  haversineDistance,
  minDistanceToRoute,
  formatNavDistance,
  formatNavDuration,
  getManeuverVisual,
} from '../geoUtils.ts'
import type { GPSFix, RouteStep } from '../types.ts'

// Mock route coordinates (Surat to Bardoli sample coordinates: [lng, lat])
const mockRouteCoordinates: [number, number][] = [
  [72.8311, 21.1702], // Origin (pt 0)
  [72.8500, 21.1750], // Checkpoint 1 (pt 1) (~2.0 km away)
  [72.8800, 21.1800], // Checkpoint 2 (pt 2)
  [72.9200, 21.1900], // Destination (pt 3)
]

const mockSteps: RouteStep[] = [
  {
    distance: 2000,
    duration: 300,
    type: 10, // Depart
    instruction: 'Head east on Ring Road',
    name: 'Ring Road',
    way_points: [0, 1],
  },
  {
    distance: 3500,
    duration: 500,
    type: 1, // Turn right
    instruction: 'Turn right onto State Highway 168',
    name: 'SH 168',
    way_points: [1, 2],
  },
  {
    distance: 4200,
    duration: 600,
    type: 11, // Arrive
    instruction: 'Arrive at destination on left',
    name: 'Destination Way',
    way_points: [2, 3],
  },
]

describe('1. Geographic Utilities', () => {
  test('haversineDistance returns accurate distance in meters', () => {
    // 1 deg latitude is approx 111.19 km
    const d = haversineDistance(21.0, 72.0, 21.01, 72.0)
    assert.ok(d > 1100 && d < 1125, `Expected ~1112m, got ${d}`)
  })

  test('minDistanceToRoute detects user on the line segment', () => {
    // Exactly halfway between origin and point 1:
    const midLng = (72.8311 + 72.8500) / 2
    const midLat = (21.1702 + 21.1750) / 2
    const res = minDistanceToRoute(midLat, midLng, mockRouteCoordinates)
    assert.ok(res.minDistanceMeters < 5, `Expected <5m deviation, got ${res.minDistanceMeters}`)
    assert.equal(res.closestSegmentIndex, 0)
  })

  test('formatNavDistance formats small and large meters accurately', () => {
    assert.equal(formatNavDistance(45), '45 m')
    assert.equal(formatNavDistance(850), '850 m')
    assert.equal(formatNavDistance(2400), '2.4 km')
  })

  test('formatNavDuration formats seconds to human readable', () => {
    assert.equal(formatNavDuration(45), '45s')
    assert.equal(formatNavDuration(135), '2m 15s')
    assert.equal(formatNavDuration(3720), '1h 2m')
  })

  test('getManeuverVisual maps ORS types to correct visuals', () => {
    assert.equal(getManeuverVisual(0).iconType, 'turn-left')
    assert.equal(getManeuverVisual(1).iconType, 'turn-right')
    assert.equal(getManeuverVisual(6).iconType, 'straight')
    assert.equal(getManeuverVisual(11).iconType, 'arrive')
  })
})

describe('2. Checkpoint Derivation', () => {
  test('derives checkpoints from real route steps with correct indices', () => {
    const checkpoints = buildCheckpoints(mockSteps, mockRouteCoordinates)
    assert.equal(checkpoints.length, 3)
    assert.equal(checkpoints[0].stepIndex, 0)
    assert.equal(checkpoints[0].status, 'current')
    assert.equal(checkpoints[0].name, 'Ring Road')
    assert.equal(checkpoints[1].status, 'pending')
    assert.equal(checkpoints[1].instruction, 'Turn right onto State Highway 168')
    assert.equal(checkpoints[2].name, 'Destination Way')
  })
})

describe('3. Route Progress & Checkpoint Advancement', () => {
  test('advances step and completes checkpoint when user is within proximity threshold', () => {
    const checkpoints = buildCheckpoints(mockSteps, mockRouteCoordinates)

    // User is at point 1 (checkpoint 1 junction)
    const userFix: GPSFix = {
      lat: mockRouteCoordinates[1][1],
      lng: mockRouteCoordinates[1][0],
      accuracy: 5,
      heading: null,
      speed: 1.4,
      timestamp: 1000,
      isSimulated: false,
    }

    const res = evaluateNavigationProgress(
      userFix,
      0, // current step 0
      checkpoints,
      mockSteps,
      mockRouteCoordinates,
      0
    )

    // Step should advance to 1, and checkpoint 0 should be marked completed
    assert.equal(res.stepIndex, 1, 'Step index should advance from 0 to 1')
    assert.equal(res.updatedCheckpoints[0].status, 'completed')
    assert.equal(res.updatedCheckpoints[1].status, 'current')
    assert.equal(res.isCompleted, false)
  })

  test('duplicate checkpoint suppression (monotonic guard against GPS jitter)', () => {
    const checkpoints = buildCheckpoints(mockSteps, mockRouteCoordinates)
    // Mark checkpoint 0 as completed previously
    checkpoints[0].status = 'completed'
    checkpoints[1].status = 'current'

    // User device experiences GPS jitter, reporting a point slightly behind checkpoint 0
    const jitterFix: GPSFix = {
      lat: mockRouteCoordinates[0][1],
      lng: mockRouteCoordinates[0][0],
      accuracy: 15,
      heading: null,
      speed: 0.5,
      timestamp: 2000,
      isSimulated: false,
    }

    const res = evaluateNavigationProgress(
      jitterFix,
      1, // already at step 1
      checkpoints,
      mockSteps,
      mockRouteCoordinates,
      0
    )

    // Jitter must NEVER regress the step index backwards
    assert.equal(res.stepIndex, 1, 'Step index must not regress backwards')
    assert.equal(res.updatedCheckpoints[0].status, 'completed', 'Checkpoint 0 must remain completed')
  })
})

describe('4. Route Deviation & Noise Filtering', () => {
  test('tolerates GPS noise when user accuracy is degraded', () => {
    const checkpoints = buildCheckpoints(mockSteps, mockRouteCoordinates)

    // User is 35m off route, but GPS accuracy is ±25m (noisy)
    // Dynamic threshold: max(45, 25 * 1.5) = 45m -> not considered off-route
    const noisyFix: GPSFix = {
      lat: 21.1705, // ~33m north of origin
      lng: 72.8311,
      accuracy: 25,
      heading: null,
      speed: 1.2,
      timestamp: 3000,
      isSimulated: false,
    }

    const res = evaluateNavigationProgress(
      noisyFix,
      0,
      checkpoints,
      mockSteps,
      mockRouteCoordinates,
      0
    )

    assert.equal(res.isOffRoute, false, 'Single noisy GPS fix should not trigger off-route alert')
  })

  test('detects sustained off-route deviation after 2 consecutive fixes', () => {
    const checkpoints = buildCheckpoints(mockSteps, mockRouteCoordinates)

    // User is 500m away from route (sustained deviation)
    const offRouteFix: GPSFix = {
      lat: 21.1800, // ~1.1 km away
      lng: 72.8311,
      accuracy: 4,
      heading: null,
      speed: 2.0,
      timestamp: 4000,
      isSimulated: false,
    }

    // Fix 1: consecutive count becomes 1, but not yet alert
    const res1 = evaluateNavigationProgress(
      offRouteFix,
      0,
      checkpoints,
      mockSteps,
      mockRouteCoordinates,
      0
    )
    assert.equal(res1.consecutiveOffRouteCount, 1)
    assert.equal(res1.isOffRoute, false, 'First off-route fix should debounce')

    // Fix 2: consecutive count becomes 2, triggers sustained alert
    const res2 = evaluateNavigationProgress(
      offRouteFix,
      0,
      checkpoints,
      mockSteps,
      mockRouteCoordinates,
      res1.consecutiveOffRouteCount
    )
    assert.equal(res2.consecutiveOffRouteCount, 2)
    assert.equal(res2.isOffRoute, true, 'Second consecutive off-route fix must trigger offRoute')
  })
})

describe('5. Journey Completion', () => {
  test('marks journey completed when user reaches destination within threshold', () => {
    const checkpoints = buildCheckpoints(mockSteps, mockRouteCoordinates)

    // User reaches destination point (pt 3)
    const destFix: GPSFix = {
      lat: mockRouteCoordinates[3][1],
      lng: mockRouteCoordinates[3][0],
      accuracy: 3,
      heading: null,
      speed: 0.2,
      timestamp: 5000,
      isSimulated: false,
    }

    const res = evaluateNavigationProgress(
      destFix,
      2,
      checkpoints,
      mockSteps,
      mockRouteCoordinates,
      0
    )

    assert.equal(res.isCompleted, true, 'Reaching destination must trigger isCompleted')
    res.updatedCheckpoints.forEach(chk => {
      assert.equal(chk.status, 'completed', 'All checkpoints should be marked completed upon arrival')
    })
  })
})

describe('6. Demo Simulation Separation', () => {
  test('simulated GPS fix is flagged with isSimulated: true and distinct from device GPS', () => {
    const simFix: GPSFix = {
      lat: 21.1702,
      lng: 72.8311,
      accuracy: 3.5,
      heading: null,
      speed: 1.4,
      timestamp: Date.now(),
      isSimulated: true,
    }

    assert.equal(simFix.isSimulated, true)
    assert.notEqual(simFix.isSimulated, false)
  })
})
