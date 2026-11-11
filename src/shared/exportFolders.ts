// Where the save dialogs start: the folder something was last written to, per project and per kind
// ('video': MP4s and the folder for scene-by-scene files; 'docs': pictures and PDFs of slides and the
// match report), kept in this computer's settings. Pure, so it is unit-tested.
export type ExportKind = 'video' | 'docs'
export type ExportFolders = Record<string, Partial<Record<ExportKind, string>>> // by project folder, compared without case

const key = (projectDir: string) => projectDir.replace(/[\\/]+$/, '').toLowerCase()

// The folder to start in, when it is still there (exists: checks the disk).
export function lastFolder(all: ExportFolders | undefined, projectDir: string, kind: ExportKind, exists: (dir: string) => boolean): string | null {
  const dir = all?.[key(projectDir)]?.[kind]
  return dir && exists(dir) ? dir : null
}

// The folders with this one remembered; at most `keep` projects, the latest kept.
export function rememberFolder(all: ExportFolders | undefined, projectDir: string, kind: ExportKind, dir: string, keep = 30): ExportFolders {
  const k = key(projectDir)
  const rest = Object.entries(all ?? {}).filter(([p]) => p !== k).slice(-(keep - 1))
  return { ...Object.fromEntries(rest), [k]: { ...all?.[k], [kind]: dir } }
}
