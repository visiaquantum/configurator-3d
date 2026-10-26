import type { Quaternion } from 'three'

/** Recover an upright heading without the XYZ Euler flip past a quarter turn. */
export function uprightYaw(quaternion: Quaternion, referenceYaw: number): number {
  const { x, y, z, w } = quaternion
  const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y))
  const fullTurn = Math.PI * 2
  return yaw + Math.round((referenceYaw - yaw) / fullTurn) * fullTurn
}
