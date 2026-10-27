import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useConfiguratorStore } from './store'
import type { ConfiguratorStore } from './store'
import { validationForState } from './readiness'
import type { ValidationIssue } from '../types'

const sameReport = (a: ValidationIssue[], b: ValidationIssue[]) => a.length === b.length && a.every((issue, i) =>
  issue.level === b[i].level && issue.code === b[i].code && issue.message === b[i].message &&
  JSON.stringify(issue.itemIds) === JSON.stringify(b[i].itemIds))

/**
 * Keep the cached validation report in step with everything it reads, and tell
 * the host when it changes (and once at mount). Validation is the costly step,
 * so it runs only when one of its inputs changes — never during a drag.
 */
export function useValidationReport(storeApi: ConfiguratorStore, onValidationChange?: (issues: ValidationIssue[]) => void) {
  const inputs = useConfiguratorStore(useShallow((s) => [
    s.project, s.catalog, s.assemblyManifest, s.itemSnaps, s.itemRules, s.itemSizes, s.interiorBBox, s.enclosureBBox,
    s.captureRefs, s.loadingCatalog, s.loadingManifest, s.catalogError, s.manifestError, s.assetErrors,
  ]))
  const listener = useRef(onValidationChange)
  const reported = useRef(false)
  useEffect(() => { listener.current = onValidationChange }, [onValidationChange])
  useEffect(() => {
    const state = storeApi.getState()
    const issues = validationForState(state)
    const same = sameReport(state.validationIssues, issues)
    if (!same) {
      state.setValidationIssues(issues)
      state.reportTelemetry({
        type: 'validation',
        outcome: issues.some((issue) => issue.level === 'error') ? 'error' : 'success',
        detail: { issueCount: issues.length, errorCount: issues.filter((issue) => issue.level === 'error').length },
      })
    }
    if (!same || !reported.current) {
      reported.current = true
      listener.current?.(structuredClone(issues))
    }
  }, [inputs, storeApi])
}
