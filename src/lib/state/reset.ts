import type { ConfiguratorState } from './storeTypes'

/**
 * What each kind of change clears. Every reset goes through these, so a new
 * field is reset by adding it in one place.
 */

/** End a guided attachment, restoring the X-ray it switched on. */
export function endAttachment(state: ConfiguratorState): Partial<ConfiguratorState> {
  if (!state.attachment) return {}
  return {
    attachment: null,
    ...(state.attachment.stage !== 'menu' && state.xrayEnabled ? { xrayEnabled: state.attachment.previousXray } : {}),
  }
}

/** A gesture in flight: the live preview it drives belongs to no saved state. */
export const gestureReset = {
  draggingItemId: null,
  dragClearance: null,
  neighborGap: null,
} satisfies Partial<ConfiguratorState>

/** A new project: nothing selected or in progress refers to the old one. */
export function projectChangeReset(state: ConfiguratorState): Partial<ConfiguratorState> {
  return {
    ...endAttachment(state),
    ...gestureReset,
    selectedId: null,
    interactionNotice: null,
    walkMode: false,
    validationIssues: [],
    overlappingIds: new Set<string>(),
  }
}

/** A different enclosure asset: its anchors, bounds and camera framing go with it. */
export const enclosureChangeReset = {
  runtimeAnchors: [],
  enclosureBBox: null,
  interiorBBox: null,
  cameraPreset: null,
  cameraProjection: 'perspective',
} satisfies Partial<ConfiguratorState>

/** Read-only mode: no edit may stay open. Selection and view stay. */
export function readOnlyReset(state: ConfiguratorState): Partial<ConfiguratorState> {
  return { ...endAttachment(state), ...gestureReset }
}

/** Undo/redo: the restored project may not contain what was selected. */
export function historyStepReset(state: ConfiguratorState): Partial<ConfiguratorState> {
  return { ...endAttachment(state), selectedId: null, interactionNotice: null }
}
