/**
 * Pure main-window geometry: parsing the persisted record and choosing the bounds to restore.
 * The Electron screen module stays in main.ts so this half is testable without an app runtime.
 */

/** Persisted main-window geometry; a convenience record, never startup policy. */
export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

/** The part of a display this module needs: its work area. */
export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** The smallest window the desktop shell can usefully restore. */
export const MIN_WINDOW_WIDTH = 520
export const MIN_WINDOW_HEIGHT = 600

/** The visible overlap a restored window keeps on a display before it is recentered. */
const MIN_VISIBLE_WIDTH = 160
const MIN_VISIBLE_HEIGHT = 120

/**
 * Read one persisted record, refusing anything that cannot describe a window.
 * A damaged record is ignored rather than clamped: startup falls back to the default size.
 */
export function parseWindowState(raw: unknown): WindowState | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const state = raw as Record<string, unknown>
  const x = Number(state['x'])
  const y = Number(state['y'])
  const width = Number(state['width'])
  const height = Number(state['height'])
  if (![x, y, width, height].every(Number.isFinite)) return undefined
  if (width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT) return undefined
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: state['maximized'] === true,
  }
}

/** Whether the rect keeps at least the minimum visible area on one display. */
export function visibleOnDisplay(rect: WindowBounds, areas: readonly WorkArea[]): boolean {
  return areas.some((area) => {
    const width = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x)
    const height = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y)
    return width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT
  })
}

/**
 * Bounds to create the window with: the saved geometry when a display still shows it,
 * otherwise the saved size clamped to the primary work area and centered there.
 */
export function restoredBounds(
  state: WindowState | undefined,
  areas: readonly WorkArea[],
  primary: WorkArea,
): WindowBounds | undefined {
  if (state === undefined) return undefined
  if (visibleOnDisplay(state, areas)) return { x: state.x, y: state.y, width: state.width, height: state.height }
  const width = Math.min(state.width, primary.width)
  const height = Math.min(state.height, primary.height)
  return {
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
  }
}
