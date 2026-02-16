/**
 * Config editor panel
 */
class ConfigEditor {
    constructor() {
        this.currentConfigPath = null;
        this.serverPath = null;
        this.originalContent = '';
        this.ceFilesData = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('config-file-select').addEventListener('change', (e) => {
            if (e.target.value) {
                this.loadConfigFile(e.target.value);
            }
        });

        document.getElementById('refresh-configs').addEventListener('click', () => {
            this.loadConfigFiles();
        });

        document.getElementById('save-config').addEventListener('click', () => {
            this.saveConfig();
        });

        document.getElementById('validate-config').addEventListener('click', () => {
            this.validateConfig();
        });

        document.getElementById('reload-config').addEventListener('click', () => {
            if (this.currentConfigPath) {
                this.loadConfigFile(this.currentConfigPath);
            }
        });

        // CE Folder Editor listeners
        const scanCEFolderBtn = document.getElementById('scan-ce-folder');
        if (scanCEFolderBtn) {
            scanCEFolderBtn.addEventListener('click', () => {
                console.log('Scan CE folder button clicked');
                this.scanCEFolder();
            });
        }

        const saveCEFolderBtn = document.getElementById('save-ce-folder');
        if (saveCEFolderBtn) {
            saveCEFolderBtn.addEventListener('click', () => {
                console.log('Save CE folder button clicked');
                this.saveCEFolder();
            });
        }

        const reloadCEFolderBtn = document.getElementById('reload-ce-folder');
        if (reloadCEFolderBtn) {
            reloadCEFolderBtn.addEventListener('click', () => {
                console.log('Reload CE folder button clicked');
                this.scanCEFolder();
            });
        }

        const ceMissionSelect = document.getElementById('ce-mission-select');
        if (ceMissionSelect) {
            ceMissionSelect.addEventListener('change', (e) => {
                console.log('Mission selection changed:', e.target.value);
                // Don't reload missions on change, just allow selection
            });
        }
    }

    async loadConfigFiles() {
        try {
            this.serverPath = await window.electronAPI.configGetServerPath();
            
            if (!this.serverPath) {
                document.getElementById('config-file-select').innerHTML = 
                    '<option value="">Please set server path in Settings</option>';
                return;
            }

            const configFiles = await window.electronAPI.configListFiles(this.serverPath);
            
            const select = document.getElementById('config-file-select');
            select.innerHTML = '<option value="">Select a config file...</option>';
            
            configFiles.forEach(file => {
                const option = document.createElement('option');
                option.value = file.path;
                option.textContent = file.name;
                select.appendChild(option);
            });

            // Also load missions for CE folder editor
            await this.loadCEFolderInfo();
        } catch (error) {
            console.error('Error loading config files:', error);
            window.app.showError(`Failed to load config files: ${error.message}`);
        }
    }

    async loadConfigFile(configPath) {
        try {
            const result = await window.electronAPI.configReadFile(configPath);
            
            if (result.success) {
                this.currentConfigPath = configPath;
                this.originalContent = result.content;
                document.getElementById('config-editor').value = result.content;
                this.clearStatus();
            } else {
                window.app.showError(result.error || 'Failed to load config file');
            }
        } catch (error) {
            window.app.showError(`Failed to load config file: ${error.message}`);
        }
    }

    async saveConfig() {
        if (!this.currentConfigPath) {
            window.app.showError('No config file selected');
            return;
        }

        const content = document.getElementById('config-editor').value;
        
        // Validate before saving
        const fileType = this.getFileType(this.currentConfigPath);
        const validation = await window.electronAPI.configValidate(content, fileType);
        
        if (!validation.valid && validation.errors.length > 0) {
            const proceed = confirm(`Validation found errors:\n${validation.errors.join('\n')}\n\nSave anyway?`);
            if (!proceed) return;
        }

        try {
            const result = await window.electronAPI.configSaveFile(this.currentConfigPath, content);
            
            if (result.success) {
                this.originalContent = content;
                this.showStatus('Config saved successfully', 'success');
            } else {
                window.app.showError(result.error || 'Failed to save config file');
            }
        } catch (error) {
            window.app.showError(`Failed to save config file: ${error.message}`);
        }
    }

