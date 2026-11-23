// Design tokens (portal v4 spec §4.2). Colours and font families live as CSS custom properties in
// src/styles/tokens.css. Almost every use is a `var(--…)` string, which the browser resolves at paint
// time and so follows the brand set on <html data-brand>. token() is only for the few sinks that cannot
// resolve var(): Leaflet pathOptions, canvas, html2canvas options and SVG presentation attributes.
// Call it at render or event time, never at module scope: main.jsx applies the brand after every import
// has been evaluated, so a module-scope read would freeze the wrong value (src/lib/tokens.test.mjs).

export const TOKENS_CSS_PATH = 'src/styles/tokens.css'

// The resolved value of `--<name>` on the document root. Throws on an unknown or empty token, so a typo
// fails loudly instead of painting a marker in no colour.
export function token(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  if (!value) throw new Error(`unknown token --${name}`)
  return value
}

// The custom property names (without `--`) declared in the rule whose selector is exactly `selector`.
// For the tests: tokens.css is flat, one rule per selector, with no nesting.
export function definedTokens(cssText, selector) {
  const names = new Set()
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const [, sel, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (sel.trim() !== selector) continue
    for (const [, name] of body.matchAll(/--([a-z0-9-]+)\s*:/g)) names.add(name)
  }
  return names
}
