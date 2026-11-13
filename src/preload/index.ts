import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type MemoryEvent,
  type OptikaxApi,
  type ScanProgress,
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
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch)
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
    has: () => ipcRenderer.invoke(IPC.apiKeyHas),
    set: (key) => ipcRenderer.invoke(IPC.apiKeySet, key),
    clear: () => ipcRenderer.invoke(IPC.apiKeyClear)
  }
}

contextBridge.exposeInMainWorld('optikax', api)
