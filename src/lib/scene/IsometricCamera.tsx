import { useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import { useConfiguratorStore } from '../state/store'

/** Frame the enclosure's projected bounds with equal foreshortening on all axes. */
export function IsometricCamera() {
  const { width, height } = useThree((s) => s.size)
  const bbox = useConfiguratorStore((s) => s.enclosureBBox)
  const dx = bbox ? bbox.max[0] - bbox.min[0] : 1
  const dy = bbox ? bbox.max[1] - bbox.min[1] : 1
  const dz = bbox ? bbox.max[2] - bbox.min[2] : 1
  const aspect = Math.max(width, 1) / Math.max(height, 1)
  const projectedWidth = (dx + dz) / Math.sqrt(2)
  const projectedHeight = (dx + dz) / Math.sqrt(6) + dy * Math.sqrt(2 / 3)
  const halfHeight = Math.max(projectedHeight, projectedWidth / aspect, 0.1) * 0.6
  const halfWidth = halfHeight * aspect

  return (
    <OrthographicCamera
      makeDefault
      manual
      left={-halfWidth}
      right={halfWidth}
      top={halfHeight}
      bottom={-halfHeight}
      near={0.05}
      far={150}
    />
  )
}
