import type { ConfiguratorTheme } from '../types'

const light = {
  background: '#edf0f4',
  scene: '#e6eaf0',
  surface: '#ffffff',
  'surface-muted': '#f6f8fc',
  'surface-hover': '#f1f5fa',
  text: '#27364b',
  'text-secondary': '#52627a',
  'text-muted': '#64748b',
  'text-subtle': '#758196',
  line: '#dce3ec',
  accent: '#2563eb',
  primary: '#2563eb',
  'on-primary': '#ffffff',
  'accent-soft': '#eff5ff',
  'accent-line': '#91b2ef',
  success: '#21785d',
  'success-surface': '#f0faf5',
  'success-line': '#b7dec9',
  error: '#b53446',
  'error-surface': '#fff1f2',
  'error-line': '#dfabb2',
  warning: '#986325',
  'warning-line': '#e4c695',
  shadow: '#172b4d12',
  scrollbar: '#cbd5e1',
  brand: '#203b59',
}

const dark: typeof light = {
  background: '#0f1722',
  scene: '#141e2b',
  surface: '#172231',
  'surface-muted': '#202d3e',
  'surface-hover': '#26364b',
  text: '#e4ebf5',
  'text-secondary': '#b3c1d3',
  'text-muted': '#9aadc3',
  'text-subtle': '#8296b0',
  line: '#334357',
  accent: '#70aaff',
  primary: '#386ee6',
  'on-primary': '#ffffff',
  'accent-soft': '#1c3352',
  'accent-line': '#375d91',
  success: '#85d8b4',
  'success-surface': '#19362e',
  'success-line': '#315c4d',
  error: '#ff9aa8',
  'error-surface': '#3b242d',
  'error-line': '#75404c',
  warning: '#e9c387',
  'warning-line': '#705836',
  shadow: '#00000038',
  scrollbar: '#435670',
  brand: '#284968',
}

const variables = (colors: typeof light) => Object.entries(colors).map(([key, value]) => `--cfg-${key}: ${value};`).join(' ')

/** Each configurator owns its palette; the demo shell uses the same tokens. */
export const themeStyles = `
.cfg-ui, .app-shell { ${variables(light)} color-scheme: light; }
.cfg-ui[data-theme=dark], .app-shell[data-theme=dark] { ${variables(dark)} color-scheme: dark; }
`

export const sceneColors: Record<ConfiguratorTheme, { background: string; cell: string; section: string }> = {
  light: { background: light.scene, cell: '#c8d0dc', section: '#a6b2c3' },
  dark: { background: dark.scene, cell: '#2c3c50', section: '#455b76' },
}
