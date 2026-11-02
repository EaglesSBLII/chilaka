const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chilakaBridge', {
  asrAvailable: () => ipcRenderer.invoke('asr:available'),
  transcribe: (wav, hint) => ipcRenderer.invoke('asr:transcribe', wav, hint ?? null),
  speak: (text) => ipcRenderer.invoke('tts:speak', text),
  setReminders: (reminders) => ipcRenderer.invoke('reminders:set', reminders),
  saveBackup: (json) => ipcRenderer.invoke('backup:save', json),
  appleMusic: {
    playlists: () => ipcRenderer.invoke('amusic:playlists'),
    play: (playlist, volume) => ipcRenderer.invoke('amusic:play', playlist, volume),
    pause: () => ipcRenderer.invoke('amusic:pause'),
    resume: () => ipcRenderer.invoke('amusic:resume'),
    setVolume: (volume) => ipcRenderer.invoke('amusic:volume', volume),
    stop: () => ipcRenderer.invoke('amusic:stop'),
  },
});
