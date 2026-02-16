/**
 * RCON panel management
 */
class RCONPanel {
    constructor() {
        this.isConnected = false;
        this.players = [];
        this.commandHistory = [];
        this.historyIndex = -1;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadConfig();
        this.startStatusPolling();
    }

    setupEventListeners() {
        // Connection controls
        document.getElementById('rcon-connect').addEventListener('click', () => this.connect());
        document.getElementById('rcon-disconnect').addEventListener('click', () => this.disconnect());

        // Quick actions
        document.getElementById('rcon-kick-btn').addEventListener('click', () => this.kickPlayer());
        document.getElementById('rcon-ban-btn').addEventListener('click', () => this.banPlayer());
        document.getElementById('rcon-say-btn').addEventListener('click', () => this.sayMessage());
        document.getElementById('rcon-refresh-players').addEventListener('click', () => this.refreshPlayers());

        // Command input
        const commandInput = document.getElementById('rcon-command');
        commandInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendCommand();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateHistory(-1);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateHistory(1);
            }
        });
        document.getElementById('rcon-send-command').addEventListener('click', () => this.sendCommand());
    }

    async loadConfig() {
        try {
            const config = await window.electronAPI.rconGetConfig();
            if (config) {
                document.getElementById('rcon-host').value = config.host || '127.0.0.1';
                document.getElementById('rcon-port').value = config.port || 2302;
                document.getElementById('rcon-password').value = config.password || '';
            }
        } catch (error) {
            console.error('Error loading RCON config:', error);
        }
    }

    async saveConfig() {
        const host = document.getElementById('rcon-host').value;
        const port = parseInt(document.getElementById('rcon-port').value) || 2302;
        const password = document.getElementById('rcon-password').value;
        const enabled = this.isConnected;

        try {
            await window.electronAPI.rconSetConfig(host, port, password, enabled);
        } catch (error) {
            console.error('Error saving RCON config:', error);
        }
    }

    async connect() {
        const host = document.getElementById('rcon-host').value;
        const port = parseInt(document.getElementById('rcon-port').value) || 2302;
        const password = document.getElementById('rcon-password').value;

        if (!host || !port) {
            window.app.showError('Please enter host and port');
            return;
        }

        try {
            const result = await window.electronAPI.rconConnect(host, port, password);
            
            if (result.success) {
                this.isConnected = true;
                this.updateConnectionUI();
                await this.saveConfig();
                window.app.showSuccess('Connected to RCON server');
                await this.refreshPlayers();
            } else {
                window.app.showError(result.error || 'Failed to connect to RCON server');
            }
        } catch (error) {
            window.app.showError(`Connection error: ${error.message}`);
        }
    }

    async disconnect() {
        try {
            const result = await window.electronAPI.rconDisconnect();
            if (result.success) {
                this.isConnected = false;
                this.updateConnectionUI();
                this.players = [];
                this.renderPlayers();
                window.app.showSuccess('Disconnected from RCON server');
            }
        } catch (error) {
            console.error('Error disconnecting:', error);
        }
    }

    updateConnectionUI() {
        const connectBtn = document.getElementById('rcon-connect');
        const disconnectBtn = document.getElementById('rcon-disconnect');
        const statusBadge = document.getElementById('rcon-status');

        if (this.isConnected) {
            connectBtn.disabled = true;
            disconnectBtn.disabled = false;
            statusBadge.textContent = 'Connected';
            statusBadge.className = 'status-badge status-success';
        } else {
            connectBtn.disabled = false;
            disconnectBtn.disabled = true;
            statusBadge.textContent = 'Disconnected';
            statusBadge.className = 'status-badge status-error';
        }
    }

    async startStatusPolling() {
        setInterval(async () => {
            if (this.isConnected) {
                try {
                    const status = await window.electronAPI.rconGetStatus();
                    if (!status.connected) {
                        this.isConnected = false;
                        this.updateConnectionUI();
                    }
                } catch (error) {
                    // Ignore polling errors
                }
            }
        }, 5000); // Poll every 5 seconds
    }

    async sendCommand() {
        if (!this.isConnected) {
            window.app.showError('Not connected to RCON server');
            return;
        }

        const commandInput = document.getElementById('rcon-command');
        const command = commandInput.value.trim();

        if (!command) {
            return;
        }

        // Add to history
        if (command !== this.commandHistory[this.commandHistory.length - 1]) {
            this.commandHistory.push(command);
            if (this.commandHistory.length > 50) {
                this.commandHistory.shift();
            }
        }
        this.historyIndex = -1;

        // Add to output
        this.addOutput(`> ${command}`, 'command');

        try {
            const result = await window.electronAPI.rconSendCommand(command);
            
            if (result.success) {
                this.addOutput(result.response || 'Command executed', 'response');
                
                // If command is #players, refresh player list
                if (command.toLowerCase().includes('#players') || command.toLowerCase().includes('players')) {
                    await this.refreshPlayers();
                }
            } else {
                this.addOutput(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            this.addOutput(`Error: ${error.message}`, 'error');
        }

        commandInput.value = '';
    }

    addOutput(text, type = 'info') {
        const output = document.getElementById('rcon-output');
        const entry = document.createElement('div');
        entry.className = `rcon-output-entry ${type}`;
        entry.textContent = text;
        output.appendChild(entry);
        output.scrollTop = output.scrollHeight;
    }

    navigateHistory(direction) {
        if (this.commandHistory.length === 0) return;

        const commandInput = document.getElementById('rcon-command');
        
        if (direction < 0) {
            // Up arrow - go back in history
            if (this.historyIndex === -1) {
                this.historyIndex = this.commandHistory.length - 1;
            } else if (this.historyIndex > 0) {
                this.historyIndex--;
            }
        } else {
            // Down arrow - go forward in history
            if (this.historyIndex !== -1) {
                this.historyIndex++;
                if (this.historyIndex >= this.commandHistory.length) {
                    this.historyIndex = -1;
                    commandInput.value = '';
                    return;
                }
            }
        }

        if (this.historyIndex >= 0) {
            commandInput.value = this.commandHistory[this.historyIndex];
        }
    }

    async refreshPlayers() {
        if (!this.isConnected) {
            return;
        }

        try {
            const result = await window.electronAPI.rconGetPlayers();
            
            if (result.success) {
                this.players = result.players || [];
                this.renderPlayers();
            } else {
                this.addOutput(`Error getting players: ${result.error}`, 'error');
            }
        } catch (error) {
            this.addOutput(`Error: ${error.message}`, 'error');
        }
    }

    renderPlayers() {
        const container = document.getElementById('rcon-players-list');
        
        if (!this.isConnected) {
            container.innerHTML = '<div class="empty-state">Not connected</div>';
            return;
        }

        if (this.players.length === 0) {
            container.innerHTML = '<div class="empty-state">No players online</div>';
            return;
        }

        container.innerHTML = this.players.map(player => `
            <div class="rcon-player-item">
                <span class="player-name">${this.escapeHtml(player.name || player.raw)}</span>
                ${player.id ? `<span class="player-id">ID: ${player.id}</span>` : ''}
            </div>
        `).join('');
    }

    async kickPlayer() {
        const playerName = document.getElementById('rcon-player-name').value.trim();
        if (!playerName) {
            window.app.showError('Please enter a player name');
            return;
        }

        if (!this.isConnected) {
            window.app.showError('Not connected to RCON server');
            return;
        }

        try {
            const result = await window.electronAPI.rconKick(playerName);
            if (result.success) {
                window.app.showSuccess(`Kicked player: ${playerName}`);
                this.addOutput(`Kicked player: ${playerName}`, 'success');
                await this.refreshPlayers();
            } else {
                window.app.showError(result.error || 'Failed to kick player');
                this.addOutput(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            window.app.showError(`Error: ${error.message}`);
        }
    }

    async banPlayer() {
        const playerName = document.getElementById('rcon-player-name').value.trim();
        if (!playerName) {
            window.app.showError('Please enter a player name');
            return;
        }

        if (!this.isConnected) {
            window.app.showError('Not connected to RCON server');
            return;
        }

        if (!confirm(`Are you sure you want to ban ${playerName}?`)) {
            return;
        }

        try {
            const result = await window.electronAPI.rconBan(playerName);
            if (result.success) {
                window.app.showSuccess(`Banned player: ${playerName}`);
                this.addOutput(`Banned player: ${playerName}`, 'success');
                await this.refreshPlayers();
            } else {
                window.app.showError(result.error || 'Failed to ban player');
                this.addOutput(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            window.app.showError(`Error: ${error.message}`);
        }
    }

    async sayMessage() {
        const message = document.getElementById('rcon-message').value.trim();
        if (!message) {
            window.app.showError('Please enter a message');
            return;
        }

        if (!this.isConnected) {
            window.app.showError('Not connected to RCON server');
            return;
        }

        try {
            const result = await window.electronAPI.rconSay(message);
            if (result.success) {
                window.app.showSuccess('Message sent');
                this.addOutput(`Sent message: ${message}`, 'success');
                document.getElementById('rcon-message').value = '';
            } else {
                window.app.showError(result.error || 'Failed to send message');
                this.addOutput(`Error: ${result.error}`, 'error');
            }
        } catch (error) {
            window.app.showError(`Error: ${error.message}`);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM and electronAPI are ready
function initializeRCONPanel() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof window.electronAPI !== 'undefined') {
                window.rconPanel = new RCONPanel();
            }
        });
    } else {
        if (typeof window.electronAPI !== 'undefined') {
            window.rconPanel = new RCONPanel();
        } else {
            const checkAPI = setInterval(() => {
                if (typeof window.electronAPI !== 'undefined') {
                    window.rconPanel = new RCONPanel();
                    clearInterval(checkAPI);
                }
            }, 100);
        }
    }
}

initializeRCONPanel();

