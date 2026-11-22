// Sets the interface language before any other module of the interface loads: some translate their
// labels once, when they load (tool lists, the shortcut list). Imported first in main.tsx.
import { setLang } from '../../shared/i18n'

setLang(window.api.lang)
