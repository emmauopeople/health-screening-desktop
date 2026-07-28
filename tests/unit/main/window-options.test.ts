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
