import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Coords { lat: number; lng: number }

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
  major_contributors: Contributor[]
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
  // injected on client after geocoding
  originCoords?: Coords
  destCoords?: Coords
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RISK_CONFIG = {
  LOW:       { bg: 'bg-green-100',  text: 'text-green-800',  label: 'Low' },
  MODERATE:  { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Moderate' },
  HIGH:      { bg: 'bg-orange-100', text: 'text-orange-800', label: 'High' },
  VERY_HIGH: { bg: 'bg-red-100',    text: 'text-red-800',    label: 'Very High' },
} as const

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
}

function formatTimeDiff(seconds: number): string {
  if (Math.abs(seconds) < 60) return 'Fastest available'
  return `+${Math.round(Math.abs(seconds) / 60)} min slower`
}

function formatExposureDiff(pct: number): string {
  if (Math.abs(pct) < 2) return 'Highest exposure in set'
  return `${Math.abs(Math.round(pct))}% lower est. heat exposure`
}

// ─── MapController ────────────────────────────────────────────────────────────

function MapController({ bounds }: { bounds: [number, number][] | null }) {
  const map = useMap()
  useEffect(() => {
    if (bounds && bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] })
  }, [bounds, map])
  return null
}

// ─── RouteCard ────────────────────────────────────────────────────────────────

