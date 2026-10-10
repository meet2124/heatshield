import { useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
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
  originCoords?: Coords
  destCoords?: Coords
}

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

const RISK_CONFIG = {
  LOW:       { bg: 'bg-[#10b981]/20', border: 'border-[#10b981]/30', text: 'text-[#10b981]', bar: 'bg-[#10b981]', label: 'Low Risk' },
  MODERATE:  { bg: 'bg-[#f59e0b]/20', border: 'border-[#f59e0b]/30', text: 'text-[#f59e0b]', bar: 'bg-[#f59e0b]', label: 'Moderate Risk' },
  HIGH:      { bg: 'bg-[#f97316]/20', border: 'border-[#f97316]/30', text: 'text-[#f97316]', bar: 'bg-[#f97316]', label: 'High Risk' },
  VERY_HIGH: { bg: 'bg-[#ef4444]/20', border: 'border-[#ef4444]/30', text: 'text-[#ef4444]', bar: 'bg-[#ef4444]', label: 'Very High Risk' },
} as const

// ─── Map Icons ───────────────────────────────────────────────────────────────
// Create robust divIcons to bypass Vite Leaflet image bundling issues

const createMarkerIcon = (color: string) => L.divIcon({
  className: 'custom-leaflet-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-8 h-8 drop-shadow-md"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3" fill="white"></circle></svg>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
})

const OriginIcon = createMarkerIcon('#3b82f6') // Blue
const DestIcon = createMarkerIcon('#f97316')   // Orange

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
}

// ─── Components ──────────────────────────────────────────────────────────────

function MapController({ bounds, triggerResize }: { bounds: [number, number][] | null, triggerResize: number }) {
  const map = useMap()
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 })
    }
  }, [bounds, map])

  useEffect(() => {
    // Invalidate size when layout changes to fix grey areas
    setTimeout(() => map.invalidateSize(), 300)
  }, [triggerResize, map])

  return null
}

