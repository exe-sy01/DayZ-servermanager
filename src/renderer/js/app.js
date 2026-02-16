/**
 * Main application logic
 */
class App {
    constructor() {
        this.currentPanel = 'server';
        this.init();
    }

    init() {
        this.setupNavigation();
        this.setupEventListeners();
        this.setupTitleBar();
        this.loadInitialData();
    }

    setupTitleBar() {
        // Title bar controls
        const minimizeBtn = document.getElementById('title-bar-minimize');
        const maximizeBtn = document.getElementById('title-bar-maximize');
        const closeBtn = document.getElementById('title-bar-close');

        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                if (window.electronAPI) {
                    window.electronAPI.windowMinimize();
                }
            });
        }

        if (maximizeBtn) {
            maximizeBtn.addEventListener('click', () => {
                if (window.electronAPI) {
                    window.electronAPI.windowMaximize();
                }
            });

            // Update maximize button icon when window state changes
            if (window.electronAPI) {
                const updateMaximizeIcon = async () => {
                    try {
                        const isMaximized = await window.electronAPI.windowIsMaximized();
                        maximizeBtn.textContent = isMaximized ? '❐' : '□';
                    } catch (error) {
                        // Ignore errors
                    }
                };
                
                // Check on load
                updateMaximizeIcon();
                
                // Listen for maximize/unmaximize events periodically
                setInterval(updateMaximizeIcon, 500);
            }
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (window.electronAPI) {
                    window.electronAPI.windowClose();
                }
            });
        }
    }

    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const panel = item.dataset.panel;
                this.switchPanel(panel);
            });
        });
    }

    switchPanel(panelName) {
        // Update navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.panel === panelName) {
                item.classList.add('active');
            }
        });

        // Update panels
        document.querySelectorAll('.panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`${panelName}-panel`).classList.add('active');

        this.currentPanel = panelName;

        // Load panel-specific data
        this.loadPanelData(panelName);
    }

    loadPanelData(panelName) {
        switch (panelName) {
            case 'server':
                if (window.serverPanel) {
                    window.serverPanel.loadServerInfo();
                }
                break;
            case 'servers':
                if (window.serverControl) {
                    window.serverControl.loadServerInfo();
                    // Ensure event listeners are attached when panel becomes visible
                    if (!window.serverControl.eventListenersAttached) {
                        console.log('Attaching event listeners for servers panel...');
                        window.serverControl.setupEventListeners();
                    }
                } else {
                    console.log('ServerControl not initialized yet, initializing now...');
                    // Try to initialize if not already done
                    setTimeout(() => {
                        if (window.serverControl) {
                            window.serverControl.loadServerInfo();
                            window.serverControl.setupEventListeners();
                        }
                    }, 100);
                }
                break;
            case 'mods':
                if (window.modPanel) {
                    window.modPanel.loadMods();
                }
                break;
            case 'browser':
                // Ensure event listeners are attached when panel becomes visible
                if (window.modBrowser) {
                    if (!window.modBrowser.eventListenersAttached) {
                        console.log('Re-attaching event listeners for browser panel...');
                        window.modBrowser.eventListenersAttached = false; // Reset flag
                        window.modBrowser.setupEventListeners();
                    }
                }
                break;
            case 'config':
                if (window.configEditor) {
                    window.configEditor.loadConfigFiles();
                }
                break;
            case 'logs':
                if (window.logViewer) {
                    window.logViewer.loadLogFiles();
                }
                break;
            case 'rcon':
                // RCON panel doesn't need special loading
                break;
            case 'settings':
                this.loadSettings();
                break;
        }
    }

    setupEventListeners() {
        // Setup progress listeners
        if (window.electronAPI) {
            // Initialize sidebar progress manager
            if (!window.sidebarProgress) {
                window.sidebarProgress = new SidebarProgress();
            }

            window.electronAPI.onProgress('steamcmd:download-progress', (event, data) => {
                console.log('SteamCMD download progress:', data);
                if (window.sidebarProgress) {
                    window.sidebarProgress.updateProgress('Downloading SteamCMD...', data);
                }
            });

            window.electronAPI.onProgress('server:install-progress', (event, data) => {
                if (window.serverPanel) {
                    window.serverPanel.updateProgress(data);
                }
                if (window.sidebarProgress) {
                    window.sidebarProgress.updateProgress('Installing server files...', data);
                }
            });

            window.electronAPI.onProgress('server:update-progress', (event, data) => {
                if (window.serverPanel) {
                    window.serverPanel.updateProgress(data);
                }
                if (window.sidebarProgress) {
                    window.sidebarProgress.updateProgress('Updating server files...', data);
                }
            });

            window.electronAPI.onProgress('workshop:download-progress', (event, data) => {
                if (window.modPanel) {
                    window.modPanel.updateModProgress(data);
                }
                const modName = data.workshopId ? `Mod ${data.workshopId}` : 'Mod';
                if (window.sidebarProgress) {
                    window.sidebarProgress.updateProgress(`Downloading ${modName}...`, data);
                }
            });

            window.electronAPI.onProgress('workshop:update-all-progress', (event, data) => {
                if (window.modPanel) {
                    window.modPanel.updateModProgress(data);
                }
                const current = data.current || 0;
                const total = data.total || 0;
                if (window.sidebarProgress) {
                    window.sidebarProgress.updateProgress(`Updating mods (${current}/${total})...`, data);
                }
            });

            window.electronAPI.onProgress('workshop:download-collection-progress', (event, data) => {
                const current = data.current || 0;
                const total = data.total || 0;
                if (window.sidebarProgress) {
                    window.sidebarProgress.updateProgress(
                        `Downloading collection (${current}/${total})...`,
                        data
                    );
                }
            });

            window.electronAPI.onProgress('log:new-line', (event, entry) => {
                if (window.logViewer) {
                    window.logViewer.addLogEntry(entry);
                }
            });

            // Listen for mod queue updates
            if (window.electronAPI.onModQueueUpdate) {
                window.electronAPI.onModQueueUpdate((status) => {
                    if (window.sidebarProgress) {
                        window.sidebarProgress.queueStatus = status;
                        window.sidebarProgress.updateQueueInfo();
                        
                        // Update progress if there's a current item
                        if (status.currentItem) {
                            const item = status.currentItem;
                            const title = item.isCollection 
                                ? `Downloading collection: ${item.name}`
                                : `Downloading: ${item.name}`;
                            window.sidebarProgress.updateProgress(title, {
                                progress: item.progress || 0,
                                message: `${item.progress || 0}%`
                            });
                        }
                    }
                });
            }

            // Initial queue status check
            if (window.electronAPI.modQueueGetStatus) {
                window.electronAPI.modQueueGetStatus().then(status => {
                    if (window.sidebarProgress && status) {
                        window.sidebarProgress.queueStatus = status;
                        window.sidebarProgress.updateQueueInfo();
                    }
                }).catch(err => console.warn('Could not get queue status:', err));
            }
        }
    }

    async loadInitialData() {
        // Load server path
        try {
            const serverPath = await window.electronAPI.configGetServerPath();
            if (serverPath) {
                const serverPathEl = document.getElementById('server-path');
                if (serverPathEl) {
                    serverPathEl.textContent = serverPath;
                }
                document.getElementById('settings-server-path').value = serverPath;
            }
        } catch (error) {
            console.error('Error loading initial data:', error);
        }

        // Start status indicator updates
        this.updateStatusIndicators();
        setInterval(() => this.updateStatusIndicators(), 5000); // Update every 5 seconds
    }

    async updateStatusIndicators() {
        try {
            // Update server status
            const status = await window.electronAPI.serverControlGetStatus();
            const statusBadge = document.getElementById('topbar-server-status');
            if (statusBadge) {
                if (status && status.running) {
                    statusBadge.textContent = 'Online';
                    statusBadge.className = 'status-badge status-success';
                } else {
                    statusBadge.textContent = 'Offline';
                    statusBadge.className = 'status-badge status-error';
                }
            }

            // Update player count
            const playerCountEl = document.getElementById('topbar-player-count');
            if (playerCountEl && status && status.running) {
                try {
                    const serverPath = await window.electronAPI.configGetServerPath();
                    const playerCount = await window.electronAPI.serverControlGetPlayerCount(serverPath, 'default');
                    if (playerCount && playerCount.current !== undefined) {
                        playerCountEl.textContent = `${playerCount.current}/${playerCount.max || 0}`;
                    }
                } catch (error) {
                    // Ignore player count errors
                }
            } else if (playerCountEl) {
                playerCountEl.textContent = '0/0';
            }
        } catch (error) {
            // Ignore status update errors
        }
    }

    async loadSettings() {
        try {
            const config = await window.electronAPI.configGet();
            if (config) {
                document.getElementById('settings-server-path').value = config.serverPath || '';
                document.getElementById('settings-steamcmd-path').value = config.steamcmdPath || '';
                document.getElementById('auto-update').checked = config.preferences?.autoUpdate || false;
                document.getElementById('check-updates').checked = config.preferences?.checkUpdatesOnStart !== false;
            }

            // Load Steam credentials
            const credentials = await window.electronAPI.configGetSteamCredentials();
            if (credentials) {
                document.getElementById('use-steam-credentials').checked = credentials.useCredentials || false;
                document.getElementById('steam-username').value = credentials.username || '';
                document.getElementById('steam-password').value = credentials.password || '';
            }

            // Setup settings event listeners
            document.getElementById('settings-select-server-path').addEventListener('click', async () => {
                const path = await window.electronAPI.configSelectServerPath();
                if (path) {
                    document.getElementById('settings-server-path').value = path;
                }
            });

            document.getElementById('download-steamcmd').addEventListener('click', async () => {
                const btn = document.getElementById('download-steamcmd');
                btn.disabled = true;
                btn.textContent = 'Downloading...';
                try {
                    const result = await window.electronAPI.steamcmdDownload();
                    if (result.success) {
                        this.showSuccess('SteamCMD downloaded successfully');
                    } else {
                        this.showError(result.error || 'Failed to download SteamCMD');
                    }
                } catch (error) {
                    this.showError(`Failed to download SteamCMD: ${error.message}`);
                } finally {
                    btn.disabled = false;
                    btn.textContent = 'Download SteamCMD';
                }
            });

            document.getElementById('save-settings').addEventListener('click', async () => {
                await this.saveSettings();
            });
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async saveSettings() {
        try {
            const serverPath = document.getElementById('settings-server-path').value;
            const autoUpdate = document.getElementById('auto-update').checked;
            const checkUpdates = document.getElementById('check-updates').checked;
            const useCredentials = document.getElementById('use-steam-credentials').checked;
            const steamUsername = document.getElementById('steam-username').value;
            const steamPassword = document.getElementById('steam-password').value;

            if (serverPath) {
                await window.electronAPI.configSetServerPath(serverPath);
            }

            const config = await window.electronAPI.configGet();
            config.preferences = {
                ...config.preferences,
                autoUpdate,
                checkUpdatesOnStart: checkUpdates
            };
            await window.electronAPI.configSet('preferences', config.preferences);

            // Save Steam credentials
            await window.electronAPI.configSetSteamCredentials(
                steamUsername,
                steamPassword,
                useCredentials
            );

            this.showSuccess('Settings saved successfully');
        } catch (error) {
            this.showError(`Failed to save settings: ${error.message}`);
        }
    }

    showError(message) {
        // Enhanced error display with better UX
        const errorDiv = document.createElement('div');
        errorDiv.className = 'toast toast-error';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--error);
            color: white;
            padding: 15px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            animation: slideIn 0.3s;
        `;
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            errorDiv.style.animation = 'slideOut 0.3s';
            setTimeout(() => errorDiv.remove(), 300);
        }, 5000);
    }

    showSuccess(message) {
        const successDiv = document.createElement('div');
        successDiv.className = 'toast toast-success';
        successDiv.textContent = message;
        successDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: var(--success);
            color: white;
            padding: 15px 20px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            animation: slideIn 0.3s;
        `;
        document.body.appendChild(successDiv);
        
        setTimeout(() => {
            successDiv.style.animation = 'slideOut 0.3s';
            setTimeout(() => successDiv.remove(), 300);
        }, 3000);
    }
}

// Wait for both DOM and electronAPI to be ready
function initializeApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAndInit);
    } else {
        checkAndInit();
    }
}

function checkAndInit() {
    // Check if electronAPI is available
    if (typeof window.electronAPI === 'undefined') {
        console.error('electronAPI is not available. Make sure preload script is loaded.');
        // Retry after a short delay (max 5 seconds)
        if (!window.initRetries) window.initRetries = 0;
        window.initRetries++;
        if (window.initRetries < 50) {
            setTimeout(checkAndInit, 100);
        } else {
            console.error('Failed to initialize: electronAPI not available after 5 seconds');
        }
        return;
    }
    
    console.log('electronAPI available, initializing app...');
    window.app = new App();
}

// Start initialization
initializeApp();