    async validateConfig() {
        if (!this.currentConfigPath) {
            window.app.showError('No config file selected');
            return;
        }

        const content = document.getElementById('config-editor').value;
        const fileType = this.getFileType(this.currentConfigPath);
        
        try {
            const validation = await window.electronAPI.configValidate(content, fileType);
            
            if (validation.valid) {
                this.showStatus('Config is valid', 'success');
            } else {
                let message = 'Validation errors:\n' + validation.errors.join('\n');
                if (validation.warnings.length > 0) {
                    message += '\n\nWarnings:\n' + validation.warnings.join('\n');
                }
                this.showStatus(message, 'error');
            }
        } catch (error) {
            window.app.showError(`Failed to validate config: ${error.message}`);
        }
    }

    getFileType(filePath) {
        const ext = filePath.split('.').pop().toLowerCase();
        // Return appropriate type for syntax highlighting
        if (ext === 'xml') return 'xml';
        if (ext === 'c') return 'c';
        if (ext === 'sqm') return 'sqm';
        return 'cfg'; // Default to cfg for .cfg and other files
    }

    showStatus(message, type) {
        const status = document.getElementById('config-status');
        status.textContent = message;
        status.className = `config-status ${type}`;
        status.style.display = 'block';
    }

    clearStatus() {
        const status = document.getElementById('config-status');
        status.style.display = 'none';
        status.textContent = '';
    }

    async loadCEFolderInfo() {
        try {
            console.log('Loading CE folder info (missions)...');
            
            if (!this.serverPath) {
                this.serverPath = await window.electronAPI.configGetServerPath();
            }

            if (!this.serverPath) {
                console.warn('No server path available for loading missions');
                const select = document.getElementById('ce-mission-select');
                if (select) {
                    select.innerHTML = '<option value="">Please set server path in Settings</option>';
                }
                return;
            }

            console.log('Loading missions from server path:', this.serverPath);
            
            // Load missions
            const missions = await window.electronAPI.configListMissions(this.serverPath);
            console.log('Missions loaded:', missions);
            
            const select = document.getElementById('ce-mission-select');
            
            if (!select) {
                console.error('ce-mission-select element not found');
                return;
            }
            
            select.innerHTML = '<option value="">Select a mission...</option>';
            
            if (missions && missions.length > 0) {
                missions.forEach(mission => {
                    const option = document.createElement('option');
                    option.value = mission.name;
                    option.textContent = mission.name;
                    select.appendChild(option);
                });
                console.log(`Loaded ${missions.length} missions into dropdown`);
            } else {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No missions found';
                select.appendChild(option);
                console.warn('No missions found');
            }
        } catch (error) {
            console.error('Error loading missions:', error);
            const select = document.getElementById('ce-mission-select');
            if (select) {
                select.innerHTML = '<option value="">Error loading missions</option>';
            }
            if (window.app && window.app.showError) {
                window.app.showError(`Failed to load missions: ${error.message}`);
            }
        }
    }

    async scanCEFolder() {
        const missionSelect = document.getElementById('ce-mission-select');
        const folderInput = document.getElementById('ce-folder-name');
        const filesContainer = document.getElementById('ce-folder-files');
        const filesList = document.getElementById('ce-files-list');

        if (!missionSelect || !folderInput) {
            window.app.showError('Mission and folder name are required');
            return;
        }

        const missionName = missionSelect.value;
        const folderName = folderInput.value.trim();

        if (!missionName) {
            window.app.showError('Please select a mission');
            return;
        }

        if (!folderName) {
            window.app.showError('Please enter a CE folder name');
            return;
        }

        try {
            if (!this.serverPath) {
                this.serverPath = await window.electronAPI.configGetServerPath();
            }

            const result = await window.electronAPI.configScanCEFolder(this.serverPath, missionName, folderName);

            if (result.success) {
                // Store files data for later use
                this.ceFilesData = result.files;
                this.renderCEFiles(result.files);
                filesContainer.style.display = 'block';
            } else {
                window.app.showError(result.error || 'Failed to scan CE folder');
            }
        } catch (error) {
            window.app.showError(`Failed to scan CE folder: ${error.message}`);
        }
    }

