/**
 * Server control panel
 */
class ServerControl {
    constructor() {
        this.serverPath = null;
        this.profileName = 'default';
        this.parameters = [];
        this.monitoringInterval = null;
        this.countdownInterval = null;
        this.isStarting = false;
        this.isStopping = false;
        this.eventListenersAttached = false;
        this.initialized = false;
        this._delegationHandler = null;
        this.init();
    }

    init() {
        // Check if elements exist before trying to attach listeners
        const startBtn = document.getElementById('start-server-btn');
        if (!startBtn) {
            console.log('ServerControl: Elements not ready, will retry...');
            setTimeout(() => this.init(), 100);
            return;
        }

        if (this.initialized) {
            console.log('ServerControl: Already initialized');
            return;
        }

        console.log('ServerControl: Initializing...');
        this.setupEventListeners();
        this.loadServerInfo();
        this.startMonitoring();
        this.initialized = true;
        console.log('ServerControl: Initialization complete');
    }

    setupEventListeners() {
        // Prevent multiple attachments
        if (this.eventListenersAttached) {
            console.log('Event listeners already attached, skipping...');
            return;
        }

        console.log('Setting up event listeners for ServerControl...');
        
        // Use event delegation from the panel itself
        const serversPanel = document.getElementById('servers-panel');
        if (!serversPanel) {
            console.error('servers-panel not found!');
            return;
        }

        console.log('Using event delegation from servers-panel');
        
        // Store handler reference to prevent duplicate attachments
        if (this._delegationHandler) {
            console.log('Removing existing delegation handler');
            serversPanel.removeEventListener('click', this._delegationHandler);
        }
        
        // Event delegation - attach to panel, handle clicks on buttons
        this._delegationHandler = (e) => {
            const target = e.target;
            const id = target.id;
            
            console.log('Click detected in servers-panel:', id, target);
            
            if (id === 'start-server-btn') {
                e.preventDefault();
                e.stopPropagation();
                console.log('=== START SERVER BUTTON CLICKED (via delegation) ===');
                
                if (this.isStarting) {
                    console.log('Server is already starting, ignoring click');
                    return;
                }
                
                if (!this.startServer) {
                    console.error('startServer method not found!');
                    return;
                }
                
                this.startServer().catch(error => {
                    console.error('Unhandled error in startServer:', error);
                    this.isStarting = false;
                });
            } else if (id === 'stop-server-btn') {
                e.preventDefault();
                e.stopPropagation();
                console.log('=== STOP SERVER BUTTON CLICKED (via delegation) ===');
                this.stopServer();
            } else if (id === 'restart-server-btn') {
                e.preventDefault();
                e.stopPropagation();
                console.log('=== RESTART SERVER BUTTON CLICKED (via delegation) ===');
                this.restartServer();
            } else if (id === 'restart-countdown-btn') {
                e.preventDefault();
                e.stopPropagation();
                console.log('=== RESTART WITH COUNTDOWN BUTTON CLICKED (via delegation) ===');
                this.restartWithCountdown();
            } else if (id === 'add-scheduled-restart') {
                e.preventDefault();
                e.stopPropagation();
                console.log('Add scheduled restart clicked');
                this.showScheduledRestartModal();
            } else if (id === 'server-control-select-path') {
                e.preventDefault();
                e.stopPropagation();
                console.log('Select path clicked');
                this.selectServerPath();
            } else if (id === 'go-to-installation') {
                e.preventDefault();
                e.stopPropagation();
                console.log('Go to installation clicked');
                if (window.app) {
                    window.app.switchPanel('server');
                }
            } else if (id === 'save-scheduled-restart') {
                e.preventDefault();
                e.stopPropagation();
                console.log('Save scheduled restart clicked');
                this.saveScheduledRestart();
            } else if (id === 'close-scheduled-restart' || id === 'cancel-scheduled-restart') {
                e.preventDefault();
                e.stopPropagation();
                console.log('Close/cancel scheduled restart clicked');
                this.hideScheduledRestartModal();
            } else if (id === 'cancel-countdown') {
                e.preventDefault();
                e.stopPropagation();
                console.log('Cancel countdown clicked');
                this.cancelCountdown();
            }
        };
        
        serversPanel.addEventListener('click', this._delegationHandler);
        
        // Also try direct attachment as backup
        const startBtn = document.getElementById('start-server-btn');
        const stopBtn = document.getElementById('stop-server-btn');
        const restartBtn = document.getElementById('restart-server-btn');
        const restartCountdownBtn = document.getElementById('restart-countdown-btn');
        const addScheduleBtn = document.getElementById('add-scheduled-restart');
        const selectPathBtn = document.getElementById('server-control-select-path');
        const goToInstallBtn = document.getElementById('go-to-installation');
        const saveScheduleBtn = document.getElementById('save-scheduled-restart');
        const closeScheduleBtn = document.getElementById('close-scheduled-restart');
        const cancelScheduleBtn = document.getElementById('cancel-scheduled-restart');
        const cancelCountdownBtn = document.getElementById('cancel-countdown');

        console.log('Buttons found:', {
            startBtn: !!startBtn,
            stopBtn: !!stopBtn,
            restartBtn: !!restartBtn,
            restartCountdownBtn: !!restartCountdownBtn,
            addScheduleBtn: !!addScheduleBtn,
            selectPathBtn: !!selectPathBtn,
            goToInstallBtn: !!goToInstallBtn
        });

        if (startBtn) {
            console.log('Attaching click handler to start button');
            console.log('Button element:', startBtn);
            console.log('Button disabled:', startBtn.disabled);
            console.log('Button style:', window.getComputedStyle(startBtn).pointerEvents);
            
            // Store reference to this for use in handler
            const self = this;
            
            const startHandler = function(e) {
                e.preventDefault();
                e.stopPropagation();
                console.log('=== START SERVER BUTTON CLICKED ===');
                console.log('Event:', e);
                console.log('This context:', self);
                console.log('isStarting:', self.isStarting);
                
                // Prevent multiple simultaneous starts
                if (self.isStarting) {
                    console.log('Server is already starting, ignoring click');
                    return;
                }
                
                if (!self.startServer) {
                    console.error('startServer method not found!');
                    alert('startServer method not found!');
                    return;
                }
                
                console.log('Calling startServer...');
                self.startServer().catch(error => {
                    console.error('Unhandled error in startServer:', error);
                    self.isStarting = false;
                });
            };
            
            // Remove any existing listeners first
            const newStartBtn = startBtn.cloneNode(true);
            startBtn.parentNode.replaceChild(newStartBtn, startBtn);
            
            // Attach to the new element
            newStartBtn.addEventListener('click', startHandler, true); // Use capture phase
            console.log('Start button handler attached to:', newStartBtn);
            
            // Also test direct onclick
            newStartBtn.onclick = function(e) {
                console.log('onclick handler fired!');
                startHandler(e);
            };
        } else {
            console.error('Start server button not found!');
        }

        if (stopBtn) {
            const self = this;
            const stopHandler = function() {
                console.log('=== STOP SERVER BUTTON CLICKED ===');
                self.stopServer();
            };
            
            const newStopBtn = stopBtn.cloneNode(true);
            stopBtn.parentNode.replaceChild(newStopBtn, stopBtn);
            newStopBtn.addEventListener('click', stopHandler, true);
            newStopBtn.onclick = stopHandler;
            console.log('Stop button handler attached');
        } else {
            console.error('Stop server button not found!');
        }

        if (restartBtn) {
            const self = this;
            const restartHandler = function() {
                console.log('=== RESTART SERVER BUTTON CLICKED ===');
                self.restartServer();
            };
            
            const newRestartBtn = restartBtn.cloneNode(true);
            restartBtn.parentNode.replaceChild(newRestartBtn, restartBtn);
            newRestartBtn.addEventListener('click', restartHandler, true);
            newRestartBtn.onclick = restartHandler;
            console.log('Restart button handler attached');
        } else {
            console.error('Restart server button not found!');
        }

        if (restartCountdownBtn) {
            const self = this;
            const countdownHandler = function() {
                console.log('=== RESTART WITH COUNTDOWN BUTTON CLICKED ===');
                self.restartWithCountdown();
            };
            
            const newCountdownBtn = restartCountdownBtn.cloneNode(true);
            restartCountdownBtn.parentNode.replaceChild(newCountdownBtn, restartCountdownBtn);
            newCountdownBtn.addEventListener('click', countdownHandler, true);
            newCountdownBtn.onclick = countdownHandler;
            console.log('Restart countdown button handler attached');
        } else {
            console.error('Restart countdown button not found!');
        }

        if (addScheduleBtn) {
            addScheduleBtn.addEventListener('click', () => {
                console.log('Add scheduled restart button clicked');
                this.showScheduledRestartModal();
            });
            console.log('Add schedule button handler attached');
        }

        if (selectPathBtn) {
            selectPathBtn.addEventListener('click', () => {
                console.log('Select path button clicked');
                this.selectServerPath();
            });
            console.log('Select path button handler attached');
        }

        if (goToInstallBtn) {
            goToInstallBtn.addEventListener('click', () => {
                console.log('Go to installation button clicked');
                if (window.app) {
                    window.app.switchPanel('server');
                } else {
                    console.error('window.app not found!');
                }
            });
            console.log('Go to installation button handler attached');
        }

        if (saveScheduleBtn) {
            saveScheduleBtn.addEventListener('click', () => {
                console.log('Save scheduled restart button clicked');
                this.saveScheduledRestart();
            });
            console.log('Save schedule button handler attached');
        }

        if (closeScheduleBtn) {
            closeScheduleBtn.addEventListener('click', () => {
                console.log('Close schedule modal button clicked');
                this.hideScheduledRestartModal();
            });
            console.log('Close schedule button handler attached');
        }

        if (cancelScheduleBtn) {
            cancelScheduleBtn.addEventListener('click', () => {
                console.log('Cancel schedule button clicked');
                this.hideScheduledRestartModal();
            });
            console.log('Cancel schedule button handler attached');
        }

        if (cancelCountdownBtn) {
            cancelCountdownBtn.addEventListener('click', () => {
                console.log('Cancel countdown button clicked');
                this.cancelCountdown();
            });
            console.log('Cancel countdown button handler attached');
        }

        // Setup progress listener for stats updates
        if (window.electronAPI) {
            window.electronAPI.onProgress('server-control:stats-update', (event, data) => {
                this.updateStats(data);
            });
            console.log('Progress listener attached');
        }

        // Mark as attached
        this.eventListenersAttached = true;
        console.log('✓ All event listeners attached successfully');
        
        // Test: Try to find buttons again after cloning
        const testStartBtn = document.getElementById('start-server-btn');
        const testStopBtn = document.getElementById('stop-server-btn');
        console.log('Button verification after attachment:', {
            startBtn: testStartBtn ? { 
                disabled: testStartBtn.disabled, 
                text: testStartBtn.textContent,
                hasOnclick: testStartBtn.onclick !== null
            } : 'NOT FOUND',
            stopBtn: testStopBtn ? { 
                disabled: testStopBtn.disabled, 
                text: testStopBtn.textContent 
            } : 'NOT FOUND'
        });
        
        // Add a global test function
        window.testServerButtons = function() {
            console.log('Testing buttons...');
            const btn = document.getElementById('start-server-btn');
            if (btn) {
                console.log('Start button found, clicking programmatically...');
                btn.click();
            } else {
                console.error('Start button not found!');
            }
        };
        console.log('Test function available: window.testServerButtons()');
    }

