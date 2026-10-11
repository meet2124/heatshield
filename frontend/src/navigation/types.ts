/**
 * HeatShield Navigation Types & Contracts
 */

export interface Coords {
  lat: number
  lng: number
}

export interface RouteStep {
  distance: number // meters
  duration: number // seconds
  type: number // ORS maneuver code
  instruction: string // e.g. "Turn right onto Brigade Road"
  name: string // e.g. "Brigade Road"
  way_points: [number, number] // indices into route geometry coordinates [start, end]
}

export interface Checkpoint {
  id: string
  stepIndex: number
  instruction: string
  name: string
  lat: number
  lng: number
  distanceFromStartMeters: number
  status: 'pending' | 'current' | 'completed'
  completedAt?: number // timestamp
}

export interface GPSFix {
  lat: number
  lng: number
  accuracy: number // meters
  heading: number | null
  speed: number | null
  timestamp: number
  isSimulated: boolean
}

export type GPSStatus =
  | 'idle'
  | 'requesting_permission'
  | 'permission_denied'
  | 'position_unavailable'
  | 'acquiring_lock'
  | 'locked'
  | 'stale'

export type JourneyStatus =
  | 'idle'
  | 'active'
  | 'paused'
  | 'off_route'
  | 'rerouting'
  | 'completed'

export interface JourneyTelemetry {
  distanceTraveledMeters: number
  distanceRemainingMeters: number
  durationElapsedSeconds: number
  durationRemainingSeconds: number
  etaIso: string
  currentStepIndex: number
  distanceToNextManeuverMeters: number
  crossTrackDistanceMeters: number
  isOffRoute: boolean
  offRouteCount: number
  completedCheckpointsCount: number
  totalCheckpointsCount: number
}
