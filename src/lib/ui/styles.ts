import { themeStyles } from './theme'

/** Embedded, scoped styles keep the library usable without a CSS entry point. */
export const configuratorStyles = `
${themeStyles}
.cfg-ui { color: var(--cfg-text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; container-type: inline-size; }
.cfg-ui *, .cfg-ui *::before, .cfg-ui *::after { box-sizing: border-box; }
.cfg-ui button, .cfg-ui select, .cfg-ui input { font: inherit; }
.cfg-ui button { transition: background .16s, border-color .16s, filter .16s, box-shadow .16s; }
.cfg-ui button:not(:disabled):hover { filter: brightness(.97); }
.cfg-ui button:disabled { opacity: .4; cursor: not-allowed !important; }
.cfg-ui button:focus-visible, .cfg-ui summary:focus-visible, .cfg-ui select:focus-visible { outline: 2px solid var(--cfg-accent); outline-offset: 3px; }
.cfg-ui input[type=checkbox] { accent-color: var(--cfg-accent); width: 14px; height: 14px; }
.cfg-ui kbd { border: 1px solid var(--cfg-line); border-radius: 5px; padding: 2px 5px; font: 12px ui-monospace, monospace; color: var(--cfg-text-muted); }
.cfg-eyebrow { font-size: 11px; font-weight: 650; letter-spacing: 1.2px; color: var(--cfg-text-muted); }
.cfg-button, .cfg-icon-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--cfg-line); border-radius: 6px; background: var(--cfg-surface); color: var(--cfg-text); padding: 9px 12px; font-size: 13px !important; font-weight: 500 !important; cursor: pointer; min-height: 36px; }
.cfg-primary { background: var(--cfg-primary); border-color: var(--cfg-primary); color: var(--cfg-on-primary); box-shadow: 0 3px 12px #2563eb12; }
.cfg-quiet { background: transparent; }
.cfg-icon-button { width: 32px; height: 32px; min-height: 32px; padding: 6px; background: transparent; border-color: transparent; }
.cfg-context-menu, .cfg-attachment-panel, .cfg-inspector, .cfg-export-menu { cursor: auto; background: var(--cfg-surface); border: 1px solid var(--cfg-line); box-shadow: 0 8px 24px var(--cfg-shadow), 0 1px 3px var(--cfg-shadow); border-radius: 10px; }
.cfg-menu-dismiss { position: absolute; inset: 0; width: 100%; height: 100%; background: transparent; border: 0; z-index: 30; cursor: default; }
.cfg-context-menu { position: absolute; width: 240px; z-index: 31; padding: 14px 8px 8px; }
.cfg-context-menu > strong, .cfg-context-menu > .cfg-eyebrow { display: block; padding: 0 8px 8px; }
.cfg-context-menu > strong { font-size: 14px; margin-bottom: 6px; }
.cfg-context-menu small { display: block; padding: 8px; color: var(--cfg-text-muted); }
.cfg-menu-action { width: 100%; display: flex; align-items: center; gap: 10px; padding: 11px 10px; background: transparent; color: var(--cfg-text-secondary); border: 0; border-radius: 8px; font-size: 13px !important; cursor: pointer; text-align: left; }
.cfg-menu-action svg:last-child:not(:first-child) { margin-left: auto; }
.cfg-menu-action:hover { background: var(--cfg-surface-hover); }
.cfg-accent { color: var(--cfg-accent); background: var(--cfg-accent-soft); }
.cfg-attachment-panel { position: absolute; left: 16px; top: 94px; width: 310px; max-width: calc(100% - 32px); max-height: calc(100% - 114px); overflow: auto; z-index: 20; padding: 18px; }
.cfg-attachment-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.cfg-mode-badge { display: inline-flex; align-items: center; gap: 7px; color: var(--cfg-accent); font-size: 11px; font-weight: 650; letter-spacing: 1.3px; }
.cfg-steps { display: flex; padding: 0; margin: 0 0 22px; list-style: none; gap: 8px; }
.cfg-steps li { display: flex; flex: 1; align-items: center; gap: 5px; font-size: 11px; color: var(--cfg-text-subtle); line-height: 1.4; }
.cfg-steps li > span { display: grid; place-items: center; width: 20px; height: 20px; flex-shrink: 0; border: 1px solid var(--cfg-line); border-radius: 50%; font-size: 11px; }
.cfg-steps li.active { color: var(--cfg-accent); }
.cfg-steps li.active > span { background: var(--cfg-primary); border-color: var(--cfg-primary); color: var(--cfg-on-primary); }
.cfg-steps li.done { color: var(--cfg-success); }
.cfg-attachment-panel h3 { font-size: 17px; line-height: 1.35; margin: 0 0 9px; font-weight: 600; letter-spacing: -.3px; }
.cfg-attachment-panel p { font-size: 12px; line-height: 1.65; color: var(--cfg-text-muted); margin: 0 0 18px; }
.cfg-snap-feedback { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-height: 43px; padding: 10px; background: var(--cfg-surface-muted); border: 1px solid var(--cfg-line); border-radius: 6px; font-size: 12px; color: var(--cfg-text-secondary); }
.cfg-point-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cfg-accent); }
.cfg-positive { color: var(--cfg-success); font-size: 11px; }
.cfg-error-text { color: var(--cfg-error); }
.cfg-warning-text { display: block; color: var(--cfg-warning); font-size: 12px; line-height: 1.5; margin-top: 12px; }
.cfg-point-list { border-top: 1px solid var(--cfg-line); margin-top: 16px; padding-top: 12px; font-size: 12px; color: var(--cfg-text-muted); }
.cfg-point-list summary { cursor: pointer; padding: 4px 0; }
.cfg-point-list > div { max-height: 160px; overflow: auto; display: grid; gap: 4px; margin-top: 10px; }
.cfg-point-list button { display: flex; align-items: center; gap: 8px; width: 100%; border: 1px solid var(--cfg-line); border-radius: 7px; background: var(--cfg-surface-muted); color: var(--cfg-text-secondary); font-size: 12px; padding: 8px; cursor: pointer; text-align: left; }
.cfg-point-list button > span { color: var(--cfg-accent); width: 18px; }
.cfg-attachment-footer { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.cfg-attachment-footer > span { color: var(--cfg-text-subtle); font-size: 11px; line-height: 1.7; }
.cfg-attachment-footer button { align-self: flex-start; }
.cfg-toast { position: absolute; bottom: 22px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 9px; padding: 12px 18px; max-width: calc(100% - 32px); z-index: 25; background: var(--cfg-success-surface); color: var(--cfg-success); border: 1px solid var(--cfg-success-line); border-radius: 8px; box-shadow: 0 8px 30px var(--cfg-shadow); font-size: 12px; }
.cfg-inspector { display: flex; flex-direction: column; }
.cfg-inspector-title { flex-shrink: 0; padding: 16px 16px 12px; border-bottom: 1px solid var(--cfg-line); }
.cfg-inspector-title h3 { font-size: 17px; font-weight: 600; margin: 6px 0 0; letter-spacing: -.3px; }
.cfg-inspector-body { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 16px; scrollbar-width: thin; scrollbar-color: var(--cfg-scrollbar) transparent; }
.cfg-inspector-footer { display: flex; flex-shrink: 0; align-items: center; justify-content: space-between; padding: 8px 16px; border-top: 1px solid var(--cfg-line); }
.cfg-inspector-body > .cfg-button { width: 100%; }
.cfg-property-label { color: var(--cfg-text-muted); font-size: 12px; margin: 16px 0 8px; display: block; }
.cfg-coordinates { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; }
.cfg-coordinates span { padding: 8px; background: var(--cfg-surface-muted); border: 1px solid var(--cfg-line); border-radius: 7px; font: 12px ui-monospace, monospace; }
.cfg-coordinates b { display: block; color: var(--cfg-text-subtle); font-size: 10px; font-weight: 400; margin-bottom: 5px; }
.cfg-inspector details { border-top: 1px solid var(--cfg-line); margin-top: 14px; padding-top: 12px; font-size: 12px; color: var(--cfg-text-secondary); }
.cfg-inspector summary { cursor: pointer; padding: 3px 0; }
.cfg-inspector .cfg-pair-options { display: grid; gap: 6px; margin-top: 10px; }
.cfg-pair-options button { display: flex; justify-content: space-between; align-items: center; gap: 8px; border: 1px solid var(--cfg-line); border-radius: 8px; background: var(--cfg-surface-muted); padding: 9px; color: var(--cfg-text-secondary); text-align: left; cursor: pointer; font-size: 12px; }
.cfg-pair-options button[aria-pressed=true] { color: var(--cfg-accent); border-color: var(--cfg-accent-line); background: var(--cfg-accent-soft); }
.cfg-pair-options button > span:last-child { font-size: 9px; color: var(--cfg-text-muted); text-align: right; }
.cfg-export-menu { position: absolute; right: 0; top: calc(100% + 9px); width: 220px; padding: 7px; z-index: 25; }
.cfg-export-menu button { text-align: left; }
.cfg-empty-hint { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 48px); padding: 9px 14px; background: var(--cfg-surface); border: 1px solid var(--cfg-line); border-radius: 24px; color: var(--cfg-text-secondary); font-size: 12px; white-space: nowrap; pointer-events: none; }
@media (max-width: 700px) { .cfg-empty-hint { display: none; } .cfg-attachment-panel { width: 280px; padding: 14px; } }
@container (max-width: 600px) { .cfg-view-controls { max-width: 220px; } .cfg-view-controls > div:first-child { flex-wrap: wrap; } .cfg-export-toolbar > button, .cfg-export-toolbar > div > button { font-size: 0 !important; width: 36px; padding: 8px; gap: 0; } .cfg-attachment-panel { top: 126px; max-height: calc(100% - 142px); } .cfg-inspector-column { max-height: calc(100% - 138px) !important; } }
`
