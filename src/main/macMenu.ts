import { Menu } from 'electron'

// A Mac always shows a menu bar, and Electron's default one has Reload (⌘R) and the developer tools:
// one keystroke would reload the editor mid-edit. This one keeps what a Mac app needs: About / Hide /
// Quit (⌘Q), Edit for text fields (⌘X / ⌘C / ⌘V / ⌘A, ⌘Z in a field), and the window (⌘M, ⌘W).
// The page sees each key first: outside a text field useShortcuts takes ⌘Z / ⌘C / ⌘V for the reel
// and its objects (preventDefault), and the menu only gets what it leaves. Windows keeps no menu.
export function setMacMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      role: 'editMenu',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    { role: 'windowMenu', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'close' }] },
  ]))
}
