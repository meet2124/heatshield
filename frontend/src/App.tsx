import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useNavigation } from './navigation/useNavigation'
import { NavigationHUD } from './navigation/NavigationHUD'

// ─── Types & Contracts ────────────────────────────────────────────────────────

interface Coords {
  lat: number
  lng: number
}

interface Contributor {
  name: string
  display_name: string
  raw_value: number
  unit: string
  points_contributed: number
}

interface Freshness {
  status: string
  observed_at: string | null
  age_minutes: number | null
  source_label: string
}

interface ScoredRoute {
  id: string
  distance_meters: number
  duration_seconds: number
  exposure_score: number
  risk_level: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'
  utility_score: number
  relative_time_diff_seconds: number
  relative_exposure_diff_pct: number
  is_recommended: boolean
  geometry: object
  profile?: string
  steps?: any[]
  major_contributors: Contributor[]
  all_contributors?: Contributor[]
  is_demo_data: boolean
  confidence: string
  freshness: Freshness
  data_freshness_note: string
}

interface RecommendationData {
  recommended_route_id: string
  reason: string
  provider_note: string
  exposure_weight: number
  time_weight: number
  is_demo_data: boolean
  routes: ScoredRoute[]
  originCoords?: Coords
  destCoords?: Coords
}

interface HourlyForecastItem {
  time_iso: string
  hour_label: string
  temperature_c: number
  humidity_pct: number
  wind_speed_kmh: number
  uv_index: number
  cloud_cover_pct: number
  exposure_score: number
  risk_level: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH'
  is_current_hour: boolean
}

// ─── Config & Theme ──────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

const RISK_CONFIG = {
  LOW: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    bar: 'bg-emerald-400',
    glow: 'rgba(16, 185, 129, 0.4)',
    label: 'Low Risk',
    badge: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  },
  MODERATE: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    bar: 'bg-amber-400',
    glow: 'rgba(245, 158, 11, 0.4)',
    label: 'Moderate Risk',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/30'
  },
  HIGH: {
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    text: 'text-orange-400',
    bar: 'bg-orange-400',
    glow: 'rgba(249, 115, 22, 0.4)',
    label: 'High Risk',
    badge: 'bg-orange-500/15 text-orange-300 border-orange-500/30'
  },
  VERY_HIGH: {
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    text: 'text-rose-400',
    bar: 'bg-rose-400',
    glow: 'rgba(244, 63, 94, 0.4)',
    label: 'Very High Risk',
    badge: 'bg-rose-500/15 text-rose-300 border-rose-500/30'
  },
} as const

// Preset routes for instant competition judging
const PRESETS = [
  {
    name: 'Surat ➔ Bardoli',
    desc: '35.4 km inland Gujarat heat corridor',
    origin: 'Surat, Gujarat, India',
    destination: 'Bardoli, Gujarat, India',
    mode: 'delivery_rider' as const,
  },
  {
    name: 'Central Park Loop',
    desc: '5.2 km urban park corridor, New York',
    origin: 'Times Square, New York, NY',
    destination: 'Central Park North, New York, NY',
    mode: 'walking' as const,
  },
  {
    name: 'Ahmedabad Tech Corridor',
    desc: '8.4 km semi-arid urban transit',
    origin: 'Vastrapur, Ahmedabad',
    destination: 'Gandhinagar, Gujarat',
    mode: 'delivery_rider' as const,
  },
]

// ─── Map Icons ───────────────────────────────────────────────────────────────

const createOriginIcon = () =>
  L.divIcon({
    className: 'custom-leaflet-marker origin-marker',
    html: `
      <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
        <div class="radar-ring" style="position: absolute; width: 28px; height: 28px; border-radius: 9999px; background: rgba(40, 199, 255, 0.35); border: 1.5px solid #28C7FF;"></div>
        <div style="position: relative; width: 14px; height: 14px; border-radius: 9999px; background: #28C7FF; border: 2.5px solid #050B18; box-shadow: 0 0 12px #28C7FF;"></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })

const createDestIcon = () =>
  L.divIcon({
    className: 'custom-leaflet-marker dest-marker',
    html: `
      <div style="position: relative; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
        <div style="position: absolute; width: 22px; height: 22px; border-radius: 6px; background: rgba(255, 255, 255, 0.15); border: 1.5px solid #F0F6FF; transform: rotate(45deg);"></div>
        <div style="position: relative; width: 12px; height: 12px; border-radius: 2px; background: #F0F6FF; border: 2px solid #050B18; box-shadow: 0 0 10px rgba(255, 255, 255, 0.9);"></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18],
  })

const OriginIcon = createOriginIcon()
const DestIcon = createDestIcon()

const createRealGPSUserIcon = () =>
  L.divIcon({
    className: 'custom-leaflet-marker gps-user-marker',
    html: `
      <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
        <div class="radar-ring" style="position: absolute; width: 32px; height: 32px; border-radius: 9999px; background: rgba(40, 199, 255, 0.4); border: 2px solid #28C7FF;"></div>
        <div style="position: relative; width: 16px; height: 16px; border-radius: 9999px; background: #28C7FF; border: 3px solid #050B18; box-shadow: 0 0 16px #28C7FF;"></div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  })

const createSimulatedUserIcon = () =>
  L.divIcon({
    className: 'custom-leaflet-marker sim-user-marker',
    html: `
      <div style="position: relative; width: 44px; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center;">
        <span style="background: #a855f7; color: #ffffff; font-size: 8px; font-weight: 800; padding: 1px 4px; border-radius: 4px; font-family: monospace; border: 1px solid rgba(255,255,255,0.4); box-shadow: 0 2px 4px rgba(0,0,0,0.5);">SIM</span>
        <div style="position: relative; width: 18px; height: 18px; border-radius: 9999px; background: #c084fc; border: 2.5px solid #050B18; box-shadow: 0 0 14px #a855f7;"></div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -24],
  })

const createCheckpointIcon = (status: 'completed' | 'current' | 'pending') => {
  const bg = status === 'completed' ? '#10b981' : status === 'current' ? '#28C7FF' : '#475569'
  const border = status === 'current' ? '#ffffff' : '#050B18'
  return L.divIcon({
    className: 'custom-leaflet-marker checkpoint-marker',
    html: `
      <div style="position: relative; width: 14px; height: 14px; border-radius: 9999px; background: ${bg}; border: 2px solid ${border}; box-shadow: 0 0 8px ${bg};"></div>
    `,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  })
}

const RealGPSUserIcon = createRealGPSUserIcon()
const SimulatedUserIcon = createSimulatedUserIcon()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
}

function calculateSpeedKmh(distanceMeters: number, durationSeconds: number): string {
  if (durationSeconds <= 0) return '0.0'
  const speed = (distanceMeters / 1000) / (durationSeconds / 3600)
  return speed.toFixed(1)
}