    async loadServerInfo() {
        try {
            this.serverPath = await window.electronAPI.configGetServerPath();
            
            // Update path display
            const pathElement = document.getElementById('server-control-path');
            if (pathElement) {
                pathElement.textContent = this.serverPath || 'Not set';
            }
            
            if (this.serverPath) {
                // Check installation status
                const isValid = await window.electronAPI.serverValidate(this.serverPath);
                const installStatusElement = document.getElementById('server-control-install-status');
                if (installStatusElement) {
                    installStatusElement.textContent = isValid ? 'Installed' : 'Not Installed';
                    installStatusElement.style.color = isValid ? '#4caf50' : '#f44336';
                }

                // Load profiles - always ensure default profile exists
                const profiles = await window.electronAPI.serverListProfiles(this.serverPath);
                const select = document.getElementById('server-profile-select');
                if (select) {
                    select.innerHTML = '';
                    
                    // Always include 'default' profile if it doesn't exist
                    const profileSet = new Set(profiles || []);
                    if (!profileSet.has('default')) {
                        profileSet.add('default');
                    }
                    
                    const sortedProfiles = Array.from(profileSet).sort();
                    
                    sortedProfiles.forEach(profile => {
                        const option = document.createElement('option');
                        option.value = profile;
                        option.textContent = profile;
                        if (profile === 'default') {
                            option.selected = true;
                        }
                        select.appendChild(option);
                    });
                    
                    // Default to 'default' profile
                    this.profileName = 'default';
                    if (select.value !== 'default') {
                        select.value = 'default';
                    }
                }

                // Enable/disable start button based on installation
                const startBtn = document.getElementById('start-server-btn');
                if (startBtn) {
                    startBtn.disabled = !isValid;
                }
            } else {
                const installStatusElement = document.getElementById('server-control-install-status');
                if (installStatusElement) {
                    installStatusElement.textContent = 'Not Configured';
                    installStatusElement.style.color = '#f44336';
                }

                const startBtn = document.getElementById('start-server-btn');
                if (startBtn) {
                    startBtn.disabled = true;
                }
            }

            // Load current status
            await this.updateStatus();
            await this.loadScheduledRestarts();
        } catch (error) {
            console.error('Error loading server info:', error);
        }
    }

