import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const mainAlias = {
  '@main': resolve('src/main'),
  '@shared': resolve('src/shared')
}

const preloadAlias = {
  '@preload': resolve('src/preload'),
  '@shared': resolve('src/shared')
}

const rendererAlias = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared')
}

export default defineConfig({
  main: {
    resolve: {
      alias: mainAlias
    }
  },
  preload: {
    resolve: {
      alias: preloadAlias
    }
  },
  renderer: {
    resolve: {
      alias: rendererAlias
    },
    plugins: [react()]
  }
})
