/**
 * Navigation HUD Component for HeatShield Active Journey.
 * Renders turn-by-turn guidance, maneuver icons, distance countdown,
 * live GPS status, off-route warnings, checkpoints progress drawer, and journey controls.
 */

import { useState } from 'react'
import type {
  Checkpoint,
  GPSFix,
  GPSStatus,
  JourneyStatus,
  JourneyTelemetry,
  RouteStep,
} from './types'
import {
  formatNavDistance,
  formatNavDuration,
  getManeuverVisual,
} from './geoUtils'

interface NavigationHUDProps {
  journeyStatus: JourneyStatus
  gpsStatus: GPSStatus
  gpsErrorMessage: string | null
  userFix: GPSFix | null
  travelMode: 'walking' | 'delivery_rider'
  isDemoMode: boolean
  currentStep: RouteStep | null
  nextStep: RouteStep | null
  telemetry: JourneyTelemetry
  checkpoints: Checkpoint[]
  isRerouting: boolean
  rerouteError: string | null
  onPause: () => void
  onResume: () => void
  onEnd: () => void
  onManualReroute: () => void
}

export function NavigationHUD({
  journeyStatus,
  gpsStatus,
  gpsErrorMessage,
  userFix,
  travelMode,
  isDemoMode,
  currentStep,
  nextStep,
  telemetry,
  checkpoints,
  isRerouting,
  rerouteError,
  onPause,
  onResume,
  onEnd,
  onManualReroute,
}: NavigationHUDProps) {
  const [showCheckpoints, setShowCheckpoints] = useState(false)

  if (journeyStatus === 'idle') return null

  const maneuverVisual = getManeuverVisual(currentStep?.type ?? 10)

  // Maneuver Icon SVG
  const renderManeuverIcon = (typeStr: string) => {
    switch (typeStr) {
      case 'turn-left':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 10 4 15 9 20" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
        )
      case 'turn-right':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 10 20 15 15 20" />
            <path d="M4 4v7a4 4 0 0 0 4 4h12" />
          </svg>
        )
      case 'slight-left':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="7 10 7 4 13 4" />
            <path d="M17 20L7 4" />
          </svg>
        )
      case 'slight-right':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 10 17 4 11 4" />
            <path d="M7 20l10-16" />
          </svg>
        )
      case 'sharp-left':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 8 2 12 6 16" />
            <path d="M22 6v6a6 6 0 0 1-6 6H2" />
          </svg>
        )
      case 'sharp-right':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 8 22 12 18 16" />
            <path d="M2 6v6a6 6 0 0 0 6 6h14" />
          </svg>
        )
      case 'roundabout':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 21h5v-5" />
          </svg>
        )
      case 'arrive':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        )
      case 'depart':
      default:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        )
    }
  }

  return (
    <div className="absolute inset-0 pointer-events-none z-30 flex flex-col justify-between p-3 sm:p-5 select-none overflow-hidden">
      {/* ── Top Turn-By-Turn Navigation Guidance HUD ── */}
      <div className="flex flex-col gap-2 max-w-lg w-full mx-auto pointer-events-auto">
        {/* GPS Status & Demo Indicator Badge */}
        <div className="flex items-center justify-between gap-2 px-1 text-xs">
          {/* GPS Pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full backdrop-blur-md font-mono text-[11px] shadow-lg border border-[#14233D] bg-[#050B18]/90">
            {isDemoMode ? (
              <>
                <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
                <span className="text-purple-300 font-bold uppercase tracking-wider">
                  Demo Simulation Mode
                </span>
                <span className="text-[9px] text-purple-400/80">(Not Device GPS)</span>
              </>
            ) : gpsStatus === 'locked' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="text-emerald-300 font-bold">GPS Locked</span>
                <span className="text-[#94A3B8]">
                  ±{userFix?.accuracy ? Math.round(userFix.accuracy) : 5}m
                </span>
              </>
            ) : gpsStatus === 'acquiring_lock' || gpsStatus === 'requesting_permission' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-[#28C7FF] animate-ping"></span>
                <span className="text-[#28C7FF] font-semibold">
                  {gpsStatus === 'requesting_permission' ? 'Requesting Permission' : 'Acquiring Satellite Lock...'}
                </span>
              </>
            ) : gpsStatus === 'stale' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span className="text-amber-300 font-bold">GPS Signal Stale</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                <span className="text-rose-300 font-bold">
                  {gpsStatus === 'permission_denied' ? 'Permission Denied' : 'GPS Unavailable'}
                </span>
              </>
            )}
          </div>

          {/* Mode Pill */}
          <div className="px-2 py-0.5 rounded-full bg-[#0E1F3D]/90 border border-[#1E355B] text-[10px] font-mono text-[#94A3B8] flex items-center gap-1">
            <span>{travelMode === 'delivery_rider' ? '🛵 Rider Mode' : '🚶 Pedestrian Mode'}</span>
            {journeyStatus === 'paused' && (
              <span className="text-amber-400 font-bold uppercase px-1 rounded bg-amber-400/20">PAUSED</span>
            )}
          </div>
        </div>

        {/* GPS Error Alert (if permission denied or unavailable) */}
        {gpsErrorMessage && !isDemoMode && (
          <div className="bg-rose-950/90 border border-rose-500/50 backdrop-blur-md text-rose-200 text-xs p-3 rounded-xl shadow-xl flex items-start gap-2">
            <span className="text-base shrink-0">⚠️</span>
            <div className="flex-1 leading-snug">
              <span className="font-bold block">Location Notice</span>
              {gpsErrorMessage}
            </div>
          </div>
        )}

        {/* Off-Route Alert Banner */}
        {(journeyStatus === 'off_route' || telemetry.isOffRoute || isRerouting) && (
          <div className="bg-amber-950/90 border border-amber-500/60 backdrop-blur-md text-amber-200 text-xs p-3 rounded-xl shadow-2xl flex items-center justify-between gap-3 animate-pulse">
            <div className="flex items-center gap-2">
              <span className="text-base shrink-0">📍</span>
              <div>
                <span className="font-bold text-amber-300 uppercase tracking-wide block">
                  Off-Route Warning ({Math.round(telemetry.crossTrackDistanceMeters)}m deviation)
                </span>
                <span className="text-[11px] text-amber-200/80">
                  {isRerouting ? 'Recalculating optimal path from current position...' : 'Departed from planned geometry.'}
                </span>
              </div>
            </div>
            {!isRerouting && (
              <button
                onClick={onManualReroute}
                className="px-2.5 py-1 rounded bg-amber-500 text-black font-bold text-[10px] uppercase hover:bg-amber-400 transition-colors shrink-0 cursor-pointer shadow"
              >
                Reroute Now
              </button>
            )}
          </div>
        )}

        {rerouteError && (
          <div className="bg-slate-900/90 border border-rose-500/40 text-rose-300 text-[11px] p-2 rounded-lg flex items-center justify-between">
            <span>⚠️ Reroute failed. Continuing on original route.</span>
            <button
              onClick={onManualReroute}
              className="text-[#28C7FF] underline font-bold cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Primary Turn Instruction HUD Card */}
        <div className="bg-[#081122]/95 backdrop-blur-2xl border border-[#1E355B] rounded-2xl p-4 shadow-[0_10px_35px_rgba(0,0,0,0.6)] flex items-center gap-4">
          {/* Large Maneuver Icon */}
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#28C7FF]/20 to-[#0A84FF]/20 border border-[#28C7FF]/40 flex items-center justify-center text-[#28C7FF] shadow-[0_0_20px_rgba(40,199,255,0.25)] shrink-0">
            {renderManeuverIcon(maneuverVisual.iconType)}
          </div>

          {/* Maneuver Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black font-mono tracking-tight text-white">
                {formatNavDistance(telemetry.distanceToNextManeuverMeters)}
              </span>
              <span className="text-xs uppercase font-bold tracking-wider text-[#28C7FF]">
                {maneuverVisual.label}
              </span>
            </div>

            <h2 className="text-sm sm:text-base font-extrabold text-[#F0F6FF] truncate mt-0.5">
              {currentStep?.instruction || 'Proceed along recommended corridor'}
            </h2>

            {currentStep?.name && currentStep.name !== '-' && (
              <div className="text-[11px] font-medium text-[#94A3B8] truncate mt-0.5">
                onto <span className="text-[#CBD5E1] font-semibold">{currentStep.name}</span>
              </div>
            )}

            {/* Next maneuver preview if available */}
            {nextStep && (
              <div className="flex items-center gap-1.5 text-[10px] text-[#64748B] mt-1 pt-1 border-t border-[#14233D]/70 truncate">
                <span className="text-[#94A3B8] font-bold">Then:</span>
                <span className="truncate">{nextStep.instruction}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Checkpoints Timeline Drawer (Expandable) ── */}
      {showCheckpoints && (
        <div className="max-w-lg w-full mx-auto pointer-events-auto bg-[#081122]/95 backdrop-blur-2xl border border-[#1E355B] rounded-2xl p-4 shadow-2xl mb-2 flex flex-col max-h-60 overflow-hidden">
          <div className="flex justify-between items-center mb-2.5 pb-2 border-b border-[#14233D]">
            <div className="flex items-center gap-2">
              <span className="text-xs">🚩</span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                Route Checkpoints ({telemetry.completedCheckpointsCount}/{checkpoints.length})
              </h3>
            </div>
            <button
              onClick={() => setShowCheckpoints(false)}
              className="text-[#64748B] hover:text-white text-xs px-2 py-0.5 cursor-pointer"
            >
              ✕ Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {checkpoints.map((chk, i) => {
              const isDone = chk.status === 'completed'
              const isCurrent = chk.status === 'current'
              return (
                <div
                  key={chk.id || i}
                  className={`flex items-start gap-2.5 p-2 rounded-xl border text-xs transition-all ${
                    isDone
                      ? 'bg-emerald-950/20 border-emerald-500/30 text-[#94A3B8]'
                      : isCurrent
                      ? 'bg-[#0E1F3D] border-[#28C7FF] text-white shadow-[0_0_12px_rgba(40,199,255,0.15)]'
                      : 'bg-[#050B18]/60 border-[#14233D] text-[#64748B]'
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    {isDone ? (
                      <span className="text-emerald-400 font-bold">✓</span>
                    ) : isCurrent ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-[#28C7FF] block animate-pulse"></span>
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-[#1E355B] block"></span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{chk.instruction}</div>
                    {chk.name && chk.name !== '-' && (
                      <div className="text-[10px] text-[#94A3B8] truncate">{chk.name}</div>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-[#64748B] shrink-0">
                    {chk.distanceFromStartMeters > 0 && formatNavDistance(chk.distanceFromStartMeters)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Bottom Operational Telemetry & Control Bar ── */}
      <div className="max-w-lg w-full mx-auto pointer-events-auto">
        <div className="bg-[#081122]/95 backdrop-blur-2xl border border-[#1E355B] rounded-2xl p-3 sm:p-4 shadow-[0_10px_35px_rgba(0,0,0,0.6)] flex flex-col gap-3">
          {/* Trip Metrics Grid */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {/* Remaining Distance */}
            <div className="flex flex-col">
              <span className="text-[9px] font-semibold uppercase text-[#64748B] tracking-wider">Remaining</span>
              <span className="text-sm sm:text-base font-extrabold font-mono text-white">
                {formatNavDistance(telemetry.distanceRemainingMeters)}
              </span>
            </div>

            {/* Remaining Time */}
            <div className="flex flex-col">
              <span className="text-[9px] font-semibold uppercase text-[#64748B] tracking-wider">Est. Time</span>
              <span className="text-sm sm:text-base font-extrabold font-mono text-white">
                {formatNavDuration(telemetry.durationRemainingSeconds)}
              </span>
            </div>

            {/* ETA Clock */}
            <div className="flex flex-col">
              <span className="text-[9px] font-semibold uppercase text-[#64748B] tracking-wider">ETA</span>
              <span className="text-sm sm:text-base font-extrabold font-mono text-[#28C7FF]">
                {telemetry.etaIso}
              </span>
            </div>

            {/* Elapsed Time */}
            <div className="flex flex-col">
              <span className="text-[9px] font-semibold uppercase text-[#64748B] tracking-wider">Elapsed</span>
              <span className="text-sm sm:text-base font-extrabold font-mono text-[#94A3B8]">
                {formatNavDuration(telemetry.durationElapsedSeconds)}
              </span>
            </div>
          </div>

          {/* Interactive Controls Row */}
          <div className="flex items-center gap-2 pt-1 border-t border-[#14233D]">
            {/* Checkpoints Drawer Toggle */}
            <button
              onClick={() => setShowCheckpoints(!showCheckpoints)}
              className="px-3 py-2 rounded-xl text-xs font-semibold bg-[#0E1F3D] hover:bg-[#142647] border border-[#1E355B] text-[#94A3B8] hover:text-[#28C7FF] transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              title="View route checkpoints"
            >
              <span>🚩</span>
              <span className="hidden sm:inline">Checkpoints</span>
              <span className="font-mono text-[10px]">({telemetry.completedCheckpointsCount}/{checkpoints.length})</span>
            </button>

            {/* Pause / Resume Button */}
            {journeyStatus === 'paused' ? (
              <button
                onClick={onResume}
                className="flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-[0_0_15px_rgba(16,185,129,0.3)]"
              >
                <span>▶️</span>
                <span>Resume Journey</span>
              </button>
            ) : (
              <button
                onClick={onPause}
                className="flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-[#14233D] hover:bg-[#1E355B] text-[#CBD5E1] transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-[#1E355B]"
              >
                <span>⏸️</span>
                <span>Pause</span>
              </button>
            )}

            {/* End Journey Button */}
            <button
              onClick={onEnd}
              className="py-2 px-3 sm:px-4 rounded-xl text-xs font-bold uppercase tracking-wider bg-rose-950/80 hover:bg-rose-900 border border-rose-500/40 text-rose-300 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>⏹️</span>
              <span>End</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
