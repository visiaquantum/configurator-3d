import type { AssemblyManifest, CatalogItem, Connection, EnclosureData, ItemRule, ItemSnapPoint, PlacedItem, ProjectData, Vec3 } from './lib'
import { computePartnerPlacement, connectionsAtPose, positionForItemSnap, snapsForItem, yawToMate } from './lib'
import { worldPoint } from './lib/scene/geometry'

// Syncro modular wall (quote 99003819, Alberto Tasca): a pair of side panels
// drilled every 36 mm, and parts bolted between them. Every hole, and every
// part height, is a multiple of this pitch.
const PITCH = 0.036
/** Side panel thickness; the parts' ends sit inside its C profile. */
const SIDE_THICKNESS = 0.029
/** The hole axis runs 17 mm inside the panel's outer face. */
const HOLE_INSET = 0.017
/** Outer face to outer face of a 1014 mm bay. */
export const BAY_WIDTH = 1.014
/** A part's ends sit in opposite holes: the bay width less both insets. */
const END_OFFSET = BAY_WIDTH / 2 - HOLE_INSET

const round = (value: number) => Math.round(value * 1e5) / 1e5
/**
 * The GLBs come straight from CAD, so contact points are read off the model
 * in its own coordinates; the catalogue wants them in the collider frame,
 * whose origin is the centre of the visible body.
 */
const fromGlb = (center: Vec3) => (point: Vec3): Vec3 => point.map((value, i) => round(value - center[i])) as Vec3

/**
 * One side panel. The GLB is the outer half of the pair: X runs back (0) to
 * front, Y up from the floor, the outer face at Z = 0 and the twin towards -Z.
 * The CAD export names the mirror rule (`RULE_MIRRORPAIR_D254.507…`) but
 * cannot orient it, hence `mirrorPair.axis`.
 *
 * Holes face the twin (-Z): a part's end, whose normal points outward, turns
 * a quarter turn to meet them and ends up with its front on the panel's front.
 * The back column has its own kind so only the angle bars take it. The stack
 * points carry horizontal normals on purpose: a panel set on another keeps its
 * orientation instead of being left to the user.
 */
function sidePanel(id: string, label: string, glbUrl: string, depth: number, height: number): CatalogItem {
  const local = fromGlb([depth / 2, height / 2, -SIDE_THICKNESS / 2])
  const column = (side: string, x: number, kind: string, name: string): ItemSnapPoint[] =>
    Array.from({ length: Math.round(height / PITCH) }, (_, k) => ({
      id: `${side}-${k + 1}`,
      label: `${name} ${k + 1}`,
      kind,
      position: local([x, PITCH / 2 + k * PITCH, -HOLE_INSET]),
      normal: [0, 0, -1],
    }))
  return {
    id, label, glbUrl, size: [depth, height, SIDE_THICKNESS], scale: 1,
    mirrorPair: { axis: [0, 0, -1] },
    snapPoints: [
      ...column('front', depth + 0.0005, 'frontale', 'Foro anteriore'),
      ...column('back', -0.0005, 'posteriore', 'Foro posteriore'),
      { id: 'stack-bottom', label: 'Base su fianco', kind: 'sovrapposizione', position: local([depth, 0, 0]), normal: [0, 0, 1] },
      { id: 'stack-top', label: 'Testa per fianco', kind: 'sovrapposizione', position: local([depth, height, 0]), normal: [0, 0, -1] },
      { id: 'top', label: 'Appoggio superiore', kind: 'appoggio', position: local([depth, height, -HOLE_INSET]), normal: [0, 0, -1] },
    ],
  }
}

/**
 * A part bolted across the bay: X is its width, +Z its front. `mount` is the
 * height and depth, in GLB coordinates, of the point that sits on a front
 * hole — the CAD `SNAP_FRONTALE` markers, which follow the drawer slide
 * rather than the drawer body.
 */