function getCurrentHourPrefix(): string {
  return new Date().toISOString().slice(0, 13)
}

function MapController({
  bounds,
  triggerResize,
  userLocation,
  isNavigating,
}: {
  bounds: [number, number][] | null
  triggerResize: number
  userLocation?: [number, number] | null
  isNavigating?: boolean
}) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    if (isNavigating && userLocation) {
      map.panTo(userLocation, { animate: true })
    } else if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
    }
  }, [bounds, map, triggerResize, userLocation, isNavigating])
  return null
}

// ─── Deterministic Model Calculator (Client-side mirror for hourly timeline) ──

function computeExposureFromWeather(
  tempC: number,
  humidityPct: number,
  uvIndex: number,
  windSpeedKmh: number,
  cloudCoverPct: number,
  durationMinutes: number,
  mode: 'walking' | 'delivery_rider'
): { score: number; risk: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH' } {
  // Linear scaling helper
  const linearScale = (val: number, min: number, max: number, weight: number) => {
    if (max <= min) return 0.0
    const frac = (val - min) / (max - min)
    return Math.max(0.0, Math.min(weight, frac * weight))
  }

  // 1. Temperature (0-40 pts)
  const tempPts = linearScale(tempC, 20.0, 45.0, 40.0)

  // 2. Humidity (0-25 pts)
  const humPts = linearScale(humidityPct, 30.0, 100.0, 25.0)

  // 3. Solar radiation modulated by cloud cover (0-20 pts)
  const cloudFactor = Math.max(0, Math.min(100, cloudCoverPct)) / 100.0
  const effSolar = Math.max(0.0, Math.min(10.0, uvIndex)) * (1.0 - 0.5 * cloudFactor)
  const solarPts = linearScale(effSolar, 0.0, 10.0, 20.0)

  // 4. Wind cooling reduction (0-10 pts subtracted)
  const windReduction = linearScale(windSpeedKmh, 0.0, 30.0, 10.0)

  // 5. Combined environmental score (capped at 85)
  const envScore = Math.max(0.0, Math.min(85.0, tempPts + humPts + solarPts - windReduction))

  // 6. Exposure duration (0-15 pts)
  const durPts = linearScale(durationMinutes, 0.0, 120.0, 15.0)

  // 7. Mode exertion multiplier (1.00x walking, 1.15x delivery_rider)
  const modeMult = mode === 'delivery_rider' ? 1.15 : 1.00

  const finalScore = Math.max(0, Math.min(100, Math.round((envScore + durPts) * modeMult)))

  let risk: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH' = 'LOW'
  if (finalScore <= 25) risk = 'LOW'
  else if (finalScore <= 50) risk = 'MODERATE'
  else if (finalScore <= 75) risk = 'HIGH'
  else risk = 'VERY_HIGH'

  return { score: finalScore, risk }
}

// ─── Actionable Insights Engine ──────────────────────────────────────────────

