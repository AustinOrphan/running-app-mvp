// The words of a page that could not be read from the server (`ErrorState`): one sentence naming
// what did not load, one muted line saying what to do, and the button. The offline line is used
// when the browser knows it has no network. Spec: visual design 5, EmptyState, and 6 for errors.
import { render, tpl, type Template } from './template.ts'

export const LOAD_ERROR_TEMPLATES = {
  'load-error.title': tpl(
    '{what} did not load.',
    { what: 'text' },
    { fallback: 'The page did not load.' },
  ),
  'load-error.body': tpl('The server did not answer. Try again in a moment.'),
  'load-error.body-offline': tpl('This device is offline. Try again once it is connected.'),
  'load-error.retry': tpl('Try again', {}, { shape: 'label' }),
} satisfies Record<string, Template>

const T = LOAD_ERROR_TEMPLATES

export interface LoadErrorText {
  title: string
  body: string
  retry: string
}

/** The sentence, the muted line and the button label; `what` is the thing, capitalised ("Activities"). */
export function loadErrorText(what: string, online: boolean): LoadErrorText {
  return {
    title: render(T['load-error.title'], { what }, 'km'),
    body: render(T[online ? 'load-error.body' : 'load-error.body-offline'], {}, 'km'),
    retry: render(T['load-error.retry'], {}, 'km'),
  }
}
