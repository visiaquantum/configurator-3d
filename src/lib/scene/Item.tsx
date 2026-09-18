import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Group, InstancedMesh, Material, Object3D } from 'three'
import {
  Box3,
  Color,
  DoubleSide,
  Euler,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Matrix4,
  Plane,
  Vector3,
} from 'three'
import { TransformControls, useGLTF } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type {
  Anchor,
  CatalogItem,
  Connection,
  Euler as EulerTuple,
  PlacedItem,
  Vec3,
} from '../types'
import type { ItemConstraint, ItemSnapPoint } from '../types'
import { useConfiguratorStore } from '../state/store'
import { hydrateItemRulesAndHide } from '../io/rules'
import { AUTO_SNAP_GRID_RULE, extractAutoSnapGridFromObject } from '../io/autoSnapGrid'
import { hydrateItemSnapsAndHide } from '../io/itemSnaps'
import { colliderSizeOf, buildLocalCorners, getItem, registerItem, unregisterItem } from './itemRegistry'
import {
  MIRROR_PAIR_RULE,
  mirrorAxisOf,
  mirrorPairConstraint,
  withSnapConstraint,
} from './mirrorPair'
import {
  clampItemToBounds,
  findNearestVertexSnap,
  offsetForLockedCorners,
  pushOutOverlaps,
  VERTEX_SNAP_RELEASE_RADIUS,
} from './snapping'
import {
  assemblyGroup,
  dedupeJoints,
  itemSnapConstraint,
  itemSnapConstraintFor,
  jointsSurvivingMove,
  linkedPartners,
  listMatingTargets,
  mirrorSnapPoints,
  positionForItemSnap,
  rotateGroupPatches,
  snapsForItem,
  worldSnapPosition,
  yawToMate,
} from './mating'
import { connectionsAtPose, connectorForSnap, connectorsCanMate, definitionFor } from '../assembly/manifest'
import { validateConfiguration } from '../assembly/validation'

interface Props {
  item: PlacedItem
  catalog: CatalogItem | undefined
  anchors?: Anchor[]
}

const ANCHOR_SNAP_RADIUS = 0.06 // 6 cm — XZ distance to an enclosure anchor that triggers a snap
const ANCHOR_SNAP_MAX_DY = 0.3 // ignore anchors more than 30 cm above/below the item base (e.g. wall anchors while floor-dragging)
const DRAG_THRESHOLD_PX = 4 // mouse movement (px) before a pointerdown is treated as a drag
const ROTATION_SENSITIVITY = 0.01 // radians of Y rotation per pixel of horizontal mouse delta
const ROTATION_STEP = Math.PI / 2 // rotations snap to 90° increments
const SNAP_POINT_MARKER_RADIUS = 0.006
const EMPTY_AUTO_SNAP_OPTIONS = {}

const snapAngle = (v: number) => Math.round(v / ROTATION_STEP) * ROTATION_STEP

// Tuning for item reflections. Picks up the scene Environment HDR so items
// look glossy and reflect the warehouse lighting like the enclosure paint.
const ITEM_ENV_INTENSITY = 1.5
const ITEM_CLEARCOAT = 0.5
const ITEM_CLEARCOAT_ROUGHNESS = 0.1

/**
 * Walk the cloned item scene and per-instance-clone each material so we can
 * boost reflections without leaking through the shared `useGLTF` cache.
 *
 * For MeshPhysicalMaterial we can also raise the clearcoat to add a glossy
 * top-coat. For plain MeshStandardMaterial we only boost envMapIntensity —
 * upgrading to Physical via `copy()` corrupts physical-specific uniforms
 * (transmission/thickness become undefined) and the mesh renders invisible.
 */
function enhanceItemMaterials(root: Object3D) {
  const upgrade = (m: Material): Material => {
    if (m instanceof MeshPhysicalMaterial) {
      const next = m.clone()
      next.envMapIntensity = Math.max(next.envMapIntensity, ITEM_ENV_INTENSITY)
      next.clearcoat = Math.max(next.clearcoat, ITEM_CLEARCOAT)
      next.clearcoatRoughness = Math.min(next.clearcoatRoughness, ITEM_CLEARCOAT_ROUGHNESS)
      next.needsUpdate = true
      return next
    }
    if (m instanceof MeshStandardMaterial) {
      const next = m.clone()
      next.envMapIntensity = Math.max(next.envMapIntensity, ITEM_ENV_INTENSITY)
      next.needsUpdate = true
      return next
    }
    return m
  }
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(upgrade)
    } else {
      obj.material = upgrade(obj.material)
    }
  })
}

// Scratch instances reused across pointermove. Drag is single-threaded so this
// is safe and saves ~100s of Vector3 allocations per second during a drag.
const _hit = new Vector3()
const _euler = new Euler()

interface SnapLock {
  myCornerIdx: number
  otherCornerIdx: number
  otherId: string
}

interface DragCtx {
  mode: 'translate' | 'rotate'
  startClientX: number
  startClientY: number
  startRotX: number
  startRotY: number
  /** Fixed group position used while rotating; rotation must not translate. */
  startPos: Vector3
  /** Horizontal plane at the group's initial Y; raycast target for translate. */
  plane: Plane
  /** group.position − pointer-hit at pointer-down. Preserves the grab offset. */
  grabOffset: Vector3
  /** True once the pointer has moved DRAG_THRESHOLD_PX from its origin. */
  started: boolean
  /**
   * Hold a snapped corner pair until the mouse-driven position drifts beyond
   * VERTEX_SNAP_RELEASE_RADIUS. Prevents the closest corner from flipping
   * between candidates each frame (visible as jitter).
   */
  snapLock: SnapLock | null
  /** The rest of the assembly, with the group positions it started from. */
  followers: Array<{ id: string; start: Vector3 }>
}

interface ConnectionPreview {
  position: Vec3
  rotation: EulerTuple
  connection: Connection
  /** Every joint this pose makes; `connection` is the one the drag resolved. */
  connections: Connection[]
  valid: boolean
  reason?: string
}