function bayPart(id: string, label: string, glbUrl: string, size: Vec3, center: Vec3, mount: [y: number, z: number], kind = 'frontale'): CatalogItem {
  const local = fromGlb(center)
  const [y, z] = mount
  return {
    id, label, glbUrl, size, scale: 1,
    snapPoints: [
      { id: 'end-a', label: 'Estremità sinistra', kind, position: local([-END_OFFSET, y, z]), normal: [-1, 0, 0] },
      { id: 'end-b', label: 'Estremità destra', kind, position: local([END_OFFSET, y, z]), normal: [1, 0, 0] },
    ],
  }
}

const XLA_CENTER: Vec3 = [-0.022, 0, 0]

export const TASCA_CATALOG_GROUPS: Array<{ category: string; items: CatalogItem[] }> = [
  {
    category: 'Parete 1014 · Fianchi',
    items: [
      sidePanel('ysi03036', 'Fianco YSI 03036 · 1080', '/models/MONTANTI/YSI03036.glb', 0.363, 1.08),
      sidePanel('ysi01131', 'Fianco YSI 01131 · 396', '/models/MONTANTI/YSI01131.glb', 0.313, 0.396),
    ],
  },
  {
    category: 'Parete 1014 · Cassetti e ripiani',
    items: [
      bayPart('kdw40236', 'Cassetto KDW 40236 · h64', '/models/ORIZZONTALI/KDW40236.glb', [1.0107, 0.0714, 0.3698], [0, 0.0297, -0.0009], [0.0119, 0.1798]),
      bayPart('kdw40336', 'Cassetto KDW 40336 · h100', '/models/ORIZZONTALI/KDW40336.glb', [1.0107, 0.1063, 0.3698], [0, 0.0471, -0.0009], [0.0454, 0.1798]),
      bayPart('kdw40436', 'Cassetto KDW 40436 · h136', '/models/ORIZZONTALI/KDW40436.glb', [1.0107, 0.141, 0.3698], [0, 0.0644, -0.0009], [0.0454, 0.1798]),
      bayPart('kdw40636', 'Cassetto KDW 40636 · h208', '/models/ORIZZONTALI/KDW40636.glb', [1.0107, 0.213, 0.3698], [0, 0.1004, -0.0009], [0.0814, 0.1798]),
      bayPart('kcp40531kmd02', 'Ripiano KCP 40531 KMD02', '/models/ORIZZONTALI/KCP40531KMD02.glb', [1.01, 0.1803, 0.307], [0, 0.0886, 0.0005], [0.015, 0.1535]),
      bayPart('kma40100', 'Angolare KMA 40100', '/models/ORIZZONTALI/KMA40100.glb', [1.007, 0.0687, 0.058], [0, -0.0333, 0], [-0.018, 0.0228]),
      {
        // The light angle is modelled lengthwise on Z with its face on +X: its
        // +Z end goes on the outer panel, which keeps the face forward.
        id: 'xla40400', label: 'Angolare leggero XLA 40400', glbUrl: '/models/ORIZZONTALI/XLA40400.glb', size: [0.051, 0.142, 1.006], scale: 1,
        snapPoints: [
          { id: 'end-a', label: 'Estremità sinistra', kind: 'frontale', position: fromGlb(XLA_CENTER)([0.003, -0.0545, END_OFFSET]), normal: [0, 0, 1] },
          { id: 'end-b', label: 'Estremità destra', kind: 'frontale', position: fromGlb(XLA_CENTER)([0.003, -0.0545, -END_OFFSET]), normal: [0, 0, -1] },
        ],
      },
      // Spans the full bay and rests on the panels' heads, front flush.
      bayPart('kdu40426kd080', 'Cassettiera KDU 40426 KD080', '/models/ORIZZONTALI/KDU40426KD080.glb', [1.014, 0.144, 0.2642], [0, 0.072, -0.1308], [0, 0], 'appoggio'),
    ],
  },
  {
    category: 'Parete 1014 · Antine',
    items: [
      bayPart('kld41000', 'Antina inferiore KLD 41000', '/models/ANTINE/KLD41000.glb', [1.0114, 0.3777, 0.2416], [0, 0.1758, -0.0598], [0.3403, 0]),
      bayPart('kud40900', 'Antina superiore KUD 40900', '/models/ANTINE/KUD40900.glb', [1.0105, 0.3207, 0.1385], [0, 0.1591, -0.0669], [0.1952, -0.0018]),
    ],
  },
]