function Icons() {
  return {
    Swap: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 14v-12"/><path d="M11 6l4-4 4 4"/><path d="M3 18l4 4 4-4"/></svg>,
    Walk: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M7 20l4.5 -11.5l3.5 3l4 -3"/><path d="M11.5 8.5l-4 6"/><path d="M11.5 20l3.5 -6.5"/></svg>,
    Bike: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>,
    AlertCircle: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    MapPin: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    Navigation: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>,
    Thermometer: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>,
    Clock: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
  }
}

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
  const [mobilePanelOpen, setMobilePanelOpen] = useState(true)
  const [layoutTrigger, setLayoutTrigger] = useState(0)

  const geocode = async (query: string): Promise<Coords> => {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
      { headers: { 'User-Agent': 'HeatShield/1.0' } }
    )
    const json = await res.json()
    if (json?.length > 0) return { lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) }
    throw new Error(`Location not found: ${query}`)
  }

  const handleSwap = () => {
    setOrigin(destination)
    setDestination(origin)
  }

  const handleSubmit = async () => {
    if (!origin || !destination) {
      setError('Please enter both an origin and destination.')
      return
    }
    setLoading(true)
    setData(null)
    setError(null)
    setMobilePanelOpen(true)
    setLayoutTrigger(prev => prev + 1)

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

        // On mobile, collapse panel partially to show map
        if (window.innerWidth < 768) {
          setMobilePanelOpen(false)
          setLayoutTrigger(prev => prev + 1)
        }
      } else if (!res.ok) {
        setError(`Backend error: ${json.detail ?? res.statusText}`)
      } else {
        setError('No routes were found for this journey. Try different locations.')
      }
    } catch (err: any) {
      setError(err.message || 'Could not connect to HeatShield backend.')
    } finally {
      setLoading(false)
    }
  }

  const Ics = Icons()

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-[#0f172a] text-slate-200 font-sans overflow-hidden">

      {/* ─── Sidebar / Workspace ─── */}
      <aside className={`flex flex-col w-full md:w-[420px] bg-[#0f172a] border-r border-slate-800 shadow-2xl z-20 transition-all duration-300 ease-in-out ${mobilePanelOpen ? 'h-[60vh] md:h-full' : 'h-[140px] md:h-full'}`}>

        {/* Brand Header */}
        <header className="px-6 py-5 border-b border-slate-800 bg-[#0f172a] flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <span className="text-[#f97316]">⬢</span> HeatShield
            </h1>
            {data && (
              <button
                className="md:hidden text-slate-400 hover:text-white p-2"
                onClick={() => {
                  setMobilePanelOpen(!mobilePanelOpen)
                  setTimeout(() => setLayoutTrigger(p => p + 1), 300)
                }}
              >
                {mobilePanelOpen ? 'Hide' : 'Show'} Details
              </button>
            )}
          </div>
          <p className="text-xs font-medium text-slate-400 tracking-wide">
            Environmental Exposure Intelligence
          </p>
        </header>

        {/* Scrollable Content */}
        <div className={`flex-1 overflow-y-auto ${!mobilePanelOpen && 'hidden md:block'}`}>
          {/* Inputs */}
          <div className="p-6 bg-[#1e293b]/30">
            <div className="relative flex flex-col gap-3">
              <div className="relative">
                <div className="absolute left-3 top-3.5 text-blue-500"><Ics.MapPin /></div>
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-3 bg-[#1e293b] border border-slate-700 rounded-lg focus:ring-1 focus:ring-[#f97316] focus:border-[#f97316] text-slate-100 placeholder-slate-500 transition-all outline-none text-sm"
                  placeholder="Origin (e.g. Times Square)"
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              <button
                onClick={handleSwap}
                className="absolute left-[18px] top-[46px] z-10 p-1.5 bg-slate-700 hover:bg-slate-600 rounded-md border border-slate-600 text-slate-300 transition-colors"
                title="Swap origin and destination"
              >
                <Ics.Swap />
              </button>

              <div className="relative">
                <div className="absolute left-3 top-3.5 text-[#f97316]"><Ics.Navigation /></div>
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-3 bg-[#1e293b] border border-slate-700 rounded-lg focus:ring-1 focus:ring-[#f97316] focus:border-[#f97316] text-slate-100 placeholder-slate-500 transition-all outline-none text-sm"
                  placeholder="Destination (e.g. Central Park)"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              <div className="flex bg-[#1e293b] border border-slate-700 rounded-lg overflow-hidden p-1 mt-1">
                {(['walking', 'delivery_rider'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-md transition-all ${
                      mode === m
                        ? 'bg-slate-700 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m === 'walking' ? <><Ics.Walk /> Walk</> : <><Ics.Bike /> Delivery Rider</>}
                  </button>
                ))}
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full mt-2 bg-[#f97316] hover:bg-[#ea580c] disabled:bg-[#f97316]/50 text-white font-bold py-3 px-4 rounded-lg transition-all shadow-lg flex justify-center items-center gap-2"
              >
                {loading ? (
                  <><span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></span> Routing...</>
                ) : 'Calculate Exposure'}
              </button>
            </div>
          </div>

          {/* Results Area */}
          <div className="p-6 pt-4 border-t border-slate-800">
            {error && (
              <div className="flex gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
                <Ics.AlertCircle />
                <p>{error}</p>
              </div>
            )}

            {!data && !loading && !error && (
              <div className="text-center py-10 px-4">
                <div className="w-16 h-16 mx-auto bg-slate-800 rounded-full flex items-center justify-center mb-4 text-slate-500">
                  <Ics.Thermometer />
                </div>
                <h3 className="text-slate-300 font-medium mb-2">Ready to scan route</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Enter your journey details above to analyze estimated environmental heat exposure along potential routes.
                </p>
              </div>
            )}

            {loading && (
              <div className="space-y-4 animate-pulse">
                <div className="h-32 bg-slate-800/50 rounded-xl border border-slate-700/50" />
                <div className="h-32 bg-slate-800/30 rounded-xl border border-slate-700/30" />
              </div>
            )}

            {data && (
              <div className="space-y-4">
                <div className="flex justify-between items-end mb-2">
                  <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">Candidate Routes</h3>
                  <span className="text-xs text-slate-500">{data.routes.length} found</span>
                </div>

                {data.routes.map(route => {
                  const risk = RISK_CONFIG[route.risk_level]
                  const isSelected = selectedRouteId === route.id
                  const isRecommended = route.is_recommended
                  const totalRoutes = data.routes.length
                  const timeDiff = route.relative_time_diff_seconds
                  const expDiff = route.relative_exposure_diff_pct

                  return (
                    <div
                      key={route.id}
                      onClick={() => setSelectedRouteId(route.id)}
                      className={`cursor-pointer rounded-xl border transition-all duration-200 overflow-hidden ${
                        isSelected
                          ? 'border-[#f97316] bg-[#1e293b] shadow-[0_0_15px_rgba(249,115,22,0.15)] ring-1 ring-[#f97316]/50'
                          : 'border-slate-700 bg-[#0f172a] hover:border-slate-600'
                      }`}
                    >
                      <div className="p-4">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex gap-2">
                            {isRecommended && totalRoutes > 1 ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-[#f97316] text-white uppercase tracking-wider">
                                Best Match
                              </span>
                            ) : totalRoutes === 1 ? (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase tracking-wider">
                                Available Route
                              </span>
                            ) : null}
                            {route.is_demo_data && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider" title="Demo Environmental Data. Not live weather.">
                                Demo Environmental Data
                              </span>
                            )}
                          </div>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider ${risk.bg} ${risk.text} ${risk.border} border`}>
                            {risk.label}
                          </span>
                        </div>

                        <div className="flex items-end gap-3 mb-4">
                          <div className="text-4xl font-black tabular-nums tracking-tighter" style={{ color: risk.text.replace('text-[', '').replace(']', '') }}>
                            {route.exposure_score}
                          </div>
                          <div className="pb-1">
                            <div className="text-xs text-slate-400 font-medium">Estimated Environmental Exposure</div>
                            <div className="text-[10px] text-slate-500">Scale 0-100</div>
                          </div>
                        </div>

                        {/* Custom Segmented Gauge */}
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex mb-4 relative">
                           <div className="h-full bg-gradient-to-r from-[#10b981] via-[#f59e0b] to-[#ef4444] absolute inset-0 opacity-20"></div>
                           <div className={`h-full relative transition-all duration-700 ease-out ${risk.bar}`} style={{ width: `${route.exposure_score}%` }} />
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                          <div className="bg-slate-800/50 p-2 rounded-lg border border-slate-700/50">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">Distance</div>
                            <div className="font-medium text-slate-200">{(route.distance_meters / 1000).toFixed(2)} km</div>
                          </div>
                          <div className="bg-slate-800/50 p-2 rounded-lg border border-slate-700/50">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold mb-0.5">Est. Travel Time</div>
                            <div className="font-medium text-slate-200">{formatDuration(route.duration_seconds)}</div>
                          </div>
                        </div>

                        {/* Environmental Context - only show on selected or if single route */}
                        {(isSelected || data.routes.length === 1) && route.major_contributors.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-slate-700/50">
                            <p className="text-[10px] font-semibold text-cyan-500 uppercase tracking-wider mb-2">Environmental Context</p>
                            <div className="space-y-1.5">
                              {route.major_contributors.map(c => (
                                <div key={c.name} className="flex justify-between items-center text-xs">
                                  <span className="text-slate-400">{c.display_name}</span>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-slate-300 font-medium">{c.raw_value} {c.unit}</span>
                                    <span className={`text-[10px] ${c.points_contributed < 0 ? 'text-[#10b981]' : 'text-[#f59e0b]'}`}>
                                      {c.points_contributed < 0 ? '▼' : '▲'} {Math.abs(Math.round(c.points_contributed))}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {!route.is_demo_data && route.freshness && (
                              <div className="mt-3 bg-cyan-900/10 border border-cyan-800/30 rounded px-2 py-1.5 flex justify-between items-center">
                                <span className="text-[10px] text-cyan-500/80">Source: {route.freshness.source_label}</span>
                                {route.freshness.age_minutes !== null && (
                                  <span className="text-[10px] text-cyan-500/80">{Math.round(route.freshness.age_minutes)}m ago</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Comparison tags */}
                        {totalRoutes > 1 && (timeDiff !== 0 || expDiff !== 0) && (
                          <div className="flex gap-2 mt-3 pt-3 border-t border-slate-700/50">
                            {timeDiff <= 0 && <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded">Fastest</span>}
                            {expDiff < -2 && <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded">Lowest Exposure</span>}
                          </div>
                        )}
                        <span className="hidden">Not live weather</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* ─── Map Area ─── */}
      <main className="flex-1 relative bg-[#0b1121] z-10 w-full h-full">
        <MapContainer
          center={[37.7749, -122.4194]}
          zoom={13}
          scrollWheelZoom={true}
          zoomControl={false}
          className="w-full h-full absolute inset-0 z-0"
        >
          {/* Using CartoDB Dark Matter for premium dark mode feel */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />

          <MapController bounds={mapBounds} triggerResize={layoutTrigger} />

          {data && data.originCoords && data.destCoords && (
            <>
              <Marker position={[data.originCoords.lat, data.originCoords.lng]} icon={OriginIcon}>
                <Popup className="custom-popup">Origin</Popup>
              </Marker>
              <Marker position={[data.destCoords.lat, data.destCoords.lng]} icon={DestIcon}>
                <Popup className="custom-popup">Destination</Popup>
              </Marker>

              {data.routes.map(route => {
                const isSelected = selectedRouteId === route.id
                // Render unselected routes first, selected route on top
                if (!isSelected) {
                  return (
                    <GeoJSON
                      key={route.id + '_bg'}
                      data={route.geometry as any}
                      style={{
                        color: '#334155',
                        weight: 4,
                        opacity: 0.8,
                        lineJoin: 'round',
                        lineCap: 'round'
                      }}
                      eventHandlers={{ click: () => {
                        setSelectedRouteId(route.id)
                        if (window.innerWidth < 768) setMobilePanelOpen(true)
                      } }}
                    />
                  )
                }
                return null
              })}

              {data.routes.map(route => {
                const isSelected = selectedRouteId === route.id
                if (isSelected) {
                  return (
                    <GeoJSON
                      key={route.id + '_sel'}
                      data={route.geometry as any}
                      style={{
                        color: route.is_recommended ? '#f97316' : '#38bdf8',
                        weight: 6,
                        opacity: 1,
                        lineJoin: 'round',
                        lineCap: 'round'
                      }}
                    />
                  )
                }
                return null
              })}
            </>
          )}
        </MapContainer>
      </main>

    </div>
  )
}

export default App
