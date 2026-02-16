/**
 * Server management panel
 */
class ServerPanel {
    constructor() {
        this.serverPath = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadServerInfo();
    }

    setupEventListeners() {
        const selectBtn = document.getElementById('select-server-path');
        const installBtn = document.getElementById('install-server');
        const updateBtn = document.getElementById('update-server');
        const validateBtn = document.getElementById('validate-server');
        const goToControlBtn = document.getElementById('go-to-server-control');

        if (selectBtn) {
            selectBtn.addEventListener('click', () => {
                this.selectServerPath();
            });
        }

        if (installBtn) {
            console.log('Install server button found, attaching click handler');
            installBtn.addEventListener('click', () => {
                console.log('Install server button clicked');
                this.installServer();
            });
        } else {
            console.error('Install server button not found!');
        }

        if (updateBtn) {
            updateBtn.addEventListener('click', () => {
                this.updateServer();
            });
        }

        if (validateBtn) {
            validateBtn.addEventListener('click', () => {
                this.validateServer();
            });
        }

        if (goToControlBtn) {
            goToControlBtn.addEventListener('click', () => {
                window.app.switchPanel('servers');
            });
        }
    }

    async selectServerPath() {
        try {
            const path = await window.electronAPI.configSelectServerPath();
            if (path) {
                this.serverPath = path;
                await this.loadServerInfo();
            }
        } catch (error) {
            window.app.showError(`Failed to select server path: ${error.message}`);
        }
    }

    async loadServerInfo() {
        try {
            this.serverPath = await window.electronAPI.configGetServerPath();
            
            if (this.serverPath) {
                document.getElementById('server-path').textContent = this.serverPath;
                
                // Check if server is installed
                const isValid = await window.electronAPI.serverValidate(this.serverPath);
                document.getElementById('server-status').textContent = isValid ? 'Installed' : 'Not Installed';
                document.getElementById('server-status').style.color = isValid ? '#4caf50' : '#f44336';

                // Get version
                const version = await window.electronAPI.serverGetVersion(this.serverPath);
                if (version) {
                    document.getElementById('server-version').textContent = 
                        version.version || version.buildId || 'Unknown';
                } else {
                    document.getElementById('server-version').textContent = '-';
                }

                // Enable "Go to Server Control" button if server is installed
                const goToControlBtn = document.getElementById('go-to-server-control');
                if (goToControlBtn) {
                    goToControlBtn.disabled = !isValid;
                }
            } else {
                document.getElementById('server-path').textContent = 'Not set';
                document.getElementById('server-status').textContent = 'Not Configured';
                document.getElementById('server-version').textContent = '-';
                
                const goToControlBtn = document.getElementById('go-to-server-control');
                if (goToControlBtn) {
                    goToControlBtn.disabled = true;
                }
            }
        } catch (error) {
            console.error('Error loading server info:', error);
            window.app.showError(`Failed to load server info: ${error.message}`);
        }
    }

    async installServer() {
        console.log('Install server button clicked');
        
        try {
            if (!this.serverPath) {
                console.log('No server path, prompting user to select...');
                const path = await window.electronAPI.configSelectServerPath();
                if (!path) {
                    window.app.showError('Please select a server installation path first');
                    return;
                }
                this.serverPath = path;
                console.log('Server path selected:', path);
            }

            const confirmed = confirm(`Install DayZ server to:\n${this.serverPath}\n\nThis may take a while. Continue?`);
            if (!confirmed) {
                console.log('User cancelled installation');
                return;
            }

            console.log('Checking SteamCMD installation...');
            // Check SteamCMD
            const isInstalled = await window.electronAPI.steamcmdIsInstalled();
            console.log('SteamCMD installed:', isInstalled);
            
            if (!isInstalled) {
                const download = confirm('SteamCMD is not installed. Download it now?');
                if (download) {
                    console.log('Downloading SteamCMD...');
                    const downloadResult = await this.downloadSteamCMD();
                    if (!downloadResult) {
                        console.error('SteamCMD download failed');
                        return;
                    }
                } else {
                    console.log('User cancelled SteamCMD download');
                    return;
                }
            }

            console.log('Starting server installation...');
            this.showProgress();
            
            const result = await window.electronAPI.serverInstall(this.serverPath, 'public');
            console.log('Installation result:', result);
            
            this.hideProgress();
            
            if (result && result.success) {
                window.app.showSuccess('Server installed successfully');
                await this.loadServerInfo();
            } else {
                const errorMsg = result?.error || 'Failed to install server';
                console.error('Installation failed:', errorMsg);
                window.app.showError(errorMsg);
            }
        } catch (error) {
            console.error('Install server error:', error);
            this.hideProgress();
            window.app.showError(`Failed to install server: ${error.message}`);
        }
    }

