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
  LOW:       { bg: 'bg-[#10b981]/15', border: 'border-[#10b981]/30', text: 'text-[#10b981]', bar: 'bg-[#10b981]', label: 'Low Risk' },
  MODERATE:  { bg: 'bg-[#f59e0b]/15', border: 'border-[#f59e0b]/30', text: 'text-[#f59e0b]', bar: 'bg-[#f59e0b]', label: 'Moderate Risk' },
  HIGH:      { bg: 'bg-[#f97316]/15', border: 'border-[#f97316]/30', text: 'text-[#f97316]', bar: 'bg-[#f97316]', label: 'High Risk' },
  VERY_HIGH: { bg: 'bg-[#ef4444]/15', border: 'border-[#ef4444]/30', text: 'text-[#ef4444]', bar: 'bg-[#ef4444]', label: 'Very High Risk' },
} as const

// ─── Map Icons ───────────────────────────────────────────────────────────────

const createMarkerIcon = (color: string, stroke: string = '#050B18') => L.divIcon({
  className: 'custom-leaflet-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 drop-shadow-[0_0_8px_rgba(40,199,255,0.8)]"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3" fill="${stroke}"></circle></svg>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -24]
})

const OriginIcon = createMarkerIcon('#28C7FF') // Electric Cyan
const DestIcon = createMarkerIcon('#F0F6FF')   // White

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
}

function MapController({ bounds, triggerResize }: { bounds: [number, number][] | null, triggerResize: number }) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    if (bounds && bounds.length > 0) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 })
    }
  }, [bounds, map, triggerResize])
  return null
}

function Icons() {
  return {
    Swap: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 14v-12"/><path d="M11 6l4-4 4 4"/><path d="M3 18l4 4 4-4"/></svg>,
    Walk: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M7 20l4.5 -11.5l3.5 3l4 -3"/><path d="M11.5 8.5l-4 6"/><path d="M11.5 20l3.5 -6.5"/></svg>,
    Bike: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>,
    Shield: () => <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    Alert: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    MapPin: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    Target: () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
    Layers: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/></svg>,
    Activity: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  }
}

// ─── Dashboard Component ─────────────────────────────────────────────────────

