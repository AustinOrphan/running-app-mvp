// The build the running page came from, named by its entry script. Vite content-hashes the entry
// (`/assets/index-<hash>.js`), so the name identifies exactly the bundle that is running and its
// source maps. `dev` where the document has no such script (the dev server, tests).

/** Set by the Vite build and the web test project (`web/versionDefine.ts`). */
declare const __APP_VERSION__: string | undefined

/** The release the page was built from (`package.json`), or `dev` where nothing sets it. */
export function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
}

/** `index-<hash>` of the entry script in the document, or `dev`. */
export function pageBuildId(): string {
  for (const script of document.querySelectorAll('script[type="module"][src]')) {
    const match = /\/assets\/(index-[^/?#]+)\.js(?:[?#].*)?$/.exec(script.getAttribute('src') ?? '')
    if (match?.[1] !== undefined) return match[1]
  }
  return 'dev'
}
