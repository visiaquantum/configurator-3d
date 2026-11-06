// Product previews rendered from the GLBs themselves, in headless Chromium
// with software WebGL (the same setup as the end-to-end tests). One PNG per
// file content: a preview is regenerated only when its GLB changes.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const THREE_DIR = join(dirname(require.resolve('three')), '..')
const HOST = 'http://catalog.preview'

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"${HOST}/three/build/three.module.js","three/addons/":"${HOST}/three/examples/jsm/"}}</script>
</head><body style="margin:0"><script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
const W = 136, H = 124
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true })
renderer.setPixelRatio(1)
renderer.setSize(W, H)
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.append(renderer.domElement)
window.renderPreview = async (url) => {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight('#ffffff', '#9ba4b1', 1.2))
  const key = new THREE.DirectionalLight('#ffffff', 2); key.position.set(4, 6, 5); scene.add(key)
  const fill = new THREE.DirectionalLight('#dce8ff', 0.8); fill.position.set(-4, 3, -4); scene.add(fill)
  const { scene: model } = await new GLTFLoader().loadAsync(url)
  model.traverse((node) => {
    if (/^(snap|rule|anchor)[_:]/i.test(node.name)) node.visible = false
    if (node.isMesh) for (const material of [node.material].flat()) { material.metalness = 0.25; material.roughness = 0.58; material.color?.set('#8796a8') }
  })
  const box = new THREE.Box3()
  model.updateMatrixWorld(true)
  model.traverseVisible((node) => { if (node.isMesh) box.union(new THREE.Box3().setFromObject(node)) })
  const size = box.getSize(new THREE.Vector3())
  model.position.sub(box.getCenter(new THREE.Vector3()))
  scene.add(model)
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.001, 1000)
  const direction = new THREE.Vector3(1.6, 1.05, 1.6).normalize()
  camera.position.copy(direction); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true)
  const view = camera.quaternion.clone().invert()
  const viewBox = new THREE.Box3()
  for (const x of [-size.x / 2, size.x / 2]) for (const y of [-size.y / 2, size.y / 2]) for (const z of [-size.z / 2, size.z / 2]) viewBox.expandByPoint(new THREE.Vector3(x, y, z).applyQuaternion(view))
  const viewSize = viewBox.getSize(new THREE.Vector3())
  const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const distance = Math.max(viewSize.y / (2 * halfFov), viewSize.x / (2 * halfFov * camera.aspect)) * 1.08 + viewSize.z / 2
  camera.position.copy(direction.multiplyScalar(distance)); camera.lookAt(0, 0, 0)
  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}
window.previewReady = true
</script></body></html>`

/**
 * Render a PNG for each `{ file, sha256 }` of `modelsDir` whose preview
 * `previewPath(asset)` does not exist yet. Returns the assets rendered.
 */
export async function renderPreviews(assets, modelsDir, previewPath, exists) {
  const todo = []
  for (const asset of assets) if (!await exists(previewPath(asset))) todo.push(asset)
  if (!todo.length) return []
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    const page = await browser.newPage()
    await page.route(`${HOST}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: PAGE })
      if (path.startsWith('/three/')) return route.fulfill({ contentType: 'text/javascript', body: await readFile(join(THREE_DIR, path.slice('/three/'.length))) })
      if (path.startsWith('/models/')) return route.fulfill({ contentType: 'model/gltf-binary', body: await readFile(join(modelsDir, decodeURIComponent(path.slice('/models/'.length)))) })
      return route.fulfill({ status: 404, body: '' })
    })
    await page.goto(`${HOST}/`)
    await page.waitForFunction(() => globalThis.previewReady === true)
    const rendered = []
    for (const asset of todo) {
      const dataUrl = await page.evaluate((url) => globalThis.renderPreview(url), `${HOST}/models/${encodeURI(asset.file)}`)
      rendered.push({ asset, png: Buffer.from(dataUrl.split(',')[1], 'base64') })
    }
    return rendered
  } finally {
    await browser.close()
  }
}
