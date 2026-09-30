/**
 * Headless check of the product snap-point pipeline.
 *
 * Part 1 runs the extractor over a synthetic product whose marker layout is
 * known, so ids, kinds, normals, the mating table and the join geometry can be
 * asserted exactly. Part 2 runs it over the real customer GLBs and prints what
 * comes out, which is how the `SNAP_..._N` de-duplication suffix and the
 * edge-marker normal ambiguity were caught.
 *
 * Reads from `dist/`, so run `npm run build:lib` first.
 *   npm run verify:snaps
 */
import { readFileSync } from 'node:fs'
import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  extractRulesFromObject,
  extractAutoSnapGridFromObject,
  extractItemSnapsFromObject,
  positionForItemSnap,
  canMate,
  snapPointLabel,
  yawToMate,
} from '../dist/configurator-3d.js'

const load = (p) =>
  new Promise((res, rej) => {
    const buf = readFileSync(p)
    new GLTFLoader().parse(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      '',
      (g) => res(g),
      rej,
    )
  })

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name, extra) }
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e

// --- fake product: upright 0.36 x 1.008 x 0.03, markers on its faces --------
const root = new Group()
const body = new Mesh(new BoxGeometry(0.36, 1.008, 0.03), new MeshBasicMaterial())
root.add(body)
const marker = (name, x, y, z) => {
  const m = new Mesh(new BoxGeometry(0.001, 0.001, 0.001), new MeshBasicMaterial())
  m.name = name
  m.position.set(x, y, z)
  root.add(m)
  return m
}
// three FRONTALE on the +Z face, one TERRA on the -Y face, one LATERALE on -X
marker('SNAP_FRONTALE-1', 0, 0.30, 0.015)
marker('SNAP_FRONTALE-2', 0, 0.00, 0.015)
marker('SNAP_FRONTALE-3', 0, -0.30, 0.015)
marker('SNAP_TERRA-7', 0, -0.504, 0)
marker('SNAP_LATERALE-7', -0.18, 0, 0)
root.updateMatrixWorld(true)

const pts = extractItemSnapsFromObject(root).map((e) => e.extracted)

console.log('\n[1] estrazione punti snap')
ok('5 punti trovati', pts.length === 5, `-> ${pts.length}`)
const ids = pts.map((p) => p.id)
ok('id univoci (era il bug di KIT01)', new Set(ids).size === 5, JSON.stringify(ids))
ok('frontale numerato', ['frontale-1','frontale-2','frontale-3'].every((i) => ids.includes(i)), JSON.stringify(ids))
ok('kind separato dall id', pts.filter((p) => p.kind === 'frontale').length === 3)
ok('punto unico tiene id nudo', ids.includes('terra') && ids.includes('laterale'), JSON.stringify(ids))

console.log('\n[2] normali di faccia')
const terra = pts.find((p) => p.id === 'terra')
const lat = pts.find((p) => p.id === 'laterale')
const fr1 = pts.find((p) => p.id === 'frontale-1')
ok('terra -> -Y', JSON.stringify(terra.normal) === '[0,-1,0]', JSON.stringify(terra.normal))
ok('laterale -> -X', JSON.stringify(lat.normal) === '[-1,0,0]', JSON.stringify(lat.normal))
ok('frontale -> +Z', JSON.stringify(fr1.normal) === '[0,0,1]', JSON.stringify(fr1.normal))

console.log('\n[3] compatibilita')
ok('frontale <-> foro', canMate('frontale', 'foro'))
ok('laterale <-> laterale', canMate('laterale', 'laterale'))
ok('terra NON con frontale', !canMate('terra', 'frontale'))
ok('origine non accoppia', !canMate('origine', 'frontale'))

console.log('\n[4] etichette')
ok('foro leggibile', snapPointLabel({ id: 'auto-grid-zmax-r3-c2', kind: 'foro', position: [0,0,0] }) === 'Foro r3 c2',
   snapPointLabel({ id: 'auto-grid-zmax-r3-c2', kind: 'foro', position: [0,0,0] }))
ok('frontale numerato', snapPointLabel({ id: 'frontale-2', kind: 'frontale', position: [0,0,0] }) === 'Facciata 2')
ok('terra', snapPointLabel({ id: 'terra', kind: 'terra', position: [0,0,0] }) === 'Base a terra')

console.log('\n[5] geometria dell aggancio')
// my point sits at local (0.1, 0.2, 0.05); collider is 1.0 tall.
// After the snap that point must land exactly on the target, whatever the yaw.
const myPoint = [0.1, 0.2, 0.05]
const H = 1.0
const target = [2.0, 0.7, -3.0]
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
  const base = positionForItemSnap(myPoint, yaw, H, target)
  // reproduce where the point ends up: group centre = base + H/2, then rotate the local offset by yaw
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const wx = base[0] + (myPoint[0] * c + myPoint[2] * s)
  const wy = base[1] + H / 2 + myPoint[1]
  const wz = base[2] + (-myPoint[0] * s + myPoint[2] * c)
  ok(`punto sul bersaglio con yaw=${yaw.toFixed(2)}`,
     near(wx, target[0]) && near(wy, target[1]) && near(wz, target[2]),
     `-> ${[wx, wy, wz].map((v) => v.toFixed(4))}`)
}


