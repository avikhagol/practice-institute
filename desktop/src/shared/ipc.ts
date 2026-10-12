// Launcher IPC contract (PACKAGING.md §2, §5). Shared by main, preload and renderer.
// Main validates every payload; the renderer only sees `window.pi: PiApi`.
// Adding a channel requires a senior-turn review: no generic exec/path/file channels.

export const IPC = {
  getState: 'pi:get-state',
  subscribe: 'pi:state', // main -> renderer push (webContents.send), payload LauncherState
  startServer: 'pi:server-start',
  stopServer: 'pi:server-stop',
  openAdmin: 'pi:open-admin',
  openFolder: 'pi:open-folder',
  createOwner: 'setup:create-owner',
  saveSettings: 'setup:save-settings',
  importTunnelCredentials: 'tunnel:import-credentials', // main opens the file dialog itself
  startTunnel: 'tunnel:start',
  stopTunnel: 'tunnel:stop',
  verifyTunnel: 'tunnel:verify',
  backup: 'recovery:backup', // main opens the folder dialog itself
  restore: 'recovery:restore', // main opens the folder dialog itself
  openGuide: 'help:open-guide',
  confirmQuit: 'app:confirm-quit',
} as const

export type ServerStatus =
  | { kind: 'stopped' }
  | { kind: 'starting' }
  | { kind: 'probing'; ownerUrl: string }
  | { kind: 'running'; ownerUrl: string; publicUrl: string; since: number }
  | { kind: 'stopping' }
  | { kind: 'failed'; reason: ServerFailure; port?: number; listener?: 'owner' | 'public'; logTail: string[] }

export type ServerFailure = 'port-in-use' | 'already-running' | 'config' | 'crashed' | 'probe-failed' | 'runtime-missing'

export type TunnelStatus =
  | { kind: 'not-configured'; missing: Array<'hostname' | 'tunnel-id' | 'credentials' | 'student-origin'> }
  | { kind: 'stopped' }
  | { kind: 'starting' }
  | { kind: 'running-unverified' } // process up only
  | { kind: 'connected'; connections: number } // cloudflared metrics readyConnections > 0
  | { kind: 'verified'; checkedAt: number } // HTTPS /api/v1/health 200 and /admin/ 404
  | { kind: 'failed'; reason: 'binary-missing' | 'config-invalid' | 'exited' | 'verify-failed'; detail: string }

export interface ExamActivity { activeAttempts: number; openExams: number; checkedAt: number }

export interface PublicSettings {
  ownerPort: number
  publicPort: number
  studentOrigin: string // '' until configured
  publicApiHost: string // '' until configured
  tunnelId: string // '' until configured
  hasTunnelCredentials: boolean // never the path contents
  trustProxyHeaders: boolean
  keepAwakeWhileServing: boolean
  closeBehavior: 'ask' | 'tray' | 'stop'
}

export interface LauncherState {
  version: string
  platform: 'win32' | 'linux' | 'darwin'
  ownerExists: boolean
  server: ServerStatus
  tunnel: TunnelStatus
  activity: ExamActivity | null
  settings: PublicSettings
  keepAwakeActive: boolean
  lastBackup: { at: number; folderName: string } | null // folder name only, not full path
}

export type Result<T = undefined> = { ok: true; value: T } | { ok: false; code: string; message: string }

export interface CreateOwnerInput { username: string; password: string; confirm: string }
export type SettingsInput = Partial<Pick<PublicSettings,
  'ownerPort' | 'publicPort' | 'studentOrigin' | 'publicApiHost' | 'tunnelId' | 'trustProxyHeaders' | 'keepAwakeWhileServing' | 'closeBehavior'>>
export type FolderKind = 'data' | 'logs' | 'backups' | 'config'
export type GuideTopic = 'cloudflare-tunnel' | 'github-pages'

export interface PiApi {
  getState(): Promise<LauncherState>
  onState(listener: (state: LauncherState) => void): () => void
  startServer(): Promise<Result>
  stopServer(): Promise<Result>
  openAdmin(): Promise<Result>
  openFolder(kind: FolderKind): Promise<Result>
  createOwner(input: CreateOwnerInput): Promise<Result> // codes: bad-input bad-username mismatch weak-password owner-exists
  saveSettings(input: SettingsInput): Promise<Result<PublicSettings>> // codes: invalid-<field>, server-running (ports)
  importTunnelCredentials(): Promise<Result<{ tunnelId: string }>> // codes: cancelled invalid-file symlink too-large
  startTunnel(): Promise<Result>
  stopTunnel(): Promise<Result>
  verifyTunnel(): Promise<Result<TunnelStatus>>
  backup(): Promise<Result<{ folderName: string }>> // codes: cancelled inside-data-dir failed
  restore(confirmText: string): Promise<Result<{ previousDataFolder: string; restarted?: boolean }>> // codes: cancelled exam-active not-confirmed failed
  openGuide(topic: GuideTopic): Promise<Result>
  confirmQuit(choice: 'stop-and-quit' | 'keep-running' | 'cancel'): Promise<Result>
}

declare global {
  interface Window { pi: PiApi }
}
