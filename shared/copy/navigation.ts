// The words of the navigation that are not page names: the three groups of the More page and the
// side rail. `NAV_TEMPLATES` is spread into `TEMPLATES`, so the shared G5 lint renders them.
import { tpl } from './template.ts'

export const NAV_TEMPLATES = {
  'nav.group.training': tpl('Training', {}, { shape: 'label' }),
  'nav.group.data': tpl('Data', {}, { shape: 'label' }),
  'nav.group.you': tpl('You', {}, { shape: 'label' }),
} as const
