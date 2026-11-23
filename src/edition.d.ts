// true in the team's own app, false in the one that is sold (electron.vite.config.ts). Write it as is
// where code is to be left out (`if (__INTERNAL__ && …)`, `__INTERNAL__ ? … : …`): the build folds it,
// and only then drops what it guards.
declare const __INTERNAL__: boolean
