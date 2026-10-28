// Lets Node run pixel-probe's hooks as they are: Node strips the types from
// a .ts file itself, and this finds the .ts behind an import that, as the
// hooks write them, names no extension.
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    for (const extension of ['.ts', '.tsx']) {
      try {
        return await next(specifier + extension, context)
      } catch {}
    }
  }
  return next(specifier, context)
}`),
)