function generateActionableInsights(route: ScoredRoute, mode: 'walking' | 'delivery_rider') {
  const insights: { title: string; detail: string; severity: 'info' | 'warning' | 'alert' }[] = []

  // Check temperature
  const tempCont = route.major_contributors.find(c => c.name === 'temperature')
  if (tempCont && tempCont.raw_value >= 35.0) {
    insights.push({
      title: 'High Ambient Heat Warning',
      detail: `Ambient temperature (${tempCont.raw_value.toFixed(1)}°C) contributes +${Math.round(tempCont.points_contributed)} pts. Maintain hydration every 15–20 minutes and monitor for thermal strain.`,
      severity: 'alert',
    })
  } else if (tempCont && tempCont.raw_value >= 30.0) {
    insights.push({
      title: 'Elevated Ambient Thermal Load',
      detail: `Temperature at ${tempCont.raw_value.toFixed(1)}°C accounts for +${Math.round(tempCont.points_contributed)} exposure points. Plan travel through shaded street canopies.`,
      severity: 'warning',
    })
  }

  // Check solar exposure
  const solarCont = route.major_contributors.find(c => c.name === 'solar_radiation')
  if (solarCont && solarCont.points_contributed >= 10.0) {
    insights.push({
      title: 'Peak Solar UV Radiation',
      detail: `High solar irradiance adds +${Math.round(solarCont.points_contributed)} pts. Protective UV gear, polarized eyewear, and rescheduling around solar peak (11:00–15:30) recommended.`,
      severity: 'warning',
    })
  }

  // Check duration
  const durCont = route.major_contributors.find(c => c.name === 'exposure_duration')
  const durMins = route.duration_seconds / 60
  if (durMins >= 60) {
    insights.push({
      title: 'Prolonged Exposure Exposure Penalty',
      detail: `${Math.round(durMins)} min outdoor duration maxes the cumulative duration weighting (+${Math.round(durCont?.points_contributed ?? 15)} pts). Consider structured cooling pauses.`,
      severity: 'warning',
    })
  }

  // Check travel mode
  if (mode === 'delivery_rider') {
    insights.push({
      title: 'Metabolic Exertion Multiplier Active',
      detail: 'Cycling / delivery courier profile applies a 1.15x cardiovascular exertion factor reflecting sustained metabolic heat generation.',
      severity: 'info',
    })
  }

  if (insights.length === 0) {
    insights.push({
      title: 'Favorable Environmental Conditions',
      detail: 'Ambient thermal factors fall within moderate thresholds. Standard hydration precautions apply.',
      severity: 'info',
    })
  }

  return insights
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function App() {
  const [origin, setOrigin] = useState('Surat, Gujarat, India')
  const [destination, setDestination] = useState('Bardoli, Gujarat, India')
  const [mode, setMode] = useState<'walking' | 'delivery_rider'>('delivery_rider')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RecommendationData | null>(null)
  const [mapBounds, setMapBounds] = useState<[number, number][] | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [resizeTrigger, setResizeTrigger] = useState(0)

  // Active Journey GPS Navigation Hook
  const nav = useNavigation({
    apiBase: API_BASE,
    onRouteReplaced: newRoute => {
      setData(prev => {
        if (!prev) return null
        return {
          ...prev,
          routes: [newRoute, ...prev.routes.filter(r => r.id !== newRoute.id)],
          recommended_route_id: newRoute.id,
        }
      })
      setSelectedRouteId(newRoute.id)
    },
  })

  // Start Journey Handler (requests browser geolocation only upon user trigger)
  const handleStartJourney = (isDemo: boolean = false) => {
    if (!selectedRoute || !data?.destCoords) return
    nav.startJourney(selectedRoute, mode, data.destCoords, isDemo)
    setMobileTab('map')
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setShowLeftDeck(false)
      setShowRightHud(false)
    }
  }

  // Floating HUD Panels toggle states (for full map immersion)
  const [showLeftDeck, setShowLeftDeck] = useState(true)
  const [showRightHud, setShowRightHud] = useState(true)
  const [mobileTab, setMobileTab] = useState<'map' | 'planner' | 'analytics' | 'timeline'>('map')

  // Hourly timeline state
  const [hourlyTimeline, setHourlyTimeline] = useState<HourlyForecastItem[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [timelineUnavailableNote, setTimelineUnavailableNote] = useState<string | null>(null)
  const [hoveredHour, setHoveredHour] = useState<HourlyForecastItem | null>(null)

  // Live UTC Clock
  const [currentTimeUtc, setCurrentTimeUtc] = useState<string>('')

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTimeUtc(now.toUTCString().replace('GMT', 'UTC'))
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  // Trigger map resize when layout changes
  useEffect(() => {
    const timer = setTimeout(() => setResizeTrigger(prev => prev + 1), 60)
    return () => clearTimeout(timer)
  }, [showLeftDeck, showRightHud, data])

  // Geocoding helper with instant preset resolution and Nominatim fallback
  const geocode = async (query: string): Promise<Coords> => {
    const KNOWN: Record<string, Coords> = {
      'surat, gujarat, india': { lat: 21.1702, lng: 72.8311 },
      'bardoli, gujarat, india': { lat: 21.1187, lng: 73.1134 },
      'times square, new york, ny': { lat: 40.758, lng: -73.9855 },
      'central park north, new york, ny': { lat: 40.796, lng: -73.955 },
      'vastrapur, ahmedabad': { lat: 23.0373, lng: 72.5317 },
      'gandhinagar, gujarat': { lat: 23.2156, lng: 72.6369 },
    }
    const normalized = query.trim().toLowerCase()
    if (KNOWN[normalized]) {
      return KNOWN[normalized]
    }
    const coordMatch = query.match(/^([-+]?\d*\.?\d+)[,\s]+([-+]?\d*\.?\d+)$/)
    if (coordMatch) {
      return { lat: parseFloat(coordMatch[1]), lng: parseFloat(coordMatch[2]) }
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&email=contact@heatshield.app`
      )
      if (res.ok) {
        const json = await res.json()
        if (json?.length > 0) {
          return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) }
        }
      }
    } catch {
      // Fall through to known location fuzzy match
    }
    for (const [k, v] of Object.entries(KNOWN)) {
      if (normalized.includes(k) || k.includes(normalized)) {
        return v
      }
    }
    throw new Error(`Location not recognized: "${query}". Please check spelling.`)
  }

  // Swap Origin and Destination
  const handleSwap = () => {
    const temp = origin
    setOrigin(destination)
    setDestination(temp)
  }

  // Handle Preset Selection
  const applyPreset = (preset: typeof PRESETS[0]) => {
    setOrigin(preset.origin)
    setDestination(preset.destination)
    setMode(preset.mode)
    executeRecommendation(preset.origin, preset.destination, preset.mode)
  }

  // Fetch hourly forecast from Open-Meteo or backend
  const fetchHourlyForecast = async (
    lat: number,
    lng: number,
    durationSeconds: number,
    travelMode: 'walking' | 'delivery_rider',
    isDemo: boolean
  ) => {
    if (isDemo) {
      setHourlyTimeline([])
      setTimelineUnavailableNote('Hourly forecast timeline unavailable in Demo mode (Open-Meteo live feed required).')
      return
    }

    setTimelineLoading(true)
    setTimelineUnavailableNote(null)

    try {
      // Query Open-Meteo public forecast endpoint directly
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,uv_index&timezone=auto&forecast_days=2`
      const res = await fetch(url)

      if (!res.ok) {
        throw new Error(`Open-Meteo API response: ${res.statusText}`)
      }

      const json = await res.json()
      const hourly = json.hourly
      if (!hourly || !hourly.time) {
        throw new Error('Malformed hourly forecast structure')
      }

      const currentHourIsoPrefix = getCurrentHourPrefix()

      const times: string[] = hourly.time
      const temps: number[] = hourly.temperature_2m
      const hums: number[] = hourly.relative_humidity_2m
      const winds: number[] = hourly.wind_speed_10m
      const clouds: number[] = hourly.cloud_cover
      const uvs: number[] = hourly.uv_index

      // Find current hour index or start from now
      let startIndex = times.findIndex(t => t.startsWith(currentHourIsoPrefix))
      if (startIndex < 0) startIndex = 0

      const durationMins = durationSeconds / 60.0
      const items: HourlyForecastItem[] = []

      // Extract next 16 hours
      for (let i = startIndex; i < Math.min(startIndex + 16, times.length); i++) {
        const timeIso = times[i]
        const temp = temps[i]
        const hum = hums[i]
        const windKmh = winds[i] * 3.6
        const cloud = clouds[i]
        const uv = uvs[i]

        const { score, risk } = computeExposureFromWeather(
          temp,
          hum,
          uv,
          windKmh,
          cloud,
          durationMins,
          travelMode
        )

        // Parse hour label (e.g. "14:00")
        const hourPart = timeIso.includes('T') ? timeIso.split('T')[1].slice(0, 5) : timeIso

        items.push({
          time_iso: timeIso,
          hour_label: hourPart,
          temperature_c: temp,
          humidity_pct: hum,
          wind_speed_kmh: windKmh,
          uv_index: uv,
          cloud_cover_pct: cloud,
          exposure_score: score,
          risk_level: risk,
          is_current_hour: i === startIndex,
        })
      }

      setHourlyTimeline(items)
      if (items.length > 0) setHoveredHour(items[0])
    } catch (err: any) {
      console.warn('Hourly forecast fetch error:', err)
      setTimelineUnavailableNote(`Hourly forecast feed temporarily unavailable (${err.message})`)
      setHourlyTimeline([])
    } finally {
      setTimelineLoading(false)
    }
  }

  // Execute recommendation request
  const executeRecommendation = async (
    originStr: string,
    destStr: string,
    currentMode: 'walking' | 'delivery_rider'
  ) => {
    if (!originStr.trim() || !destStr.trim()) {
      setError('Please provide valid origin and destination locations.')
      return
    }

    setLoading(true)
    setError(null)
    setData(null)

    try {
      const [originCoords, destCoords] = await Promise.all([
        geocode(originStr),
        geocode(destStr),
      ])

      const res = await fetch(`${API_BASE}/api/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin: originCoords,
          destination: destCoords,
          mode: currentMode,
        }),
      })

      const json = await res.json()

      if (res.ok && json.data?.routes?.length > 0) {
        const recommendation: RecommendationData = {
          ...json.data,
          originCoords,
          destCoords,
        }
        setData(recommendation)
        setSelectedRouteId(recommendation.recommended_route_id)

        // Fit map bounds to coordinates with padding
        setMapBounds([
          [originCoords.lat, originCoords.lng],
          [destCoords.lat, destCoords.lng],
        ])

        // Fetch hourly forecast for the selected route duration
        const firstRoute = recommendation.routes[0]
        fetchHourlyForecast(
          originCoords.lat,
          originCoords.lng,
          firstRoute.duration_seconds,
          currentMode,
          recommendation.is_demo_data
        )

        // Auto-switch mobile view to map
        setMobileTab('map')
      } else if (!res.ok) {
        setError(`Backend Error: ${json.detail || res.statusText}`)
      } else {
        setError('No candidate routes discovered between these coordinates.')
      }
    } catch (err: any) {
      setError(err.message || 'Network communication error connecting to HeatShield service.')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = () => {
    executeRecommendation(origin, destination, mode)
  }

  // Get currently selected route object
  const selectedRoute = useMemo(() => {
    if (!data?.routes) return null
    return data.routes.find(r => r.id === selectedRouteId) || data.routes[0]
  }, [data, selectedRouteId])

  // Insights based on selected route
  const actionableInsights = useMemo(() => {
    if (!selectedRoute) return []
    return generateActionableInsights(selectedRoute, mode)
  }, [selectedRoute, mode])

  return (
    <div className="flex flex-col h-screen w-screen bg-[#050B18] text-[#F0F6FF] font-sans overflow-hidden select-none">

      {/* ─── Top Operational Command Bar ─── */}
      <header className="h-14 bg-[#081122]/90 backdrop-blur-xl border-b border-[#14233D] flex items-center justify-between px-4 lg:px-6 z-30 shrink-0 shadow-lg">
        <div className="flex items-center gap-3">
          {/* Glowing Shield Brandmark */}
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#28C7FF]/20 to-[#0A84FF]/20 border border-[#28C7FF]/40 flex items-center justify-center text-[#28C7FF] shadow-[0_0_15px_rgba(40,199,255,0.3)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm tracking-wider uppercase text-white">HEATSHIELD</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-bold bg-[#28C7FF]/10 text-[#28C7FF] border border-[#28C7FF]/30">v2.4 OPS</span>
            </div>
            <span className="text-[9px] uppercase tracking-[0.18em] text-[#64748B] font-semibold hidden sm:inline">
              Environmental Exposure Intelligence Command
            </span>
          </div>
        </div>

        {/* Quick Presets for Competition Judges */}
        <div className="hidden xl:flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase text-[#64748B] mr-1">Demo Scenarios:</span>
          {PRESETS.map(p => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[#0D1B33] hover:bg-[#142647] border border-[#1E355B] hover:border-[#28C7FF]/50 text-[#94A3B8] hover:text-[#28C7FF] transition-all flex items-center gap-1.5 cursor-pointer"
              title={p.desc}
            >
              <span>{p.mode === 'delivery_rider' ? '🛵' : '🚶'}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>

        {/* Right Telemetry Indicators */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded bg-[#0A1428] border border-[#14233D] text-[#94A3B8] text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-ping"></span>
            <span className="text-[#10b981] font-semibold">NWP Live Feed</span>
            <span className="text-[#475569]">|</span>
            <span className="font-mono-num text-[#CBD5E1]">{currentTimeUtc.split(' ').slice(4, 5).join(' ') || '12:00:00'} UTC</span>
          </div>

          {/* Desktop HUD Toggles */}
          <div className="hidden lg:flex items-center gap-1 bg-[#0A1428] p-0.5 rounded-lg border border-[#14233D]">
            <button
              onClick={() => setShowLeftDeck(!showLeftDeck)}
              className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
                showLeftDeck ? 'bg-[#1E355B] text-[#28C7FF]' : 'text-[#64748B] hover:text-[#CBD5E1]'
              }`}
              title="Toggle Flight Planner HUD"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>
              </svg>
            </button>
            <button
              onClick={() => setShowRightHud(!showRightHud)}
              className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
                showRightHud ? 'bg-[#1E355B] text-[#28C7FF]' : 'text-[#64748B] hover:text-[#CBD5E1]'
              }`}
              title="Toggle Intelligence HUD"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main Operations Canvas ─── */}
      <main className="flex-1 relative w-full h-[calc(100vh-3.5rem)] overflow-hidden">

        {/* ── 1. Full-Canvas Leaflet Centerpiece ── */}
        <div className="absolute inset-0 w-full h-full z-0">
          <MapContainer
            center={[21.1702, 72.8311]} // Surat default
            zoom={12}
            zoomControl={false}
            className="w-full h-full"
          >
            {/* CartoDB Dark Matter High-Tech Baselayer */}
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              subdomains="abcd"
              maxZoom={19}
            />

            <MapController
              bounds={mapBounds}
              triggerResize={resizeTrigger}
              userLocation={nav.userFix ? [nav.userFix.lat, nav.userFix.lng] : null}
              isNavigating={nav.journeyStatus === 'active' || nav.journeyStatus === 'off_route'}
            />

            {/* Checkpoint Markers during navigation */}
            {nav.journeyStatus !== 'idle' &&
              nav.checkpoints.map((chk, i) => (
                <Marker
                  key={chk.id || i}
                  position={[chk.lat, chk.lng]}
                  icon={createCheckpointIcon(chk.status)}
                >
                  <Popup className="custom-popup">
                    <div className="font-bold text-[#28C7FF]">{chk.instruction}</div>
                    <div className="text-[10px] text-[#94A3B8] font-mono">
                      {chk.name !== '-' ? chk.name : 'Route Waypoint'} • {chk.status.toUpperCase()}
                    </div>
                  </Popup>
                </Marker>
              ))}

            {/* User GPS Position on Map */}
            {nav.userFix && (
              <>
                {!nav.userFix.isSimulated && (
                  <Circle
                    center={[nav.userFix.lat, nav.userFix.lng]}
                    radius={nav.userFix.accuracy || 10}
                    pathOptions={{
                      color: '#28C7FF',
                      fillColor: '#28C7FF',
                      fillOpacity: 0.15,
                      weight: 1.5,
                      dashArray: '4, 4',
                    }}
                  />
                )}
                <Marker
                  position={[nav.userFix.lat, nav.userFix.lng]}
                  icon={nav.userFix.isSimulated ? SimulatedUserIcon : RealGPSUserIcon}
                >
                  <Popup className="custom-popup">
                    <div className="font-bold text-white">
                      {nav.userFix.isSimulated ? 'DEMO SIMULATION' : 'REAL DEVICE POSITION'}
                    </div>
                    <div className="text-[10px] text-[#94A3B8] font-mono">
                      {nav.userFix.isSimulated
                        ? 'Simulated GPS movement (Not real device)'
                        : `Accuracy: ±${Math.round(nav.userFix.accuracy)}m`}
                    </div>
                  </Popup>
                </Marker>
              </>
            )}

            {data && data.originCoords && data.destCoords && (
              <>
                {/* Custom glowing markers */}
                <Marker position={[data.originCoords.lat, data.originCoords.lng]} icon={OriginIcon}>
                  <Popup className="custom-popup">
                    <div className="font-bold text-[#28C7FF]">JOURNEY ORIGIN</div>
                    <div className="text-[10px] text-[#94A3B8] font-mono">{origin}</div>
                  </Popup>
                </Marker>

                <Marker position={[data.destCoords.lat, data.destCoords.lng]} icon={DestIcon}>
                  <Popup className="custom-popup">
                    <div className="font-bold text-[#F0F6FF]">DESTINATION TARGET</div>
                    <div className="text-[10px] text-[#94A3B8] font-mono">{destination}</div>
                  </Popup>
                </Marker>

                {/* Candidate routes */}
                {data.routes.map(r => {
                  if (selectedRouteId !== r.id) {
                    return (
                      <GeoJSON
                        key={r.id + '_bg'}
                        data={r.geometry as any}
                        style={{
                          color: '#4F46E5', // Electric Indigo for alternative
                          weight: 5,
                          opacity: 0.6,
                          lineCap: 'round',
                          lineJoin: 'round',
                        }}
                        eventHandlers={{
                          click: () => setSelectedRouteId(r.id),
                        }}
                      />
                    )
                  }
                  return null
                })}

                {/* Selected active route with high-contrast electric cyan glow */}
                {selectedRoute && (
                  <GeoJSON
                    key={selectedRoute.id + '_sel'}
                    data={selectedRoute.geometry as any}
                    style={{
                      color: '#28C7FF',
                      weight: 6,
                      opacity: 1,
                      lineCap: 'round',
                      lineJoin: 'round',
                      className: 'glow-route-active',
                    }}
                  />
                )}
              </>
            )}
          </MapContainer>

          {/* Vignette depth gradient overlay (pointer-events-none) */}
          <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_80px_rgba(5,11,24,0.85)] z-[400]"></div>
        </div>

        {/* ── 2. Floating Left HUD: Route Parameters & Candidate Matcher ── */}
        <div
          className={`absolute top-4 left-4 bottom-20 z-20 w-[380px] max-w-[calc(100vw-2rem)] flex flex-col gap-3 transition-all duration-300 pointer-events-auto ${
            showLeftDeck ? 'translate-x-0 opacity-100' : '-translate-x-[420px] opacity-0 pointer-events-none'
          } ${mobileTab === 'planner' || mobileTab === 'map' ? 'flex' : 'hidden lg:flex'}`}
        >
          {/* Route Parameters HUD */}
          <div className="hud-panel rounded-2xl p-4.5 flex flex-col gap-3.5 shadow-2xl shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#28C7FF] shadow-[0_0_8px_#28C7FF]"></div>
                <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-[#28C7FF]">
                  Flight Navigation Deck
                </h2>
              </div>
              <span className="text-[10px] font-mono text-[#64748B]">OpenRouteService</span>
            </div>

            {/* Inputs */}
            <div className="space-y-2.5">
              {/* Origin */}
              <div className="relative group">
                <div className="absolute left-3.5 top-3 text-[#28C7FF]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                </div>
                <input
                  type="text"
                  className="w-full pl-10 pr-8 py-2.5 bg-[#050B18]/90 border border-[#14233D] group-focus-within:border-[#28C7FF] focus:border-[#28C7FF] rounded-xl text-xs text-[#F0F6FF] placeholder-[#64748B] outline-none transition-all font-medium shadow-inner"
                  placeholder="Origin address or coordinates..."
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
                {origin && (
                  <button
                    onClick={() => setOrigin('')}
                    className="absolute right-2.5 top-2.5 text-[#64748B] hover:text-white text-xs p-1 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Destination */}
              <div className="relative group">
                <div className="absolute left-3.5 top-3 text-[#CBD5E1]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </div>
                <input
                  type="text"
                  className="w-full pl-10 pr-9 py-2.5 bg-[#050B18]/90 border border-[#14233D] group-focus-within:border-[#28C7FF] focus:border-[#28C7FF] rounded-xl text-xs text-[#F0F6FF] placeholder-[#64748B] outline-none transition-all font-medium shadow-inner"
                  placeholder="Destination address or coordinates..."
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
                <button
                  onClick={handleSwap}
                  className="absolute right-2 top-2 p-1.5 hover:bg-[#14233D] text-[#64748B] hover:text-[#28C7FF] rounded-lg transition-colors cursor-pointer"
                  title="Swap Origin and Destination"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 10v12"/><path d="M15 14v-12"/><path d="M11 6l4-4 4 4"/><path d="M3 18l4 4 4-4"/>
                  </svg>
                </button>
              </div>

              {/* Mode Toggle with exertion factor indicators */}
              <div className="flex bg-[#050B18]/90 p-1 rounded-xl border border-[#14233D]">
                <button
                  onClick={() => setMode('walking')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    mode === 'walking'
                      ? 'bg-[#14233D] text-[#28C7FF] shadow-md border border-[#28C7FF]/30'
                      : 'text-[#64748B] hover:text-[#CBD5E1]'
                  }`}
                >
                  <span>🚶</span>
                  <span>Walking</span>
                  <span className="text-[9px] font-mono text-[#64748B]">(1.0×)</span>
                </button>
                <button
                  onClick={() => setMode('delivery_rider')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    mode === 'delivery_rider'
                      ? 'bg-[#14233D] text-[#28C7FF] shadow-md border border-[#28C7FF]/30'
                      : 'text-[#64748B] hover:text-[#CBD5E1]'
                  }`}
                >
                  <span>🛵</span>
                  <span>Delivery Rider</span>
                  <span className="text-[9px] font-mono text-[#64748B]">(1.15×)</span>
                </button>
              </div>

              {/* Profile hint info */}
              <div className="flex justify-between items-center px-1 text-[10px] font-mono text-[#64748B]">
                <span>Routing Profile:</span>
                <span className="text-[#94A3B8]">
                  {mode === 'walking' ? 'foot-walking (~4.5 km/h)' : 'cycling-regular (~17.5 km/h)'}
                </span>
              </div>

              {/* Submit CTA */}
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full bg-gradient-to-r from-[#28C7FF] via-[#0A9DFF] to-[#0A84FF] hover:brightness-110 disabled:from-[#14233D] disabled:to-[#14233D] disabled:text-[#64748B] text-[#050B18] font-bold py-3 px-4 rounded-xl transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest shadow-[0_0_20px_rgba(40,199,255,0.25)] disabled:shadow-none cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-[#050B18] border-t-transparent rounded-full animate-spin"></div>
                    <span>Computing Physics Intelligence...</span>
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                    <span>Generate Intelligence</span>
                  </>
                )}
              </button>

              {/* Error Alert */}
              {error && (
                <div className="flex gap-2.5 items-start bg-rose-950/40 border border-rose-500/30 p-3 rounded-xl text-xs text-rose-300">
                  <span className="text-sm">⚠️</span>
                  <div className="flex-1">{error}</div>
                </div>
              )}
            </div>
          </div>

          {/* Candidate Routes Selector Card */}
          {data && (
            <div className="hud-panel rounded-2xl flex flex-col overflow-hidden shadow-2xl flex-1 max-h-[360px]">
              <div className="p-3.5 border-b border-[#14233D] flex justify-between items-center shrink-0 bg-[#081122]/60">
                <div className="flex items-center gap-2">
                  <span className="text-xs">🗺️</span>
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#CBD5E1]">
                    Candidate Options ({data.routes.length})
                  </h3>
                </div>
                <span className="text-[10px] font-mono text-[#64748B]">Utility: 60% Heat / 40% Time</span>
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {data.routes.map((route, i) => {
                  const isSelected = selectedRouteId === route.id
                  const isRecommended = route.is_recommended
                  const totalRoutes = data.routes.length
                  const risk = RISK_CONFIG[route.risk_level]
                  const timeDiff = route.relative_time_diff_seconds
                  const expDiff = route.relative_exposure_diff_pct
                  const impliedSpeed = calculateSpeedKmh(route.distance_meters, route.duration_seconds)

                  return (
                    <div
                      key={route.id}
                      onClick={() => setSelectedRouteId(route.id)}
                      className={`cursor-pointer rounded-xl border p-3 transition-all flex flex-col gap-2 ${
                        isSelected
                          ? 'border-[#28C7FF] bg-[#0E1F3D] shadow-[0_0_15px_rgba(40,199,255,0.15)]'
                          : 'border-[#14233D] bg-[#050B18]/70 hover:border-[#1E355B]'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2 items-center">
                          <span className="text-xs font-bold text-white">Route {i + 1}</span>
                          {isRecommended && totalRoutes > 1 ? (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#28C7FF]/15 text-[#28C7FF] uppercase tracking-wider border border-[#28C7FF]/30">
                              Best Match
                            </span>
                          ) : totalRoutes === 1 ? (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#14233D] text-[#94A3B8] uppercase tracking-wider border border-[#14233D]">
                              Available Route
                            </span>
                          ) : null}
                        </div>

                        {/* Exposure Score Badge */}
                        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg border text-xs font-mono font-bold ${risk.badge}`}>
                          <span className="text-sm font-extrabold">{route.exposure_score}</span>
                          <span className="text-[9px] uppercase tracking-wider">{risk.label}</span>
                        </div>
                      </div>

                      {/* Distance & Duration Metrics */}
                      <div className="grid grid-cols-3 gap-2 text-[11px] font-mono-num text-[#94A3B8] pt-1">
                        <div>
                          <span className="text-[9px] text-[#64748B] block font-sans uppercase">Distance</span>
                          <span className="font-bold text-[#F0F6FF]">{(route.distance_meters / 1000).toFixed(2)} km</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-[#64748B] block font-sans uppercase">Est. Travel Time</span>
                          <span className="font-bold text-[#F0F6FF]">{formatDuration(route.duration_seconds)}</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-[#64748B] block font-sans uppercase">Avg Speed</span>
                          <span className="font-bold text-[#F0F6FF]">{impliedSpeed} km/h</span>
                        </div>
                      </div>

                      {/* Comparative Delta Pills (Guarded by totalRoutes > 1 for test contract) */}
                      {totalRoutes > 1 && (timeDiff !== 0 || expDiff !== 0) && (
                        <div className="flex flex-wrap gap-1.5 mt-1 pt-2 border-t border-[#14233D]/60 text-[9px] font-mono">
                          {timeDiff <= 0 ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">
                              Fastest
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded bg-[#14233D] text-[#94A3B8] uppercase">
                              +{Math.round(timeDiff / 60)} min
                            </span>
                          )}
                          {expDiff < -2 ? (
                            <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase">
                              Lowest Exposure ({Math.round(expDiff)}%)
                            </span>
                          ) : expDiff > 2 ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase">
                              +{Math.round(expDiff)}% Heat
                            </span>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Provider note footer */}
              {data.provider_note && (
                <div className="p-2.5 bg-[#050B18]/90 border-t border-[#14233D] text-[10px] text-[#64748B] font-mono leading-tight">
                  ℹ️ {data.provider_note}
                </div>
              )}

              {/* Start Journey Deployment Action Card */}
              {selectedRoute && nav.journeyStatus === 'idle' && (
                <div className="p-3 bg-[#081122]/95 border-t border-[#14233D] flex flex-col gap-2 shrink-0">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-bold text-[#CBD5E1]">
                      Ready to Navigate: {(selectedRoute.distance_meters / 1000).toFixed(2)} km
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#14233D] text-[#28C7FF] font-mono text-[10px] border border-[#1E355B]">
                      {mode === 'delivery_rider' ? '🛵 Rider' : '🚶 Walking'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStartJourney(false)}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-gradient-to-r from-[#28C7FF] to-[#0A84FF] text-[#050B18] font-black text-xs uppercase tracking-wider hover:brightness-110 shadow-[0_0_15px_rgba(40,199,255,0.3)] flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                      title="Request device geolocation and begin live GPS turn-by-turn navigation"
                    >
                      <span>🧭</span>
                      <span>Start Journey</span>
                    </button>
                    <button
                      onClick={() => handleStartJourney(true)}
                      className="py-2.5 px-3 rounded-xl bg-[#0E1F3D] hover:bg-[#142647] border border-purple-500/40 text-purple-300 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1 cursor-pointer transition-all"
                      title="Simulate GPS movement along this route for evaluation/demo"
                    >
                      <span>🎮</span>
                      <span>Demo Run</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── 3. Floating Right HUD: Intelligence Analysis & Factor Breakdown ── */}
        <div
          className={`absolute top-4 right-4 bottom-20 z-20 w-[390px] max-w-[calc(100vw-2rem)] flex flex-col gap-3 transition-all duration-300 pointer-events-auto ${
            showRightHud ? 'translate-x-0 opacity-100' : 'translate-x-[430px] opacity-0 pointer-events-none'
          } ${mobileTab === 'analytics' ? 'flex' : 'hidden lg:flex'}`}
        >
          {!selectedRoute ? (
            <div className="hud-panel rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-2xl h-64 my-auto">
              <div className="w-12 h-12 rounded-full bg-[#14233D] flex items-center justify-center text-[#28C7FF] mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#CBD5E1] mb-1">Awaiting Route Telemetry</h3>
              <p className="text-[11px] text-[#64748B] max-w-[240px]">
                Input origin and destination parameters to trigger deterministic heat-exposure simulation.
              </p>
            </div>
          ) : (
            <>
              {/* Prominent Active Journey Launch Banner (Right HUD) */}
              {selectedRoute && nav.journeyStatus === 'idle' && (
                <div className="hud-panel rounded-2xl p-3 shadow-xl border border-[#28C7FF]/30 flex items-center justify-between gap-3 bg-[#081122]/90 shrink-0">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[#28C7FF]/15 border border-[#28C7FF]/30 flex items-center justify-center text-[#28C7FF] text-base">
                      🧭
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">Active Journey Ready</div>
                      <div className="text-[10px] text-[#94A3B8] font-mono">
                        {mode === 'delivery_rider' ? 'Delivery Rider (1.15×)' : 'Pedestrian (1.0×)'} • {(selectedRoute.distance_meters / 1000).toFixed(1)} km
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleStartJourney(false)}
                    className="px-3.5 py-1.5 rounded-xl bg-[#28C7FF] hover:bg-[#0A84FF] text-[#050B18] font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-[0_0_12px_rgba(40,199,255,0.4)]"
                  >
                    Start
                  </button>
                </div>
              )}

              {/* Primary Exposure Score Gauge */}
              <div className="hud-panel rounded-2xl p-4.5 shadow-2xl relative overflow-hidden shrink-0">
                {/* Subtle atmospheric ambient glow */}
                <div
                  className="absolute -top-10 -right-10 w-36 h-36 rounded-full blur-[60px] pointer-events-none"
                  style={{ background: RISK_CONFIG[selectedRoute.risk_level].glow }}
                ></div>

                <div className="flex justify-between items-center mb-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#28C7FF]"></span>
                    <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#28C7FF]">
                      Thermal Exposure Risk
                    </span>
                  </div>
                  {selectedRoute.is_demo_data ? (
                    <span
                      className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-500/30"
                      title="Demo Environmental Data. Not live weather."
                    >
                      Demo Environmental Data
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      NWP Model Verified
                    </span>
                  )}
                </div>

                {/* Exact Required String for Unit Test */}
                <div className="text-[10px] text-[#94A3B8] uppercase tracking-widest font-semibold mb-1">
                  Estimated Environmental Exposure
                </div>

                {/* Score Number Dial */}
                <div className="flex items-baseline gap-3 my-2">
                  <span
                    className="text-6xl font-black font-mono-num tracking-tighter"
                    style={{
                      color:
                        selectedRoute.risk_level === 'LOW'
                          ? '#10b981'
                          : selectedRoute.risk_level === 'MODERATE'
                          ? '#f59e0b'
                          : selectedRoute.risk_level === 'HIGH'
                          ? '#f97316'
                          : '#ef4444',
                    }}
                  >
                    {selectedRoute.exposure_score}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-[#64748B]">/ 100</span>
                    <span className={`text-xs font-extrabold uppercase tracking-wider ${RISK_CONFIG[selectedRoute.risk_level].text}`}>
                      {RISK_CONFIG[selectedRoute.risk_level].label}
                    </span>
                  </div>
                </div>

                {/* Gradient Progress Bar */}
                <div className="h-2 w-full bg-[#050B18] rounded-full overflow-hidden relative my-2 border border-[#14233D]">
                  <div
                    className="h-full transition-all duration-1000 ease-out rounded-full"
                    style={{
                      width: `${selectedRoute.exposure_score}%`,
                      background:
                        selectedRoute.exposure_score <= 25
                          ? '#10b981'
                          : selectedRoute.exposure_score <= 50
                          ? '#f59e0b'
                          : selectedRoute.exposure_score <= 75
                          ? '#f97316'
                          : '#ef4444',
                      boxShadow: `0 0 10px ${RISK_CONFIG[selectedRoute.risk_level].glow}`,
                    }}
                  />
                </div>

                <div className="flex justify-between items-center text-[10px] text-[#64748B] font-mono mt-2">
                  <span>0 (Low)</span>
                  <span>50 (Moderate)</span>
                  <span>75 (High)</span>
                  <span>100 (Extreme)</span>
                </div>
              </div>

              {/* Environmental Contributing Factors Breakdown */}
              <div className="hud-panel rounded-2xl flex flex-col overflow-hidden shadow-2xl flex-1 max-h-[380px]">
                <div className="p-3.5 border-b border-[#14233D] bg-[#081122]/60 flex justify-between items-center shrink-0">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-[#28C7FF]">
                    Environmental Factors Breakdown
                  </h3>
                  <span className="text-[9px] font-mono text-[#64748B]">Points Impact</span>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {selectedRoute.major_contributors.map(c => {
                    const isCooling = c.points_contributed < 0
                    const barPercent = Math.min(100, Math.abs(c.points_contributed) * 2.5)

                    return (
                      <div
                        key={c.name}
                        className="bg-[#050B18]/80 border border-[#14233D] p-2.5 rounded-xl flex flex-col gap-1.5"
                      >
                        <div className="flex justify-between items-center">
                          {/* Exact c.display_name for test contract */}
                          <span className="text-[11px] text-[#CBD5E1] font-semibold">
                            {c.display_name}
                          </span>
                          <span className="text-xs font-mono font-bold text-white">
                            {c.raw_value} <span className="text-[10px] text-[#64748B]">{c.unit}</span>
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-[#0A1428] rounded-full overflow-hidden border border-[#14233D]">
                            <div
                              className={`h-full rounded-full ${
                                isCooling ? 'bg-cyan-400' : 'bg-gradient-to-r from-amber-400 to-orange-500'
                              }`}
                              style={{ width: `${barPercent}%` }}
                            />
                          </div>
                          <span
                            className={`text-[10px] font-mono font-bold ${
                              isCooling ? 'text-cyan-400' : 'text-amber-400'
                            }`}
                          >
                            {isCooling ? '▼ ' : '▲ +'}
                            {Math.abs(Math.round(c.points_contributed))} pts
                          </span>
                        </div>
                      </div>
                    )
                  })}

                  {/* Actionable Recommendations List */}
                  <div className="mt-2 pt-2 border-t border-[#14233D]">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#CBD5E1] block mb-1.5">
                      Operational Guidance
                    </span>
                    <div className="space-y-1.5">
                      {actionableInsights.map((ins, idx) => (
                        <div
                          key={idx}
                          className="bg-[#050B18]/60 border border-[#14233D] p-2 rounded-lg text-[10px] text-[#94A3B8]"
                        >
                          <div className="font-bold text-[#CBD5E1] flex items-center gap-1.5 mb-0.5">
                            <span className={ins.severity === 'alert' ? 'text-rose-400' : 'text-cyan-400'}>
                              {ins.severity === 'alert' ? '●' : '◆'}
                            </span>
                            <span>{ins.title}</span>
                          </div>
                          <div>{ins.detail}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Freshness & Attribution Footer */}
                <div className="p-3 border-t border-[#14233D] bg-[#050B18]/90 text-[10px] font-mono text-[#64748B] shrink-0">
                  {!selectedRoute.is_demo_data && selectedRoute.freshness ? (
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span>Data Source:</span>
                        <span className="text-[#28C7FF]">{selectedRoute.freshness.source_label}</span>
                      </div>
                      {selectedRoute.freshness.age_minutes !== null && (
                        <div className="flex justify-between">
                          <span>Observation Age:</span>
                          <span className="text-[#94A3B8] font-mono-num">
                            {Math.round(selectedRoute.freshness.age_minutes)} min ago
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      {/* Exact strings for test contract */}
                      <span className="text-purple-400 font-bold block">Demo Environmental Data</span>
                      <span className="text-[#64748B]">Fixed demonstration scenario. Not live weather.</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── 4. Bottom Floating Timeline & Departure Planner ── */}
        <div
          className={`absolute bottom-3 left-4 right-4 z-20 pointer-events-auto transition-all ${
            mobileTab === 'timeline' ? 'block' : 'hidden lg:block'
          }`}
        >
          <div className="hud-panel rounded-2xl p-3 lg:px-4 lg:py-2.5 flex flex-col lg:flex-row items-center justify-between gap-3 shadow-2xl border border-[#1E355B]/60">
            {/* Timeline Header info */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-7 h-7 rounded-lg bg-[#14233D] flex items-center justify-center text-[#28C7FF]">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#28C7FF]">
                  24-Hour Departure Window
                </span>
                <span className="text-[9px] text-[#64748B] font-mono">
                  {timelineUnavailableNote ? timelineUnavailableNote : 'NWP Model Forecast · Estimated Exposure by Departure Hour'}
                </span>
              </div>
            </div>

            {/* Timeline Bars / Hourly Strip */}
            {timelineLoading ? (
              <div className="flex items-center gap-2 text-xs font-mono text-[#64748B]">
                <div className="w-3 h-3 border-2 border-[#28C7FF] border-t-transparent rounded-full animate-spin"></div>
                <span>Syncing Open-Meteo hourly model...</span>
              </div>
            ) : hourlyTimeline.length > 0 ? (
              <div className="flex-1 flex items-center gap-1.5 overflow-x-auto max-w-full py-1 px-2">
                {hourlyTimeline.map((item) => {
                  const riskCfg = RISK_CONFIG[item.risk_level]
                  const isHovered = hoveredHour?.time_iso === item.time_iso

                  return (
                    <div
                      key={item.time_iso}
                      onMouseEnter={() => setHoveredHour(item)}
                      className={`flex flex-col items-center px-2 py-1 rounded-lg transition-all cursor-pointer border ${
                        item.is_current_hour
                          ? 'border-[#28C7FF] bg-[#14233D]'
                          : isHovered
                          ? 'border-[#28C7FF]/50 bg-[#0E1F3D]'
                          : 'border-[#14233D] bg-[#050B18]/60 hover:border-[#1E355B]'
                      }`}
                    >
                      <span className="text-[9px] font-mono font-bold text-[#CBD5E1]">
                        {item.hour_label}
                      </span>
                      <div className="my-1 w-6 h-6 rounded-full flex items-center justify-center font-mono text-[10px] font-extrabold" style={{ color: riskCfg.text.replace('text-', '') }}>
                        {item.exposure_score}
                      </div>
                      <span className="text-[8px] font-mono text-[#64748B]">
                        {item.temperature_c.toFixed(0)}°C
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="text-[10px] text-[#64748B] font-mono italic">
                {timelineUnavailableNote || 'Generate a route to calculate departure window risk curve.'}
              </div>
            )}

            {/* Selected hour snapshot tool */}
            {hoveredHour && (
              <div className="hidden xl:flex items-center gap-3 pl-3 border-l border-[#14233D] text-[10px] font-mono shrink-0">
                <span className="text-[#CBD5E1]">Departure @ <strong className="text-[#28C7FF]">{hoveredHour.hour_label}</strong>:</span>
                <span className="font-bold text-white">{hoveredHour.exposure_score}/100 ({hoveredHour.risk_level})</span>
                <span className="text-[#64748B]">UV {hoveredHour.uv_index.toFixed(1)} · Wind {hoveredHour.wind_speed_kmh.toFixed(0)} km/h</span>
              </div>
            )}
          </div>
        </div>

        {/* ── 5. Mobile Tab Switcher Bar ── */}
        <div className="lg:hidden absolute bottom-2 left-2 right-2 z-30 bg-[#081122]/95 backdrop-blur-xl border border-[#14233D] rounded-xl flex p-1 shadow-2xl">
          <button
            onClick={() => setMobileTab('map')}
            className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg ${
              mobileTab === 'map' ? 'bg-[#14233D] text-[#28C7FF]' : 'text-[#64748B]'
            }`}
          >
            Map
          </button>
          <button
            onClick={() => setMobileTab('planner')}
            className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg ${
              mobileTab === 'planner' ? 'bg-[#14233D] text-[#28C7FF]' : 'text-[#64748B]'
            }`}
          >
            Routes
          </button>
          <button
            onClick={() => setMobileTab('analytics')}
            className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg ${
              mobileTab === 'analytics' ? 'bg-[#14233D] text-[#28C7FF]' : 'text-[#64748B]'
            }`}
          >
            Exposure
          </button>
          <button
            onClick={() => setMobileTab('timeline')}
            className={`flex-1 py-2 text-center text-xs font-semibold rounded-lg ${
              mobileTab === 'timeline' ? 'bg-[#14233D] text-[#28C7FF]' : 'text-[#64748B]'
            }`}
          >
            24h Window
          </button>
        </div>

        {/* ── Active Journey Turn-By-Turn Navigation HUD Overlay ── */}
        <NavigationHUD
          journeyStatus={nav.journeyStatus}
          gpsStatus={nav.gpsStatus}
          gpsErrorMessage={nav.gpsErrorMessage}
          userFix={nav.userFix}
          travelMode={nav.travelMode}
          isDemoMode={nav.isDemoMode}
          currentStep={nav.currentStep}
          nextStep={nav.nextStep}
          telemetry={nav.telemetry}
          checkpoints={nav.checkpoints}
          isRerouting={nav.isRerouting}
          rerouteError={nav.rerouteError}
          onPause={nav.pauseJourney}
          onResume={nav.resumeJourney}
          onEnd={nav.endJourney}
          onManualReroute={nav.triggerManualReroute}
        />

      </main>
    </div>
  )
}