/** XZ offsets of the 4 bottom corners of a centered collider box. */
function cornerOffsetsXZ(size: Vec3): Array<[number, number]> {
  const hx = size[0] / 2
  const hz = size[2] / 2
  return [
    [-hx, -hz],
    [hx, -hz],
    [-hx, hz],
    [hx, hz],
  ]
}

/** Rotate an XZ offset by `yaw` radians around +Y (three.js convention). */
function rotateOffsetXZ(ox: number, oz: number, yaw: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [ox * c + oz * s, -ox * s + oz * c]
}

interface AnchorSnapHit {
  anchor: Anchor
  /** Index into cornerOffsetsXZ, or null when the item center snapped. */
  corner: number | null
  /** Id of the product snap point that snapped, or null. Wins over corner. */
  point: string | null
  /** New item base position that puts the snapped point on the anchor. */
  position: Vec3
  dist: number
}

interface SnapCandidate {
  corner: number | null
  point: string | null
  dx: number
  dz: number
  /** Y offset of the candidate point above the item base. */
  oy: number
}

/**
 * Nearest anchor within ANCHOR_SNAP_RADIUS of the item center, any of its 4
 * bottom corners, or any product snap point declared in the GLB. Distance is
 * measured on XZ only (the anchor supplies the Y), with a vertical window so
 * floor drags don't grab wall anchors.
 */
function findAnchorSnap(
  base: Vec3,
  yaw: number,
  colliderSize: Vec3,
  anchors: Anchor[],
  snapPoints: ItemSnapPoint[],
): AnchorSnapHit | null {
  const candidates: SnapCandidate[] = [{ corner: null, point: null, dx: 0, dz: 0, oy: 0 }]
  cornerOffsetsXZ(colliderSize).forEach(([ox, oz], i) => {
    const [dx, dz] = rotateOffsetXZ(ox, oz, yaw)
    candidates.push({ corner: i, point: null, dx, dz, oy: 0 })
  })
  for (const sp of snapPoints) {
    const [dx, dz] = rotateOffsetXZ(sp.position[0], sp.position[2], yaw)
    candidates.push({
      corner: null,
      point: sp.id,
      dx,
      dz,
      oy: sp.position[1] + colliderSize[1] / 2,
    })
  }
  let best: AnchorSnapHit | null = null
  for (const a of anchors) {
    for (const cand of candidates) {
      if (Math.abs(base[1] + cand.oy - a.position[1]) > ANCHOR_SNAP_MAX_DY) continue
      const d = Math.hypot(
        base[0] + cand.dx - a.position[0],
        base[2] + cand.dz - a.position[2],
      )
      if (d <= ANCHOR_SNAP_RADIUS && (!best || d < best.dist)) {
        best = {
          anchor: a,
          corner: cand.corner,
          point: cand.point,
          dist: d,
          position: [
            a.position[0] - cand.dx,
            a.position[1] - cand.oy,
            a.position[2] - cand.dz,
          ],
        }
      }
    }
  }
  return best
}

/** World-space AABB of the visible meshes only (markers are hidden). */
function computeVisibleBBox(root: Object3D): Box3 {
  root.updateMatrixWorld(true)
  const box = new Box3()
  const tmp = new Box3()
  root.traverseVisible((obj) => {
    if (!(obj instanceof Mesh)) return
    const geom = obj.geometry
    if (!geom.boundingBox) geom.computeBoundingBox()
    if (geom.boundingBox) {
      tmp.copy(geom.boundingBox).applyMatrix4(obj.matrixWorld)
      box.union(tmp)
    }
  })
  return box
}

/** snapToAnchor constraint recording which item feature landed on the anchor. */
function snapHitConstraint(hit: AnchorSnapHit): ItemConstraint {
  return {
    type: 'snapToAnchor',
    target: hit.anchor.id,
    ...(hit.point
      ? { point: hit.point }
      : hit.corner != null
        ? { corner: hit.corner }
        : {}),
  }
}

export function Item({ item, catalog, anchors = [] }: Props) {
  const [assetStartedAt] = useState(() => performance.now())
  const url = catalog?.glbUrl
  if (!url) return null
  return <ItemInner item={item} catalog={catalog} anchors={anchors} url={url} assetStartedAt={assetStartedAt} />
}

