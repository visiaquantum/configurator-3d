/// <reference lib="webworker" />
import { boundsOf, guessUnit, orient, parseStl, simplify, weld } from './core'
import type { IndexedMesh, OrientOptions } from './core'
import type { WorkerRequest, WorkerResponse } from './protocol'

let source: Float32Array | null = null
let welded: { key: string; mesh: IndexedMesh } | null = null

const post = (message: WorkerResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(message, transfer)

function weldedFor(options: OrientOptions): IndexedMesh {
  const key = JSON.stringify(options)
  if (welded?.key !== key) welded = { key, mesh: weld(orient(source!, options)) }
  return welded.mesh
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  try {
    if (request.type === 'load') {
      source = parseStl(request.buffer)
      welded = null
      const { min, max } = boundsOf(source)
      post({ type: 'loaded', triangles: source.length / 9, unit: guessUnit(source), extent: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] })
      return
    }
    if (!source) throw new Error('Nessun STL caricato')
    const base = weldedFor(request.orient)
    const mesh = await simplify(base, request.targetTriangles, request.prune)
    const { min, max } = boundsOf(mesh.positions)
    post({
      type: 'result', id: request.id, sourceTriangles: base.indices.length / 3,
      positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, error: mesh.error,
      size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    }, [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer])
  } catch (error) {
    post({ type: 'error', id: request.type === 'process' ? request.id : undefined, message: error instanceof Error ? error.message : String(error) })
  }
}
