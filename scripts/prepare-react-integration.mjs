import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
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

console.log('Esempio pronto in examples/react-integration: libreria installabile e quattro GLB inclusi.')
