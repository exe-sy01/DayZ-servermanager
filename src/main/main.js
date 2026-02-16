// Polyfill for File API (required by undici/cheerio in Electron)
if (typeof File === 'undefined') {
  global.File = class File {
    constructor(bits, name, options = {}) {
      this.name = name;
      this.lastModified = options.lastModified || Date.now();
      this.size = 0;
      this.type = options.type || '';
    }
  };
}

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const config = require('./config');
const steamcmd = require('./steamcmd');
const serverManager = require('./serverManager');
const serverControl = require('./serverControl');
const workshopManager = require('./workshopManager');
const configEditor = require('./configEditor');
const logViewer = require('./logViewer');
const modQueue = require('./modQueue');
const rconManager = require('./rconManager');

let mainWindow;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 682,
    minWidth: 1320,
    minHeight: 682,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: false // Disable DevTools by default
    },
    icon: path.join(__dirname, '../../resources/icons/icon.png'),
    frame: false, // Remove default frame for custom title bar
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1a' // Match app background
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Remove menu bar
  Menu.setApplicationMenu(null);

  // Enable DevTools only with Ctrl+Shift+I (or Cmd+Option+I on Mac)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Cleanup on close
  app.on('before-quit', async () => {
    logViewer.stopAllTailing();
    if (serverControl.isRunning) {
      await serverControl.stopServer();
    }
  });
}

/**
 * Send progress update to renderer
 */