    async selectServerPath() {
        try {
            const path = await window.electronAPI.configSelectServerPath();
            if (path) {
                await this.loadServerInfo();
            }
        } catch (error) {
            window.app.showError(`Failed to select server path: ${error.message}`);
        }
    }

    async updateStatus() {
        try {
            const status = await window.electronAPI.serverControlGetStatus();
            const statusElement = document.getElementById('server-control-status');
            const pidElement = document.getElementById('server-pid');
            
            if (status.isRunning) {
                statusElement.textContent = 'Running';
                statusElement.className = 'status-badge running';
                pidElement.textContent = status.pid || '-';
                
                document.getElementById('start-server-btn').disabled = true;
                document.getElementById('stop-server-btn').disabled = false;
                document.getElementById('restart-server-btn').disabled = false;
                document.getElementById('restart-countdown-btn').disabled = false;
            } else {
                statusElement.textContent = 'Stopped';
                statusElement.className = 'status-badge stopped';
                pidElement.textContent = '-';
                
                document.getElementById('start-server-btn').disabled = false;
                document.getElementById('stop-server-btn').disabled = true;
                document.getElementById('restart-server-btn').disabled = true;
                document.getElementById('restart-countdown-btn').disabled = true;
            }
        } catch (error) {
            console.error('Error updating status:', error);
        }
    }