    async updateServer() {
        if (!this.serverPath) {
            window.app.showError('Please select a server installation path first');
            return;
        }

        const confirmed = confirm(`Update DayZ server at:\n${this.serverPath}\n\nThis may take a while. Continue?`);
        if (!confirmed) return;

        try {
            this.showProgress();
            const result = await window.electronAPI.serverUpdate(this.serverPath);
            this.hideProgress();

            if (result.success) {
                window.app.showSuccess('Server updated successfully');
                await this.loadServerInfo();
                
                // Ensure "Go to Server Control" button is enabled
                const goToControlBtn = document.getElementById('go-to-server-control');
                if (goToControlBtn) {
                    goToControlBtn.disabled = false;
                }
            } else {
                window.app.showError(result.error || 'Failed to update server');
            }
        } catch (error) {
            this.hideProgress();
            window.app.showError(`Failed to update server: ${error.message}`);
        }
    }

    async validateServer() {
        if (!this.serverPath) {
            window.app.showError('Please select a server installation path first');
            return;
        }

        try {
            const isValid = await window.electronAPI.serverValidate(this.serverPath);
            if (isValid) {
                window.app.showSuccess('Server installation is valid');
            } else {
                window.app.showError('Server installation validation failed');
            }
            await this.loadServerInfo();
        } catch (error) {
            window.app.showError(`Failed to validate server: ${error.message}`);
        }
    }

    async downloadSteamCMD() {
        try {
            console.log('Downloading SteamCMD...');
            const result = await window.electronAPI.steamcmdDownload();
            console.log('SteamCMD download result:', result);
            
            if (!result || !result.success) {
                const errorMsg = result?.error || 'Failed to download SteamCMD';
                console.error('SteamCMD download failed:', errorMsg);
                window.app.showError(errorMsg);
                return false;
            }
            console.log('SteamCMD downloaded successfully');
            return true;
        } catch (error) {
            console.error('SteamCMD download error:', error);
            window.app.showError(`Failed to download SteamCMD: ${error.message}`);
            return false;
        }
    }

    showProgress() {
        const container = document.getElementById('server-progress');
        const fill = document.getElementById('server-progress-fill');
        const text = document.getElementById('server-progress-text');
        
        container.style.display = 'block';
        fill.style.width = '0%';
        text.textContent = 'Starting...';
    }

    hideProgress() {
        document.getElementById('server-progress').style.display = 'none';
    }

    updateProgress(data) {
        const fill = document.getElementById('server-progress-fill');
        const text = document.getElementById('server-progress-text');
        
        if (data.progress !== undefined) {
            fill.style.width = `${data.progress}%`;
        }
        
        if (data.message) {
            text.textContent = data.message;
        }
    }
}

// Initialize when DOM and electronAPI are ready
function initializeServerPanel() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof window.electronAPI !== 'undefined') {
                window.serverPanel = new ServerPanel();
            } else {
                console.error('electronAPI not available for ServerPanel');
            }
        });
    } else {
        if (typeof window.electronAPI !== 'undefined') {
            window.serverPanel = new ServerPanel();
        } else {
            console.error('electronAPI not available for ServerPanel');
        }
    }
}

initializeServerPanel();

