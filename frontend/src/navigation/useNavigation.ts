/**
 * React hook managing active GPS navigation state, live geolocation watcher,
 * demo simulation, turn-by-turn instruction advancement, and off-route rerouting.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import type {
  Checkpoint,
  GPSFix,
  GPSStatus,
  JourneyStatus,
  JourneyTelemetry,
  RouteStep,
} from './types'
import {
  buildCheckpoints,
  evaluateNavigationProgress,
} from './navigationEngine'
import { formatNavEta } from './geoUtils'

const STALE_GPS_TIMEOUT_MS = 15000
const SIMULATION_STEP_INTERVAL_MS = 1200

export interface UseNavigationProps {
  apiBase: string
  onRouteReplaced?: (newRoute: any) => void
}

export function useNavigation({ apiBase, onRouteReplaced }: UseNavigationProps) {
  const [journeyStatus, setJourneyStatus] = useState<JourneyStatus>('idle')
  const [gpsStatus, setGpsStatus] = useState<GPSStatus>('idle')
  const [gpsErrorMessage, setGpsErrorMessage] = useState<string | null>(null)
  const [userFix, setUserFix] = useState<GPSFix | null>(null)

  const [activeRoute, setActiveRoute] = useState<any | null>(null)
  const [travelMode, setTravelMode] = useState<'walking' | 'delivery_rider'>('walking')
  const [isDemoMode, setIsDemoMode] = useState(false)

  const [steps, setSteps] = useState<RouteStep[]>([])
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([])
  const [currentStepIndex, setCurrentStepIndex] = useState(0)

  // Telemetry
  const [telemetry, setTelemetry] = useState<JourneyTelemetry>({
    distanceTraveledMeters: 0,
    distanceRemainingMeters: 0,
    durationElapsedSeconds: 0,
    durationRemainingSeconds: 0,
    etaIso: '--:--',
    currentStepIndex: 0,
    distanceToNextManeuverMeters: 0,
    crossTrackDistanceMeters: 0,
    isOffRoute: false,
    offRouteCount: 0,
    completedCheckpointsCount: 0,
    totalCheckpointsCount: 0,
  })

  const [isRerouting, setIsRerouting] = useState(false)
  const [rerouteError, setRerouteError] = useState<string | null>(null)

  // Internal refs
  const watchIdRef = useRef<number | null>(null)
  const simTimerRef = useRef<any | null>(null)
  const elapsedTimerRef = useRef<any | null>(null)
  const lastFixTimestampRef = useRef<number>(0)
  const staleCheckTimerRef = useRef<any | null>(null)
  const simCoordinateIndexRef = useRef<number>(0)
  const consecutiveOffRouteRef = useRef<number>(0)
  const originalDestinationRef = useRef<{ lat: number; lng: number } | null>(null)
  const elapsedSecondsRef = useRef<number>(0)

  // Clear all timers and watchers
  const cleanupWatchers = useCallback(() => {
    if (watchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    if (simTimerRef.current !== null) {
      clearInterval(simTimerRef.current)
      simTimerRef.current = null
    }
    if (elapsedTimerRef.current !== null) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    if (staleCheckTimerRef.current !== null) {
      clearInterval(staleCheckTimerRef.current)
      staleCheckTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      cleanupWatchers()
    }
  }, [cleanupWatchers])

  // Extract geometry coordinates in [[lng, lat], ...]
  const getRouteCoordinates = useCallback((route: any): [number, number][] => {
    if (!route?.geometry?.coordinates) return []
    return route.geometry.coordinates as [number, number][]
  }, [])

  // Attempt automatic reroute when sustained deviation occurs
  const attemptReroute = useCallback(
    async (currentLat: number, currentLng: number) => {
      if (!originalDestinationRef.current || isRerouting) return

      setIsRerouting(true)
      setRerouteError(null)

      try {
        const dest = originalDestinationRef.current
        const res = await fetch(`${apiBase}/api/recommend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: { lat: currentLat, lng: currentLng },
            destination: { lat: dest.lat, lng: dest.lng },
            mode: travelMode,
          }),
        })

        if (!res.ok) {
          throw new Error(`Rerouting service error (${res.statusText})`)
        }

        const json = await res.json()
        const newRoutes = json.data?.routes
        if (!newRoutes || newRoutes.length === 0) {
          throw new Error('No alternative route found for current position')
        }

        const primaryRoute =
          newRoutes.find((r: any) => r.id === json.data?.recommended_route_id) ||
          newRoutes[0]

        // Replace route cleanly
        setActiveRoute(primaryRoute)
        const newCoords = getRouteCoordinates(primaryRoute)
        const newSteps: RouteStep[] = primaryRoute.steps || []
        setSteps(newSteps)

        const newCheckpoints = buildCheckpoints(newSteps, newCoords)
        setCheckpoints(newCheckpoints)
        setCurrentStepIndex(0)
        consecutiveOffRouteRef.current = 0

        if (onRouteReplaced) {
          onRouteReplaced(primaryRoute)
        }

        setJourneyStatus('active')
      } catch (err: any) {
        setRerouteError(err.message || 'Recalculation failed')
        // Retain original route and journey state
      } finally {
        setIsRerouting(false)
      }
    },
    [apiBase, travelMode, isRerouting, getRouteCoordinates, onRouteReplaced]
  )

  // Handle incoming position fix (from either real GPS or simulation)
  const processPositionFix = useCallback(
    (fix: GPSFix) => {
      setUserFix(fix)
      lastFixTimestampRef.current = fix.timestamp
      setGpsStatus('locked')
      setGpsErrorMessage(null)

      if (journeyStatus !== 'active' && journeyStatus !== 'off_route') {
        return
      }

      if (!activeRoute) return
      const coords = getRouteCoordinates(activeRoute)
      if (coords.length === 0) return

      // Evaluate progress with monotonic guard
      const result = evaluateNavigationProgress(
        fix,
        currentStepIndex,
        checkpoints,
        steps,
        coords,
        consecutiveOffRouteRef.current
      )

      consecutiveOffRouteRef.current = result.consecutiveOffRouteCount
      setCurrentStepIndex(result.stepIndex)
      setCheckpoints(result.updatedCheckpoints)

      // Estimate remaining duration
      const totalDur = activeRoute.duration_seconds || 600
      const progressFraction =
        coords.length > 0
          ? Math.max(0, Math.min(1, 1 - result.distanceRemainingMeters / (activeRoute.distance_meters || 1)))
          : 0
      const remainingSecs = Math.max(0, Math.round(totalDur * (1 - progressFraction)))

      const completedCount = result.updatedCheckpoints.filter(
        c => c.status === 'completed'
      ).length

      setTelemetry(prev => ({
        ...prev,
        distanceTraveledMeters: result.distanceTraveledMeters,
        distanceRemainingMeters: result.distanceRemainingMeters,
        durationRemainingSeconds: remainingSecs,
        etaIso: formatNavEta(remainingSecs),
        currentStepIndex: result.stepIndex,
        distanceToNextManeuverMeters: result.distanceToNextManeuverMeters,
        crossTrackDistanceMeters: result.crossTrackDistanceMeters,
        isOffRoute: result.isOffRoute,
        offRouteCount: result.consecutiveOffRouteCount,
        completedCheckpointsCount: completedCount,
        totalCheckpointsCount: result.updatedCheckpoints.length,
      }))

      if (result.isCompleted) {
        setJourneyStatus('completed')
        cleanupWatchers()
      } else if (result.isOffRoute) {
        setJourneyStatus('off_route')
        // Automatically attempt reroute if not already rerouting
        if (!isRerouting && !isDemoMode) {
          attemptReroute(fix.lat, fix.lng)
        }
      } else if (journeyStatus === 'off_route') {
        setJourneyStatus('active')
      }
    },
    [
      journeyStatus,
      activeRoute,
      getRouteCoordinates,
      currentStepIndex,
      checkpoints,
      steps,
      isRerouting,
      isDemoMode,
      attemptReroute,
      cleanupWatchers,
    ]
  )

  // Start Real GPS Geolocation Watcher
  const startRealGPSWatcher = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGpsStatus('position_unavailable')
      setGpsErrorMessage('Browser geolocation API is not supported on this device.')
      return
    }

    setGpsStatus('requesting_permission')
    setGpsErrorMessage(null)

    // Check for stale GPS every 5 seconds
    staleCheckTimerRef.current = setInterval(() => {
      if (
        lastFixTimestampRef.current > 0 &&
        Date.now() - lastFixTimestampRef.current > STALE_GPS_TIMEOUT_MS
      ) {
        setGpsStatus('stale')
      }
    }, 5000)

    try {
      const id = navigator.geolocation.watchPosition(
        position => {
          const fix: GPSFix = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading ?? null,
            speed: position.coords.speed ?? null,
            timestamp: position.timestamp || Date.now(),
            isSimulated: false,
          }
          processPositionFix(fix)
        },
        error => {
          if (error.code === error.PERMISSION_DENIED) {
            setGpsStatus('permission_denied')
            setGpsErrorMessage(
              'Geolocation permission denied. Please allow location access in your browser settings to navigate.'
            )
          } else if (error.code === error.POSITION_UNAVAILABLE) {
            setGpsStatus('position_unavailable')
            setGpsErrorMessage('GPS position is currently unavailable. Ensure device location is turned on.')
          } else {
            // Timeout - keep trying
            if (lastFixTimestampRef.current === 0) {
              setGpsStatus('acquiring_lock')
              setGpsErrorMessage('Searching for satellite lock...')
            }
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 2000,
          timeout: 10000,
        }
      )
      watchIdRef.current = id
      setGpsStatus('acquiring_lock')
    } catch (err: any) {
      setGpsStatus('position_unavailable')
      setGpsErrorMessage(err.message || 'Failed to initialize geolocation watcher.')
    }
  }, [processPositionFix])

  // Start Demo Mode Simulation
  const startDemoSimulation = useCallback(
    (coords: [number, number][]) => {
      if (!coords || coords.length === 0) return

      setIsDemoMode(true)
      setGpsStatus('locked')
      setGpsErrorMessage(null)

      simCoordinateIndexRef.current = 0

      // Immediately emit first point
      const [startLng, startLat] = coords[0]
      processPositionFix({
        lat: startLat,
        lng: startLng,
        accuracy: 3.5, // Plausible high accuracy
        heading: null,
        speed: 1.4, // ~5 km/h
        timestamp: Date.now(),
        isSimulated: true,
      })

      // Interval advancing through coordinates
      simTimerRef.current = setInterval(() => {
        simCoordinateIndexRef.current += 1
        const idx = simCoordinateIndexRef.current

        if (idx >= coords.length) {
          // Reached end
          const [endLng, endLat] = coords[coords.length - 1]
          processPositionFix({
            lat: endLat,
            lng: endLng,
            accuracy: 3.0,
            heading: null,
            speed: 0,
            timestamp: Date.now(),
            isSimulated: true,
          })
          clearInterval(simTimerRef.current)
          simTimerRef.current = null
          return
        }

        const [currLng, currLat] = coords[idx]
        processPositionFix({
          lat: currLat,
          lng: currLng,
          accuracy: 4.0,
          heading: null,
          speed: 1.4,
          timestamp: Date.now(),
          isSimulated: true,
        })
      }, SIMULATION_STEP_INTERVAL_MS)
    },
    [processPositionFix]
  )

  // Start Journey entrypoint
  const startJourney = useCallback(
    (
      route: any,
      mode: 'walking' | 'delivery_rider',
      destinationCoords: { lat: number; lng: number },
      isDemo: boolean = false
    ) => {
      cleanupWatchers()

      setActiveRoute(route)
      setTravelMode(mode)
      setIsDemoMode(isDemo)
      originalDestinationRef.current = destinationCoords

      const coords = getRouteCoordinates(route)
      const routeSteps: RouteStep[] = route.steps || []
      setSteps(routeSteps)

      const initialCheckpoints = buildCheckpoints(routeSteps, coords)
      setCheckpoints(initialCheckpoints)
      setCurrentStepIndex(0)
      consecutiveOffRouteRef.current = 0
      elapsedSecondsRef.current = 0

      setTelemetry({
        distanceTraveledMeters: 0,
        distanceRemainingMeters: route.distance_meters || 0,
        durationElapsedSeconds: 0,
        durationRemainingSeconds: route.duration_seconds || 0,
        etaIso: formatNavEta(route.duration_seconds || 0),
        currentStepIndex: 0,
        distanceToNextManeuverMeters: routeSteps[0]?.distance || 0,
        crossTrackDistanceMeters: 0,
        isOffRoute: false,
        offRouteCount: 0,
        completedCheckpointsCount: 0,
        totalCheckpointsCount: initialCheckpoints.length,
      })

      setJourneyStatus('active')

      // Start elapsed timer
      elapsedTimerRef.current = setInterval(() => {
        elapsedSecondsRef.current += 1
        setTelemetry(prev => ({
          ...prev,
          durationElapsedSeconds: elapsedSecondsRef.current,
        }))
      }, 1000)

      if (isDemo) {
        startDemoSimulation(coords)
      } else {
        startRealGPSWatcher()
      }
    },
    [
      cleanupWatchers,
      getRouteCoordinates,
      startDemoSimulation,
      startRealGPSWatcher,
    ]
  )

  // Pause Journey
  const pauseJourney = useCallback(() => {
    cleanupWatchers()
    setJourneyStatus('paused')
  }, [cleanupWatchers])

  // Resume Journey
  const resumeJourney = useCallback(() => {
    if (!activeRoute) return
    setJourneyStatus('active')

    // Resume elapsed timer
    elapsedTimerRef.current = setInterval(() => {
      elapsedSecondsRef.current += 1
      setTelemetry(prev => ({
        ...prev,
        durationElapsedSeconds: elapsedSecondsRef.current,
      }))
    }, 1000)

    if (isDemoMode) {
      const coords = getRouteCoordinates(activeRoute)
      // Resume from current index
      simTimerRef.current = setInterval(() => {
        simCoordinateIndexRef.current += 1
        const idx = simCoordinateIndexRef.current
        if (idx >= coords.length) {
          const [endLng, endLat] = coords[coords.length - 1]
          processPositionFix({
            lat: endLat,
            lng: endLng,
            accuracy: 3.0,
            heading: null,
            speed: 0,
            timestamp: Date.now(),
            isSimulated: true,
          })
          clearInterval(simTimerRef.current)
          simTimerRef.current = null
          return
        }

        const [currLng, currLat] = coords[idx]
        processPositionFix({
          lat: currLat,
          lng: currLng,
          accuracy: 4.0,
          heading: null,
          speed: 1.4,
          timestamp: Date.now(),
          isSimulated: true,
        })
      }, SIMULATION_STEP_INTERVAL_MS)
    } else {
      startRealGPSWatcher()
    }
  }, [
    activeRoute,
    isDemoMode,
    getRouteCoordinates,
    processPositionFix,
    startRealGPSWatcher,
  ])

  // End Journey
  const endJourney = useCallback(() => {
    cleanupWatchers()
    setJourneyStatus('idle')
    setGpsStatus('idle')
    setUserFix(null)
    setActiveRoute(null)
    setSteps([])
    setCheckpoints([])
    setCurrentStepIndex(0)
    setIsDemoMode(false)
  }, [cleanupWatchers])

  // Trigger manual reroute
  const triggerManualReroute = useCallback(() => {
    if (userFix) {
      attemptReroute(userFix.lat, userFix.lng)
    }
  }, [userFix, attemptReroute])

  const currentStep = steps[currentStepIndex] || null
  const nextStep = steps[currentStepIndex + 1] || null

  return {
    journeyStatus,
    gpsStatus,
    gpsErrorMessage,
    userFix,
    activeRoute,
    travelMode,
    isDemoMode,
    steps,
    checkpoints,
    currentStepIndex,
    currentStep,
    nextStep,
    telemetry,
    isRerouting,
    rerouteError,
    startJourney,
    pauseJourney,
    resumeJourney,
    endJourney,
    triggerManualReroute,
  }
}
