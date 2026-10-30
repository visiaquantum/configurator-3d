import type { Object3D } from 'three'
import { Quaternion, Vector3 } from 'three'
import type { Vec3 } from '../types'
import { own } from '../util/record'

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
 * (including the root's own scale). scene/productAsset.ts converts it into the
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
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
}

/**
 * Rules declarable by node name alone, for GLBs whose CAD export cannot write
 * extras — the same channel as `SNAP_*`. A node named `RULE_AUTOSNAPGRID`
 * (any instance suffix) turns on hole detection; `RULE_MIRRORPAIR_D254.507.761`
 * declares a mirror pair whose spacings, in millimetres, follow `_D`.
 *
 * A name cannot carry an axis: a name-declared `mirror-pair` uses the node's
 * +X like any rule, which the catalogue's `mirrorPair.axis` corrects.
 */
const NAME_RULE_RE = /^rule[_:]([a-z0-9]+)(?:_d(\d+(?:\.\d+)*))?(?:-\d+)?(?:_\d+)?$/i
const NAME_RULE_ALIASES: Record<string, string> = {
  autosnapgrid: 'auto-snap-grid',
  mirrorpair: 'mirror-pair',
}

function ruleFromName(name: string): { rule: string; params: Record<string, unknown> } | null {
  const m = name.match(NAME_RULE_RE)
  if (!m) return null
  const rule = own(NAME_RULE_ALIASES, m[1].toLowerCase())
  if (!rule) return null
  if (!m[2]) return { rule, params: {} }
  // Only the mirror pair takes spacings; anything else with `_D…` is not a rule name.
  if (rule !== 'mirror-pair') return null
  return { rule, params: { distances: m[2].split('.').map((mm) => Number(mm) / 1000) } }
}

export function extractRulesFromObject(root: Object3D): ExtractedRuleNode[] {
  const out: ExtractedRuleNode[] = []
  const worldPos = new Vector3()
  const worldAxis = new Vector3()
  const localAxis = new Vector3(1, 0, 0)
  const worldQuat = new Quaternion()

  root.traverse((obj) => {
    const ud = (obj.userData ?? {}) as Record<string, unknown>
    const byExtras = ud.kind === 'rule' && typeof ud.rule === 'string' && ud.rule ? ud.rule : null
    // three.js strips `.` from node names; GLTFLoader keeps the original in userData.
    const byName = byExtras ? null : ruleFromName(typeof ud.name === 'string' ? ud.name : obj.name)
    const ruleId = byExtras ?? byName?.rule
    if (!ruleId) return

    const params = {
      ...byName?.params,
      ...(typeof ud.params === 'object' && ud.params !== null && !Array.isArray(ud.params)
        ? (ud.params as Record<string, unknown>)
        : {}),
    }

    obj.updateWorldMatrix(true, false)
    obj.getWorldPosition(worldPos)
    const position: Vec3 = [worldPos.x, worldPos.y, worldPos.z]

    // An explicit axis is a direction: normalised, and ignored when it has none.
    const explicit = isVec3(params.axis) ? Math.hypot(...params.axis) : 0
    let axis: Vec3
    if (isVec3(params.axis) && Number.isFinite(explicit) && explicit > 1e-9) {
      axis = params.axis.map((value) => +(value / explicit).toFixed(6)) as Vec3
    } else {
      obj.getWorldQuaternion(worldQuat)
      worldAxis.copy(localAxis).applyQuaternion(worldQuat).normalize()
      axis = [+worldAxis.x.toFixed(6), +worldAxis.y.toFixed(6), +worldAxis.z.toFixed(6)]
    }

    out.push({ extracted: { rule: ruleId, position, axis, params }, node: obj })
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
