// true in the team's own app, false in the one that is sold (electron.vite.config.ts). Write it as is
// where code is to be left out (`if (__INTERNAL__ && …)`, `__INTERNAL__ ? … : …`): the build folds it,
// and only then drops what it guards.
declare const __INTERNAL__: boolean
// The main process only: the token the internal edition reads its updates with ('' in the sold one, and
// in an internal build made without VR_INTERNAL_UPDATE_TOKEN). electron.vite.config.ts says where it comes from.
declare const __UPDATE_TOKEN__: string
// The main process only: the email addresses the internal edition opens its features for ([] in the sold one).
declare const __INTERNAL_EMAILS__: string[]
