export const developmentReactRefreshPreamblePath = '/@health-screening/react-refresh-preamble'

const reactRefreshRuntimePath = '/@react-refresh'

const inlineReactRefreshPreamblePattern =
  /<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*>\s*import\s*\{\s*injectIntoGlobalHook\s*\}\s*from\s*["']\/@react-refresh["'];\s*injectIntoGlobalHook\(window\);\s*window\.\$RefreshReg\$\s*=\s*\(\)\s*=>\s*\{\};\s*window\.\$RefreshSig\$\s*=\s*\(\)\s*=>\s*\(type\)\s*=>\s*type;\s*<\/script>/i

export function createDevelopmentReactRefreshPreambleModule(): string {
  return [
    `import { injectIntoGlobalHook } from "${reactRefreshRuntimePath}";`,
    'injectIntoGlobalHook(window);',
    'window.$RefreshReg$ = () => {};',
    'window.$RefreshSig$ = () => (type) => type;',
    ''
  ].join('\n')
}

export function externalizeInlineReactRefreshPreamble(html: string): string {
  return html.replace(
    inlineReactRefreshPreamblePattern,
    `<script type="module" src="${developmentReactRefreshPreamblePath}"></script>`
  )
}