function RouteCard({ route, totalRoutes }: { route: ScoredRoute; totalRoutes: number }) {
  const risk = RISK_CONFIG[route.risk_level]
  const isRecommended = route.is_recommended
  const timeDiff = route.relative_time_diff_seconds
  const expDiff = route.relative_exposure_diff_pct
  const freshness = route.freshness

  // Format the observation time to a human-readable string
  const observedAtDisplay = freshness?.observed_at
    ? new Date(freshness.observed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
    : null

  const isStale = freshness?.status === 'LOW'

  return (
    <div className={`rounded-xl border p-4 transition-all ${
      isRecommended && totalRoutes > 1
        ? 'border-orange-400 shadow-md bg-orange-50'
        : 'border-gray-200 bg-white shadow-sm'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        {isRecommended && totalRoutes > 1 ? (
          <span className="bg-orange-500 text-white text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
            Recommended
          </span>
        ) : totalRoutes === 1 ? (
          <span className="bg-blue-500 text-white text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide">
            Available Route
          </span>
        ) : (
          <span className="bg-gray-100 text-gray-500 text-xs font-medium px-2.5 py-1 rounded-full">
            Alternative
          </span>
        )}
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${risk.bg} ${risk.text}`}>
          {risk.label} Risk
        </span>
      </div>

      {/* Metrics */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-500">Distance</span>
          <span className="font-semibold text-gray-900">{(route.distance_meters / 1000).toFixed(2)} km</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Est. Travel Time (Vehicle Speed)*</span>
          <span className="font-semibold text-gray-900">{formatDuration(route.duration_seconds)}</span>
        </div>

        {/* Exposure score — label + big number + bar */}
        <div className="pt-2 pb-1">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Estimated Environmental Exposure
          </p>
          <div className="flex items-end gap-2 mb-1">
            <span className={`text-3xl font-black ${risk.text}`}>{route.exposure_score}</span>
            <span className="text-gray-400 text-sm mb-0.5">/100</span>
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${risk.bg} ${risk.text} ml-1 mb-0.5`}>
              {risk.label.toUpperCase()}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                route.risk_level === 'LOW' ? 'bg-green-400' :
                route.risk_level === 'MODERATE' ? 'bg-yellow-400' :
                route.risk_level === 'HIGH' ? 'bg-orange-400' : 'bg-red-500'
              }`}
              style={{ width: `${route.exposure_score}%` }}
            />
          </div>
        </div>

        {/* Contributors bullet list */}
        {route.major_contributors.length > 0 && (
          <div className="pt-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Contributors</p>
            <ul className="space-y-0.5">
              {route.major_contributors.map(c => (
                <li key={c.name} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <span className={c.points_contributed < 0 ? 'text-green-500' : 'text-orange-400'}>
                    {c.points_contributed < 0 ? '▼' : '▲'}
                  </span>
                  {c.display_name}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Comparison chips — only meaningful with multiple routes */}
        {totalRoutes > 1 && (timeDiff !== 0 || expDiff !== 0) && (
          <div className="flex flex-wrap gap-1 pt-2">
            {timeDiff > 0 && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {formatTimeDiff(timeDiff)}
              </span>
            )}
            {timeDiff === 0 && (
              <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                Fastest available
              </span>
            )}
            {expDiff < -2 && (
              <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                {formatExposureDiff(expDiff)}
              </span>
            )}
          </div>
        )}

        {/* DEMO notice — prominent, always visible when is_demo_data */}
        {route.is_demo_data && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
            <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Demo Environmental Data</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Not live weather. Fixed demonstration values only.
            </p>
          </div>
        )}

        {/* Real weather metadata — shown only when is_demo_data is false */}
        {!route.is_demo_data && freshness && (
          <div className={`mt-3 rounded-lg border px-3 py-2 ${
            isStale
              ? 'border-yellow-300 bg-yellow-50'
              : 'border-blue-200 bg-blue-50'
          }`}>
            <p className={`text-xs font-bold uppercase tracking-wide ${
              isStale ? 'text-yellow-800' : 'text-blue-800'
            }`}>
              {isStale ? 'Stale Weather Estimate' : 'Current Weather Estimate · Open-Meteo'}
            </p>
            <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
              Source: {freshness.source_label}
            </p>
            {observedAtDisplay && (
              <p className="text-xs text-gray-600">
                Observed: {observedAtDisplay}
                {freshness.age_minutes !== null && ` (${Math.round(freshness.age_minutes)} min ago)`}
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1 italic">
              Conditions observed at route origin. May vary along route.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── API base URL ────────────────────────────────────────────────────────────
// VITE_API_BASE_URL is set at build time via frontend/.env or frontend/.env.production
// Never put the ORS_API_KEY or any server secret in a VITE_* variable.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [mode, setMode] = useState<'walking' | 'delivery_rider'>('walking')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RecommendationData | null>(null)
  const [mapBounds, setMapBounds] = useState<[number, number][] | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)

  const geocode = async (query: string): Promise<Coords> => {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'User-Agent': 'HeatShield/1.0' } }
    )
    const json = await res.json()
    if (json?.length > 0) return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) }
    throw new Error(`Location not found: ${query}`)
  }

  const handleSubmit = async () => {
    if (!origin || !destination) { setError('Please enter both an origin and destination.'); return }
    setLoading(true)
    setData(null)
    setError(null)

    try {
      const [originCoords, destCoords] = await Promise.all([geocode(origin), geocode(destination)])

      const res = await fetch(`${API_BASE}/api/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: originCoords, destination: destCoords, mode }),
      })
      const json = await res.json()

      if (res.ok && json.data?.routes?.length > 0) {
        const recommendation: RecommendationData = { ...json.data, originCoords, destCoords }
        setData(recommendation)
        setSelectedRouteId(recommendation.recommended_route_id)
        setMapBounds([[originCoords.lat, originCoords.lng], [destCoords.lat, destCoords.lng]])
      } else if (!res.ok) {
        setError(`Backend error: ${json.detail ?? res.statusText}`)
      } else {
        setError('No routes were found for this journey. Try different locations.')
      }
    } catch (err: any) {
      setError(err.message || 'Could not connect to HeatShield backend. Is it running?')
    } finally {
      setLoading(false)
    }
  }


  return (
    <div className="flex flex-col h-screen w-full bg-gray-50 font-sans">
      {/* Header */}
      <header className="bg-orange-600 text-white px-5 py-3 shadow-md flex justify-between items-center z-10 relative">
        <div>
          <h1 className="text-xl font-bold tracking-tight leading-tight">🛡️ HeatShield</h1>
          <p className="text-xs font-medium opacity-80 hidden sm:block mt-0.5">Environmental Exposure Intelligence for Outdoor Mobility</p>
        </div>
        <span className="text-xs font-semibold bg-orange-500 border border-orange-400 px-2 py-1 rounded-full opacity-90 hidden sm:block">
          WeMakeDevs Heat &amp; Water 2026
        </span>
      </header>

      <main className="flex-1 flex flex-col md:flex-row relative">
        {/* Sidebar */}
        <aside className="w-full md:w-96 bg-white shadow-2xl z-10 flex flex-col relative overflow-y-auto">

          {/* Input Panel */}
          <div className="p-6 bg-gradient-to-b from-gray-50 to-white border-b border-gray-100">
            <h2 className="text-xl font-bold text-gray-800 mb-5">Plan Your Route</h2>

            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Origin</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all outline-none"
                  placeholder="e.g., Times Square, NY"
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Destination</label>
                <input
                  type="text"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all outline-none"
                  placeholder="e.g., Central Park, NY"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              {/* Mode selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Travel Mode</label>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  {(['walking', 'delivery_rider'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`flex-1 py-2 text-sm font-medium transition-colors ${
                        mode === m
                          ? 'bg-orange-500 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {m === 'walking' ? 'Walking' : 'Delivery Rider'}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-md"
              >
                {loading ? 'Routing...' : 'Find Route'}
              </button>
            </div>
          </div>

          {/* Results Panel */}
          <div className="flex-1 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Route Details</h3>

            {!data && !loading && !error && (
              <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 text-sm text-orange-800 leading-relaxed">
                <p className="font-semibold mb-1">How it works</p>
                <p>Enter a starting point and destination. HeatShield will compare route candidates and recommend the one with the lowest estimated heat exposure based on current weather conditions.</p>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 leading-relaxed">
                <p className="font-semibold mb-1">Could not complete request</p>
                <p>{error}</p>
              </div>
            )}

            {loading && (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded" />
                <div className="h-24 bg-gray-100 rounded-xl" />
              </div>
            )}

            {data && (
              <div className="space-y-4">
                {/* Recommendation reason — secondary, below results */}
                <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border border-gray-100 leading-relaxed">
                  {data.reason}
                </div>

                {/* Route cards */}
                {data.routes.map(route => (
                  <div
                    key={route.id}
                    onClick={() => setSelectedRouteId(route.id)}
                    className={`cursor-pointer rounded-xl transition-shadow ${
                      selectedRouteId === route.id ? 'ring-2 ring-orange-400 shadow-md' : ''
                    }`}
                  >
                    <RouteCard route={route} totalRoutes={data.routes.length} />
                  </div>
                ))}

                {/* Provider note */}
                <p className="text-xs text-gray-400 italic leading-relaxed">{data.provider_note}</p>
              </div>
            )}
          </div>
        </aside>

        {/* Map */}
        <div className="flex-1 relative bg-gray-100 z-0 h-full min-h-[500px]">
          <MapContainer
            center={[37.7749, -122.4194]}
            zoom={13}
            scrollWheelZoom={true}
            style={{ width: '100%', height: '100%' }}
            className="w-full h-full absolute inset-0 z-0"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {mapBounds && <MapController bounds={mapBounds} />}

            {data && (
              <>
                <Marker position={[data.originCoords!.lat, data.originCoords!.lng]}>
                  <Popup>Origin</Popup>
                </Marker>
                <Marker position={[data.destCoords!.lat, data.destCoords!.lng]}>
                  <Popup>Destination</Popup>
                </Marker>

                {/* Render all routes; highlight recommended / selected */}
                {data.routes.map(route => (
                  <GeoJSON
                    key={route.id + (selectedRouteId === route.id ? '_sel' : '')}
                    data={route.geometry as any}
                    style={{
                      color: selectedRouteId === route.id
                        ? (route.is_recommended ? '#f97316' : '#6366f1')
                        : '#d1d5db',
                      weight: selectedRouteId === route.id ? 6 : 3,
                      opacity: selectedRouteId === route.id ? 0.9 : 0.5,
                      lineJoin: 'round',
                    }}
                    eventHandlers={{ click: () => setSelectedRouteId(route.id) }}
                  />
                ))}
              </>
            )}
          </MapContainer>
        </div>
      </main>
    </div>
  )
}

export default App