    updateStats(data) {
        if (data.stats) {
            document.getElementById('server-cpu').textContent = `${data.stats.cpu.toFixed(1)}%`;
            document.getElementById('server-ram').textContent = `${data.stats.memoryMB} MB`;
        }

        if (data.playerCount) {
            const max = data.playerCount.max || 0;
            document.getElementById('player-count').textContent = `${data.playerCount.count}/${max}`;
        }

        if (data.status) {
            this.updateStatusDisplay(data.status);
        }
    }

    updateStatusDisplay(status) {
        // Status is updated separately
    }

    async startServer() {
        console.log('startServer called');
        
        // Prevent multiple simultaneous starts
        if (this.isStarting) {
            console.log('Server is already starting, ignoring request');
            return;
        }

        // Check if server is already running
        try {
            const status = await window.electronAPI.serverControlGetStatus();
            if (status.isRunning) {
                const errorMsg = 'Server is already running';
                console.error(errorMsg);
                if (window.app) {
                    window.app.showError(errorMsg);
                }
                return;
            }
        } catch (error) {
            console.error('Error checking server status:', error);
        }

        this.isStarting = true;
        
        // Disable start button
        const startBtn = document.getElementById('start-server-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = 'Starting...';
        }
        
        try {
            // Reload server path if not set
            if (!this.serverPath) {
                console.log('Server path not set, loading from config...');
                this.serverPath = await window.electronAPI.configGetServerPath();
            }
            
            if (!this.serverPath) {
                const errorMsg = 'Please set server installation path in Settings first';
                console.error(errorMsg);
                if (window.app) {
                    window.app.showError(errorMsg);
                } else {
                    alert(errorMsg);
                }
                this.isStarting = false;
                if (startBtn) {
                    startBtn.disabled = false;
                    startBtn.textContent = 'Start Server';
                }
                return;
            }

            console.log('Using server path:', this.serverPath);

            const profileSelect = document.getElementById('server-profile-select');
            const paramsInput = document.getElementById('server-parameters');
            
            this.profileName = profileSelect ? profileSelect.value : 'default';
            const paramsText = paramsInput ? paramsInput.value : '';
            this.parameters = paramsText ? paramsText.split(' ').filter(p => p.trim()) : [];

            // Get ordered mods and use their actual folder names
            let modParameter = '';
            try {
                // Get ordered mods from config
                const orderedModsResult = await window.electronAPI.configGetModsOrdered();
                const orderedMods = orderedModsResult.success ? orderedModsResult.mods : [];
                
                if (orderedMods.length > 0) {
                    // Get installed mods to match with ordered mods
                    const installedMods = await window.electronAPI.workshopListInstalled(this.serverPath);
                    
                    // Build mod parameter in load order
                    const modNames = [];
                    for (const orderedMod of orderedMods) {
                        // Find matching installed mod by workshop ID
                        const installedMod = installedMods.find(im => 
                            String(im.workshopId) === String(orderedMod.workshopId)
                        );
                        
                        if (installedMod && installedMod.modName) {
                            // Use modName from mod.info (actual folder name)
                            let modName = installedMod.modName;
                            // Remove ALL @ symbols from anywhere in the name
                            modName = modName.replace(/@/g, '');
                            modName = modName.trim();
                            modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
                            modNames.push(`@${modName}`);
                        }
                    }
                    
                    if (modNames.length > 0) {
                        modParameter = `-mod=${modNames.join(';')}`;
                        console.log('Mods to load (in order):', modNames);
                    }
                }
            } catch (error) {
                console.warn('Could not load mod list:', error);
            }

            // Add mod parameter to parameters if it exists
            if (modParameter) {
                this.parameters.push(modParameter);
            }

            console.log('Starting server with:', {
                path: this.serverPath,
                profile: this.profileName,
                parameters: this.parameters,
                modParameter: modParameter || 'none'
            });

            if (!window.electronAPI) {
                throw new Error('electronAPI not available');
            }

            const result = await window.electronAPI.serverControlStart(
                this.serverPath,
                this.profileName,
                this.parameters
            );

            console.log('Start server result:', result);

            if (result && result.success) {
                const successMsg = `Server started successfully (PID: ${result.pid || 'unknown'})`;
                if (window.app) {
                    window.app.showSuccess(successMsg);
                } else {
                    alert(successMsg);
                }
                await this.updateStatus();
            } else {
                const errorMsg = result?.error || 'Failed to start server';
                console.error('Start server failed:', errorMsg);
                console.error('Full result:', result);
                if (window.app) {
                    window.app.showError(errorMsg);
                } else {
                    alert(`Error: ${errorMsg}`);
                }
            }
        } catch (error) {
            console.error('Error starting server:', error);
            const errorMsg = `Failed to start server: ${error.message}`;
            if (window.app) {
                window.app.showError(errorMsg);
            } else {
                alert(errorMsg);
            }
        } finally {
            this.isStarting = false;
            // Re-enable button if server didn't start
            const startBtn = document.getElementById('start-server-btn');
            if (startBtn) {
                try {
                    const status = await window.electronAPI.serverControlGetStatus();
                    startBtn.disabled = status.isRunning;
                } catch (e) {
                    // If status check fails, just enable the button
                    startBtn.disabled = false;
                }
                startBtn.textContent = 'Start Server';
            }
        }
    }

