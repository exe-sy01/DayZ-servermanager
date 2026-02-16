/**
 * Log viewer panel
 */
class LogViewer {
    constructor() {
        this.serverPath = null;
        this.currentLogPath = null;
        this.currentTab = 'historical';
        this.logEntries = [];
        this.isTailing = false;
        this.autoScroll = true;
        this.init();
    }

    init() {
        this.setupEventListeners();
        // Load log files when panel becomes active
        this.setupPanelActivationListener();
    }

    setupPanelActivationListener() {
        // Watch for panel activation
        const observer = new MutationObserver(() => {
            const logsPanel = document.getElementById('logs-panel');
            if (logsPanel && logsPanel.classList.contains('active')) {
                this.loadLogFiles();
            }
        });

        // Observe the main content area for panel changes
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            observer.observe(mainContent, {
                attributes: true,
                attributeFilter: ['class'],
                subtree: true
            });
        }

        // Also check on initial load
        setTimeout(() => {
            const logsPanel = document.getElementById('logs-panel');
            if (logsPanel && logsPanel.classList.contains('active')) {
                this.loadLogFiles();
            }
        }, 500);
    }

    setupEventListeners() {
        document.getElementById('log-file-select').addEventListener('change', (e) => {
            if (e.target.value) {
                this.currentLogPath = e.target.value;
                if (this.currentTab === 'historical') {
                    this.loadHistoricalLogs();
                }
            }
        });

        document.getElementById('refresh-logs').addEventListener('click', () => {
            this.loadLogFiles();
        });

        document.getElementById('log-level-filter').addEventListener('change', () => {
            this.filterLogs();
        });

        document.getElementById('log-search').addEventListener('input', () => {
            this.filterLogs();
        });

        document.getElementById('export-logs').addEventListener('click', () => {
            this.exportLogs();
        });

        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        // Real-time controls
        document.getElementById('start-tail').addEventListener('click', () => {
            this.startTailing();
        });

        document.getElementById('stop-tail').addEventListener('click', () => {
            this.stopTailing();
        });

        document.getElementById('auto-scroll').addEventListener('change', (e) => {
            this.autoScroll = e.target.checked;
        });

        // Setup progress listener for real-time logs
        if (window.electronAPI) {
            window.electronAPI.onProgress('log:new-line', (event, entry) => {
                this.addLogEntry(entry);
            });
        }
    }

    switchTab(tab) {
        this.currentTab = tab;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.tab === tab) {
                btn.classList.add('active');
            }
        });

        if (tab === 'historical') {
            document.getElementById('historical-log-viewer').style.display = 'block';
            document.getElementById('realtime-log-viewer').style.display = 'none';
            if (this.currentLogPath) {
                this.loadHistoricalLogs();
            }
        } else {
            document.getElementById('historical-log-viewer').style.display = 'none';
            document.getElementById('realtime-log-viewer').style.display = 'block';
        }
    }

    async loadLogFiles() {
        try {
            this.serverPath = await window.electronAPI.configGetServerPath();
            
            if (!this.serverPath) {
                document.getElementById('log-file-select').innerHTML = 
                    '<option value="">Please set server path in Settings</option>';
                return;
            }

            const logFiles = await window.electronAPI.logListFiles(this.serverPath);
            
            const select = document.getElementById('log-file-select');
            select.innerHTML = '<option value="">Select a log file...</option>';
            
            logFiles.forEach(file => {
                const option = document.createElement('option');
                option.value = file.path;
                option.textContent = `${file.name} (${file.profile})`;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading log files:', error);
            window.app.showError(`Failed to load log files: ${error.message}`);
        }
    }

    async loadHistoricalLogs() {
        if (!this.currentLogPath) return;

        try {
            const result = await window.electronAPI.logReadFile(this.currentLogPath, 500);
            
            if (result.success) {
                this.logEntries = result.entries || [];
                this.renderLogs(this.logEntries);
            } else {
                window.app.showError(result.error || 'Failed to read log file');
            }
        } catch (error) {
            window.app.showError(`Failed to load logs: ${error.message}`);
        }
    }

    renderLogs(entries) {
        const container = this.currentTab === 'historical' 
            ? document.getElementById('historical-log-viewer')
            : document.getElementById('realtime-log-content');
        
        if (entries.length === 0) {
            container.innerHTML = '<div class="empty-state">No log entries</div>';
            return;
        }

        container.innerHTML = entries.map(entry => {
            const levelClass = entry.level ? entry.level.toLowerCase() : 'info';
            const timestamp = entry.timestamp ? `[${entry.timestamp}] ` : '';
            return `<div class="log-entry ${levelClass}">${timestamp}${this.escapeHtml(entry.message || entry.raw)}</div>`;
        }).join('');

        if (this.autoScroll && this.currentTab === 'realtime') {
            container.scrollTop = container.scrollHeight;
        }
    }

    filterLogs() {
        if (this.currentTab !== 'historical') return;

        const level = document.getElementById('log-level-filter').value;
        const search = document.getElementById('log-search').value;

        // Client-side filtering
        let filtered = [...this.logEntries];
        
        if (level) {
            filtered = filtered.filter(entry => entry.level === level);
        }
        
        if (search) {
            const searchLower = search.toLowerCase();
            filtered = filtered.filter(entry => 
                (entry.message || entry.raw || '').toLowerCase().includes(searchLower)
            );
        }
        
        this.renderLogs(filtered);
    }

    async startTailing() {
        if (!this.currentLogPath) {
            window.app.showError('Please select a log file first');
            return;
        }

        if (this.isTailing) {
            await this.stopTailing();
        }

        try {
            document.getElementById('realtime-log-content').innerHTML = '';
            
            const result = await window.electronAPI.logStartTail(this.currentLogPath);
            
            if (result.success) {
                this.isTailing = true;
                window.app.showSuccess('Started tailing log file');
            } else {
                window.app.showError(result.error || 'Failed to start tailing');
            }
        } catch (error) {
            window.app.showError(`Failed to start tailing: ${error.message}`);
        }
    }

    async stopTailing() {
        if (!this.currentLogPath || !this.isTailing) return;

        try {
            await window.electronAPI.logStopTail(this.currentLogPath);
            this.isTailing = false;
            window.app.showSuccess('Stopped tailing log file');
        } catch (error) {
            console.error('Error stopping tail:', error);
        }
    }

    addLogEntry(entry) {
        if (this.currentTab !== 'realtime') return;

        const container = document.getElementById('realtime-log-content');
        const levelClass = entry.level ? entry.level.toLowerCase() : 'info';
        const timestamp = entry.timestamp ? `[${entry.timestamp}] ` : '';
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${levelClass}`;
        logEntry.textContent = `${timestamp}${entry.message || entry.raw}`;
        
        container.appendChild(logEntry);

        if (this.autoScroll) {
            container.scrollTop = container.scrollHeight;
        }
    }

    async exportLogs() {
        if (!this.currentLogPath) {
            window.app.showError('Please select a log file first');
            return;
        }

        try {
            const outputPath = await window.electronAPI.logSelectExportPath();
            if (!outputPath) return;

            const level = document.getElementById('log-level-filter').value;
            const search = document.getElementById('log-search').value;
            const filter = (level || search) ? { level: level || null, search: search || null } : null;

            const result = await window.electronAPI.logExport(this.currentLogPath, outputPath, filter);
            
            if (result.success) {
                window.app.showSuccess('Logs exported successfully');
            } else {
                window.app.showError(result.error || 'Failed to export logs');
            }
        } catch (error) {
            window.app.showError(`Failed to export logs: ${error.message}`);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM and electronAPI are ready
function initializeLogViewer() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof window.electronAPI !== 'undefined') {
                window.logViewer = new LogViewer();
            }
        });
    } else {
        if (typeof window.electronAPI !== 'undefined') {
            window.logViewer = new LogViewer();
        }
    }
}

initializeLogViewer();

