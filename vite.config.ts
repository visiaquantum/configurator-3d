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
        dts({ include: ['src/lib/**/*'], insertTypesEntry: true }),
      ],
      build: {
        lib: {
          entry: resolve(__dirname, 'src/lib/index.ts'),
          name: 'Configurator3D',
          fileName: (format) => `configurator-3d.${format === 'es' ? 'js' : 'umd.cjs'}`,
          formats: ['es', 'umd'],
        },
        rollupOptions: {
          external: (id) => externalPattern.test(id) || id === 'react/jsx-runtime',
          output: {
            globals: (id: string) => {
              if (id === 'react') return 'React'
              if (id === 'react-dom') return 'ReactDOM'
              if (id === 'react/jsx-runtime') return 'jsxRuntime'
              if (id === 'three' || id.startsWith('three/')) return 'THREE'
              if (id === '@react-three/fiber') return 'ReactThreeFiber'
              if (id === '@react-three/drei') return 'ReactThreeDrei'
              if (id === 'zustand' || id.startsWith('zustand/')) return 'zustand'
              if (id === 'zod') return 'zod'
              if (id === 'nanoid') return 'nanoid'
              if (id === 'jspdf') return 'jspdf'
              return id
            },
          },
        },
        sourcemap: true,
        emptyOutDir: true,
      },
    }
  }
  return {
    plugins: [react()],
  }
})
