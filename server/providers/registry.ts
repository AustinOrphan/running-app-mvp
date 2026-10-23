import { notFound } from '../errors.ts'
import { appleHealthPush } from './appleHealth.ts'
import { garminProvider } from './garmin.ts'
import { intervalsProvider } from './intervals.ts'
import { intervalsPublish } from './intervalsPublish.ts'
import { stravaProvider } from './strava.ts'
import type {
  ProviderInfo,
  PublishProvider,
  PullProvider,
  PushProvider,
  UploadProvider,
} from './types.ts'

export interface RegisteredProvider {
  info: ProviderInfo
  pull?: PullProvider
  push?: PushProvider
  upload?: UploadProvider
  publish?: PublishProvider
}

/**
 * Every source, in display order. The `folder` provider has no module: the scheduler scans it. The
 * private calendar feed is not a provider (ADR 0008): it has no account to connect or sync.
 */
export const PROVIDERS: Record<string, RegisteredProvider> = {
  intervals: {
    info: {
      key: 'intervals',
      label: 'intervals.icu',
      experimental: false,
      channels: ['pull', 'publish'],
      wellness: true,
      docsUrl: 'https://intervals.icu/api-docs.html',
    },
    pull: intervalsProvider,
    publish: intervalsPublish,
  },
  strava: {
    info: {
      key: 'strava',
      label: 'Strava',
      experimental: false,
      channels: ['pull'],
      wellness: false,
      docsUrl: 'https://developers.strava.com/docs/getting-started/',
    },
    pull: stravaProvider,
  },
  garmin: {
    info: {
      key: 'garmin',
      label: 'Garmin Connect',
      experimental: true,
      channels: ['pull'],
      wellness: true,
      docsUrl: 'https://www.garmin.com/en-US/garmin-technology/health-science/',
    },
    pull: garminProvider,
  },
  'apple-health': {
    info: {
      key: 'apple-health',
      label: 'Apple Health',
      experimental: false,
      channels: ['push', 'upload'],
      wellness: true,
      docsUrl: 'https://www.healthyapps.dev/',
    },
    push: appleHealthPush,
  },
  folder: {
    info: {
      key: 'folder',
      label: 'Watched folder',
      experimental: false,
      channels: ['folder'],
      wellness: false,
      docsUrl: 'https://healthfit.io/',
    },
  },
}

/** Throws `notFound` for a key that is not registered. */
export function getProvider(key: string): RegisteredProvider {
  const provider = Object.hasOwn(PROVIDERS, key) ? PROVIDERS[key] : undefined
  if (!provider) throw notFound(`Unknown provider: ${key}`)
  return provider
}
