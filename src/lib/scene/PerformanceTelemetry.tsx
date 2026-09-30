import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useConfiguratorStoreApi } from '../state/store'

/** Reports a bounded, local frame-time sample every two seconds when enabled. */
export function PerformanceTelemetry() {
  const storeApi = useConfiguratorStoreApi()
  const accumulatedMs = useRef(0)
  const frames = useRef(0)

  useFrame((_, delta) => {
    accumulatedMs.current += delta * 1000
    frames.current += 1
    if (accumulatedMs.current < 2000) return
    const elapsed = accumulatedMs.current
    storeApi.getState().reportTelemetry({
      type: 'frame-time',
      outcome: 'success',
      durationMs: elapsed / frames.current,
      detail: { fps: Math.round((frames.current * 1000) / elapsed) },
    })
    accumulatedMs.current = 0
    frames.current = 0
  })

  return null
}