    async stopServer() {
        console.log('stopServer called');
        const confirmed = confirm('Are you sure you want to stop the server?');
        if (!confirmed) {
            console.log('Stop cancelled by user');
            return;
        }

        try {
            const result = await window.electronAPI.serverControlStop();
            
            if (result.success) {
                window.app.showSuccess('Server stopped successfully');
                await this.updateStatus();
            } else {
                window.app.showError(result.error || 'Failed to stop server');
            }
        } catch (error) {
            window.app.showError(`Failed to stop server: ${error.message}`);
        } finally {
            this.isStopping = false;
        }
    }

    async restartServer() {
        const confirmed = confirm('Are you sure you want to restart the server?');
        if (!confirmed) return;

        if (!this.serverPath) {
            window.app.showError('Server path not set');
            return;
        }

        this.profileName = document.getElementById('server-profile-select').value;
        const paramsText = document.getElementById('server-parameters').value;
        this.parameters = paramsText ? paramsText.split(' ').filter(p => p.trim()) : [];

        // Get ordered mods and use their actual folder names
        try {
            const orderedModsResult = await window.electronAPI.configGetModsOrdered();
            const orderedMods = orderedModsResult.success ? orderedModsResult.mods : [];
            
            if (orderedMods.length > 0) {
                const installedMods = await window.electronAPI.workshopListInstalled(this.serverPath);
                const modNames = [];
                
                for (const orderedMod of orderedMods) {
                    const installedMod = installedMods.find(im => 
                        String(im.workshopId) === String(orderedMod.workshopId)
                    );
                    
                    if (installedMod && installedMod.modName) {
                        let modName = installedMod.modName;
                        modName = modName.replace(/@/g, '');
                        modName = modName.trim();
                        modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
                        modNames.push(`@${modName}`);
                    }
                }
                
                if (modNames.length > 0) {
                    const modParameter = `-mod=${modNames.join(';')}`;
                    this.parameters.push(modParameter);
                }
            }
        } catch (error) {
            console.warn('Could not load mod list for restart:', error);
        }

        try {
            const result = await window.electronAPI.serverControlRestart(
                this.serverPath,
                this.profileName,
                this.parameters,
                0
            );

            if (result.success) {
                window.app.showSuccess('Server restarting...');
                await this.updateStatus();
            } else {
                window.app.showError(result.error || 'Failed to restart server');
            }
        } catch (error) {
            window.app.showError(`Failed to restart server: ${error.message}`);
        }
    }