function ItemInner({
  item,
  catalog,
  anchors = [],
  url,
  assetStartedAt,
}: Props & { url: string; assetStartedAt: number }) {
  const select = useConfiguratorStore((s) => s.select)
  const updateItems = useConfiguratorStore((s) => s.updateItems)
  const selectedId = useConfiguratorStore((s) => s.selectedId)
  const gizmoMode = useConfiguratorStore((s) => s.gizmoMode)
  const setDraggingItemId = useConfiguratorStore((s) => s.setDraggingItemId)
  const readOnly = useConfiguratorStore((s) => s.readOnly)
  const collisionBounds = useConfiguratorStore((s) => s.interiorBBox ?? s.enclosureBBox)
  const isSelected = selectedId === item.id
  const isOverlapping = useConfiguratorStore((s) => s.overlappingIds.has(item.id))
  const assetReportedRef = useRef(false)

  const [group, setGroup] = useState<Group | null>(null)
  const [connectionPreview, setConnectionPreview] = useState<ConnectionPreview | null>(null)
  // Pointer-up may arrive before React has rendered the pointer-move state.
  // Keep the authoritative current ghost in a ref so a valid release cannot
  // accidentally fall back to a normal drag commit.
  const connectionPreviewRef = useRef<ConnectionPreview | null>(null)
  const updateConnectionPreview = (next: ConnectionPreview | null) => {
    connectionPreviewRef.current = next
    setConnectionPreview(next)
  }
  const dragRef = useRef<DragCtx | null>(null)
  const transformLockPosRef = useRef<Vector3 | null>(null)

  const gltf = useGLTF(url)
  const scale = catalog?.scale ?? 1

  useLayoutEffect(() => {
    if (assetReportedRef.current) return
    assetReportedRef.current = true
    useConfiguratorStore.getState().reportTelemetry({
      type: 'asset-load',
      outcome: 'success',
      durationMs: performance.now() - assetStartedAt,
      detail: { catalogId: item.catalogId },
    })
  }, [assetStartedAt, item.catalogId])
  const mirrored = item.mirrored === true
  const cloned = useMemo(() => {
    const c = gltf.scene.clone()
    c.scale.setScalar(scale)
    enhanceItemMaterials(c)
    if (mirrored) {
      // The mirror flip (scale.x = -1 on the wrapper) inverts face winding;
      // render both sides so the geometry doesn't show inside-out.
      c.traverse((obj) => {
        if (!(obj instanceof Mesh)) return
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        for (const m of mats) {
          // enhanceItemMaterials already cloned Standard/Physical materials,
          // so mutating them cannot leak into the shared useGLTF cache.
          if (m instanceof MeshStandardMaterial) m.side = DoubleSide
        }
      })
    }
    c.updateMatrixWorld(true)
    return c
  }, [gltf.scene, scale, mirrored])

  // Rules declared in the GLB via extras (kind: "rule") and snap points
  // (SNAP_* nodes / extras kind: "snap"). Extraction also hides the marker
  // nodes in this clone.
  const modelRules = useMemo(() => hydrateItemRulesAndHide(cloned), [cloned])
  const modelSnaps = useMemo(() => hydrateItemSnapsAndHide(cloned), [cloned])
  // Hole detection runs when the GLB asks for it, or when the catalog entry
  // does — the escape hatch for models that can carry neither extras nor a
  // `RULE_AUTOSNAPGRID` node.
  const autoGridConfig = typeof catalog?.autoSnapGrid === 'object' ? catalog.autoSnapGrid : EMPTY_AUTO_SNAP_OPTIONS
  const autoGridForced = catalog?.autoSnapGrid === true || typeof catalog?.autoSnapGrid === 'object'
  const gridRules = useMemo(
    () => {
      const existing = modelRules.find((rule) => rule.rule === AUTO_SNAP_GRID_RULE)
      if (existing) {
        return modelRules.map((rule) => rule.rule === AUTO_SNAP_GRID_RULE
          ? { ...rule, params: { ...rule.params, ...autoGridConfig } }
          : rule,
        )
      }
      return autoGridForced
        ? [...modelRules, { rule: AUTO_SNAP_GRID_RULE, position: [0, 0, 0] as Vec3, axis: [1, 0, 0] as Vec3, params: autoGridConfig }]
        : modelRules
    },
    [modelRules, autoGridForced, autoGridConfig],
  )
  const autoGridSnaps = useMemo(
    () => extractAutoSnapGridFromObject(cloned, gridRules),
    [cloned, gridRules],
  )

  // Mirror flip for the twin of a mirror pair: along the local axis
  // perpendicular to the rule's mirror plane (X or Z depending on the GLB).
  const catalogRules = useConfiguratorStore((s) => s.itemRules[item.catalogId])
  const mirrorScale = useMemo<Vec3 | undefined>(() => {
    if (!mirrored) return undefined
    const rule = catalogRules?.find((r) => r.rule === MIRROR_PAIR_RULE)
    return rule && mirrorAxisOf(rule) === 'z' ? [1, 1, -1] : [-1, 1, 1]
  }, [mirrored, catalogRules])

  // Tint the item red when it overlaps another item or clips the enclosure
  // body. Originals captured once per material; we lerp toward red instead of
  // overwriting so textures/branding stay readable.
  const originalColorsRef = useRef<Map<MeshStandardMaterial, Color>>(new Map())
  useLayoutEffect(() => {
    if (!cloned) return
    const originals = originalColorsRef.current
    const RED = new Color(0xff0000)
    cloned.traverse((obj) => {
      if (!(obj instanceof Mesh)) return
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (!(m instanceof MeshStandardMaterial)) continue
        if (!originals.has(m)) originals.set(m, m.color.clone())
        const orig = originals.get(m)!
        if (isOverlapping) {
          m.color.copy(orig).lerp(RED, 0.6)
        } else {
          m.color.copy(orig)
        }
      }
    })
  }, [cloned, isOverlapping])

  // Bounds of the VISIBLE geometry only — rule/snap marker meshes were just
  // hidden by the hydrate calls above and must not inflate the collider
  // (e.g. Sincro's 1 mm SNAP_* cubes at floor level under a wall-mounted
  // panel would stretch the box down to y=0).
  const bbox = useMemo(() => {
    const b = computeVisibleBBox(cloned)
    if (b.isEmpty()) b.setFromObject(cloned)
    const size = new Vector3()
    const center = new Vector3()
    b.getSize(size)
    b.getCenter(center)
    return { size, center, min: b.min.clone() }
    // modelRules/modelSnaps derive from `cloned` and their memos run above,
    // so by the time this executes the markers are already hidden.
  }, [cloned])

  const catSize = catalog?.size
  const colliderSize = useMemo<Vec3>(
    () =>
      catSize
        ? [catSize[0] * scale, catSize[1] * scale, catSize[2] * scale]
        : [
            Math.max(bbox.size.x, 0.005),
            Math.max(bbox.size.y, 0.005),
            Math.max(bbox.size.z, 0.005),
          ],
    [catSize, scale, bbox.size.x, bbox.size.y, bbox.size.z],
  )

  // Publish the GLB rules and snap points (converted into the item's local
  // frame: origin at the collider center) so UI panels, pair math, and the
  // anchor-snap logic can read them by catalogId.
  const setItemRules = useConfiguratorStore((s) => s.setItemRules)
  const setItemSnaps = useConfiguratorStore((s) => s.setItemSnaps)
  useLayoutEffect(() => {
    // Same transform as the render wrapper below: XZ centered on the visible
    // bbox, Y so the visible bottom sits at the collider bottom (-h/2).
    const toLocal = (p: Vec3): Vec3 => [
      p[0] - bbox.center.x,
      p[1] - colliderSize[1] / 2 - bbox.min.y,
      p[2] - bbox.center.z,
    ]
    const s = useConfiguratorStore.getState()
    if (modelRules.length > 0 && !s.itemRules[item.catalogId]) {
      setItemRules(
        item.catalogId,
        modelRules.map((r) => ({
          rule: r.rule,
          position: toLocal(r.position),
          axis: r.axis,
          params: r.params,
        })),
      )
    }
    const extractedSnaps = [...modelSnaps, ...autoGridSnaps]
    const catalogSnapPoints = catalog?.snapPoints ?? []
    if ((extractedSnaps.length > 0 || catalogSnapPoints.length > 0) && !s.itemSnaps[item.catalogId]) {
      setItemSnaps(
        item.catalogId,
        // `toLocal` is a pure translation, so the face normal carries over
        // unchanged from the model frame to the item frame.
        [
          ...extractedSnaps.map((sp) => ({
            id: sp.id,
            kind: sp.kind,
            position: toLocal(sp.position),
            normal: sp.normal,
          })),
          // Catalog points already use the local collider frame.
          ...catalogSnapPoints,
        ],
      )
    }
  }, [modelRules, modelSnaps, autoGridSnaps, catalog?.snapPoints, bbox, colliderSize, item.catalogId, setItemRules, setItemSnaps])

  /**
   * Items this one may legitimately overlap: whatever it is joined to through
   * a `snapToItem` constraint. Interlocking parts share material by design, so
   * the push-out must leave those pairs alone or it would prise the assembly
   * apart on every move.
   */
  const linkedTo = (id: string): ReadonlySet<string> | undefined => {
    const s = useConfiguratorStore.getState()
    return s.project ? linkedPartners(id, s.project.items, s.project.connections ?? []) : undefined
  }

  /** Nearest manifest-approved mating candidate for the current live drag pose. */
  const resolveConnectionPreview = (): ConnectionPreview | null => {
    const s = useConfiguratorStore.getState()
    if (!s.project || !s.assemblyManifest || !group) return null
    const sourceDefinition = definitionFor(s.assemblyManifest, item.catalogId)
    if (!sourceDefinition) return null
    // A part cannot be joined to what is travelling with it. Its own seat moves
    // with the drag, so it stays within snapping range for the whole gesture:
    // the preview kept resolving back onto it, the ghost flicked between the
    // two places, and the release put the part back where it started.
    const travelling = assemblyGroup(item.id, s.project.items, s.project.connections ?? [])
    const snapsByItem = new Map<string, ItemSnapPoint[]>()
    for (const placed of s.project.items) {
      if (travelling.has(placed.id) && placed.id !== item.id) continue
      snapsByItem.set(placed.id, snapsForItem(placed, s.itemSnaps, s.itemRules))
    }
    let best: { source: ItemSnapPoint; target: ReturnType<typeof listMatingTargets>[number]; distance: number } | null = null
    for (const source of effectiveCatalogSnaps) {
      const sourceConnector = connectorForSnap(sourceDefinition, source)
      if (!sourceConnector) continue
      const sourceWorld = worldSnapPosition(item.id, source.position)
      if (!sourceWorld) continue
      for (const target of listMatingTargets(item.id, source.kind, snapsByItem)) {
        const targetItem = s.project.items.find((placed) => placed.id === target.itemId)
        if (!targetItem) continue
        const targetConnector = connectorForSnap(
          definitionFor(s.assemblyManifest, targetItem.catalogId),
          target.point,
        )
        if (!targetConnector || !connectorsCanMate(sourceConnector, source, targetConnector, target.point)) continue
        const distance = Math.hypot(
          sourceWorld[0] - target.position[0],
          sourceWorld[1] - target.position[1],
          sourceWorld[2] - target.position[2],
        )
        if (distance > 0.09 || (best && distance >= best.distance)) continue
        best = { source, target, distance }
      }
    }
    if (!best) return null
    const targetItem = s.project.items.find((placed) => placed.id === best.target.itemId)!
    const sourceConnector = connectorForSnap(sourceDefinition, best.source)!
    const targetConnector = connectorForSnap(
      definitionFor(s.assemblyManifest, targetItem.catalogId),
      best.target.point,
    )!
    const yaw = yawToMate(best.source.normal, best.target.point.normal, targetItem.rotation[1])
    const rotation: EulerTuple = yaw === null
      ? [group.rotation.x, group.rotation.y, group.rotation.z]
      : [0, yaw, 0]
    const position = positionForItemSnap(
      best.source.position,
      rotation[1],
      colliderSize[1],
      best.target.position,
    )
    const connection: Connection = {
      sourceItemId: item.id,
      sourceConnectorId: sourceConnector.id,
      sourcePointId: best.source.id,
      targetItemId: targetItem.id,
      targetConnectorId: targetConnector.id,
      targetPointId: best.target.point.id,
      resolvedTransform: { position, rotation },
    }
    // Every contact this pose makes, not just the one the drag was nearest to.
    const joints = connectionsAtPose(item, { position, rotation }, {
      items: s.project.items,
      itemSnaps: s.itemSnaps,
      itemRules: s.itemRules,
      manifest: s.assemblyManifest,
      heightOf: (placed) => colliderSizeOf(placed.id)?.[1] ?? 0,
    })
    const connections = joints.length > 0 ? joints : [connection]
    const retained = (s.project.connections ?? []).filter((existing) => existing.sourceItemId !== item.id)
    const constraints = [
      ...(item.constraints?.filter((constraint) => constraint.type === 'mirrorPair') ?? []),
      itemSnapConstraintFor(targetItem.id, best.source.id, best.target.point.id),
    ]
    const previewProject = {
      ...s.project,
      connections: [...retained, ...connections],
      items: s.project.items.map((placed) => placed.id === item.id ? { ...placed, position, rotation, constraints } : placed),
    }
    const issues = validateConfiguration(previewProject, s.catalog, s.assemblyManifest, {
      itemSnaps: s.itemSnaps,
      itemRules: s.itemRules,
      enclosureBounds: s.interiorBBox,
    })
    const blocking = issues.find((issue) => issue.level === 'error' && issue.itemIds.includes(item.id))
    return { position, rotation, connection, connections, valid: !blocking, reason: blocking?.message }
  }

  const snapConstraint = item.constraints?.find((c) => c.type === 'snapToAnchor')
  const snappedAnchor = snapConstraint
    ? anchors.find((a) => a.id === snapConstraint.target)
    : undefined

  // Sync the group's transform with `item` whenever external state changes
  // (undo/redo, Inspector edits, snap-toggle). Drag handlers mutate
  // group.position imperatively; no JSX `position` prop fights them. Mutating
  // the Three.js Group held in state is the idiomatic scene-graph pattern;
  // React state holds the (stable) reference, not the world transform.
  /* eslint-disable react-hooks/immutability */
  const snapCorner = snapConstraint?.corner ?? null
  const snapPointId = snapConstraint?.point ?? null
  const catalogSnaps = useConfiguratorStore((s) => s.itemSnaps[item.catalogId])
  const effectiveCatalogSnaps = mirrorSnapPoints(catalogSnaps, mirrorScale)
  useLayoutEffect(() => {
    if (!group) return
    let px: number, py: number, pz: number
    if (snappedAnchor) {
      const sp = snapPointId ? effectiveCatalogSnaps.find((p) => p.id === snapPointId) : undefined
      const corner = snapCorner != null ? cornerOffsetsXZ(colliderSize)[snapCorner] : undefined
      if (sp) {
        // Snapped by a product snap point: place it exactly on the anchor.
        const [dx, dz] = rotateOffsetXZ(sp.position[0], sp.position[2], item.rotation[1])
        px = snappedAnchor.position[0] - dx
        py = snappedAnchor.position[1] - (sp.position[1] + colliderSize[1] / 2)
        pz = snappedAnchor.position[2] - dz
      } else if (corner) {
        // Snapped by a corner: place the item so that corner sits on the anchor.
        const [dx, dz] = rotateOffsetXZ(corner[0], corner[1], item.rotation[1])
        px = snappedAnchor.position[0] - dx
        py = snappedAnchor.position[1]
        pz = snappedAnchor.position[2] - dz
      } else {
        ;[px, py, pz] = snappedAnchor.position
      }
    } else {
      ;[px, py, pz] = item.position
    }
    group.position.set(px, py + colliderSize[1] / 2, pz)
    group.rotation.set(item.rotation[0], item.rotation[1], item.rotation[2])
  }, [
    group,
    snappedAnchor,
    snapCorner,
    snapPointId,
    effectiveCatalogSnaps,
    item.position,
    item.rotation,
    colliderSize,
  ])

  // Register with the cross-item registry for vertex-snap and overlap push-out.
  useLayoutEffect(() => {
    if (!group) return
    group.userData.exportable = true
    const localCorners = buildLocalCorners(colliderSize)
    registerItem({ id: item.id, group, localCorners })
    return () => unregisterItem(item.id)
  }, [item.id, colliderSize, group])

  // If an item is loaded/added before enclosure bounds are ready, normalize it
  // as soon as bounds exist so it never starts below the floor or outside the van.
  useLayoutEffect(() => {
    if (!group || !collisionBounds) return
    // A joined part is held by its joint, not by the van, and so is the twin of
    // a mirror pair: both are placed by something else. Clamping either slides
    // it off its seat, and the patch below then drops the joint as well — so an
    // assembly that reaches past the van could never be built, however it was
    // oriented afterwards. Validation still reports it, and moving the whole
    // assembly clears it.
    if (itemSnapConstraint(item) || mirrorPairConstraint(item)) return
    const moved = clampItemToBounds(item.id, collisionBounds)
    if (!moved) return
    const nextPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    if (
      Math.abs(nextPos[0] - item.position[0]) < 1e-6 &&
      Math.abs(nextPos[1] - item.position[1]) < 1e-6 &&
      Math.abs(nextPos[2] - item.position[2]) < 1e-6
    ) return
    updateItems([
      {
        id: item.id,
        patch: { position: nextPos, constraints: withSnapConstraint(item, null) },
      },
    ])
  }, [group, collisionBounds, item, item.id, item.position, colliderSize, updateItems])
  /* eslint-enable react-hooks/immutability */

  const handleTransformEnd = () => {
    if (!group) return
    _euler.setFromQuaternion(group.quaternion)
    const newRot: EulerTuple = [snapAngle(_euler.x), snapAngle(_euler.y), snapAngle(_euler.z)]
    group.rotation.set(newRot[0], newRot[1], newRot[2])

    // Rotate gizmo: rotate IN PLACE around the collider center. No overlap
    // push-out, no anchor re-snap — the item must not move in space. A snap
    // by corner/point can't survive an in-place rotation (the item would
    // orbit the anchor), so it is dropped and the current position is kept;
    // a center snap is rotation-invariant and stays.
    if (useConfiguratorStore.getState().gizmoMode === 'rotate') {
      if (transformLockPosRef.current) group.position.copy(transformLockPosRef.current)
      transformLockPosRef.current = null
      const swung = turnAssembly(newRot[1] - item.rotation[1])
      if (swung) {
        updateItems(swung)
        return
      }
      const pushed = pushOutOverlaps(item.id, 8, linkedTo(item.id))
      const clamped = clampItemToBounds(item.id, collisionBounds)
      const keepSnap =
        !pushed && !clamped && snapConstraint != null && snapCorner == null && snapPointId == null
      const basePos: Vec3 = [
        group.position.x,
        group.position.y - colliderSize[1] / 2,
        group.position.z,
      ]
      const finalPos = keepSnap ? item.position : basePos
      updateItems([
        {
          id: item.id,
          patch: {
            rotation: newRot,
            ...(keepSnap ? {} : { position: finalPos, constraints: withSnapConstraint(item, null) }),
          },
        },
      ])
      return
    }

    transformLockPosRef.current = null
    pushOutOverlaps(item.id, 8, linkedTo(item.id))
    clampItemToBounds(item.id, collisionBounds)
    const newPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    let hit = findAnchorSnap(
      newPos,
      newRot[1],
      colliderSize,
      anchors,
      effectiveCatalogSnaps,
    )
    if (hit) {
      group.position.set(hit.position[0], hit.position[1] + colliderSize[1] / 2, hit.position[2])
      const pushed = pushOutOverlaps(item.id, 8, linkedTo(item.id))
      const clamped = clampItemToBounds(item.id, collisionBounds)
      if (pushed || clamped) hit = null
    }
    const finalPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    // Same as the pointer drag: the assembly takes one step, and the joins hold.
    const constraints = hit ? withSnapConstraint(item, snapHitConstraint(hit)) : item.constraints
    updateItems([
      { id: item.id, patch: { position: finalPos, rotation: newRot, constraints } },
      ...groupFollowPatches(finalPos, newRot[1]),
    ])
  }

  /**
   * The rest of this item's assembly, with the live positions it starts from.
   * A translate moves them all by the same step: re-deriving each pose from its
   * seat would reach the same place more slowly, and only rigid motion is sure
   * to leave every joint exactly as tight as it was.
   */
  const assemblyFollowers = (): Array<{ id: string; start: Vector3 }> => {
    const s = useConfiguratorStore.getState()
    const members = assemblyGroup(item.id, s.project?.items ?? [], s.project?.connections ?? [])
    const out: Array<{ id: string; start: Vector3 }> = []
    for (const id of members) {
      if (id === item.id) continue
      const reg = getItem(id)
      if (reg) out.push({ id, start: reg.group.position.clone() })
    }
    return out
  }

  /**
   * Live feedback mid-gesture: the rest of the frame put where this item's
   * current pose — turned as well as moved — has taken it. `true` when there
   * was a frame to move, which also means the single-part guards do not apply:
   * pushing this one member out or clamping it to the van would slide it off
   * the joints the others hold it by.
   *
   * Without this a turn showed the grabbed part swinging alone while the rest
   * stood still, and only the release put the frame back together.
   */
  const followLive = (): boolean => {
    if (!group) return false
    const s = useConfiguratorStore.getState()
    const members = assemblyGroup(item.id, s.project?.items ?? [], s.project?.connections ?? [])
    if (members.size < 2) return false
    // A frame turns about the upright axis only. Tipping it would lift half its
    // members off the floor, and the commit keeps each one's own pitch anyway —
    // so a pitch shown here would be a pitch taken back on release.
    /* eslint-disable react-hooks/immutability -- holding the live scene-graph node upright is the point */
    group.rotation.x = item.rotation[0]
    group.rotation.z = item.rotation[2]
    /* eslint-enable react-hooks/immutability */
    groupFollowPatches(
      [group.position.x, group.position.y - colliderSize[1] / 2, group.position.z],
      group.rotation.y,
    )
    return true
  }

  /**
   * A frame swung by `step` about this item, live groups included. `null` when
   * the item stands alone, which leaves the single-part rules — anchor snap
   * kept or dropped, push-out, clamp — exactly as they were.
   *
   * An assembly is exempt from those: pushing one member out or clamping it to
   * the van would move it away from the others, and the turn is what makes a
   * long frame fit in the first place. Validation still reports the result.
   */
  const turnAssembly = (step: number): Array<{ id: string; patch: Partial<PlacedItem> }> | null => {
    const s = useConfiguratorStore.getState()
    const items = s.project?.items ?? []
    const members = assemblyGroup(item.id, items, s.project?.connections ?? [])
    if (members.size < 2) return null
    const patches = rotateGroupPatches(items, members, item.position, step)
    for (const { id, patch } of patches) {
      const reg = getItem(id)
      if (!reg || !patch.position || !patch.rotation) continue
      reg.group.position.set(
        patch.position[0],
        patch.position[1] + (colliderSizeOf(id)?.[1] ?? 0) / 2,
        patch.position[2],
      )
      reg.group.rotation.set(patch.rotation[0], patch.rotation[1], patch.rotation[2])
      reg.group.updateWorldMatrix(true, false)
    }
    return patches
  }

  /**
   * The rest of the assembly brought along to the pose this item is committing
   * to, as patches, with their live groups moved to match. One rigid motion —
   * swung about this item, then carried to its new place — so a frame behaves
   * the same whether it was dragged, nudged by the gizmo, or snapped into a
   * seat, and no joint is stretched on the way.
   */
  const groupFollowPatches = (
    position: Vec3,
    yaw: number,
  ): Array<{ id: string; patch: Partial<PlacedItem> }> => {
    const s = useConfiguratorStore.getState()
    const items = s.project?.items ?? []
    const members = assemblyGroup(item.id, items, s.project?.connections ?? [])
    const swung = rotateGroupPatches(items, members, item.position, yaw - item.rotation[1])
    const patches: Array<{ id: string; patch: Partial<PlacedItem> }> = []
    for (const { id, patch } of swung) {
      if (id === item.id || !patch.position) continue
      const moved: Vec3 = [
        patch.position[0] + position[0] - item.position[0],
        patch.position[1] + position[1] - item.position[1],
        patch.position[2] + position[2] - item.position[2],
      ]
      const reg = getItem(id)
      if (reg) {
        reg.group.position.set(moved[0], moved[1] + (colliderSizeOf(id)?.[1] ?? 0) / 2, moved[2])
        if (patch.rotation) reg.group.rotation.set(patch.rotation[0], patch.rotation[1], patch.rotation[2])
        reg.group.updateWorldMatrix(true, false)
      }
      patches.push({ id, patch: { position: moved, rotation: patch.rotation } })
    }
    return patches
  }

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (useConfiguratorStore.getState().walkMode) return
    e.stopPropagation()
    if (!isSelected) select(item.id)
    if (readOnly) return
    if (!group) return
    ;(e.target as Element & { setPointerCapture?: (id: number) => void })
      .setPointerCapture?.(e.pointerId)

    // Drag plane at the group's current Y so translate stays on the same height.
    const plane = new Plane(new Vector3(0, 1, 0), -group.position.y)
    const initialHit = new Vector3()
    e.ray.intersectPlane(plane, initialHit)
    const grabOffset = new Vector3().subVectors(group.position, initialHit)

    dragRef.current = {
      mode: e.shiftKey ? 'rotate' : 'translate',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startRotX: group.rotation.x,
      startRotY: group.rotation.y,
      startPos: group.position.clone(),
      plane,
      grabOffset,
      started: false,
      snapLock: null,
      followers: assemblyFollowers(),
    }
  }

  // Mutating the Group's transform is how Three.js drives the scene graph;
  // the lint rule is correct that we're modifying a useState value, but in
  // this case the value IS a mutable scene-graph node by design.
  /* eslint-disable react-hooks/immutability */
  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d || !group) return
    const dx = e.clientX - d.startClientX
    const dy = e.clientY - d.startClientY
    if (!d.started) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      d.started = true
      setDraggingItemId(item.id)
    }
    if (d.mode === 'rotate') {
      updateConnectionPreview(null)
      group.position.copy(d.startPos)
      group.rotation.y = snapAngle(d.startRotY + dx * ROTATION_SENSITIVITY)
      group.rotation.x = snapAngle(d.startRotX + dy * ROTATION_SENSITIVITY)
      if (followLive()) return
      pushOutOverlaps(item.id, 8, linkedTo(item.id))
      clampItemToBounds(item.id, collisionBounds)
      return
    }
    if (!e.ray.intersectPlane(d.plane, _hit)) return
    group.position.x = _hit.x + d.grabOffset.x
    group.position.z = _hit.z + d.grabOffset.z
    // Y stays at the plane constant.

    // Grid snap (base step). Vertex snap below may override on engagement.
    const store = useConfiguratorStore.getState()
    if (store.snapToGridEnabled && store.gridStep > 0) {
      const s = store.gridStep
      group.position.x = Math.round(group.position.x / s) * s
      group.position.z = Math.round(group.position.z / s) * s
    }

    // Vertex snap with hysteresis. A held lock survives until the corner pair
    // drifts beyond RELEASE_RADIUS, then we look for a fresh pair within
    // ENGAGE_RADIUS. ENGAGE < RELEASE, so we don't oscillate at the threshold.
    if (d.snapLock) {
      const r = offsetForLockedCorners(
        item.id,
        d.snapLock.myCornerIdx,
        d.snapLock.otherId,
        d.snapLock.otherCornerIdx,
      )
      if (r && r.dist <= VERTEX_SNAP_RELEASE_RADIUS) {
        group.position.x += r.offset.x
        group.position.z += r.offset.z
      } else {
        d.snapLock = null
      }
    }
    if (!d.snapLock) {
      const snap = findNearestVertexSnap(item.id)
      if (snap) {
        group.position.x += snap.offset.x
        group.position.z += snap.offset.z
        d.snapLock = {
          myCornerIdx: snap.myCornerIdx,
          otherCornerIdx: snap.otherCornerIdx,
          otherId: snap.otherId,
        }
      }
    }

    // Resolve the joint first: a part on its way into a valid seat must not be
    // shoved back out by the collision push-out, or it can never get close
    // enough for the snap to engage. A valid preview has already been through
    // `validateConfiguration`, bounds included, so it needs neither guard.
    const preview = resolveConnectionPreview()
    updateConnectionPreview(preview)
    if (!preview?.valid) {
      // Hard collision constraints: separate from other products and keep the
      // collider inside the van/interior bounds. The rest of the assembly is
      // exempt: those parts share material with this one by design.
      pushOutOverlaps(item.id, 8, new Set(d.followers.map((f) => f.id)))
      clampItemToBounds(item.id, collisionBounds)
    }

    // Live: the whole assembly takes the same step — the mirrored half and
    // everything bolted on, however far down the chain.
    followLive()

    // Live clearance from enclosure walls (item AABB ↔ enclosure AABB).
    const bbox = store.enclosureBBox
    if (bbox) {
      const hx = colliderSize[0] / 2
      const hy = colliderSize[1] / 2
      const hz = colliderSize[2] / 2
      const px = group.position.x
      const py = group.position.y
      const pz = group.position.z
      store.setDragClearance({
        itemId: item.id,
        left: px - hx - bbox.min[0],
        right: bbox.max[0] - (px + hx),
        back: pz - hz - bbox.min[2],
        front: bbox.max[2] - (pz + hz),
        bottom: py - hy - bbox.min[1],
        top: bbox.max[1] - (py + hy),
      })
    }
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as Element & { releasePointerCapture?: (id: number) => void })
      .releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    if (!d.started) return // pure click — selection already handled in pointerdown
    setDraggingItemId(null)
    useConfiguratorStore.getState().setDragClearance(null)
    if (!group) return

    if (d.mode === 'rotate') {
      updateConnectionPreview(null)
      group.position.copy(d.startPos)
      const rx = snapAngle(group.rotation.x)
      const ry = snapAngle(group.rotation.y)
      group.rotation.x = rx
      group.rotation.y = ry
      const newRot: EulerTuple = [rx, ry, item.rotation[2]]
      const swung = turnAssembly(ry - item.rotation[1])
      if (swung) {
        updateItems(swung)
        return
      }
      const pushed = pushOutOverlaps(item.id, 8, linkedTo(item.id))
      const clamped = clampItemToBounds(item.id, collisionBounds)
      // In-place rotation: a corner/point snap would make the item orbit the
      // anchor. Any collision correction also invalidates the snap.
      const keepSnap =
        !pushed && !clamped && (snapConstraint == null || (snapCorner == null && snapPointId == null))
      const basePos: Vec3 = [
        group.position.x,
        group.position.y - colliderSize[1] / 2,
        group.position.z,
      ]
      updateItems([
        {
          id: item.id,
          patch: {
            rotation: newRot,
            ...(keepSnap
              ? {}
              : { position: basePos, constraints: withSnapConstraint(item, null) }),
          },
        },
      ])
      return
    }
    const preview = connectionPreviewRef.current
    if (preview?.valid) {
      group.position.set(
        preview.position[0],
        preview.position[1] + colliderSize[1] / 2,
        preview.position[2],
      )
      group.rotation.set(preview.rotation[0], preview.rotation[1], preview.rotation[2])
      const s = useConfiguratorStore.getState()
      const constraints = [
        ...(item.constraints?.filter((constraint) => constraint.type === 'mirrorPair') ?? []),
        itemSnapConstraintFor(preview.connection.targetItemId, preview.connection.sourcePointId, preview.connection.targetPointId),
      ]
      const patches = [
        { id: item.id, patch: { position: preview.position, rotation: preview.rotation, constraints } },
        ...groupFollowPatches(preview.position, preview.rotation[1]),
      ]
      const connections = dedupeJoints([
        ...jointsSurvivingMove(patches, s.project?.connections ?? []),
        ...preview.connections,
      ])
      s.commitAssembly(patches, connections)
      updateConnectionPreview(null)
      return
    }
    // Translate commit: resolve any residual AABB overlap (push along smaller
    // of X/Z), keep inside the van/interior bounds, then check for anchor snap.
    // The live vertex-snap has already aligned to a neighbour's corner if one
    // was close enough.
    const exempt = new Set(d.followers.map((f) => f.id))
    pushOutOverlaps(item.id, 8, exempt)
    clampItemToBounds(item.id, collisionBounds)
    const newPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    let hit = findAnchorSnap(
      newPos,
      item.rotation[1],
      colliderSize,
      anchors,
      effectiveCatalogSnaps,
    )
    if (hit) {
      group.position.set(hit.position[0], hit.position[1] + colliderSize[1] / 2, hit.position[2])
      const pushed = pushOutOverlaps(item.id, 8, exempt)
      const clamped = clampItemToBounds(item.id, collisionBounds)
      if (pushed || clamped) hit = null
    }
    const finalPos: Vec3 = [
      group.position.x,
      group.position.y - colliderSize[1] / 2,
      group.position.z,
    ]
    // The join survives a translate: nothing slid off its seat, the seat came
    // along. Only an anchor snap replaces it.
    const constraints = hit ? withSnapConstraint(item, snapHitConstraint(hit)) : item.constraints
    const patches = [
      { id: item.id, patch: { position: finalPos, constraints } },
      ...groupFollowPatches(finalPos, item.rotation[1]),
    ]
    const s = useConfiguratorStore.getState()
    const kept = jointsSurvivingMove(patches, s.project?.connections ?? [])
    if (kept.length !== (s.project?.connections ?? []).length) s.commitAssembly(patches, kept)
    else updateItems(patches)
    updateConnectionPreview(null)
  }
  const handlePointerCancel = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current
    if (!d) return
    ;(e.target as Element & { releasePointerCapture?: (id: number) => void })
      .releasePointerCapture?.(e.pointerId)
    dragRef.current = null
    setDraggingItemId(null)
    useConfiguratorStore.getState().setDragClearance(null)
    updateConnectionPreview(null)
  }
  /* eslint-enable react-hooks/immutability */

  return (
    <>
      <group
        ref={setGroup}
        onPointerDown={handlePointerDown}
        // eslint-disable-next-line react-hooks/immutability -- handler mutates group.position imperatively (three.js scene-graph)
        onPointerMove={handlePointerMove}
        // eslint-disable-next-line react-hooks/immutability -- handler snaps group.rotation imperatively before committing
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <group scale={mirrorScale}>
          <group
            position={[
              -bbox.center.x,
              -colliderSize[1] / 2 - bbox.min.y,
              -bbox.center.z,
            ]}
          >
            <primitive object={cloned} />
          </group>
        </group>
        {isSelected && !readOnly && (
          <mesh>
            <boxGeometry
              args={[colliderSize[0] * 1.05, colliderSize[1] * 1.05, colliderSize[2] * 1.05]}
            />
            <meshBasicMaterial
              wireframe
              color={isOverlapping ? '#ff4040' : snappedAnchor ? '#33ff88' : '#ffcc33'}
            />
          </mesh>
        )}
        {!isSelected && isOverlapping && (
          <mesh>
            <boxGeometry
              args={[colliderSize[0] * 1.05, colliderSize[1] * 1.05, colliderSize[2] * 1.05]}
            />
            <meshBasicMaterial wireframe color="#ff4040" />
          </mesh>
        )}
        {isSelected && <SnapPointMarkers points={effectiveCatalogSnaps} />}
      </group>

      {isSelected && group && !readOnly && (
        <TransformControls
          object={group as Object3D}
          mode={gizmoMode}
          size={MathUtils.clamp(Math.max(...colliderSize) * 4, 0.05, 0.3)}
          rotationSnap={ROTATION_STEP}
          onMouseDown={() => {
            transformLockPosRef.current = gizmoMode === 'rotate' ? group.position.clone() : null
          }}
          // eslint-disable-next-line react-hooks/immutability -- handler drives group transforms imperatively (three.js scene-graph)
          onObjectChange={() => {
            if (gizmoMode === 'rotate' && transformLockPosRef.current) {
              group.position.copy(transformLockPosRef.current)
            }
            // The gizmo drags one object; the frame it belongs to comes along
            // every frame, or it only catches up on release.
            if (followLive()) return
            pushOutOverlaps(item.id, 8, linkedTo(item.id))
            clampItemToBounds(item.id, collisionBounds)
          }}
          onMouseUp={handleTransformEnd}
        />
      )}
      {connectionPreview && (
        <mesh
          position={[
            connectionPreview.position[0],
            connectionPreview.position[1] + colliderSize[1] / 2,
            connectionPreview.position[2],
          ]}
          rotation={connectionPreview.rotation}
          renderOrder={1001}
        >
          <boxGeometry args={[colliderSize[0] * 1.04, colliderSize[1] * 1.04, colliderSize[2] * 1.04]} />
          <meshBasicMaterial
            wireframe
            transparent
            opacity={0.7}
            depthTest={false}
            color={connectionPreview.valid ? '#33ff88' : '#ff4040'}
          />
        </mesh>
      )}
    </>
  )
}

/**
 * Snap points of the selected item, drawn as one instanced mesh.
 *
 * A perforated shelf publishes ~750 points; one `<mesh>` each would mean that
 * many draw calls, geometries and materials. Instancing keeps it to one of
 * each. The instance count is baked into the buffer at construction, so the
 * `key` forces a fresh mesh whenever it changes.
 */
function SnapPointMarkers({ points }: { points: ItemSnapPoint[] }) {
  const ref = useRef<InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new Matrix4()
    points.forEach((p, i) => {
      m.makeTranslation(p.position[0], p.position[1], p.position[2])
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [points])

  if (points.length === 0) return null
  return (
    <instancedMesh
      key={points.length}
      ref={ref}
      args={[undefined, undefined, points.length]}
      renderOrder={1001}
      frustumCulled={false}
    >
      <sphereGeometry args={[SNAP_POINT_MARKER_RADIUS, 8, 8]} />
      <meshBasicMaterial
        color="#00d5ff"
        transparent
        opacity={0.9}
        depthTest={false}
        toneMapped={false}
      />
    </instancedMesh>
  )
}
