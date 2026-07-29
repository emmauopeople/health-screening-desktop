import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { ConfigEnv, Plugin } from 'vite'
import {
  createProductionContentSecurityPolicy,
  injectContentSecurityPolicyMeta,
  viteDevelopmentCspNonce
} from './src/main/security/content-security-policy'

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

export default defineConfig(({ command }: ConfigEnv) => ({
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
    ...(command === 'serve' ? { html: { cspNonce: viteDevelopmentCspNonce } } : {}),
    resolve: {
      alias: rendererAlias
    },
    plugins: [react(), productionContentSecurityPolicyPlugin()]
  }
}))