    renderCEFiles(files) {
        const filesList = document.getElementById('ce-files-list');
        
        if (!filesList) {
            console.error('ce-files-list element not found');
            return;
        }

        if (!files || files.length === 0) {
            filesList.innerHTML = '<div class="empty-state">No files found in CE folder</div>';
            return;
        }

        console.log('Rendering CE files:', files);

        let html = '<div class="ce-files-list-container">';
        html += '<table class="ce-files-table">';
        html += '<thead><tr><th>File Name</th><th>Type</th></tr></thead>';
        html += '<tbody>';
        
        files.forEach((file, index) => {
            const suggestedType = file.suggestedType || 'types';
            const fullFileName = file.fullName || file.name;
            // Store both display name (without extension) and full name (with extension)
            html += `<tr class="ce-file-row">
                <td class="ce-file-name-cell">
                    <span class="ce-file-name">${this.escapeHtml(fullFileName)}</span>
                </td>
                <td class="ce-file-type-cell">
                    <select class="ce-file-type-select" data-file-index="${index}" data-file-name="${this.escapeHtml(fullFileName)}" data-display-name="${this.escapeHtml(file.name)}">
                        <option value="types" ${suggestedType === 'types' ? 'selected' : ''}>types</option>
                        <option value="spawnabletypes" ${suggestedType === 'spawnabletypes' ? 'selected' : ''}>spawnabletypes</option>
                        <option value="events" ${suggestedType === 'events' ? 'selected' : ''}>events</option>
                    </select>
                </td>
            </tr>`;
        });
        
        html += '</tbody></table></div>';
        filesList.innerHTML = html;
    }

    async saveCEFolder() {
        const missionSelect = document.getElementById('ce-mission-select');
        const folderInput = document.getElementById('ce-folder-name');
        const filesList = document.getElementById('ce-files-list');

        if (!missionSelect || !folderInput) {
            window.app.showError('Mission and folder name are required');
            return;
        }

        const missionName = missionSelect.value;
        const folderName = folderInput.value.trim();

        if (!missionName) {
            window.app.showError('Please select a mission');
            return;
        }

        if (!folderName) {
            window.app.showError('Please enter a CE folder name');
            return;
        }

        // Extract files from the rendered list with selected types
        const files = {
            types: [],
            spawnabletypes: [],
            events: []
        };

        const selects = filesList.querySelectorAll('.ce-file-type-select');
        selects.forEach(select => {
            // Use fullName (with extension) from data attribute
            const fileName = select.getAttribute('data-file-name'); // This is the full name with extension
            const fileType = select.value;
            
            if (fileName && fileType && files[fileType]) {
                // Store with fullName property for XML generation
                files[fileType].push({ 
                    name: fileName, // Display name (will be used in XML)
                    fullName: fileName // Full filename with extension
                });
            }
        });

        const totalFiles = files.types.length + files.spawnabletypes.length + files.events.length;
        if (totalFiles === 0) {
            window.app.showError('No files to save. Please scan the folder first.');
            return;
        }

        try {
            if (!this.serverPath) {
                this.serverPath = await window.electronAPI.configGetServerPath();
            }

            const result = await window.electronAPI.configUpdateEconomyCore(
                this.serverPath,
                missionName,
                folderName,
                files
            );

            if (result.success) {
                window.app.showSuccess(`CE folder "${folderName}" saved to cfgeconomycore.xml`);
            } else {
                window.app.showError(result.error || 'Failed to save CE folder');
            }
        } catch (error) {
            window.app.showError(`Failed to save CE folder: ${error.message}`);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize when DOM and electronAPI are ready
function initializeConfigEditor() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof window.electronAPI !== 'undefined') {
                window.configEditor = new ConfigEditor();
            }
        });
    } else {
        if (typeof window.electronAPI !== 'undefined') {
            window.configEditor = new ConfigEditor();
        }
    }
}

initializeConfigEditor();