function App() {
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [mode, setMode] = useState<'walking' | 'delivery_rider'>('walking')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RecommendationData | null>(null)
  const [mapBounds, setMapBounds] = useState<[number, number][] | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null)
  const [resizeTrigger, setResizeTrigger] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setResizeTrigger(prev => prev + 1), 50)
    return () => clearTimeout(timer)
  }, [data])

  const geocode = async (query: string): Promise<Coords> => {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&email=admin@heatshield.app`
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
      setError('Please enter both origin and destination.')
      return 
    }
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
        setError('No routes found for this journey.')
      }
    } catch (err: any) {
      setError(err.message || 'Connection error.')
    } finally {
      setLoading(false)
    }
  }

  const Ics = Icons()
  const selectedRoute = data?.routes.find(r => r.id === selectedRouteId)

  return (
    <div className="flex flex-col h-screen w-screen bg-[#050B18] text-[#F0F6FF] font-sans overflow-hidden">
      
      {/* ─── Compact Header ─── */}
      <header className="h-14 bg-[#0B1426]/90 backdrop-blur-md border-b border-[#101D32] flex items-center justify-between px-6 z-20 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="text-[#28C7FF]">
            <Ics.Shield />
          </div>
          <div className="flex items-baseline gap-3">
            <h1 className="text-base font-bold tracking-wide">HeatShield</h1>
            <span className="text-[10px] uppercase tracking-[0.15em] text-[#477BFF] font-semibold hidden sm:inline">
              Environmental Intelligence Platform
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold text-[#8FA4BF]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse"></div>
            <span>System Active</span>
          </div>
        </div>
      </header>

      {/* ─── Dashboard Workspace ─── */}
      <main className="flex-1 p-3 md:p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden relative z-10">
        
        {/* Left Column: Routing Controls & Candidates (Span 3) */}
        <div className="lg:col-span-3 flex flex-col gap-4 overflow-hidden">
          
          {/* Controls Panel */}
          <div className="bg-[#0B1426] border border-[#101D32] rounded-xl p-4 shadow-lg shrink-0 relative overflow-hidden">
            {/* Atmospheric subtle gradient */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#28C7FF]/5 blur-[60px] rounded-full pointer-events-none"></div>

            <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#477BFF] mb-4 flex items-center gap-2">
              <Ics.Activity /> Route Parameters
            </h2>

            <div className="space-y-3 relative z-10">
              <div className="relative">
                <div className="absolute left-3 top-2.5 text-[#477BFF]"><Ics.MapPin /></div>
                <input
                  type="text"
                  className="w-full pl-9 pr-3 py-2 bg-[#050B18] border border-[#101D32] rounded-lg focus:border-[#28C7FF] focus:ring-1 focus:ring-[#28C7FF] text-sm text-[#F0F6FF] placeholder-[#8FA4BF] outline-none transition-all"
                  placeholder="Origin"
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
              </div>

              <div className="relative">
                <div className="absolute left-3 top-2.5 text-[#477BFF]"><Ics.Target /></div>
                <input
                  type="text"
                  className="w-full pl-9 pr-9 py-2 bg-[#050B18] border border-[#101D32] rounded-lg focus:border-[#28C7FF] focus:ring-1 focus:ring-[#28C7FF] text-sm text-[#F0F6FF] placeholder-[#8FA4BF] outline-none transition-all"
                  placeholder="Destination"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
                <button 
                  onClick={handleSwap}
                  className="absolute right-2 top-2 p-1 hover:bg-[#101D32] text-[#8FA4BF] hover:text-[#F0F6FF] rounded transition-colors"
                >
                  <Ics.Swap />
                </button>
              </div>

              <div className="flex bg-[#050B18] p-1 rounded-lg border border-[#101D32]">
                {(['walking', 'delivery_rider'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex-1 flex items-center justify-center gap-2 py-1.5 text-xs font-semibold rounded-md transition-all ${
                      mode === m
                        ? 'bg-[#101D32] text-[#28C7FF] shadow-sm'
                        : 'text-[#8FA4BF] hover:text-[#F0F6FF]'
                    }`}
                  >
                    {m === 'walking' ? <Ics.Walk /> : <Ics.Bike />}
                    <span className="capitalize">{m.replace('_', ' ')}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full mt-1 bg-gradient-to-r from-[#28C7FF] to-[#0A9DFF] hover:from-[#477BFF] hover:to-[#28C7FF] disabled:from-[#101D32] disabled:to-[#101D32] disabled:text-[#8FA4BF] text-[#050B18] font-bold py-2.5 px-4 rounded-lg transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(40,199,255,0.2)] disabled:shadow-none"
              >
                {loading ? 'Processing...' : 'Generate Intelligence'}
              </button>

              {error && (
                <div className="flex gap-2 items-start mt-2 bg-red-900/10 border border-red-500/20 p-2 rounded-lg text-xs text-red-300">
                  <div className="mt-0.5"><Ics.Alert /></div>
                  <div>{error}</div>
                </div>
              )}
            </div>
          </div>

          {/* Candidate Routes Panel */}
          {data && (
            <div className="flex-1 bg-[#0B1426] border border-[#101D32] rounded-xl flex flex-col overflow-hidden shadow-lg">
              <div className="p-4 border-b border-[#101D32] shrink-0 bg-[#0B1426]/50">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#477BFF] flex items-center gap-2">
                  <Ics.Layers /> Candidate Routes
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {data.routes.map((route, i) => {
                  const isSelected = selectedRouteId === route.id
                  const isRecommended = route.is_recommended
                  const totalRoutes = data.routes.length
                  const risk = RISK_CONFIG[route.risk_level]
                  const timeDiff = route.relative_time_diff_seconds
                  const expDiff = route.relative_exposure_diff_pct

                  return (
                    <div
                      key={route.id}
                      onClick={() => setSelectedRouteId(route.id)}
                      className={`cursor-pointer rounded-lg border p-3 transition-all flex flex-col gap-2 ${
                        isSelected
                          ? 'border-[#28C7FF] bg-[#101D32]'
                          : 'border-[#101D32] bg-[#050B18] hover:border-[#477BFF]/50'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2 items-center">
                          <span className="text-xs font-bold text-[#F0F6FF]">Route {i + 1}</span>
                          {isRecommended && totalRoutes > 1 ? (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#28C7FF]/10 text-[#28C7FF] uppercase tracking-widest border border-[#28C7FF]/20">
                              Best Match
                            </span>
                          ) : totalRoutes === 1 ? (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-[#101D32] text-[#8FA4BF] uppercase tracking-widest border border-[#101D32]">
                              Available Route
                            </span>
                          ) : null}
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-widest ${risk.text}`}>
                          {route.exposure_score} {risk.label}
                        </span>
                      </div>
                      
                      <div className="flex justify-between text-[10px] text-[#8FA4BF] font-medium">
                        <span>{(route.distance_meters / 1000).toFixed(2)} km</span>
                        <span>{formatDuration(route.duration_seconds)}</span>
                      </div>
                      
                      {/* Comparison Context */}
                      {totalRoutes > 1 && (timeDiff !== 0 || expDiff !== 0) && (
                        <div className="flex gap-2 mt-1 pt-2 border-t border-[#101D32]">
                          {timeDiff <= 0 && <span className="text-[8px] font-bold bg-[#050B18] text-[#8FA4BF] border border-[#101D32] px-1.5 py-0.5 rounded uppercase tracking-widest">Fastest</span>}
                          {expDiff < -2 && <span className="text-[8px] font-bold bg-[#050B18] text-[#8FA4BF] border border-[#101D32] px-1.5 py-0.5 rounded uppercase tracking-widest">Lowest Exposure</span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Center Column: Map Workspace (Span 6) */}
        <div className="lg:col-span-6 bg-[#050B18] border border-[#101D32] rounded-xl overflow-hidden relative shadow-lg min-h-[40vh] lg:min-h-0">
          <MapContainer
            center={[37.7749, -122.4194]}
            zoom={13}
            zoomControl={false}
            className="w-full h-full"
          >
            {/* OSM Tiles with Dark Atmospheric Filter */}
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              className="map-tiles-dark"
            />

            <MapController bounds={mapBounds} triggerResize={resizeTrigger} />

            {data && data.originCoords && data.destCoords && (
              <>
                <Marker position={[data.originCoords.lat, data.originCoords.lng]} icon={OriginIcon}>
                  <Popup className="custom-popup">Origin</Popup>
                </Marker>
                <Marker position={[data.destCoords.lat, data.destCoords.lng]} icon={DestIcon}>
                  <Popup className="custom-popup">Destination</Popup>
                </Marker>

                {data.routes.map(route => {
                  if (selectedRouteId !== route.id) {
                    return (
                      <GeoJSON
                        key={route.id + '_bg'}
                        data={route.geometry as any}
                        style={{ color: '#477BFF', weight: 4, opacity: 0.3, lineJoin: 'round' }}
                        eventHandlers={{ click: () => setSelectedRouteId(route.id) }}
                      />
                    )
                  }
                  return null
                })}
                
                {selectedRoute && (
                  <GeoJSON
                    key={selectedRoute.id + '_sel'}
                    data={selectedRoute.geometry as any}
                    style={{ color: '#28C7FF', weight: 6, opacity: 1, lineJoin: 'round', className: 'glow-line' }}
                  />
                )}
              </>
            )}
          </MapContainer>

          {/* Map Overlay Gradients for Depth */}
          <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_50px_rgba(5,11,24,0.8)] z-[400]"></div>
        </div>

        {/* Right Column: Exposure Analytics (Span 3) */}
        <div className="lg:col-span-3 flex flex-col gap-4 overflow-hidden">
          {!selectedRoute ? (
            <div className="flex-1 bg-[#0B1426] border border-[#101D32] rounded-xl p-6 flex flex-col items-center justify-center text-center shadow-lg">
              <div className="text-[#101D32] mb-4 opacity-50"><Ics.Shield /></div>
              <p className="text-xs text-[#8FA4BF] max-w-[200px]">Awaiting route generation for environmental exposure analysis.</p>
            </div>
          ) : (
            <>
              {/* Primary Exposure Score Panel */}
              <div className="bg-[#0B1426] border border-[#101D32] rounded-xl p-5 shadow-lg relative overflow-hidden shrink-0">
                <div className="absolute top-0 right-0 w-40 h-40 bg-[#28C7FF]/5 blur-[60px] rounded-full pointer-events-none"></div>
                
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-[#477BFF] mb-5 flex justify-between items-center relative z-10">
                  <span>Exposure Analysis</span>
                  {selectedRoute.is_demo_data && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20" title="Demo Environmental Data. Not live weather.">
                      Demo Environmental Data
                    </span>
                  )}
                </h2>

                <div className="text-[10px] text-[#8FA4BF] uppercase tracking-widest font-semibold mb-2 relative z-10">Estimated Environmental Exposure</div>
                <div className="flex items-baseline gap-3 mb-5 relative z-10">
                  <span className="text-5xl font-black tracking-tighter" style={{ color: RISK_CONFIG[selectedRoute.risk_level].text.replace('text-[', '').replace(']', '') }}>
                    {selectedRoute.exposure_score}
                  </span>
                  <span className="text-xs font-bold text-[#8FA4BF]">/ 100</span>
                </div>

                <div className="h-1.5 w-full bg-[#050B18] rounded-full overflow-hidden flex mb-3 relative z-10">
                   <div className="h-full bg-gradient-to-r from-[#10b981] via-[#f59e0b] to-[#ef4444] absolute inset-0 opacity-25"></div>
                   <div className={`h-full relative transition-all duration-1000 ease-out ${RISK_CONFIG[selectedRoute.risk_level].bar}`} style={{ width: `${selectedRoute.exposure_score}%` }} />
                </div>

                <div className="flex justify-between items-center text-[10px] uppercase tracking-widest font-bold text-[#8FA4BF] relative z-10">
                  <span>Risk Classification</span>
                  <span className={RISK_CONFIG[selectedRoute.risk_level].text}>{RISK_CONFIG[selectedRoute.risk_level].label}</span>
                </div>
              </div>

              {/* Factors Breakdown & Metadata */}
              <div className="flex-1 bg-[#0B1426] border border-[#101D32] rounded-xl flex flex-col overflow-hidden shadow-lg">
                <div className="p-4 border-b border-[#101D32] bg-[#0B1426]/50 shrink-0">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#477BFF]">Environmental Factors</h3>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {selectedRoute.major_contributors.map(c => (
                    <div key={c.name} className="bg-[#050B18] border border-[#101D32] p-3 rounded-lg flex flex-col gap-1.5">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-[#8FA4BF] font-semibold uppercase tracking-wider">{c.display_name}</span>
                        <span className="text-xs font-bold text-[#F0F6FF]">{c.raw_value} <span className="text-[10px] text-[#8FA4BF]">{c.unit}</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 bg-[#101D32] rounded-full overflow-hidden">
                           <div className={`h-full rounded-full ${c.points_contributed > 0 ? 'bg-[#f59e0b]' : 'bg-[#10b981]'}`} style={{ width: `${Math.min(100, Math.abs(c.points_contributed) * 2)}%` }}></div>
                        </div>
                        <span className={`text-[9px] font-bold px-1 rounded ${c.points_contributed < 0 ? 'text-[#10b981]' : 'text-[#f59e0b]'}`}>
                           {c.points_contributed < 0 ? '▼' : '▲'} {Math.abs(Math.round(c.points_contributed))} pts
                        </span>
                      </div>
                    </div>
                  ))}
                  
                  {/* Route Summary Stats inside Analytics */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="bg-[#050B18] border border-[#101D32] p-3 rounded-lg text-center">
                      <div className="text-[9px] text-[#8FA4BF] uppercase tracking-widest font-semibold mb-1">Est. Travel Time</div>
                      <div className="text-xs font-bold text-[#F0F6FF]">{formatDuration(selectedRoute.duration_seconds)}</div>
                    </div>
                    <div className="bg-[#050B18] border border-[#101D32] p-3 rounded-lg text-center">
                      <div className="text-[9px] text-[#8FA4BF] uppercase tracking-widest font-semibold mb-1">Distance</div>
                      <div className="text-xs font-bold text-[#F0F6FF]">{(selectedRoute.distance_meters / 1000).toFixed(2)} km</div>
                    </div>
                  </div>
                </div>

                {/* Freshness Footer */}
                <div className="p-3 border-t border-[#101D32] bg-[#050B18] shrink-0">
                  <div className="text-[9px] text-[#8FA4BF] uppercase tracking-widest font-semibold flex flex-col gap-1">
                    {!selectedRoute.is_demo_data && selectedRoute.freshness ? (
                      <>
                        <div className="flex justify-between">
                          <span>Data Source</span>
                          <span className="text-[#477BFF]">{selectedRoute.freshness.source_label}</span>
                        </div>
                        {selectedRoute.freshness.age_minutes !== null && (
                          <div className="flex justify-between">
                            <span>Freshness</span>
                            <span className="text-[#477BFF]">{Math.round(selectedRoute.freshness.age_minutes)} min ago</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-purple-400">Fixed Demonstration Scenario</span>
                    )}
                    <span className="hidden">Not live weather</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

      </main>

      {/* Deep atmospheric filter for standard OSM tiles */}
      <style>{`
        .map-tiles-dark {
          filter: brightness(0.6) invert(1) contrast(1.2) hue-rotate(180deg) saturate(0.5) brightness(0.8) sepia(0.2) hue-rotate(200deg);
        }
        .glow-line {
          filter: drop-shadow(0 0 4px rgba(40,199,255,0.8));
        }
      `}</style>
    </div>
  )
}

export default App
