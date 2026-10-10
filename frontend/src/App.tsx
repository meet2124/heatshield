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

const createMarkerIcon = (color: string) => L.divIcon({
  className: 'custom-leaflet-marker',
  html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}" stroke="#133725" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-8 h-8 drop-shadow-xl"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3" fill="#133725"></circle></svg>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
})

const OriginIcon = createMarkerIcon('#caff00') // Electric Lime
const DestIcon = createMarkerIcon('#ffffff')   // Ivory

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`
}

function MapController({ bounds }: { bounds: [number, number][] | null }) {
  const map = useMap()
  useEffect(() => {
    if (bounds && bounds.length > 0) {
      // Offset padding on desktop to account for the floating sidebar on the right
      const paddingOptions: L.FitBoundsOptions = window.innerWidth > 768
        ? { paddingBottomRight: [450, 50], paddingTopLeft: [450, 50] }
        : { padding: [20, 20], maxZoom: 16 }
      map.fitBounds(bounds, paddingOptions)
    }
  }, [bounds, map])
  return null
}

function Icons() {
  return {
    Swap: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 14v-12"/><path d="M11 6l4-4 4 4"/><path d="M3 18l4 4 4-4"/></svg>,
    Walk: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M7 20l4.5 -11.5l3.5 3l4 -3"/><path d="M11.5 8.5l-4 6"/><path d="M11.5 20l3.5 -6.5"/></svg>,
    Bike: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>,
    Leaf: () => <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>,
    Alert: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    MapPin: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
    Target: () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
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
      setError(err.message || 'Could not connect to HeatShield backend.')
    } finally {
      setLoading(false)
    }
  }

  const Ics = Icons()

  return (
    <div className="relative w-screen h-screen bg-[#fdfbf7] text-[#133725] font-sans overflow-hidden">

      {/* ─── Full-bleed Map ─── */}
      <div className="absolute inset-0 z-0">
        <MapContainer
          center={[37.7749, -122.4194]}
          zoom={13}
          zoomControl={false}
          className="w-full h-full"
        >
          {/* Light ivory/grey base map to match the warm theme */}
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapController bounds={mapBounds} />

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
                        color: '#a8a29e', // stone-400
                        weight: 4,
                        opacity: 0.6,
                        lineJoin: 'round',
                        lineCap: 'round'
                      }}
                      eventHandlers={{ click: () => setSelectedRouteId(route.id) }}
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
                        color: '#133725', // Forest green
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
      </div>

      {/* ─── Floating UI Layer ─── */}
      <div className="absolute inset-0 z-10 pointer-events-none p-4 md:p-6 flex flex-col md:flex-row gap-6 overflow-hidden">

        {/* Left Column: Command & Search */}
        <div className="w-full md:w-[380px] flex flex-col gap-4 pointer-events-auto shrink-0 z-20">

          {/* Brand Identity */}
          <div className="bg-[#133725] text-[#fdfbf7] p-5 rounded-3xl shadow-xl flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                <span className="text-[#caff00]"><Ics.Leaf /></span> HeatShield
              </h1>
              <p className="text-xs font-medium text-[#fdfbf7]/70 tracking-wide mt-1">Environmental Exposure Intelligence</p>
            </div>
          </div>

          {/* Search Card */}
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.08)] border border-stone-200/60 p-5 flex flex-col gap-3">
            <div className="relative">
              <div className="absolute left-4 top-3.5 text-[#133725]/50"><Ics.MapPin /></div>
              <input
                type="text"
                className="w-full pl-11 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-[#caff00] focus:border-[#133725] text-[#133725] placeholder-stone-400 transition-all outline-none font-medium text-sm"
                placeholder="Origin"
                value={origin}
                onChange={e => setOrigin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
            </div>

            <div className="relative">
              <div className="absolute left-4 top-3.5 text-[#133725]/50"><Ics.Target /></div>
              <input
                type="text"
                className="w-full pl-11 pr-4 py-3 bg-stone-50 border border-stone-200 rounded-2xl focus:ring-2 focus:ring-[#caff00] focus:border-[#133725] text-[#133725] placeholder-stone-400 transition-all outline-none font-medium text-sm"
                placeholder="Destination"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />

              <button
                onClick={handleSwap}
                className="absolute right-4 top-2.5 p-1.5 bg-white shadow-sm hover:bg-stone-100 rounded-lg border border-stone-200 text-[#133725] transition-colors"
                title="Swap locations"
              >
                <Ics.Swap />
              </button>
            </div>

            <div className="flex bg-stone-100 rounded-xl p-1 mt-1">
              {(['walking', 'delivery_rider'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all ${
                    mode === m
                      ? 'bg-white text-[#133725] shadow-sm'
                      : 'text-stone-500 hover:text-[#133725]'
                  }`}
                >
                  {m === 'walking' ? <><Ics.Walk /> Walk</> : <><Ics.Bike /> Delivery Rider</>}
                </button>
              ))}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full mt-2 bg-[#caff00] hover:bg-[#bce600] disabled:bg-stone-200 disabled:text-stone-400 text-[#133725] font-black tracking-wide py-3.5 px-4 rounded-2xl transition-all shadow-md flex justify-center items-center gap-2 uppercase text-sm"
            >
              {loading ? (
                <><span className="animate-spin w-4 h-4 border-2 border-[#133725]/30 border-t-[#133725] rounded-full"></span> Routing</>
              ) : 'Find Route'}
            </button>

            {error && (
              <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 mt-2">
                <Ics.Alert />
                <p className="font-medium">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column / Bottom Sheet: Results Gallery */}
        <div className="flex-1 flex md:justify-end items-end md:items-stretch pointer-events-none z-10 overflow-hidden">
          {data && (
            <div className="w-full md:w-[440px] pointer-events-auto flex flex-col bg-white/90 backdrop-blur-2xl rounded-t-3xl md:rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] border border-stone-200/60 overflow-hidden h-[60vh] md:h-full">

              <div className="p-5 border-b border-stone-200/60 bg-white/50 backdrop-blur-sm shrink-0">
                <h3 className="text-lg font-black tracking-tight text-[#133725]">Exposure Analysis</h3>
                <p className="text-xs font-medium text-stone-500 mt-0.5">{data.routes.length} options evaluated</p>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
                      className={`cursor-pointer rounded-2xl border-2 transition-all duration-300 overflow-hidden relative ${
                        isSelected
                          ? 'border-[#133725] bg-white shadow-lg'
                          : 'border-transparent bg-stone-50 hover:bg-white hover:border-stone-200'
                      }`}
                    >
                      {/* Selection Indicator Line */}
                      {isSelected && (
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#caff00]"></div>
                      )}

                      <div className="p-5 pl-6">
                        {/* Header Badges */}
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex flex-wrap gap-2">
                            {isRecommended && totalRoutes > 1 ? (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-[#133725] text-[#caff00] uppercase tracking-widest">
                                Best Match
                              </span>
                            ) : totalRoutes === 1 ? (
                              <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-stone-200 text-stone-700 uppercase tracking-widest">
                                Available Route
                              </span>
                            ) : null}

                            {route.is_demo_data && (
                              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 uppercase tracking-widest" title="Demo Environmental Data. Not live weather.">
                                Demo Environmental Data
                              </span>
                            )}
                          </div>
                          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest border ${risk.bg} ${risk.text} ${risk.border}`}>
                            {risk.label}
                          </span>
                        </div>

                        {/* Main Score Area */}
                        <div className="flex justify-between items-end mb-5">
                          <div>
                            <div className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Estimated Environmental Exposure</div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-5xl font-black tracking-tighter" style={{ color: risk.text.replace('text-[', '').replace(']', '') }}>
                                {route.exposure_score}
                              </span>
                              <span className="text-sm font-bold text-stone-400">/ 100</span>
                            </div>
                          </div>
                        </div>

                        {/* Score Gauge */}
                        <div className="h-2 w-full bg-stone-100 rounded-full overflow-hidden flex mb-5 relative shadow-inner">
                           <div className="h-full bg-gradient-to-r from-[#10b981] via-[#f59e0b] to-[#ef4444] absolute inset-0 opacity-15"></div>
                           <div className={`h-full relative transition-all duration-1000 ease-out ${risk.bar}`} style={{ width: `${route.exposure_score}%` }} />
                        </div>

                        {/* Route Metrics */}
                        <div className="grid grid-cols-2 gap-3 mb-5">
                          <div className="bg-stone-50 p-3 rounded-xl border border-stone-100">
                            <div className="text-[10px] text-stone-400 uppercase tracking-widest font-bold mb-1">Distance</div>
                            <div className="font-bold text-[#133725] text-sm">{(route.distance_meters / 1000).toFixed(2)} km</div>
                          </div>
                          <div className="bg-stone-50 p-3 rounded-xl border border-stone-100">
                            <div className="text-[10px] text-stone-400 uppercase tracking-widest font-bold mb-1">Est. Travel Time</div>
                            <div className="font-bold text-[#133725] text-sm">{formatDuration(route.duration_seconds)}</div>
                          </div>
                        </div>

                        {/* Environmental Context - expanded on select */}
                        {(isSelected || totalRoutes === 1) && route.major_contributors.length > 0 && (
                          <div className="mt-2 pt-4 border-t border-stone-100">
                            <p className="text-[10px] font-black text-[#133725] uppercase tracking-widest mb-3">Impact Factors</p>
                            <div className="space-y-2.5">
                              {route.major_contributors.map(c => (
                                <div key={c.name} className="flex justify-between items-center text-xs font-medium">
                                  <span className="text-stone-600">{c.display_name}</span>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[#133725] font-bold">{c.raw_value} {c.unit}</span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-black ${c.points_contributed < 0 ? 'bg-[#10b981]/10 text-[#10b981]' : 'bg-[#f59e0b]/10 text-[#f59e0b]'}`}>
                                      {c.points_contributed < 0 ? '▼' : '▲'} {Math.abs(Math.round(c.points_contributed))}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {!route.is_demo_data && route.freshness && (
                              <div className="mt-4 bg-[#133725]/5 rounded-lg px-3 py-2 flex justify-between items-center border border-[#133725]/10">
                                <span className="text-[10px] font-bold text-[#133725]/60 uppercase tracking-wider">Source: {route.freshness.source_label}</span>
                                {route.freshness.age_minutes !== null && (
                                  <span className="text-[10px] font-bold text-[#133725]/60 uppercase tracking-wider">{Math.round(route.freshness.age_minutes)}m ago</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Comparison tags */}
                        {totalRoutes > 1 && (timeDiff !== 0 || expDiff !== 0) && (
                          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-stone-100">
                            {timeDiff <= 0 && <span className="text-[10px] font-bold bg-stone-100 text-stone-600 px-2 py-1 rounded-md uppercase tracking-wider">Fastest</span>}
                            {expDiff < -2 && <span className="text-[10px] font-bold bg-stone-100 text-stone-600 px-2 py-1 rounded-md uppercase tracking-wider">Lowest Exposure</span>}
                          </div>
                        )}
                        <span className="hidden">Not live weather</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

export default App
