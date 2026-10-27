import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { resolve } from 'node:path'

// Match these as externals in lib mode. Includes the package name itself plus
// any subpath imports (e.g. `three/examples/jsm/exporters/GLTFExporter.js`).
const PEERS = [
  'react',
  'react-dom',
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'zustand',
  'zod',
  'nanoid',
  'jspdf',
]
const externalPattern = new RegExp(
  `^(${PEERS.map((p) => p.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|')})(\\/|$)`,
)

// Two modes:
//  - default (dev / build:demo): serves/builds demo host app
//  - --mode lib (build:lib): produces consumable library bundle
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [
        react(),
        // `tsconfigPath` is required: the root tsconfig.json is a solution file
        // (`files: []` + project references), so the plugin would find no input
        // files and emit an empty `index.d.ts`.
        dts({
          tsconfigPath: resolve(import.meta.dirname, 'tsconfig.lib.json'),
          include: ['src/lib/**/*'],
          insertTypesEntry: true,
        }),
      ],
      // Don't copy `public/` (25 MB HDR + customer GLBs) into the published
      // package. Demo-only assets; the host app serves its own.
      publicDir: false,
      build: {
        // ESM only: every peer is ESM-first, and a UMD/CJS build could not
        // resolve the dynamic `jspdf` / GLTFExporter imports anyway.
        lib: {
          entry: resolve(import.meta.dirname, 'src/lib/index.ts'),
          fileName: () => 'configurator-3d.js',
          formats: ['es'],
        },
        rollupOptions: {
          external: (id) => externalPattern.test(id),
        },
        sourcemap: true,
        emptyOutDir: true,
      },
    }
  }
  return {
    plugins: [react()],
    // Demo output is kept out of `dist/`: that directory is the published
    // package (`files: ["dist"]`), and a demo build would otherwise overwrite
    // the library bundle with the SPA + all of `public/`.
    build: { outDir: 'dist-demo' },
  }
})
