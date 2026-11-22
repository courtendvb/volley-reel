// Packs in vendor/packs go into the installer (electron-builder.yml), and the releases repository is
// public: league photos in it would be anyone's to download. npm run release stops while there are
// any, unless VR_RELEASE_WITH_PACKS=1 says they are meant to ship; testers get packs as .vrpack files.
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The ids of the packs that would ship (folders with a manifest.json).
export function packsToShip(dir = join('vendor', 'packs')) {
  return existsSync(dir) ? readdirSync(dir).filter(id => existsSync(join(dir, id, 'manifest.json'))) : []
}
