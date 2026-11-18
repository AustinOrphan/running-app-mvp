// The release identity (RI1) for the web build: the `package.json` version, substituted for
// `__APP_VERSION__` by Vite and by the web test project, so the page shows the version of the
// release it was built from (read at run time by `appVersion` in `pwa/buildId.ts`).
import { readAppVersion } from '../server/version.ts'

export function appVersionDefine(): Record<string, string> {
  return { __APP_VERSION__: JSON.stringify(readAppVersion()) }
}
