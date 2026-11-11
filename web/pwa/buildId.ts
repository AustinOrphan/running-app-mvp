// The build id of the running page: the value the Vite plugin (`web/sw/buildSw.ts`) also writes into
// the service worker, given to the page as a constant at build time. `dev` outside a build (the dev
// server, tests).
declare const __BUILD_ID__: string | undefined

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
