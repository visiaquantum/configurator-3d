import type { OrientOptions, StlUnit } from './core'

export type WorkerRequest =
  | { type: 'load'; buffer: ArrayBuffer }
  | { type: 'process'; id: number; orient: OrientOptions; targetTriangles: number; prune: boolean }

export type WorkerResponse =
  | { type: 'loaded'; triangles: number; unit: StlUnit; extent: [number, number, number] }
  | {
    type: 'result'; id: number; sourceTriangles: number
    positions: Float32Array; normals: Float32Array; indices: Uint32Array
    /** Largest deviation from the source, metres. */
    error: number
    size: [number, number, number]
  }
  | { type: 'error'; id?: number; message: string }