console.log('\n--- GLB reali del catalogo ---')


for (const p of ['public/models/MONTANTI/YSI12836.glb', 'public/models/KIT/KIT01.glb']) {
  const gltf = await load(p)
  gltf.scene.updateMatrixWorld(true)
  const pts = extractItemSnapsFromObject(gltf.scene).map((e) => e.extracted)
  console.log('\n===== ' + p)
  for (const q of pts) {
    console.log(
      '  id=' + q.id.padEnd(16),
      'kind=' + q.kind.padEnd(16),
      'pos=' + q.position.map((v) => v.toFixed(3)).join(','),
      'n=' + (q.normal ? q.normal.join(',') : '—'),
    )
  }
  const ids = pts.map((q) => q.id)
  console.log('  -> id univoci:', new Set(ids).size === ids.length ? 'SI' : 'NO ***')
}

console.log('\n[6] orientamento dell incastro')
const rotY = (v, y) => {
  const c = Math.cos(y), s = Math.sin(y)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}
// After the mate, my face must point straight into the target's face.
for (const [mine, theirs, theirYaw] of [
  [[0, 0, 1], [1, 0, 0], 0],
  [[0, 0, 1], [-1, 0, 0], 0],
  [[1, 0, 0], [1, 0, 0], 0],
  [[0, 0, -1], [0, 0, 1], 0],
  [[1, 0, 0], [1, 0, 0], Math.PI / 2],
]) {
  const yaw = yawToMate(mine, theirs, theirYaw)
  const tw = rotY(theirs, theirYaw)
  const mw = yaw === null ? null : rotY(mine, yaw)
  const opposed = mw && near(mw[0], -tw[0], 1e-9) && near(mw[2], -tw[2], 1e-9)
  ok(`facce opposte: mia ${JSON.stringify(mine)} vs ${JSON.stringify(theirs)} @${theirYaw.toFixed(2)}`,
     !!opposed, `yaw=${yaw} mia_mondo=${mw && mw.map(v => v.toFixed(2))}`)
}
ok('faccia verticale -> nessuna rotazione possibile', yawToMate([0, 1, 0], [1, 0, 0], 0) === null)
ok('bersaglio verticale -> nessuna rotazione possibile', yawToMate([1, 0, 0], [0, -1, 0], 0) === null)
ok('normale mancante -> null', yawToMate(undefined, [1, 0, 0], 0) === null)

console.log('\n[7] incastro montante + orizzontale, sui GLB veri')
{
  const upright = await load('public/models/MONTANTI/YSI12836.glb')
  const shelf = await load('public/models/ORIZZONTALI/XDS40231KM02.glb')
  upright.scene.updateMatrixWorld(true)
  shelf.scene.updateMatrixWorld(true)

  const uprightRules = extractRulesFromObject(upright.scene).map((r) => r.extracted)
  const holes = extractAutoSnapGridFromObject(upright.scene, uprightRules)
  const shelfPts = extractItemSnapsFromObject(shelf.scene).map((e) => e.extracted)
  const shelfFront = shelfPts.find((p) => p.kind === 'frontale')

  ok('il montante espone fori', holes.length > 0, String(holes.length))
  ok('l orizzontale espone una facciata', !!shelfFront)
  ok('foro e facciata sono compatibili', shelfFront && canMate(shelfFront.kind, holes[0].kind))

  // Pick a hole whose face is vertical, i.e. one a shelf can actually mate to.
  const hole = holes.find((h) => h.normal && Math.hypot(h.normal[0], h.normal[2]) > 0.5)
  ok('esiste un foro su faccia verticale', !!hole, JSON.stringify(holes[0]?.normal))

  if (hole && shelfFront && shelfFront.normal) {
    const yaw = yawToMate(shelfFront.normal, hole.normal, 0)
    ok('rotazione di incastro trovata', yaw !== null, `normali: mensola=${JSON.stringify(shelfFront.normal)} foro=${JSON.stringify(hole.normal)}`)
    if (yaw !== null) {
      const mw = rotY(shelfFront.normal, yaw)
      ok('mensola rivolta contro il montante',
         near(mw[0], -hole.normal[0], 1e-9) && near(mw[2], -hole.normal[2], 1e-9),
         JSON.stringify(mw))

      // The shelf point must land exactly on the hole after the move.
      const H = 0.07
      const target = [hole.position[0], hole.position[1], hole.position[2]]
      const base = positionForItemSnap(shelfFront.position, yaw, H, target)
      const c = Math.cos(yaw), sn = Math.sin(yaw)
      const wx = base[0] + (shelfFront.position[0] * c + shelfFront.position[2] * sn)
      const wy = base[1] + H / 2 + shelfFront.position[1]
      const wz = base[2] + (-shelfFront.position[0] * sn + shelfFront.position[2] * c)
      ok('facciata della mensola esattamente sul foro',
         near(wx, target[0]) && near(wy, target[1]) && near(wz, target[2]),
         `-> ${[wx, wy, wz].map((v) => v.toFixed(4))} vs ${target.map((v) => v.toFixed(4))}`)
    }
  }
}

console.log(`\n=== ${pass} pass, ${fail} fail ===`)
process.exit(fail ? 1 : 0)