/** IVECO Daily 2014 L2H3: modelled in metres, cargo box only. */
export const IVECO_ENCLOSURE: EnclosureData = {
  glbUrl: '/models/IVECO-DL14L2SH3.glb',
  scale: 1,
  dimensions: [1.81, 2.097, 3.197],
  // The model's own floor markers (`SNAP_TERRA`) are not anchor nodes.
  anchors: [
    { id: 'pavimento-dx', position: [0.845, 0.012, 1.211], normal: [0, 1, 0] },
    { id: 'pavimento-sx', position: [-0.845, 0.012, 1.211], normal: [0, 1, 0] },
  ],
}

interface Placement {
  catalogId: string
  /** Point of the part, then the panel and its point it lands on. */
  point: string
  on: string
  at: string
}

/**
 * The element outlined on page 17 of the quote, bottom to top. Lower panels
 * (30 holes): one pitch free above the floor, the lower door (10), drawers of
 * 6, 4, 3 and 2 pitches, the light angle (4). Upper panels (11 holes): the
 * angle bar pair (2), the upper door (9). The MultiBox rests on top.
 */
const TASCA_WALL: Array<Placement & { id: string }> = [
  { id: 'antina-inferiore', catalogId: 'kld41000', point: 'end-a', on: 'fianco-basso', at: 'front-11' },
  { id: 'cassetto-208', catalogId: 'kdw40636', point: 'end-a', on: 'fianco-basso', at: 'front-14' },
  { id: 'cassetto-136', catalogId: 'kdw40436', point: 'end-a', on: 'fianco-basso', at: 'front-19' },
  { id: 'cassetto-100', catalogId: 'kdw40336', point: 'end-a', on: 'fianco-basso', at: 'front-23' },
  { id: 'cassetto-64', catalogId: 'kdw40236', point: 'end-a', on: 'fianco-basso', at: 'front-25' },
  { id: 'angolare-leggero', catalogId: 'xla40400', point: 'end-a', on: 'fianco-basso', at: 'front-27' },
  { id: 'angolare-anteriore', catalogId: 'kma40100', point: 'end-a', on: 'fianco-alto', at: 'front-2' },
  { id: 'angolare-posteriore', catalogId: 'kma40100', point: 'end-b', on: 'fianco-alto', at: 'back-2' },
  { id: 'antina-superiore', catalogId: 'kud40900', point: 'end-a', on: 'fianco-alto', at: 'front-8' },
  { id: 'cassettiera', catalogId: 'kdu40426kd080', point: 'end-a', on: 'fianco-alto', at: 'top' },
]

export interface WallContext {
  catalog: CatalogItem[]
  manifest: AssemblyManifest
  /** Hydrated product rules: the panels' mirror rule comes from their GLB. */
  itemRules: Record<string, ItemRule[]>
  itemSnaps: Record<string, ItemSnapPoint[]>
}

/**
 * What the editor learns once the GLBs hydrate, without loading them: every
 * seat the wall uses is declared by the catalogue, and the panels' mirror
 * rule node sits at the GLB origin, the outer bottom back corner.
 */
export function tascaWallContext(catalog: CatalogItem[], manifest: AssemblyManifest): WallContext {
  return {
    catalog,
    manifest,
    itemSnaps: Object.fromEntries(catalog.map((product) => [product.id, product.snapPoints ?? []])),
    itemRules: Object.fromEntries(catalog.filter((product) => product.mirrorPair?.axis && product.size).map((product) => {
      const [x, y, z] = product.size!
      return [product.id, [{ rule: 'mirror-pair', position: [-x / 2, -y / 2, z / 2], axis: product.mirrorPair!.axis!, params: {} }]]
    })),
  }
}

/**
 * Compose the quoted wall out of single products with the same math the drag
 * uses, so the result is what a user would get by hand: the outer lower panel
 * stands in the van's back right corner, everything else is mated from it.
 */
