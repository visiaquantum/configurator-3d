import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const example = join(root, 'examples/react-integration')
const fixture = JSON.parse(await readFile(join(example, 'public/catalog/project.json'), 'utf8'))
const catalog = JSON.parse(await readFile(join(example, 'public/catalog/catalog.json'), 'utf8'))

// Preserve each URL's path so the example also works when copied out of this repo.
for (const path of [fixture.enclosure.glbUrl, ...catalog.items.map((product) => product.glbUrl)]) {
  const destination = join(example, 'public', path)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(join(root, 'public', path), destination)
}

const cache = join(root, 'node_modules/.cache/integration-npm')
await mkdir(cache, { recursive: true })
const temporary = await mkdtemp(join(cache, 'pack-'))
try {
  const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--cache', cache, '--pack-destination', temporary], { cwd: root, encoding: 'utf8' })
  const [packed] = JSON.parse(output)
  await mkdir(join(example, 'vendor'), { recursive: true })
  await copyFile(join(temporary, packed.filename), join(example, 'vendor/configurator-3d.tgz'))
} finally {
  await rm(temporary, { recursive: true, force: true })
}

// The example's lockfile pins the tarball's integrity and peer ranges. npm does
// not refresh them for an unchanged `file:` version, so the delivered `npm ci`
// would reject the package just packed: write them from the tarball itself.
const tarball = await readFile(join(example, 'vendor/configurator-3d.tgz'))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const lockPath = join(example, 'package-lock.json')
const lock = JSON.parse(await readFile(lockPath, 'utf8'))
const entry = lock.packages[`node_modules/${manifest.name}`]
entry.version = manifest.version
entry.integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
entry.peerDependencies = manifest.peerDependencies
if (manifest.peerDependenciesMeta) entry.peerDependenciesMeta = manifest.peerDependenciesMeta
else delete entry.peerDependenciesMeta
await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`)

console.log('Esempio pronto in examples/react-integration: libreria installabile e quattro GLB inclusi.')