    async restartWithCountdown() {
        console.log('restartWithCountdown called');
        if (!this.serverPath) {
            window.app.showError('Server path not set');
            return;
        }

        const countdownInput = prompt('Enter countdown in seconds (default: 60):', '60');
        if (!countdownInput) return;

        const countdown = parseInt(countdownInput) || 60;
        if (countdown < 1) {
            window.app.showError('Countdown must be at least 1 second');
            return;
        }

        this.profileName = document.getElementById('server-profile-select').value;
        const paramsText = document.getElementById('server-parameters').value;
        this.parameters = paramsText ? paramsText.split(' ').filter(p => p.trim()) : [];

        // Get ordered mods and use their actual folder names
        try {
            const orderedModsResult = await window.electronAPI.configGetModsOrdered();
            const orderedMods = orderedModsResult.success ? orderedModsResult.mods : [];
            
            if (orderedMods.length > 0) {
                const installedMods = await window.electronAPI.workshopListInstalled(this.serverPath);
                const modNames = [];
                
                for (const orderedMod of orderedMods) {
                    const installedMod = installedMods.find(im => 
                        String(im.workshopId) === String(orderedMod.workshopId)
                    );
                    
                    if (installedMod && installedMod.modName) {
                        let modName = installedMod.modName;
                        modName = modName.replace(/@/g, '');
                        modName = modName.trim();
                        modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
                        modNames.push(`@${modName}`);
                    }
                }
                
                if (modNames.length > 0) {
                    const modParameter = `-mod=${modNames.join(';')}`;
                    this.parameters.push(modParameter);
                }
            }
        } catch (error) {
            console.warn('Could not load mod list for restart:', error);
        }

        // Show countdown modal
        const modal = document.getElementById('restart-countdown-modal');
        const countdownDisplay = document.getElementById('countdown-display');
        const countdownSeconds = document.getElementById('countdown-seconds');
        modal.classList.add('active');

        let remaining = countdown;

        this.countdownInterval = setInterval(() => {
            remaining--;
            countdownDisplay.textContent = remaining;
            countdownSeconds.textContent = remaining;

            if (remaining <= 0) {
                clearInterval(this.countdownInterval);
                modal.classList.remove('active');
                this.performRestart();
            }
        }, 1000);
    }

