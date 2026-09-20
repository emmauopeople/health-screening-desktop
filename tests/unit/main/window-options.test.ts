import { describe, expect, it } from 'vitest'

import { createMainWindowOptions } from '@main/app/window-options'

describe('main window options', () => {
  it('sets the expected secure web preferences', () => {
    const options = createMainWindowOptions({
      preloadPath: 'preload-entry.js',
      isDevelopment: false,
      platform: 'win32'
    })

    expect(options.webPreferences?.contextIsolation).toBe(true)
    expect(options.webPreferences?.nodeIntegration).toBe(false)
    expect(options.webPreferences?.sandbox).toBe(true)
    expect(options.webPreferences?.webSecurity).toBe(true)
    expect(options.webPreferences?.webviewTag).toBe(false)
    expect(options.webPreferences?.navigateOnDragDrop).toBe(false)
  })

  it('uses the configured preload path', () => {
    const options = createMainWindowOptions({
      preloadPath: 'out/preload/index.js',
      isDevelopment: false,
      platform: 'win32'
    })

    expect(options.webPreferences?.preload).toBe('out/preload/index.js')
  })

  it.each([
    { width: 1920, height: 1040 },
    { width: 1093, height: 574 },
    { width: 800, height: 440 },
    { width: 600, height: 400 }
  ])(
    'keeps initial and minimum bounds within the scaled display work area $width x $height',
    (workAreaSize) => {
      const options = createMainWindowOptions({
        preloadPath: 'preload.js',
        isDevelopment: false,
        workAreaSize
      })
      expect(options.width).toBe(Math.min(1100, workAreaSize.width))
      expect(options.height).toBe(Math.min(720, workAreaSize.height))
      expect(options.minWidth).toBeLessThanOrEqual(options.width!)
      expect(options.minHeight).toBeLessThanOrEqual(options.height!)
      expect(options.width).toBeLessThanOrEqual(workAreaSize.width)
      expect(options.height).toBeLessThanOrEqual(workAreaSize.height)
    }
  )

  it('enables devTools only in development', () => {
    const developmentOptions = createMainWindowOptions({
      preloadPath: 'preload-entry.js',
      isDevelopment: true,
      platform: 'win32'
    })
    const productionOptions = createMainWindowOptions({
      preloadPath: 'preload-entry.js',
      isDevelopment: false,
      platform: 'win32'
    })

    expect(developmentOptions.webPreferences?.devTools).toBe(true)
    expect(productionOptions.webPreferences?.devTools).toBe(false)
  })
})
