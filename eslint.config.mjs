import { defineConfig } from 'eslint/config'
import { builtinModules } from 'node:module'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

const nodeBuiltinImports = Array.from(
  new Set(
    builtinModules.flatMap((moduleName) => {
      const bareName = moduleName.replace(/^node:/, '')
      return [bareName, `node:${bareName}`]
    })
  )
)
  .sort()
  .map((moduleName) => ({
    name: moduleName,
    message: 'Renderer code must use the typed preload API instead of Node built-ins.'
  }))

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }]
    }
  },
  {
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'Renderer code must use the typed preload API instead of Electron imports.'
            },
            ...nodeBuiltinImports
          ],
          patterns: [
            {
              group: [
                '@main',
                '@main/*',
                '@preload',
                '@preload/*',
                'src/main',
                'src/main/*',
                'src/preload',
                'src/preload/*',
                '../main',
                '../main/*',
                '../preload',
                '../preload/*',
                '../../main',
                '../../main/*',
                '../../preload',
                '../../preload/*',
                '../../../main',
                '../../../main/*',
                '../../../preload',
                '../../../preload/*',
                '../../../../main',
                '../../../../main/*',
                '../../../../preload',
                '../../../../preload/*'
              ],
              message: 'Renderer code must not import main or preload implementation modules.'
            }
          ]
        }
      ]
    }
  },
  eslintConfigPrettier
)
