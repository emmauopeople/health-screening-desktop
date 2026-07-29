import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import {
  createProductionContentSecurityPolicy,
  injectContentSecurityPolicyMeta
} from './src/main/security/content-security-policy'
import {
  createDevelopmentReactRefreshPreambleModule,
  developmentReactRefreshPreamblePath,
  externalizeInlineReactRefreshPreamble
} from './src/main/security/development-react-refresh-preamble'

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

function productionContentSecurityPolicyPlugin(): Plugin {
  return {
    name: 'health-screening-production-csp',
    apply: 'build',
    transformIndexHtml(html): string {
      return injectContentSecurityPolicyMeta(html, createProductionContentSecurityPolicy())
    }
  }
}

function developmentReactRefreshPreamblePlugin(): Plugin {
  const virtualModuleId = '\0health-screening-react-refresh-preamble'

  return {
    name: 'health-screening-development-react-refresh-preamble',
    apply: 'serve',
    enforce: 'post',
    resolveId(source): string | undefined {
      if (
        source === developmentReactRefreshPreamblePath ||
        source === developmentReactRefreshPreamblePath.slice(1)
      ) {
        return virtualModuleId
      }

      return undefined
    },
    load(id): string | undefined {
      if (id === virtualModuleId) {
        return createDevelopmentReactRefreshPreambleModule()
      }

      return undefined
    },
    transformIndexHtml: {
      order: 'post',
      handler(html): string {
        return externalizeInlineReactRefreshPreamble(html)
      }
    }
  }
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
    plugins: [
      react(),
      developmentReactRefreshPreamblePlugin(),
      productionContentSecurityPolicyPlugin()
    ]
  }
})
