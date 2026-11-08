import { describe, expect, it } from 'vitest'
import { parseWindowState, restoredBounds, visibleOnDisplay } from '../src/window-state.ts'

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }
const SECOND = { x: 1920, y: 0, width: 1280, height: 1024 }

describe('parseWindowState', () => {
  it('accepts a saved record and rounds its geometry', () => {
    expect(parseWindowState({ x: 12.6, y: 40.2, width: 1280.4, height: 820.9, maximized: true })).toEqual({
      x: 13, y: 40, width: 1280, height: 821, maximized: true,
    })
  })

  it('reads maximized only when the stored value is exactly true', () => {
    const state = parseWindowState({ x: 0, y: 0, width: 800, height: 700, maximized: 'yes' })
    expect(state?.maximized).toBe(false)
  })

  it('refuses a damaged record instead of clamping it', () => {
    for (const raw of [null, 'window', 42, {}, { x: 0, y: 0, width: 800 }, { x: 'a', y: 0, width: 800, height: 700 }]) {
      expect(parseWindowState(raw)).toBeUndefined()
    }
  })

  it('refuses a window below the minimum usable size', () => {
    expect(parseWindowState({ x: 0, y: 0, width: 519, height: 700 })).toBeUndefined()
    expect(parseWindowState({ x: 0, y: 0, width: 800, height: 599 })).toBeUndefined()
  })
})

describe('visibleOnDisplay', () => {
  it('keeps a window that overlaps one display by the minimum visible area', () => {
    expect(visibleOnDisplay({ x: 100, y: 100, width: 800, height: 700 }, [PRIMARY, SECOND])).toBe(true)
  })

  it('rejects a window that is entirely off every display', () => {
    expect(visibleOnDisplay({ x: 5000, y: 5000, width: 800, height: 700 }, [PRIMARY, SECOND])).toBe(false)
  })

  it('rejects a window with less than the minimum visible overlap', () => {
    // 100 px of horizontal overlap is below the 160 px floor.
    expect(visibleOnDisplay({ x: 1870, y: 100, width: 800, height: 700 }, [PRIMARY])).toBe(false)
  })
})

describe('restoredBounds', () => {
  it('restores saved geometry when a display still shows it', () => {
    expect(restoredBounds({ x: 100, y: 80, width: 900, height: 700, maximized: false }, [PRIMARY], PRIMARY))
      .toEqual({ x: 100, y: 80, width: 900, height: 700 })
  })

  it('centers an off-screen window on the primary work area', () => {
    expect(restoredBounds({ x: 9000, y: 9000, width: 800, height: 700, maximized: false }, [PRIMARY], PRIMARY))
      .toEqual({ x: 560, y: 170, width: 800, height: 700 })
  })

  it('preserves a saved window larger than the current work area while it is still visible', () => {
    // The record came from a larger display; the window overlaps this one, so the saved size
    // stands and the user can resize it instead of the shell silently shrinking the layout.
    expect(restoredBounds({ x: 0, y: 0, width: 4000, height: 3000, maximized: false }, [PRIMARY], PRIMARY))
      .toEqual({ x: 0, y: 0, width: 4000, height: 3000 })
  })

  it('has no bounds to restore without a record', () => {
    expect(restoredBounds(undefined, [PRIMARY], PRIMARY)).toBeUndefined()
  })
})