function sendProgress(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// App event handlers
app.whenReady().then(async () => {
  await config.load();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers - Config
ipcMain.handle('config:get', async (event, key) => {
  return config.get(key);
});

ipcMain.handle('config:set', async (event, key, value) => {
  return await config.set(key, value);
});

ipcMain.handle('config:get-server-path', async () => {
  return config.getServerPath();
});

ipcMain.handle('config:set-server-path', async (event, serverPath) => {
  return await config.setServerPath(serverPath);
});

ipcMain.handle('config:set-steam-credentials', async (event, username, password, useCredentials) => {
  return await config.setSteamCredentials(username, password, useCredentials);
});

ipcMain.handle('config:get-steam-credentials', async () => {
  return config.getSteamCredentials();
});

ipcMain.handle('config:remove-mod', async (event, workshopId) => {
  try {
    await config.removeMod(workshopId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:set-mod-load-order', async (event, workshopId, loadOrder) => {
  try {
    await config.setModLoadOrder(workshopId, loadOrder);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:reorder-mods', async (event, modOrderArray) => {
  try {
    await config.reorderMods(modOrderArray);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:get-mods-ordered', async () => {
  try {
    const mods = config.getModsOrdered();
    return { success: true, mods };
  } catch (error) {
    return { success: false, error: error.message, mods: [] };
  }
});

ipcMain.handle('config:select-server-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select DayZ Server Installation Directory'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    await config.setServerPath(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('workshop:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Workshop Folder (steamapps/workshop/content/221100)'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// IPC Handlers - SteamCMD
ipcMain.handle('steamcmd:is-installed', async () => {
  return await steamcmd.isInstalled();
});

ipcMain.handle('steamcmd:download', async (event) => {
  try {
    await steamcmd.downloadSteamCMD((progress) => {
      sendProgress('steamcmd:download-progress', progress);
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC Handlers - Server Management
ipcMain.handle('server:install', async (event, installPath, branch) => {
  try {
    const result = await serverManager.installServer(installPath, branch, (progress) => {
      sendProgress('server:install-progress', progress);
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('server:update', async (event, installPath) => {
  try {
    const result = await serverManager.updateServer(installPath, (progress) => {
      sendProgress('server:update-progress', progress);
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('server:get-version', async (event, installPath) => {
  return await serverManager.getServerVersion(installPath);
});

ipcMain.handle('server:validate', async (event, installPath) => {
  return await serverManager.validateInstallation(installPath);
});

ipcMain.handle('server:list-profiles', async (event, installPath) => {
  return await serverManager.listProfiles(installPath);
});

// IPC Handlers - Workshop Management
ipcMain.handle('workshop:search', async (event, query, page, sortBy) => {
  try {
    return await workshopManager.searchMods(query, page, sortBy);
  } catch (error) {
    return { success: false, error: error.message, mods: [], page: 1, totalPages: 0 };
  }
});

ipcMain.handle('workshop:get-details', async (event, workshopId) => {
  try {
    return await workshopManager.getModDetails(workshopId);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workshop:get-popular', async (event, page) => {
  try {
    return await workshopManager.getPopularMods(page);
  } catch (error) {
    return { success: false, error: error.message, mods: [], page: 1, totalPages: 0 };
  }
});

ipcMain.handle('workshop:download', async (event, workshopId, installPath) => {
  try {
    const result = await workshopManager.downloadMod(workshopId, installPath, (progress) => {
      sendProgress('workshop:download-progress', { workshopId, ...progress });
    });
    
    // Get mod details and add to config with name
    if (result.success) {
      try {
        const modDetails = await workshopManager.getModDetails(workshopId);
        if (modDetails && modDetails.name) {
          await config.addMod(workshopId, modDetails.name);
        }
      } catch (error) {
        console.warn('Could not get mod details, adding with workshop ID as name:', error);
        // Add with workshop ID as fallback name
        await config.addMod(workshopId, `Mod ${workshopId}`);
      }
    }
    
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workshop:update', async (event, workshopId, installPath) => {
  try {
    const result = await workshopManager.updateMod(workshopId, installPath, (progress) => {
      sendProgress('workshop:update-progress', { workshopId, ...progress });
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workshop:get-collection', async (event, collectionId) => {
  try {
    const collection = await workshopManager.getCollectionDetails(collectionId);
    return { success: true, ...collection };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workshop:download-collection', async (event, collectionId, installPath) => {
  try {
    const result = await workshopManager.downloadCollection(collectionId, installPath, (progress) => {
      sendProgress('workshop:download-collection-progress', { collectionId, ...progress });
    });
    
    // Add all successfully downloaded mods to config
    if (result.success && result.results) {
      for (const modResult of result.results) {
        if (modResult.success) {
          try {
            const modDetails = await workshopManager.getModDetails(modResult.workshopId);
            if (modDetails && modDetails.name) {
              await config.addMod(modResult.workshopId, modDetails.name);
            } else {
              await config.addMod(modResult.workshopId, `Mod ${modResult.workshopId}`);
            }
          } catch (error) {
            console.warn(`Could not get details for mod ${modResult.workshopId}:`, error);
            await config.addMod(modResult.workshopId, `Mod ${modResult.workshopId}`);
          }
        }
      }
    }
    
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Mod Queue IPC Handlers
ipcMain.handle('mod-queue:add', async (event, workshopId, isCollection, name) => {
  try {
    modQueue.setServerPath(await config.getServerPath());
    const itemId = modQueue.addToQueue(workshopId, isCollection, name);
    return { success: true, itemId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mod-queue:add-collection', async (event, collectionId, collectionName) => {
  try {
    modQueue.setServerPath(await config.getServerPath());
    const itemId = await modQueue.addCollectionToQueue(collectionId, collectionName);
    return { success: true, itemId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mod-queue:remove', async (event, itemId) => {
  try {
    const removed = modQueue.removeFromQueue(itemId);
    return { success: removed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mod-queue:clear-completed', async () => {
  try {
    const removed = modQueue.clearCompleted();
    return { success: true, removed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mod-queue:clear-all', async () => {
  try {
    modQueue.clearAll();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('mod-queue:get-status', async () => {
  return modQueue.getQueueStatus();
});

// Set up queue event listeners
modQueue.on('queue-updated', (status) => {
  mainWindow?.webContents.send('mod-queue:updated', status);
});

modQueue.on('item-progress', (data) => {
  mainWindow?.webContents.send('mod-queue:item-progress', data);
});

ipcMain.handle('workshop:update-all', async (event, modsList, installPath) => {
  try {
    const results = await workshopManager.updateAllMods(modsList, installPath, (progress) => {
      sendProgress('workshop:update-all-progress', progress);
    });
    return { success: true, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workshop:list-installed', async (event, installPath) => {
  return await workshopManager.listInstalledMods(installPath);
});

ipcMain.handle('workshop:scan-folder', async (event, workshopFolderPath, serverPath) => {
  try {
    const result = await workshopManager.scanWorkshopFolder(workshopFolderPath, serverPath);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('workshop:get-info', async (event, workshopId, installPath) => {
  return await workshopManager.getModInfo(workshopId, installPath);
});

ipcMain.handle('workshop:remove-mod-folder', async (event, serverPath, modName) => {
  try {
    const fs = require('fs-extra');
    const path = require('path');
    const modFolderPath = path.join(serverPath, `@${modName}`);
    const keysPath = path.join(serverPath, 'keys');
    
    // Remove mod folder
    if (await fs.pathExists(modFolderPath)) {
      await fs.remove(modFolderPath);
      console.log(`Removed mod folder: ${modFolderPath}`);
    }
    
    // Find and remove keys that belong to this mod
    if (await fs.pathExists(keysPath)) {
      // Get the actual mod path (follow symlink if needed)
      let actualModPath = modFolderPath;
      try {
        const stats = await fs.lstat(modFolderPath);
        if (stats.isSymbolicLink()) {
          actualModPath = await fs.readlink(modFolderPath);
        }
      } catch (error) {
        // If folder was already removed, try to find keys by checking if they exist
        // We'll check all keys and see if they might belong to this mod
      }
      
      // If we can access the mod folder, find its keys
      if (await fs.pathExists(actualModPath)) {
        const findKeys = async (dir) => {
          const keys = [];
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
              const fullPath = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                const subKeys = await findKeys(fullPath);
                keys.push(...subKeys);
              } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.bikey')) {
                keys.push(entry.name);
              }
            }
          } catch (error) {
            // Ignore errors
          }
          return keys;
        };
        
        const modKeyFiles = await findKeys(actualModPath);
        
        // Remove matching keys from keys folder
        if (modKeyFiles.length > 0) {
          const keysDirEntries = await fs.readdir(keysPath).catch(() => []);
          for (const keyFile of modKeyFiles) {
            const keyPath = path.join(keysPath, keyFile);
            if (await fs.pathExists(keyPath)) {
              await fs.remove(keyPath);
              console.log(`Removed key file: ${keyPath}`);
            }
          }
        }
      } else {
        // Mod folder doesn't exist, but we can try to remove keys that match the mod name pattern
        // This is a fallback - try to match keys that might belong to this mod
        const keysDirEntries = await fs.readdir(keysPath).catch(() => []);
        const modNameLower = modName.toLowerCase();
        
        for (const entry of keysDirEntries) {
          const entryLower = entry.toLowerCase();
          // If key filename contains mod name (without @), consider removing it
          // This is a heuristic - be careful not to remove keys from other mods
          if (entryLower.includes(modNameLower) && entry.toLowerCase().endsWith('.bikey')) {
            const keyPath = path.join(keysPath, entry);
            try {
              await fs.remove(keyPath);
              console.log(`Removed key file (by name match): ${keyPath}`);
            } catch (error) {
              console.warn(`Could not remove key file ${keyPath}:`, error);
            }
          }
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error removing mod folder:', error);
    return { success: false, error: error.message };
  }
});

// IPC Handlers - Config Editor
ipcMain.handle('config:list-files', async (event, serverPath) => {
  return await configEditor.listConfigFiles(serverPath);
});

ipcMain.handle('config:read-file', async (event, configPath) => {
  try {
    return await configEditor.readConfigFile(configPath);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:save-file', async (event, configPath, content) => {
  try {
    const result = await configEditor.writeConfigFile(configPath, content);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:validate', async (event, content, fileType) => {
  return configEditor.validateConfig(content, fileType);
});

ipcMain.handle('config:backup', async (event, configPath) => {
  return await configEditor.backupConfig(configPath);
});

ipcMain.handle('config:list-missions', async (event, serverPath) => {
  return await configEditor.listMissions(serverPath);
});

ipcMain.handle('config:scan-ce-folder', async (event, serverPath, missionName, folderName) => {
  return await configEditor.scanCEFolder(serverPath, missionName, folderName);
});

ipcMain.handle('config:read-economy-core', async (event, serverPath, missionName) => {
  return await configEditor.readEconomyCore(serverPath, missionName);
});

ipcMain.handle('config:update-economy-core', async (event, serverPath, missionName, folderName, files) => {
  return await configEditor.updateEconomyCore(serverPath, missionName, folderName, files);
});

// IPC Handlers - Log Viewer
ipcMain.handle('log:list-files', async (event, serverPath) => {
  return await logViewer.findLogFiles(serverPath);
});

ipcMain.handle('log:read-file', async (event, logPath, lines) => {
  try {
    return await logViewer.readLogFile(logPath, lines);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('log:start-tail', async (event, logPath) => {
  try {
    logViewer.tailLogFile(logPath, (entry) => {
      sendProgress('log:new-line', entry);
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('log:stop-tail', async (event, logPath) => {
  return logViewer.stopTailing(logPath);
});

// Note: log:filter is handled client-side in the renderer for better performance

ipcMain.handle('log:export', async (event, logPath, outputPath, filter) => {
  try {
    const result = await logViewer.exportLogs(logPath, outputPath, filter);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('log:select-export-path', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Log File',
    defaultPath: 'dayz-log-export.txt',
    filters: [
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled) {
    return result.filePath;
  }
  return null;
});

// IPC Handlers - Server Control
ipcMain.handle('server-control:start', async (event, serverPath, profileName, parameters) => {
  try {
    const result = await serverControl.startServer(serverPath, profileName, parameters);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('server-control:stop', async () => {
  try {
    const result = await serverControl.stopServer();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('server-control:restart', async (event, serverPath, profileName, parameters, countdown) => {
  try {
    const result = await serverControl.restartServer(serverPath, profileName, parameters, countdown);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('server-control:get-status', async () => {
  return serverControl.getServerStatus();
});

ipcMain.handle('server-control:get-stats', async () => {
  return await serverControl.getProcessStats();
});

ipcMain.handle('server-control:get-player-count', async (event, serverPath, profileName) => {
  return await serverControl.getPlayerCount(serverPath, profileName);
});

ipcMain.handle('server-control:schedule-restart', async (event, time, serverPath, profileName, parameters) => {
  return serverControl.scheduleRestart(time, serverPath, profileName, parameters);
});

ipcMain.handle('server-control:cancel-scheduled-restart', async (event, id) => {
  serverControl.cancelScheduledRestart(id);
  return { success: true };
});

ipcMain.handle('server-control:get-scheduled-restarts', async () => {
  return serverControl.getScheduledRestarts();
});

// Start monitoring interval for server stats
setInterval(async () => {
  if (serverControl.isRunning) {
    const stats = await serverControl.getProcessStats();
    const status = serverControl.getServerStatus();
    const serverPath = await config.getServerPath();
    
    if (serverPath) {
      const profiles = await serverManager.listProfiles(serverPath);
      const profileName = profiles[0] || 'default';
      const playerCount = await serverControl.getPlayerCount(serverPath, profileName);
      
      sendProgress('server-control:stats-update', {
        stats,
        status,
        playerCount
      });
    }
  }
  
  // Check scheduled restarts
  await serverControl.checkScheduledRestarts();
}, 2000);

// IPC Handlers - RCON
ipcMain.handle('rcon:connect', async (event, host, port, password) => {
  try {
    const result = await rconManager.connect(host, port, password);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:disconnect', async () => {
  try {
    rconManager.disconnect();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:send-command', async (event, command) => {
  try {
    const response = await rconManager.sendCommand(command);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:get-players', async () => {
  try {
    const players = await rconManager.getPlayers();
    return { success: true, players };
  } catch (error) {
    return { success: false, error: error.message, players: [] };
  }
});

ipcMain.handle('rcon:get-status', async () => {
  return rconManager.getStatus();
});

ipcMain.handle('rcon:kick', async (event, playerName) => {
  try {
    const response = await rconManager.kickPlayer(playerName);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:ban', async (event, playerName) => {
  try {
    const response = await rconManager.banPlayer(playerName);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:say', async (event, message) => {
  try {
    const response = await rconManager.sayMessage(message);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:shutdown', async () => {
  try {
    const response = await rconManager.shutdown();
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:restart', async () => {
  try {
    const response = await rconManager.restart();
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rcon:get-config', async () => {
  return config.getRCONConfig();
});

ipcMain.handle('rcon:set-config', async (event, host, port, password, enabled) => {
  try {
    await config.setRCONConfig(host, port, password, enabled);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// IPC Handlers - Modlist Export
ipcMain.handle('modlist:select-export-path', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export DayZ Modlist',
    defaultPath: 'dayz-mods.html',
    filters: [
      { name: 'HTML Files', extensions: ['html'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled) {
    return result.filePath;
  }
  return null;
});

ipcMain.handle('modlist:export', async (event, mods, filePath) => {
  try {
    const fs = require('fs-extra');
    
    // Generate DayZ Launcher modlist HTML
    const html = generateModlistHTML(mods);
    
    await fs.writeFile(filePath, html, 'utf-8');
    
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Window control handlers
ipcMain.handle('window:minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('window:is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

/**
 * Generate DayZ Launcher modlist HTML
 */
function generateModlistHTML(mods) {
  const modRows = mods.map(mod => {
    const displayName = mod.name || `Mod ${mod.workshopId}`;
    const workshopId = mod.workshopId || mod.workshopId;
    const workshopUrl = `http://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
    
    return `        <tr data-type="ModContainer">
          <td data-type="DisplayName">${escapeHtml(displayName)}</td>
          <td>
            <span class="from-steam">Steam</span>
          </td>
          <td>
            <a href="${workshopUrl}" data-type="Link">${workshopUrl}</a>
          </td>
        </tr>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<html>
  <!--Created by DayZ Server Manager-->
  <head>
    <meta name="dayz:Type" content="list" />
    <meta name="generator" content="DayZ Server Manager" />
    <title>DayZ Mods</title>
    <link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet" type="text/css" />
    <style>
body {
	margin: 0;
	padding: 0;
	color: #fff;
	background: #000;	
}

body, th, td {
	font: 95%/1.3 Roboto, Segoe UI, Tahoma, Arial, Helvetica, sans-serif;
}

td {
    padding: 3px 30px 3px 0;
}

h1 {
    padding: 20px 20px 0 20px;
    color: white;
    font-weight: 200;
    font-family: segoe ui;
    font-size: 3em;
    margin: 0;
}

em {
    font-variant: italic;
    color:silver;
}

.before-list {
    padding: 5px 20px 10px 20px;
}

.mod-list {
    background: #222222;
    padding: 20px;
}

.footer {
    padding: 20px;
    color:gray;
}

.whups {
    color:gray;
}

a {
    color: #C80004;
    text-decoration: underline;
}

a:hover {
    color:#F1AF41;
    text-decoration: none;
}

.from-steam {
    color: #449EBD;
}
.from-local {
    color: gray;
}

</style>
  </head>
  <body>
    <h1>DayZ Mods</h1>
    <p class="before-list">
      <em>Drag this file or link to it to DayZ Launcher or open it Mods / Preset / Import.</em>
    </p>
    <div class="mod-list">
      <table>
${modRows}
      </table>
    </div>
    <div class="footer">
      <span>Created by DayZ Server Manager.</span>
    </div>
  </body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

