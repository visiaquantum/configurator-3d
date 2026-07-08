import type { Object3D } from 'three'
import { Quaternion, Vector3 } from 'three'
import type { Vec3 } from '../types'

/**
 * Convention to declare rule nodes inside a product GLB (extras only):
 *
 * A node carries glTF `extras` (→ `Object3D.userData` in three.js) with:
 *
 *   { "kind": "rule", "rule": "<rule-id>", "params": { ... } }
 *
 * - `kind: "rule"` marks the node (parallel to `kind: "anchor"`).
 * - `rule` is the id of a rule implemented in the configurator code
 *   (e.g. "mirror-pair"). Unknown rules are ignored, not an error.
 * - `params` is a free-form JSON object whose schema depends on the rule.
 *   Lengths in params are meters, independent of any catalog `scale`.
 *
 * Geometric semantics: the node's world position is the rule reference
 * point; its local +X axis is the rule direction. `params.axis: [x,y,z]`
 * overrides the computed axis (like `normal` on anchors).
 *
 * The node may be an Empty or a marker mesh — marker meshes are hidden by
 * `hydrateItemRulesAndHide`.
 */

/** Rule as extracted from the GLB, in the model root's coordinate space
 * (including the root's own scale). scene/Item.tsx converts it into the
 * item's local frame before storing it as an `ItemRule`. */
export interface ExtractedRule {
  rule: string
  position: Vec3
  axis: Vec3
  params: Record<string, unknown>
}

interface ExtractedRuleNode {
  extracted: ExtractedRule
  node: Object3D
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')
}

export function extractRulesFromObject(root: Object3D): ExtractedRuleNode[] {
  const out: ExtractedRuleNode[] = []
  const worldPos = new Vector3()
  const worldAxis = new Vector3()
  const localAxis = new Vector3(1, 0, 0)
  const worldQuat = new Quaternion()

  root.traverse((obj) => {
    const ud = (obj.userData ?? {}) as Record<string, unknown>
    if (ud.kind !== 'rule' || typeof ud.rule !== 'string' || !ud.rule) return

    const params =
      typeof ud.params === 'object' && ud.params !== null
        ? (ud.params as Record<string, unknown>)
        : {}

    obj.updateWorldMatrix(true, false)
    obj.getWorldPosition(worldPos)
    const position: Vec3 = [worldPos.x, worldPos.y, worldPos.z]

    let axis: Vec3
    if (isVec3(params.axis)) {
      axis = params.axis
    } else {
      obj.getWorldQuaternion(worldQuat)
      worldAxis.copy(localAxis).applyQuaternion(worldQuat).normalize()
      axis = [+worldAxis.x.toFixed(6), +worldAxis.y.toFixed(6), +worldAxis.z.toFixed(6)]
    }

    out.push({ extracted: { rule: ud.rule, position, axis, params }, node: obj })
  })

  return out
}

/**
 * Hide rule marker nodes from the rendered scene. Returns the extracted
 * rules. Idempotent — call once per loaded model clone.
 */
export function hydrateItemRulesAndHide(root: Object3D): ExtractedRule[] {
  const found = extractRulesFromObject(root)
  for (const f of found) {
    f.node.visible = false
  }
  return found.map((f) => f.extracted)
}
