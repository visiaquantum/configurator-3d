import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useConfiguratorStore } from '../state/store'

/**
 * Lives inside the Canvas. Publishes the live renderer / scene / camera refs
 * into the zustand store so DOM-side code (export buttons in Configurator3D)
 * can render frames, walk the scene, and screenshot the canvas.
 */
export function SceneCaptureBridge() {
  const { gl, scene, camera } = useThree()
  const setCaptureRefs = useConfiguratorStore((s) => s.setCaptureRefs)

  useEffect(() => {
    setCaptureRefs({ gl, scene, camera })
    return () => setCaptureRefs(null)
  }, [gl, scene, camera, setCaptureRefs])

  return null
}
