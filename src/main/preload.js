const { contextBridge, ipcRenderer } = require('electron');

/**
 * Expose protected methods that allow the renderer process to use
 * the ipcRenderer without exposing the entire object
 */
console.log('Preload script loaded');

contextBridge.exposeInMainWorld('electronAPI', {
  // Config
  configGet: (key) => ipcRenderer.invoke('config:get', key),
  configSet: (key, value) => ipcRenderer.invoke('config:set', key, value),
  configGetServerPath: () => ipcRenderer.invoke('config:get-server-path'),
  configSetServerPath: (path) => ipcRenderer.invoke('config:set-server-path', path),
  configSelectServerPath: () => ipcRenderer.invoke('config:select-server-path'),
  configSetSteamCredentials: (username, password) => ipcRenderer.invoke('config:set-steam-credentials', username, password),
  configGetSteamCredentials: () => ipcRenderer.invoke('config:get-steam-credentials'),
  configRemoveMod: (workshopId) => ipcRenderer.invoke('config:remove-mod', workshopId),
  configAddLocalMod: (modName, name) => ipcRenderer.invoke('config:add-local-mod', modName, name),
  configRemoveLocalMod: (modName) => ipcRenderer.invoke('config:remove-local-mod', modName),
  workshopListLocalMods: (serverPath) => ipcRenderer.invoke('workshop:list-local-mods', serverPath),
  configSetModLoadOrder: (workshopId, loadOrder) => ipcRenderer.invoke('config:set-mod-load-order', workshopId, loadOrder),
  configReorderMods: (modOrderArray) => ipcRenderer.invoke('config:reorder-mods', modOrderArray),
  configGetModsOrdered: () => ipcRenderer.invoke('config:get-mods-ordered'),
  configGetSteamApi: () => ipcRenderer.invoke('config:get-steam-api'),
  configSetSteamApi: (enabled, apiKey) => ipcRenderer.invoke('config:set-steam-api', enabled, apiKey),
  configGetLaunchConfig: () => ipcRenderer.invoke('config:get-launch-config'),
  configSetLaunchConfig: (partial) => ipcRenderer.invoke('config:set-launch-config', partial),
  configListServerConfigs: (serverPath) => ipcRenderer.invoke('config:list-server-configs', serverPath),
  configGetServerHostname: (configFile) => ipcRenderer.invoke('config:get-server-hostname', configFile),
  onServerCrashed: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('server:crashed', handler);
    return () => ipcRenderer.removeListener('server:crashed', handler);
  },

  // SteamCMD
  steamcmdIsInstalled: () => ipcRenderer.invoke('steamcmd:is-installed'),
  steamcmdDownload: () => ipcRenderer.invoke('steamcmd:download'),
  onSteamcmdConsole: (callback) => {
    const handler = (event, chunk) => callback(chunk);
    ipcRenderer.on('steamcmd:console', handler);
    return () => ipcRenderer.removeListener('steamcmd:console', handler);
  },
  onSteamcmdRunning: (callback) => {
    const handler = (event, state) => callback(state);
    ipcRenderer.on('steamcmd:running', handler);
    return () => ipcRenderer.removeListener('steamcmd:running', handler);
  },
  onSteamcmdPrompt: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('steamcmd:prompt', handler);
    return () => ipcRenderer.removeListener('steamcmd:prompt', handler);
  },
  steamcmdSendInput: (text) => ipcRenderer.invoke('steamcmd:input', text),
  steamcmdKill: () => ipcRenderer.invoke('steamcmd:kill'),
  steamcmdIsRunning: () => ipcRenderer.invoke('steamcmd:is-running'),
  steamcmdProvideSteamGuardCode: (code) => ipcRenderer.invoke('steamcmd:provide-steam-guard-code', code),
  steamcmdCancelSteamGuard: () => ipcRenderer.invoke('steamcmd:cancel-steam-guard'),
  onSteamcmdSteamGuardRequired: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('steamcmd:steam-guard-required', handler);
    return () => ipcRenderer.removeListener('steamcmd:steam-guard-required', handler);
  },

  // Server
  serverInstall: (installPath, branch) => ipcRenderer.invoke('server:install', installPath, branch),
  serverUpdate: (installPath) => ipcRenderer.invoke('server:update', installPath),
  serverGetVersion: (installPath) => ipcRenderer.invoke('server:get-version', installPath),
  serverValidate: (installPath) => ipcRenderer.invoke('server:validate', installPath),
  serverListProfiles: (installPath) => ipcRenderer.invoke('server:list-profiles', installPath),
  serverCheckUpdates: (serverPath) => ipcRenderer.invoke('server:check-updates', serverPath),

  // Workshop
  workshopSearch: (query, page, sortBy) => ipcRenderer.invoke('workshop:search', query, page, sortBy),
  workshopGetDetails: (workshopId) => ipcRenderer.invoke('workshop:get-details', workshopId),
  workshopGetPopular: (page) => ipcRenderer.invoke('workshop:get-popular', page),
  workshopDownload: (workshopId, installPath) => ipcRenderer.invoke('workshop:download', workshopId, installPath),
  workshopUpdate: (workshopId, installPath) => ipcRenderer.invoke('workshop:update', workshopId, installPath),
  workshopUpdateAll: (modsList, installPath) => ipcRenderer.invoke('workshop:update-all', modsList, installPath),
  workshopCheckUpdates: (installPath, modsList) => ipcRenderer.invoke('workshop:check-updates', installPath, modsList),
  workshopListInstalled: (installPath) => ipcRenderer.invoke('workshop:list-installed', installPath),
  workshopGetInfo: (workshopId, installPath) => ipcRenderer.invoke('workshop:get-info', workshopId, installPath),
  workshopScanFolder: (workshopFolderPath, serverPath) => ipcRenderer.invoke('workshop:scan-folder', workshopFolderPath, serverPath),
  selectWorkshopFolder: () => ipcRenderer.invoke('workshop:select-folder'),
  removeModFolder: (serverPath, modName) => ipcRenderer.invoke('workshop:remove-mod-folder', serverPath, modName),
  workshopGetCollection: (collectionId) => ipcRenderer.invoke('workshop:get-collection', collectionId),
  workshopDownloadCollection: (collectionId, installPath) => ipcRenderer.invoke('workshop:download-collection', collectionId, installPath),
  modsCheckDependencies: (serverPath) => ipcRenderer.invoke('mods:check-dependencies', serverPath),

  // Mod Queue
  modQueueAdd: (workshopId, isCollection, name) => ipcRenderer.invoke('mod-queue:add', workshopId, isCollection, name),
  modQueueAddCollection: (collectionId, collectionName) => ipcRenderer.invoke('mod-queue:add-collection', collectionId, collectionName),
  modQueueRemove: (itemId) => ipcRenderer.invoke('mod-queue:remove', itemId),
  modQueueClearCompleted: () => ipcRenderer.invoke('mod-queue:clear-completed'),
  modQueueClearAll: () => ipcRenderer.invoke('mod-queue:clear-all'),
  modQueueGetStatus: () => ipcRenderer.invoke('mod-queue:get-status'),

  // Config Editor
  configListFiles: (serverPath) => ipcRenderer.invoke('config:list-files', serverPath),
  configReadFile: (configPath) => ipcRenderer.invoke('config:read-file', configPath),
  configSaveFile: (configPath, content) => ipcRenderer.invoke('config:save-file', configPath, content),
  configValidate: (content, fileType) => ipcRenderer.invoke('config:validate', content, fileType),
  configBackup: (configPath) => ipcRenderer.invoke('config:backup', configPath),
  configListMissions: (serverPath) => ipcRenderer.invoke('config:list-missions', serverPath),
  configScanCEFolder: (serverPath, missionName, folderName) => ipcRenderer.invoke('config:scan-ce-folder', serverPath, missionName, folderName),
  configReadEconomyCore: (serverPath, missionName) => ipcRenderer.invoke('config:read-economy-core', serverPath, missionName),
  configUpdateEconomyCore: (serverPath, missionName, folderName, files) => ipcRenderer.invoke('config:update-economy-core', serverPath, missionName, folderName, files),

  // Log Viewer
  logListFiles: (serverPath) => ipcRenderer.invoke('log:list-files', serverPath),
  logReadFile: (logPath, lines) => ipcRenderer.invoke('log:read-file', logPath, lines),
  logStartTail: (logPath) => ipcRenderer.invoke('log:start-tail', logPath),
  logStopTail: (logPath) => ipcRenderer.invoke('log:stop-tail', logPath),
  logExport: (logPath, outputPath, filter) => ipcRenderer.invoke('log:export', logPath, outputPath, filter),
  logSelectExportPath: () => ipcRenderer.invoke('log:select-export-path'),

  // Server Control
  serverControlStart: (serverPath, profileName, parameters) => ipcRenderer.invoke('server-control:start', serverPath, profileName, parameters),
  serverControlStop: () => ipcRenderer.invoke('server-control:stop'),
  serverControlRestart: (serverPath, profileName, parameters, countdown) => ipcRenderer.invoke('server-control:restart', serverPath, profileName, parameters, countdown),
  serverControlGetStatus: () => ipcRenderer.invoke('server-control:get-status'),
  serverControlGetStats: () => ipcRenderer.invoke('server-control:get-stats'),
  serverControlGetPlayerCount: (serverPath, profileName) => ipcRenderer.invoke('server-control:get-player-count', serverPath, profileName),
  serverControlScheduleRestart: (time, serverPath, profileName, parameters, repeat) => ipcRenderer.invoke('server-control:schedule-restart', time, serverPath, profileName, parameters, repeat),
  serverControlCancelScheduledRestart: (id) => ipcRenderer.invoke('server-control:cancel-scheduled-restart', id),
  serverControlGetScheduledRestarts: () => ipcRenderer.invoke('server-control:get-scheduled-restarts'),

  // Event listeners
  onProgress: (channel, callback) => {
    const subscription = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
  onModQueueUpdate: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('mod-queue:updated', handler);
    return () => ipcRenderer.removeListener('mod-queue:updated', handler);
  },
  onModQueueItemProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('mod-queue:item-progress', handler);
    return () => ipcRenderer.removeListener('mod-queue:item-progress', handler);
  },

  // RCON
  rconConnect: (host, port, password) => ipcRenderer.invoke('rcon:connect', host, port, password),
  rconDisconnect: () => ipcRenderer.invoke('rcon:disconnect'),
  rconSendCommand: (command) => ipcRenderer.invoke('rcon:send-command', command),
  rconGetPlayers: () => ipcRenderer.invoke('rcon:get-players'),
  rconGetStatus: () => ipcRenderer.invoke('rcon:get-status'),
  rconKick: (playerName) => ipcRenderer.invoke('rcon:kick', playerName),
  rconBan: (playerName) => ipcRenderer.invoke('rcon:ban', playerName),
  rconSay: (message) => ipcRenderer.invoke('rcon:say', message),
  rconShutdown: () => ipcRenderer.invoke('rcon:shutdown'),
  rconRestart: () => ipcRenderer.invoke('rcon:restart'),
  rconGetConfig: () => ipcRenderer.invoke('rcon:get-config'),
  rconSetConfig: (host, port, password, enabled) => ipcRenderer.invoke('rcon:set-config', host, port, password, enabled),

  // Modlist Export
  modlistSelectExportPath: () => ipcRenderer.invoke('modlist:select-export-path'),
  modlistExport: (mods, filePath) => ipcRenderer.invoke('modlist:export', mods, filePath),

  // Notifications
  notificationsGet: () => ipcRenderer.invoke('notifications:get'),
  notificationsMarkRead: (id) => ipcRenderer.invoke('notifications:mark-read', id),
  notificationsMarkAllRead: () => ipcRenderer.invoke('notifications:mark-all-read'),
  notificationsClear: () => ipcRenderer.invoke('notifications:clear'),
  onNotification: (callback) => {
    const handler = (event, notification) => callback(notification);
    ipcRenderer.on('notifications:new', handler);
    return () => ipcRenderer.removeListener('notifications:new', handler);
  },

  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized')
});

console.log('electronAPI exposed to renderer');

