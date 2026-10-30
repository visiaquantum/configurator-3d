import { Plane, Vector3 } from 'three'
import type { Ray } from 'three'
import type { ConfiguratorState } from '../state/store'
import type { Euler } from '../types'
import { assemblyMembers, jointsOf } from '../assembly/graph'
import { selectCollisionBounds } from '../state/selectors'
import { colliderSizeOf } from './itemRegistry'
import { assemblyPosePatches } from './mating'
import { uprightYaw } from './rotation'
import { clampItemsToBounds, clampItemToBounds, findNearestVertexSnap, offsetForLockedCorners, pushOutOverlaps, VERTEX_SNAP_RELEASE_RADIUS } from './snapping'
import { applyLiveItemPatches } from './itemMovement'
import type { ConnectionPreview } from './connectionPreview'

/**
 * Mid-gesture feedback on the live Three.js groups of one configurator. These
 * move what is drawn and nothing else: the release goes through
 * `finishItemMovement` / `commitConnectionPreview`, which decide what is kept.
 */

type LiveState = Pick<ConfiguratorState, 'project' | 'itemRegistry' | 'snapToGridEnabled' | 'gridStep' | 'interiorBBox' | 'enclosureBBox'>

/** Below 15° between the pointer ray and the floor, the floor plane is too oblique to drag on. */
const MIN_FLOOR_RAY_SIN = Math.sin((15 * Math.PI) / 180)
/** A ray within 5° of its plane lands metres away for a pixel of pointer travel. */
const MIN_PLANE_RAY_SIN = Math.sin((5 * Math.PI) / 180)

/**
 * The plane a drag follows, through `point`. From above it is the floor plane
 * at the item's height. Seen side-on (Fronte, Lato, a low orbit) that plane is
 * edge-on: a few pixels of pointer travel threw the part metres across the van,
 * or behind the camera. There the part follows a vertical plane facing the
 * camera instead, so the pointer moves it sideways and its depth stays put.
 */
export function dragPlaneFor(ray: Ray, point: Vector3): Plane {
  if (Math.abs(ray.direction.y) >= MIN_FLOOR_RAY_SIN) return new Plane(new Vector3(0, 1, 0), -point.y)
  const normal = new Vector3(-ray.direction.x, 0, -ray.direction.z).normalize()
  return new Plane().setFromNormalAndCoplanarPoint(normal, point)
}

/** Where the pointer ray meets the drag plane, or null when it misses or only grazes it. */
export function dragPlaneHit(ray: Ray, plane: Plane, out: Vector3): Vector3 | null {
  if (Math.abs(ray.direction.dot(plane.normal)) < MIN_PLANE_RAY_SIN) return null
  return ray.intersectPlane(plane, out)
}

/** A corner pair held by the vertex magnet until it drifts past the release radius. */
export interface VertexSnapLock {
  myCornerIdx: number
  otherCornerIdx: number
  otherId: string
}

/**
 * Put a dragged item under the pointer at (`x`, `z`), then apply the grid and
 * the vertex magnet. A held lock survives until its corner pair drifts beyond
 * the release radius; only then is a fresh pair looked for. Engage < release,
 * so the magnet does not oscillate at the threshold. Returns the lock to hold.
 * The rest of the assembly (`travelling`) is no target: its corners still sit
 * at the previous frame's pose and would pull the part back every move.
 */
export function placeDraggedItem(
  state: LiveState,
  id: string,
  x: number,
  z: number,
  lock: VertexSnapLock | null,
  travelling: ReadonlySet<string>,
): VertexSnapLock | null {
  const group = state.itemRegistry.get(id)?.group
  if (!group) return null
  group.position.x = x
  group.position.z = z
  if (state.snapToGridEnabled && state.gridStep > 0) {
    group.position.x = Math.round(group.position.x / state.gridStep) * state.gridStep
    group.position.z = Math.round(group.position.z / state.gridStep) * state.gridStep
  }
  if (lock) {
    const held = offsetForLockedCorners(id, lock.myCornerIdx, lock.otherId, lock.otherCornerIdx, state.itemRegistry)
    if (held && held.dist <= VERTEX_SNAP_RELEASE_RADIUS) {
      group.position.x += held.offset.x
      group.position.z += held.offset.z
      return lock
    }
  }
  const snap = findNearestVertexSnap(id, state.itemRegistry, travelling)
  if (!snap) return null
  group.position.x += snap.offset.x
  group.position.z += snap.offset.z
  return { myCornerIdx: snap.myCornerIdx, otherCornerIdx: snap.otherCornerIdx, otherId: snap.otherId }
}

/**
 * Magnet: a valid seat in range wins over the pointer. The part sits in it,
 * turned the way the joint needs, so the join is seen during the gesture
 * instead of as a jump on release. Out of range it goes back to
 * `restRotation`. `false` means the part is on its own.
 */
export function holdInSeat(state: LiveState, id: string, preview: ConnectionPreview | null, restRotation: Euler): boolean {
  const group = state.itemRegistry.get(id)?.group
  const size = colliderSizeOf(id, state.itemRegistry)
  if (!group || !size) return false
  if (!preview?.valid) {
    group.rotation.set(...restRotation)
    return false
  }
  group.position.set(preview.position[0], preview.position[1] + size[1] / 2, preview.position[2])
  group.rotation.set(...preview.rotation)
  return true
}

/**
 * The rest of an item's assembly put where the item's live pose — turned as
 * well as moved — has taken it. `true` when there was an assembly to move,
 * which also means the single-part guards must not run: pushing one member out
 * or clamping it would slide it off the joints the others hold it by.
 */
export function followAssemblyLive(state: LiveState, id: string): boolean {
  const project = state.project
  const item = project?.items.find((entry) => entry.id === id)
  const group = state.itemRegistry.get(id)?.group
  const size = colliderSizeOf(id, state.itemRegistry)
  if (!project || !item || !group || !size) return false
  const members = assemblyMembers(project.items, jointsOf(project), id)
  if (members.size < 2) return false
  // An assembly turns about the upright axis only: the commit keeps each
  // member's own pitch, so a pitch shown here would be taken back on release.
  group.rotation.set(item.rotation[0], uprightYaw(group.quaternion, item.rotation[1]), item.rotation[2])
  const pose = {
    position: [group.position.x, group.position.y - size[1] / 2, group.position.z] as [number, number, number],
    rotation: [item.rotation[0], group.rotation.y, item.rotation[2]] as Euler,
  }
  applyLiveItemPatches(state.itemRegistry, assemblyPosePatches(project.items, members, item, pose).filter((entry) => entry.id !== id))
  return true
}

/**
 * An assembly on the move stays inside the enclosure as one body. Only a part
 * out of a seat: a seat that reaches past the van is the user's to decide.
 */
export function keepAssemblyInside(state: LiveState, id: string): void {
  const project = state.project
  if (!project) return
  clampItemsToBounds(assemblyMembers(project.items, jointsOf(project), id), selectCollisionBounds(state), state.itemRegistry)
}

/** A part on its own is pushed out of other products and kept inside the enclosure. */
export function separateFreePart(state: LiveState, id: string, ignore: ReadonlySet<string>): void {
  pushOutOverlaps(id, state.itemRegistry, ignore)
  clampItemToBounds(id, selectCollisionBounds(state), state.itemRegistry)
}