    cancelCountdown() {
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        document.getElementById('restart-countdown-modal').classList.remove('active');
    }

    async performRestart() {
        try {
            const result = await window.electronAPI.serverControlRestart(
                this.serverPath,
                this.profileName,
                this.parameters,
                0
            );

            if (result.success) {
                window.app.showSuccess('Server restarting...');
                await this.updateStatus();
            } else {
                window.app.showError(result.error || 'Failed to restart server');
            }
        } catch (error) {
            window.app.showError(`Failed to restart server: ${error.message}`);
        }
    }

    showScheduledRestartModal() {
        document.getElementById('scheduled-restart-modal').classList.add('active');
        // Set default time to 1 hour from now
        const now = new Date();
        now.setHours(now.getHours() + 1);
        document.getElementById('restart-time').value = now.toISOString().slice(0, 16);
    }

    hideScheduledRestartModal() {
        document.getElementById('scheduled-restart-modal').classList.remove('active');
    }

    async saveScheduledRestart() {
        const timeInput = document.getElementById('restart-time').value;
        const repeat = document.getElementById('restart-repeat').value;

        if (!timeInput) {
            window.app.showError('Please select a restart time');
            return;
        }

        if (!this.serverPath) {
            window.app.showError('Server path not set');
            return;
        }

        this.profileName = document.getElementById('server-profile-select').value;
        const paramsText = document.getElementById('server-parameters').value;
        this.parameters = paramsText ? paramsText.split(' ').filter(p => p.trim()) : [];

        // Get ordered mods and use their actual folder names
        try {
            const orderedModsResult = await window.electronAPI.configGetModsOrdered();
            const orderedMods = orderedModsResult.success ? orderedModsResult.mods : [];
            
            if (orderedMods.length > 0) {
                const installedMods = await window.electronAPI.workshopListInstalled(this.serverPath);
                const modNames = [];
                
                for (const orderedMod of orderedMods) {
                    const installedMod = installedMods.find(im => 
                        String(im.workshopId) === String(orderedMod.workshopId)
                    );
                    
                    if (installedMod && installedMod.modName) {
                        let modName = installedMod.modName;
                        modName = modName.replace(/@/g, '');
                        modName = modName.trim();
                        modName = modName.replace(/[^a-zA-Z0-9_-]/g, '');
                        modNames.push(`@${modName}`);
                    }
                }
                
                if (modNames.length > 0) {
                    const modParameter = `-mod=${modNames.join(';')}`;
                    this.parameters.push(modParameter);
                }
            }
        } catch (error) {
            console.warn('Could not load mod list from config for scheduled restart:', error);
        }

        try {
            const time = new Date(timeInput);
            const result = await window.electronAPI.serverControlScheduleRestart(
                time.toISOString(),
                this.serverPath,
                this.profileName,
                this.parameters
            );

            if (result) {
                window.app.showSuccess('Scheduled restart added');
                this.hideScheduledRestartModal();
                await this.loadScheduledRestarts();
            }
        } catch (error) {
            window.app.showError(`Failed to schedule restart: ${error.message}`);
        }
    }

