// The build the running page came from, named by its entry script. Vite content-hashes the entry
// (`/assets/index-<hash>.js`), so the name identifies exactly the bundle that is running and its
// source maps. `dev` where the document has no such script (the dev server, tests).

/** `index-<hash>` of the entry script in the document, or `dev`. */
export function pageBuildId(): string {
  for (const script of document.querySelectorAll('script[type="module"][src]')) {
    const match = /\/assets\/(index-[^/?#]+)\.js(?:[?#].*)?$/.exec(script.getAttribute('src') ?? '')
    if (match?.[1] !== undefined) return match[1]
  }
  return 'dev'
}