export function buildTascaWall(context: WallContext, enclosure: EnclosureData = IVECO_ENCLOSURE): ProjectData {
  const catalog = Object.fromEntries(context.catalog.map((product) => [product.id, product]))
  const heightOf = (item: PlacedItem) => catalog[item.catalogId].size?.[1] ?? 0
  const pointOf = (item: PlacedItem, id: string) => {
    const point = snapsForItem(item, context.itemSnaps, context.itemRules).find((p) => p.id === id)
    if (!point) throw new Error(`Punto ${id} mancante su ${item.catalogId}`)
    return point
  }
  const items: PlacedItem[] = []
  const byId = (id: string) => items.find((item) => item.id === id)!

  const mate = (id: string, { catalogId, point, on, at }: Placement) => {
    const target = byId(on)
    const draft: PlacedItem = { id, catalogId, position: [0, 0, 0], rotation: [0, 0, 0] }
    const mine = pointOf(draft, point)
    const theirs = pointOf(target, at)
    const yaw = yawToMate(mine.normal, theirs.normal, target.rotation[1])
    if (yaw === null) throw new Error(`${id} non trova un orientamento su ${on}:${at}`)
    const position = positionForItemSnap(mine.position, yaw, heightOf(draft), worldPoint(target, theirs.position, heightOf(target)))
    const item: PlacedItem = { ...draft, position, rotation: [0, yaw, 0] }
    items.push(item)
    return item
  }

  const pairUp = (half: PlacedItem, twinId: string) => {
    const rule = context.itemRules[half.catalogId]?.find((r) => r.rule === 'mirror-pair')
    if (!rule) throw new Error(`${half.catalogId} non dichiara la coppia specchiata`)
    const twin = computePartnerPlacement(half, rule, BAY_WIDTH)
    half.constraints = [{ type: 'mirrorPair', target: twinId, distance: BAY_WIDTH }]
    items.push({ id: twinId, catalogId: half.catalogId, ...twin, constraints: [{ type: 'mirrorPair', target: half.id, distance: BAY_WIDTH }] })
  }

  // The outer panel turns its front towards the aisle (-X); its twin, at +Z,
  // takes the corner the van marks with its right floor anchor.
  const anchor = enclosure.anchors?.find((a) => a.id === 'pavimento-dx')?.position ?? [0.845, 0.012, 1.211]
  const lower: PlacedItem = { id: 'fianco-basso', catalogId: 'ysi03036', position: [0, 0, 0], rotation: [0, Math.PI, 0] }
  const corner = fromGlb([0.1815, 0.54, -0.0145])([0, 0, 0])
  lower.position = positionForItemSnap(corner, Math.PI, heightOf(lower), [anchor[0], anchor[1], anchor[2] - BAY_WIDTH])
  items.push(lower)
  pairUp(lower, 'fianco-basso-specchiato')
  pairUp(mate('fianco-alto', { catalogId: 'ysi01131', point: 'stack-bottom', on: 'fianco-basso', at: 'stack-top' }), 'fianco-alto-specchiato')
  for (const { id, ...placement } of TASCA_WALL) mate(id, placement)

  // Bolt every part wherever its points meet a panel, twins included. Parts
  // hang from the panels and upper panels from lower ones; a panel's holes
  // also see the parts, but that is the same joint the other way round.
  const isPanel = (id: string) => byId(id).catalogId.startsWith('ysi')
  const connections: Connection[] = items
    .flatMap((item) => connectionsAtPose(item, item, { items, itemSnaps: context.itemSnaps, itemRules: context.itemRules, manifest: context.manifest, heightOf }))
    .filter((joint) => !isPanel(joint.sourceItemId) || joint.sourcePointId === 'stack-bottom')

  return {
    id: 'tasca-99003819',
    version: 1,
    enclosure,
    items,
    connections,
    metadata: { name: 'Parete 1014 — preventivo 99003819', customer: 'Alberto Tasca · Syncro Cassola' },
  }
}
