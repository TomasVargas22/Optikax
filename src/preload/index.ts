import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type AiProgress,
  type GameModeStatus,
  type MemoryEvent,
  type OptikaxApi,
  type ScanProgress,
  type Settings,
  type WindowState
} from '@shared/types'

const api: OptikaxApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    setTitleBarTheme: (theme) => ipcRenderer.invoke(IPC.titleBarTheme, theme),
    onWindowState: (cb) => {
      const listener = (_e: IpcRendererEvent, state: WindowState): void => cb(state)
      ipcRenderer.on(IPC.windowState, listener)
      return () => ipcRenderer.removeListener(IPC.windowState, listener)
    }
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    onChange: (cb) => {
      const listener = (_e: IpcRendererEvent, s: Settings): void => cb(s)
      ipcRenderer.on(IPC.settingsChanged, listener)
      return () => ipcRenderer.removeListener(IPC.settingsChanged, listener)
    }
  },
  hardware: {
    scan: (force) => ipcRenderer.invoke(IPC.hardwareScan, force === true),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: ScanProgress): void => cb(p)
      ipcRenderer.on(IPC.hardwareProgress, listener)
      return () => ipcRenderer.removeListener(IPC.hardwareProgress, listener)
    }
  },
  tweaks: {
    list: () => ipcRenderer.invoke(IPC.tweaksList),
    apply: (ids) => ipcRenderer.invoke(IPC.tweaksApply, ids),
    revert: (ids) => ipcRenderer.invoke(IPC.tweaksRevert, ids)
  },
  memory: {
    stats: () => ipcRenderer.invoke(IPC.memoryStats),
    purge: (kind) => ipcRenderer.invoke(IPC.memoryPurge, kind),
    state: () => ipcRenderer.invoke(IPC.memoryState),
    onEvent: (cb) => {
      const listener = (_e: IpcRendererEvent, event: MemoryEvent): void => cb(event)
      ipcRenderer.on(IPC.memoryEvent, listener)
      return () => ipcRenderer.removeListener(IPC.memoryEvent, listener)
    }
  },
  apiKey: {
    has: (provider) => ipcRenderer.invoke(IPC.apiKeyHas, provider),
    set: (provider, key) => ipcRenderer.invoke(IPC.apiKeySet, provider, key),
    clear: (provider) => ipcRenderer.invoke(IPC.apiKeyClear, provider),
    test: (provider) => ipcRenderer.invoke(IPC.apiKeyTest, provider)
  },
  backup: {
    export: () => ipcRenderer.invoke(IPC.backupExport)
  },
  gameMode: {
    status: () => ipcRenderer.invoke(IPC.gameModeStatus),
    onChange: (cb) => {
      const listener = (_e: IpcRendererEvent, s: GameModeStatus): void => cb(s)
      ipcRenderer.on(IPC.gameModeChange, listener)
      return () => ipcRenderer.removeListener(IPC.gameModeChange, listener)
    }
  },
  ai: {
    last: () => ipcRenderer.invoke(IPC.aiLast),
    analyze: () => ipcRenderer.invoke(IPC.aiAnalyze),
    cancel: () => ipcRenderer.invoke(IPC.aiCancel),
    onProgress: (cb) => {
      const listener = (_e: IpcRendererEvent, p: AiProgress): void => cb(p)
      ipcRenderer.on(IPC.aiProgress, listener)
      return () => ipcRenderer.removeListener(IPC.aiProgress, listener)
    }
  }
}

contextBridge.exposeInMainWorld('optikax', api)
