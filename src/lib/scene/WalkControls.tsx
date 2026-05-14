import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { PointerLockControls } from '@react-three/drei'
import type { PointerLockControls as PointerLockControlsImpl } from 'three-stdlib'
import { useConfiguratorStore } from '../state/store'

const EYE_HEIGHT = 1.5 // meters above the floor
const WALL_PADDING = 0.05 // keep the camera this far from the walls
const WALK_SPEED = 1.5 // m/s
const RUN_SPEED = 3.0 // m/s (held shift)

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * First-person controller. Active only when `walkMode === true` in the store.
 *
 * Mouse-look via drei's `PointerLockControls` (requires a user click to engage
 * the browser pointer lock). WASD / arrow keys move along the camera's
 * horizontal forward + right vectors; shift to run. Y is locked to a fixed
 * eye height inside the enclosure; X/Z are clamped to the enclosure AABB so
 * the user can't walk through walls.
 *
 * Pressing Esc releases the pointer lock; the unlock handler also exits walk
 * mode so the orbit camera comes back.
 */
export function WalkControls() {
  const { camera } = useThree()
  const lockRef = useRef<PointerLockControlsImpl | null>(null)
  const keys = useRef<Record<string, boolean>>({})
  const enteredRef = useRef(false)

  // Position the camera once on entry: centered horizontally inside the
  // enclosure, eye-height above the floor, looking forward (-Z). Mutating
  // camera transforms imperatively is the idiomatic Three.js pattern.
  useEffect(() => {
    if (enteredRef.current) return
    const bbox = useConfiguratorStore.getState().enclosureBBox
    if (!bbox) return
    const cx = (bbox.min[0] + bbox.max[0]) / 2
    const cz = (bbox.min[2] + bbox.max[2]) / 2
    const eye = bbox.min[1] + Math.min(EYE_HEIGHT, bbox.max[1] - bbox.min[1] - 0.1)
    camera.position.set(cx, eye, cz)
    camera.lookAt(cx, eye, cz - 1)
    enteredRef.current = true
  }, [camera])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keys.current[e.code] = true
    }
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      keys.current = {}
    }
  }, [])

  const forward = useRef(new Vector3()).current
  const right = useRef(new Vector3()).current
  const up = useRef(new Vector3(0, 1, 0)).current
  const move = useRef(new Vector3()).current

  /* eslint-disable react-hooks/immutability */
  useFrame((_, dt) => {
    camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) return
    forward.normalize()
    right.crossVectors(forward, up).normalize()
    const k = keys.current
    const speed = k.ShiftLeft || k.ShiftRight ? RUN_SPEED : WALK_SPEED

    move.set(0, 0, 0)
    if (k.KeyW || k.ArrowUp) move.add(forward)
    if (k.KeyS || k.ArrowDown) move.sub(forward)
    if (k.KeyD || k.ArrowRight) move.add(right)
    if (k.KeyA || k.ArrowLeft) move.sub(right)
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt)
      camera.position.add(move)
    }

    // Clamp to enclosure interior. Y stays locked to eye height.
    const bbox = useConfiguratorStore.getState().enclosureBBox
    if (bbox) {
      camera.position.x = clamp(
        camera.position.x,
        bbox.min[0] + WALL_PADDING,
        bbox.max[0] - WALL_PADDING,
      )
      camera.position.z = clamp(
        camera.position.z,
        bbox.min[2] + WALL_PADDING,
        bbox.max[2] - WALL_PADDING,
      )
      const eye = bbox.min[1] + Math.min(EYE_HEIGHT, bbox.max[1] - bbox.min[1] - 0.1)
      camera.position.y = eye
    }
  })
  /* eslint-enable react-hooks/immutability */

  return (
    <PointerLockControls
      ref={lockRef}
      onUnlock={() => {
        // Esc / pointer-unlock returns to orbit mode.
        useConfiguratorStore.getState().setWalkMode(false)
      }}
    />
  )
}
