/**
 * Geographic calculation utilities for HeatShield GPS Navigation.
 */

const EARTH_RADIUS_METERS = 6371000

/**
 * Calculates Haversine distance in meters between two lat/lng coordinates.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_METERS * c
}

/**
 * Calculates initial bearing in degrees (0-360) from point 1 to point 2.
 */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const θ = Math.atan2(y, x)
  return ((θ * 180) / Math.PI + 360) % 360
}

/**
 * Calculates the perpendicular distance (cross-track distance) in meters
 * from a point [pLat, pLng] to a line segment [aLat, aLng] -> [bLat, bLng].
 */
export function distanceToSegment(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): { distanceMeters: number; closestPoint: [number, number]; t: number } {
  // Convert to local equirectangular plane centered at average latitude
  const meanLatRad = (((aLat + bLat) / 2) * Math.PI) / 180
  const cosLat = Math.cos(meanLatRad)

  // x is longitude in meters, y is latitude in meters
  const degToMeters = (Math.PI * EARTH_RADIUS_METERS) / 180
  const ax = aLng * cosLat * degToMeters
  const ay = aLat * degToMeters
  const bx = bLng * cosLat * degToMeters
  const by = bLat * degToMeters
  const px = pLng * cosLat * degToMeters
  const py = pLat * degToMeters

  const dx = bx - ax
  const dy = by - ay
  const segLenSq = dx * dx + dy * dy

  let t = 0
  if (segLenSq > 1e-9) {
    t = ((px - ax) * dx + (py - ay) * dy) / segLenSq
    t = Math.max(0, Math.min(1, t))
  }

  const projX = ax + t * dx
  const projY = ay + t * dy

  const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY)
  const distanceMeters = Math.sqrt(distSq)

  // Convert back to lat/lng
  const closestLat = projY / degToMeters
  const closestLng = projX / (cosLat * degToMeters)

  return { distanceMeters, closestPoint: [closestLat, closestLng], t }
}

/**
 * Finds the minimum perpendicular cross-track distance in meters from a user position [lat, lng]
 * to a route polyline given in GeoJSON coordinates format [[lng, lat], ...].
 */
export function minDistanceToRoute(
  userLat: number,
  userLng: number,
  routeCoordinatesLngLat: [number, number][]
): {
  minDistanceMeters: number
  closestSegmentIndex: number
  closestPoint: [number, number]
  totalPolylineDistanceMeters: number
  distanceAlongPolylineMeters: number
} {
  if (!routeCoordinatesLngLat || routeCoordinatesLngLat.length === 0) {
    return {
      minDistanceMeters: 0,
      closestSegmentIndex: -1,
      closestPoint: [userLat, userLng],
      totalPolylineDistanceMeters: 0,
      distanceAlongPolylineMeters: 0,
    }
  }

  if (routeCoordinatesLngLat.length === 1) {
    const [lng, lat] = routeCoordinatesLngLat[0]
    const d = haversineDistance(userLat, userLng, lat, lng)
    return {
      minDistanceMeters: d,
      closestSegmentIndex: 0,
      closestPoint: [lat, lng],
      totalPolylineDistanceMeters: 0,
      distanceAlongPolylineMeters: 0,
    }
  }

  let minDistanceMeters = Infinity
  let closestSegmentIndex = 0
  let closestPoint: [number, number] = [userLat, userLng]
  let bestT = 0

  // Pre-calculate cumulative lengths to find progress along route
  const cumulativeLengths: number[] = [0]
  for (let i = 0; i < routeCoordinatesLngLat.length - 1; i++) {
    const [aLng, aLat] = routeCoordinatesLngLat[i]
    const [bLng, bLat] = routeCoordinatesLngLat[i + 1]
    const segDist = haversineDistance(aLat, aLng, bLat, bLng)
    cumulativeLengths.push(cumulativeLengths[i] + segDist)

    const res = distanceToSegment(userLat, userLng, aLat, aLng, bLat, bLng)
    if (res.distanceMeters < minDistanceMeters) {
      minDistanceMeters = res.distanceMeters
      closestSegmentIndex = i
      closestPoint = res.closestPoint
      bestT = res.t
    }
  }

  const totalPolylineDistanceMeters =
    cumulativeLengths[cumulativeLengths.length - 1]

  const segStartDist = cumulativeLengths[closestSegmentIndex]
  const segEndDist = cumulativeLengths[closestSegmentIndex + 1]
  const distanceAlongPolylineMeters =
    segStartDist + bestT * (segEndDist - segStartDist)

  return {
    minDistanceMeters,
    closestSegmentIndex,
    closestPoint,
    totalPolylineDistanceMeters,
    distanceAlongPolylineMeters,
  }
}

/**
 * Human-friendly distance format
 */
export function formatNavDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${(meters / 1000).toFixed(1)} km`
}

/**
 * Human-friendly duration format (e.g. "12m 30s" or "1h 15m")
 */
export function formatNavDuration(seconds: number): string {
  const totalSecs = Math.max(0, Math.round(seconds))
  const hrs = Math.floor(totalSecs / 3600)
  const mins = Math.floor((totalSecs % 3600) / 60)
  const secs = totalSecs % 60

  if (hrs > 0) {
    return `${hrs}h ${mins}m`
  }
  if (mins > 0) {
    return `${mins}m ${secs}s`
  }
  return `${secs}s`
}

/**
 * Formats seconds into HH:MM am/pm ETA
 */
export function formatNavEta(remainingSeconds: number): string {
  const etaDate = new Date(Date.now() + remainingSeconds * 1000)
  return etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Maneuver visual symbol helper
 */
export function getManeuverVisual(type: number): {
  iconType: string
  label: string
} {
  switch (type) {
    case 0:
      return { iconType: 'turn-left', label: 'Turn Left' }
    case 1:
      return { iconType: 'turn-right', label: 'Turn Right' }
    case 2:
      return { iconType: 'sharp-left', label: 'Sharp Left' }
    case 3:
      return { iconType: 'sharp-right', label: 'Sharp Right' }
    case 4:
      return { iconType: 'slight-left', label: 'Slight Left' }
    case 5:
      return { iconType: 'slight-right', label: 'Slight Right' }
    case 6:
      return { iconType: 'straight', label: 'Continue Straight' }
    case 7:
    case 8:
      return { iconType: 'roundabout', label: 'Roundabout' }
    case 9:
      return { iconType: 'u-turn', label: 'U-Turn' }
    case 10:
      return { iconType: 'depart', label: 'Depart' }
    case 11:
      return { iconType: 'arrive', label: 'Arrive at Target' }
    default:
      return { iconType: 'straight', label: 'Proceed' }
  }
}