    async loadScheduledRestarts() {
        try {
            const restarts = await window.electronAPI.serverControlGetScheduledRestarts();
            const container = document.getElementById('scheduled-restarts-list');

            if (restarts.length === 0) {
                container.innerHTML = '<div class="empty-state">No scheduled restarts</div>';
                return;
            }

            container.innerHTML = restarts.map(restart => {
                const time = new Date(restart.time);
                return `
                    <div class="scheduled-restart-item">
                        <div class="restart-info">
                            <div class="restart-time">${time.toLocaleString()}</div>
                            <div class="restart-profile">Profile: ${restart.profileName}</div>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="window.serverControl.cancelScheduledRestart('${restart.id}')">Cancel</button>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading scheduled restarts:', error);
        }
    }

    async cancelScheduledRestart(id) {
        try {
            await window.electronAPI.serverControlCancelScheduledRestart(id);
            window.app.showSuccess('Scheduled restart cancelled');
            await this.loadScheduledRestarts();
        } catch (error) {
            window.app.showError(`Failed to cancel scheduled restart: ${error.message}`);
        }
    }

    startMonitoring() {
        // Status updates come via IPC events
        // Also poll periodically for status
        setInterval(async () => {
            await this.updateStatus();
        }, 5000);
    }
}

// Initialize when DOM and electronAPI are ready
function initializeServerControl() {
    let initRetries = 0;
    const maxRetries = 100; // 10 seconds max wait

    function tryInit() {
        initRetries++;
        
        if (initRetries > maxRetries) {
            console.error('Failed to initialize ServerControl: timeout waiting for elements');
            return;
        }

        if (typeof window.electronAPI === 'undefined') {
            console.log('Waiting for electronAPI...');
            setTimeout(tryInit, 100);
            return;
        }

        // Check if elements exist
        const startBtn = document.getElementById('start-server-btn');
        if (!startBtn) {
            console.log('Server control elements not found, waiting...');
            setTimeout(tryInit, 100);
            return;
        }

        console.log('All elements found, initializing ServerControl...');
        try {
            if (window.serverControl) {
                console.log('ServerControl already exists, re-initializing...');
                // Reset flags to allow re-initialization
                window.serverControl.initialized = false;
                window.serverControl.eventListenersAttached = false;
                window.serverControl.init();
                return;
            }
            window.serverControl = new ServerControl();
            console.log('ServerControl initialized successfully');
            
            // Verify button is still there and has handler
            const verifyBtn = document.getElementById('start-server-btn');
            if (verifyBtn) {
                console.log('Button verified after initialization, disabled:', verifyBtn.disabled);
            } else {
                console.error('Button disappeared after initialization!');
            }
        } catch (error) {
            console.error('Error initializing ServerControl:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
}

initializeServerControl();

// Also try to initialize when panel becomes visible
document.addEventListener('DOMContentLoaded', () => {
    // Watch for panel visibility changes
    const serversPanel = document.getElementById('servers-panel');
    if (serversPanel) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (serversPanel.classList.contains('active')) {
                        console.log('Servers panel became active');
                        if (!window.serverControl) {
                            console.log('Re-initializing ServerControl...');
                            initializeServerControl();
                        } else {
                            // Reload server info when panel becomes active
                            console.log('Reloading server info and ensuring listeners are attached...');
                            window.serverControl.loadServerInfo();
                            // Re-attach listeners in case they weren't attached initially
                            if (!window.serverControl.eventListenersAttached) {
                                console.log('Event listeners not attached, attaching now...');
                                window.serverControl.setupEventListeners();
                            }
                        }
                    }
                }
            });
        });
        observer.observe(serversPanel, { attributes: true, attributeFilter: ['class'] });
    }
});

