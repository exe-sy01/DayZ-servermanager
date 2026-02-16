/**
 * Mod management panel
 */
class ModPanel {
    constructor() {
        this.mods = [];
        this.serverPath = null;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadMods();
    }

    setupEventListeners() {
        document.getElementById('add-mod').addEventListener('click', () => {
            this.showAddModModal();
        });

        document.getElementById('update-all-mods').addEventListener('click', () => {
            this.updateAllMods();
        });

        document.getElementById('refresh-mods').addEventListener('click', () => {
            this.loadMods();
        });

        // Add mod modal
        document.getElementById('add-mod-submit').addEventListener('click', () => {
            this.addMod();
        });

        document.getElementById('close-add-mod').addEventListener('click', () => {
            this.hideAddModModal();
        });

        document.getElementById('cancel-add-mod').addEventListener('click', () => {
            this.hideAddModModal();
        });

        document.getElementById('scan-workshop-folder').addEventListener('click', () => {
            this.scanWorkshopFolder();
        });

        document.getElementById('export-modlist').addEventListener('click', () => {
            this.exportModlist();
        });
    }

    async loadMods() {
        try {
            this.serverPath = await window.electronAPI.configGetServerPath();
            
            if (!this.serverPath) {
                document.getElementById('mods-list').innerHTML = 
                    '<div class="empty-state">Please set server installation path in Settings</div>';
                return;
            }

            // Get config mods first - this is the source of truth
            const configMods = await window.electronAPI.configGet('mods') || [];
            
            if (configMods.length === 0) {
                this.mods = [];
                this.renderMods();
                return;
            }

            // Get installed mods to check if they're actually installed
            const installedMods = await window.electronAPI.workshopListInstalled(this.serverPath);
            
            // Only show mods that are in the config
            this.mods = await Promise.all(configMods.map(async (configMod) => {
                // Find matching installed mod by workshop ID
                const installedMod = installedMods.find(im => 
                    im.workshopId === configMod.workshopId || 
                    im.workshopId === configMod.workshopId?.toString() ||
                    String(im.workshopId) === String(configMod.workshopId)
                );
                
                // Use modName from installed mod if available, otherwise use name from config
                let modName = configMod.name;
                let modNameFromInfo = installedMod?.modName;
                
                // If we have an installed mod, use its info
                if (installedMod) {
                    return {
                        ...installedMod,
                        name: modName || installedMod.name || `Mod ${configMod.workshopId}`,
                        modName: modNameFromInfo || modName?.replace(/@/g, '').replace(/[^a-zA-Z0-9_-]/g, '') || `Mod${configMod.workshopId}`,
                        workshopId: configMod.workshopId,
                        loadOrder: configMod.loadOrder || 999999, // Include loadOrder from config
                        installed: true // Mark as installed if found in installedMods
                    };
                } else {
                    // Check if @ModName folder exists in server directory (for scanned mods)
                    // Try to determine modName from config name
                    let potentialModName = modName?.replace(/@/g, '').replace(/[^a-zA-Z0-9_-]/g, '') || `Mod${configMod.workshopId}`;
                    const serverModPath = `@${potentialModName}`;
                    
                    // Try to check if the folder exists (we'll use a simple approach - check via getInfo)
                    try {
                        const modInfo = await window.electronAPI.workshopGetInfo(configMod.workshopId, this.serverPath);
                        if (modInfo && modInfo.serverModPath) {
                            // Mod folder exists in server directory
                            return {
                                ...modInfo,
                                name: modName || modInfo.name || `Mod ${configMod.workshopId}`,
                                workshopId: configMod.workshopId,
                                loadOrder: configMod.loadOrder || 999999,
                                installed: true
                            };
                        } else if (modInfo) {
                            return {
                                ...modInfo,
                                name: modName || modInfo.name || `Mod ${configMod.workshopId}`,
                                workshopId: configMod.workshopId,
                                loadOrder: configMod.loadOrder || 999999,
                                installed: false
                            };
                        }
                    } catch (error) {
                        console.warn(`Could not get info for mod ${configMod.workshopId}:`, error);
                    }
                    
                    // Fallback: just show what we have from config
                    return {
                        workshopId: configMod.workshopId,
                        name: modName || `Mod ${configMod.workshopId}`,
                        loadOrder: configMod.loadOrder || 999999,
                        installed: false
                    };
                }
            }));
            
            // Sort by loadOrder
            this.mods.sort((a, b) => {
                const orderA = a.loadOrder || 999999;
                const orderB = b.loadOrder || 999999;
                if (orderA !== orderB) return orderA - orderB;
                // If same order, sort by added date as fallback
                const dateA = a.added ? new Date(a.added).getTime() : 0;
                const dateB = b.added ? new Date(b.added).getTime() : 0;
                return dateA - dateB;
            });
            
            this.renderMods();
            this.setupDragAndDrop();
            this.setupContextMenu();
        } catch (error) {
            console.error('Error loading mods:', error);
            window.app.showError(`Failed to load mods: ${error.message}`);
        }
    }

    renderMods() {
        const container = document.getElementById('mods-list');
        const counter = document.getElementById('mod-counter');
        
        // Update counter
        const totalMods = this.mods.length;
        const installedMods = this.mods.filter(mod => mod.installed !== false).length;
        if (counter) {
            counter.textContent = `${totalMods} mod${totalMods !== 1 ? 's' : ''} (${installedMods} installed)`;
        }
        
        if (this.mods.length === 0) {
            container.innerHTML = '<div class="empty-state">No mods installed</div>';
            return;
        }

        // Mods are already sorted by loadOrder in loadMods()
        container.innerHTML = this.mods.map((mod, index) => {
            const isInstalled = mod.installed !== false;
            const statusClass = isInstalled ? 'installed' : 'not-installed';
            const statusText = isInstalled ? 'Installed' : 'Not Installed';
            const loadOrder = mod.loadOrder || (index + 1);
            
            return `
            <div class="mod-item" draggable="true" data-workshop-id="${mod.workshopId}" data-load-order="${loadOrder}">
                <div class="mod-load-order-number">${loadOrder}</div>
                <div class="mod-item-info">
                    <div class="mod-item-name">${this.escapeHtml(mod.name || `Mod ${mod.workshopId}`)}</div>
                    <div class="mod-item-id">Workshop ID: ${mod.workshopId}</div>
                </div>
                <div class="mod-actions">
                    <span class="mod-status ${statusClass}">${statusText}</span>
                    ${isInstalled ? `<button class="btn btn-secondary btn-sm" onclick="window.modPanel.updateMod('${mod.workshopId}')">Update</button>` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="window.modPanel.removeMod('${mod.workshopId}')">Remove</button>
                </div>
            </div>
        `;
        }).join('');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupDragAndDrop() {
        const container = document.getElementById('mods-list');
        if (!container) return;

        let draggedElement = null;
        let draggedIndex = null;

        // Remove existing listeners by cloning
        const newContainer = container.cloneNode(true);
        container.parentNode.replaceChild(newContainer, container);

        // Drag start
        newContainer.addEventListener('dragstart', (e) => {
            const modItem = e.target.closest('.mod-item');
            if (modItem) {
                draggedElement = modItem;
                draggedIndex = Array.from(newContainer.children).indexOf(draggedElement);
                draggedElement.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', draggedElement.innerHTML);
            }
        });

        // Drag over
        newContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const modItem = e.target.closest('.mod-item');
            if (modItem && modItem !== draggedElement) {
                const rect = modItem.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                
                if (e.clientY < midpoint) {
                    modItem.classList.add('drag-over-top');
                    modItem.classList.remove('drag-over-bottom');
                } else {
                    modItem.classList.add('drag-over-bottom');
                    modItem.classList.remove('drag-over-top');
                }
            }
        });

        // Drag leave
        newContainer.addEventListener('dragleave', (e) => {
            const modItem = e.target.closest('.mod-item');
            if (modItem) {
                modItem.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        // Drop
        newContainer.addEventListener('drop', async (e) => {
            e.preventDefault();
            
            if (!draggedElement) return;

            const modItem = e.target.closest('.mod-item');
            if (modItem && modItem !== draggedElement) {
                const dropIndex = Array.from(newContainer.children).indexOf(modItem);
                const rect = modItem.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                const insertAfter = e.clientY > midpoint;

                const targetIndex = insertAfter ? dropIndex + 1 : dropIndex;
                const finalIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
                
                // Get new order array
                const modOrder = Array.from(newContainer.children)
                    .map(child => child.getAttribute('data-workshop-id'))
                    .filter(id => id);
                
                // Remove dragged element from array
                const draggedId = draggedElement.getAttribute('data-workshop-id');
                modOrder.splice(draggedIndex, 1);
                
                // Insert at new position
                modOrder.splice(finalIndex, 0, draggedId);
                
                // Update load order
                await this.reorderMods(modOrder);
            }

            // Cleanup
            newContainer.querySelectorAll('.mod-item').forEach(item => {
                item.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
            });
            draggedElement = null;
            draggedIndex = null;
        });

        // Drag end
        newContainer.addEventListener('dragend', (e) => {
            if (draggedElement) {
                draggedElement.classList.remove('dragging');
            }
            newContainer.querySelectorAll('.mod-item').forEach(item => {
                item.classList.remove('drag-over-top', 'drag-over-bottom');
            });
            draggedElement = null;
            draggedIndex = null;
        });
    }

    setupContextMenu() {
        const container = document.getElementById('mods-list');
        if (!container) return;

        // Remove existing context menu
        const existingMenu = document.getElementById('mod-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // Create context menu
        const contextMenu = document.createElement('div');
        contextMenu.id = 'mod-context-menu';
        contextMenu.className = 'mod-context-menu';
        contextMenu.innerHTML = `
            <div class="mod-context-menu-item" id="set-load-order-item">Set Load Order...</div>
        `;
        document.body.appendChild(contextMenu);

        let currentModWorkshopId = null;

        // Right-click handler
        container.addEventListener('contextmenu', (e) => {
            const modItem = e.target.closest('.mod-item');
            if (modItem) {
                e.preventDefault();
                currentModWorkshopId = modItem.getAttribute('data-workshop-id');
                
                const rect = modItem.getBoundingClientRect();
                contextMenu.style.display = 'block';
                contextMenu.style.left = `${e.clientX}px`;
                contextMenu.style.top = `${e.clientY}px`;
            }
        });

        // Close context menu on click outside
        document.addEventListener('click', () => {
            contextMenu.style.display = 'none';
        });

        // Set load order handler
        document.getElementById('set-load-order-item').addEventListener('click', async () => {
            if (!currentModWorkshopId) return;
            
            const mod = this.mods.find(m => String(m.workshopId) === String(currentModWorkshopId));
            if (!mod) return;

            const currentOrder = mod.loadOrder || this.mods.length;
            const input = prompt(`Enter load order for "${mod.name}" (1-${this.mods.length}):`, currentOrder);
            
            if (input === null) return; // User cancelled
            
            const newOrder = parseInt(input, 10);
            if (isNaN(newOrder) || newOrder < 1 || newOrder > this.mods.length) {
                window.app.showError(`Load order must be between 1 and ${this.mods.length}`);
                return;
            }

            await this.setModLoadOrder(currentModWorkshopId, newOrder);
            contextMenu.style.display = 'none';
        });
    }

    async setModLoadOrder(workshopId, loadOrder) {
        try {
            const result = await window.electronAPI.configSetModLoadOrder(workshopId, loadOrder);
            if (result.success) {
                await this.loadMods(); // Reload to get updated order
            } else {
                window.app.showError(result.error || 'Failed to set load order');
            }
        } catch (error) {
            window.app.showError(`Failed to set load order: ${error.message}`);
        }
    }

    async reorderMods(modOrderArray) {
        try {
            const result = await window.electronAPI.configReorderMods(modOrderArray);
            if (result.success) {
                await this.loadMods(); // Reload to get updated order
            } else {
                window.app.showError(result.error || 'Failed to reorder mods');
            }
        } catch (error) {
            window.app.showError(`Failed to reorder mods: ${error.message}`);
        }
    }

    showAddModModal() {
        document.getElementById('add-mod-modal').classList.add('active');
        document.getElementById('mod-workshop-id').value = '';
        document.getElementById('is-collection-checkbox').checked = false;
        const queueCheckbox = document.getElementById('add-to-queue-checkbox');
        if (queueCheckbox) {
            queueCheckbox.checked = true; // Default to queue
        }
    }

    hideAddModModal() {
        document.getElementById('add-mod-modal').classList.remove('active');
    }

    async addMod() {
        const inputId = document.getElementById('mod-workshop-id').value.trim();
        const isCollection = document.getElementById('is-collection-checkbox').checked;
        const addToQueue = document.getElementById('add-to-queue-checkbox')?.checked ?? false;
        
        if (!inputId) {
            window.app.showError('Please enter a Workshop ID or Collection ID');
            return;
        }

        if (!this.serverPath) {
            this.serverPath = await window.electronAPI.configGetServerPath();
            if (!this.serverPath) {
                window.app.showError('Please set server installation path first');
                return;
            }
        }

        try {
            this.hideAddModModal();
            
            // If add to queue is checked, add to queue instead of downloading immediately
            if (addToQueue) {
                if (isCollection) {
                    const collectionDetails = await window.electronAPI.workshopGetCollection(inputId);
                    if (collectionDetails.success) {
                        await window.electronAPI.modQueueAddCollection(inputId, collectionDetails.name);
                        window.app.showSuccess(`Added collection "${collectionDetails.name}" to download queue`);
                    } else {
                        window.app.showError(collectionDetails.error || 'Failed to load collection');
                    }
                } else {
                    // Try to get mod name
                    let modName = null;
                    try {
                        const modDetails = await window.electronAPI.workshopGetDetails(inputId);
                        if (modDetails && modDetails.name) {
                            modName = modDetails.name;
                        }
                    } catch (error) {
                        console.warn('Could not get mod details:', error);
                    }
                    
                    await window.electronAPI.modQueueAdd(inputId, false, modName);
                    window.app.showSuccess(`Added mod to download queue`);
                }
                return;
            }
            
            // Check if it's a collection or try to detect
            if (isCollection) {
                // User explicitly marked it as a collection
                window.app.showSuccess(`Loading collection ${inputId}...`);
                
                // First, get collection details to show what will be downloaded
                const collectionDetails = await window.electronAPI.workshopGetCollection(inputId);
                
                if (!collectionDetails.success) {
                    window.app.showError(collectionDetails.error || 'Failed to load collection');
                    return;
                }

                const modCount = collectionDetails.modIds?.length || 0;
                if (modCount === 0) {
                    window.app.showError('Collection is empty or could not extract mods');
                    return;
                }

                const confirmed = confirm(
                    `Collection: ${collectionDetails.name || inputId}\n` +
                    `Contains ${modCount} mod(s)\n\n` +
                    `Download all ${modCount} mods from this collection?`
                );

                if (!confirmed) return;

                window.app.showSuccess(`Downloading collection (${modCount} mods)...`);
                
                const result = await window.electronAPI.workshopDownloadCollection(inputId, this.serverPath);
                
                if (result.success) {
                    const successCount = result.successCount || 0;
                    const failCount = result.failCount || 0;
                    
                    if (failCount === 0) {
                        window.app.showSuccess(`Successfully downloaded all ${successCount} mod(s) from collection`);
                    } else {
                        window.app.showError(
                            `Downloaded ${successCount} mod(s), ${failCount} failed. ` +
                            `Check console for details.`
                        );
                    }
                    await this.loadMods();
                } else {
                    window.app.showError(result.error || 'Failed to download collection');
                }
            } else {
                // Try to detect if it's a collection, otherwise treat as single mod
                try {
                    const collectionDetails = await window.electronAPI.workshopGetCollection(inputId);
                    if (collectionDetails.success && collectionDetails.modIds && collectionDetails.modIds.length > 0) {
                        // It's a collection, ask user
                        const modCount = collectionDetails.modIds.length;
                        const useAsCollection = confirm(
                            `This appears to be a collection: "${collectionDetails.name || inputId}"\n` +
                            `Contains ${modCount} mod(s)\n\n` +
                            `Download all mods from collection? (Click Cancel to download as single mod)`
                        );

                        if (useAsCollection) {
                            window.app.showSuccess(`Downloading collection (${modCount} mods)...`);
                            
                            const result = await window.electronAPI.workshopDownloadCollection(inputId, this.serverPath);
                            
                            if (result.success) {
                                const successCount = result.successCount || 0;
                                const failCount = result.failCount || 0;
                                
                                if (failCount === 0) {
                                    window.app.showSuccess(`Successfully downloaded all ${successCount} mod(s) from collection`);
                                } else {
                                    window.app.showError(
                                        `Downloaded ${successCount} mod(s), ${failCount} failed. ` +
                                        `Check console for details.`
                                    );
                                }
                                await this.loadMods();
                            } else {
                                window.app.showError(result.error || 'Failed to download collection');
                            }
                            return;
                        }
                    }
                } catch (error) {
                    // Not a collection or error checking, continue as single mod
                    console.log('Not a collection, downloading as single mod:', error);
                }

                // Download as single mod
                window.app.showSuccess(`Downloading mod ${inputId}...`);
                
                const result = await window.electronAPI.workshopDownload(inputId, this.serverPath);
                
                if (result.success) {
                    window.app.showSuccess('Mod downloaded successfully');
                    await this.loadMods();
                } else {
                    window.app.showError(result.error || 'Failed to download mod');
                }
            }
        } catch (error) {
            window.app.showError(`Failed to add mod: ${error.message}`);
        }
    }

    async updateMod(workshopId) {
        if (!this.serverPath) {
            this.serverPath = await window.electronAPI.configGetServerPath();
        }

        try {
            const result = await window.electronAPI.workshopUpdate(workshopId, this.serverPath);
            
            if (result.success) {
                window.app.showSuccess('Mod updated successfully');
                await this.loadMods();
            } else {
                window.app.showError(result.error || 'Failed to update mod');
            }
        } catch (error) {
            window.app.showError(`Failed to update mod: ${error.message}`);
        }
    }

    async removeMod(workshopId) {
        const mod = this.mods.find(m => m.workshopId === workshopId || String(m.workshopId) === String(workshopId));
        const modName = mod?.name || mod?.modName || workshopId;
        
        const confirmed = confirm(`Remove mod "${modName}" (${workshopId})? This will remove it from the list and delete the @ModName folder and keys. The workshop files will remain.`);
        if (!confirmed) return;

        try {
            if (!this.serverPath) {
                this.serverPath = await window.electronAPI.configGetServerPath();
            }

            // Remove from config
            await window.electronAPI.configRemoveMod(workshopId);

            // Remove @ModName folder (symlink or copy) and keys from server directory
            if (this.serverPath && mod?.modName) {
                try {
                    const result = await window.electronAPI.removeModFolder(this.serverPath, mod.modName);
                    if (!result.success) {
                        console.warn('Could not remove mod folder:', result.error);
                    }
                } catch (error) {
                    console.warn('Could not remove mod folder:', error);
                    // Continue anyway
                }
            }

            window.app.showSuccess('Mod removed successfully');
            await this.loadMods();
        } catch (error) {
            window.app.showError(`Failed to remove mod: ${error.message}`);
        }
    }

    async scanWorkshopFolder() {
        try {
            // Ask user for workshop folder path
            const workshopPath = await window.electronAPI.selectWorkshopFolder();
            if (!workshopPath) {
                return; // User cancelled
            }

            // Get server path if not set
            if (!this.serverPath) {
                this.serverPath = await window.electronAPI.configGetServerPath();
            }

            window.app.showSuccess(`Scanning workshop folder: ${workshopPath}...`);
            
            // Scan for mods in the workshop folder
            const result = await window.electronAPI.workshopScanFolder(workshopPath, this.serverPath);
            
            if (result.success) {
                const count = result.modsFound || 0;
                window.app.showSuccess(`Found ${count} mod(s) and added them to the list`);
                await this.loadMods();
            } else {
                window.app.showError(result.error || 'Failed to scan workshop folder');
            }
        } catch (error) {
            window.app.showError(`Failed to scan workshop folder: ${error.message}`);
        }
    }

    async updateAllMods() {
        if (this.mods.length === 0) {
            window.app.showError('No mods to update');
            return;
        }

        if (!this.serverPath) {
            this.serverPath = await window.electronAPI.configGetServerPath();
        }

        const confirmed = confirm(`Update all ${this.mods.length} mods? This may take a while.`);
        if (!confirmed) return;

        try {
            const result = await window.electronAPI.workshopUpdateAll(this.mods, this.serverPath);
            
            if (result.success) {
                const successCount = result.results.filter(r => r.success).length;
                window.app.showSuccess(`Updated ${successCount} of ${this.mods.length} mods`);
                await this.loadMods();
            } else {
                window.app.showError(result.error || 'Failed to update mods');
            }
        } catch (error) {
            window.app.showError(`Failed to update mods: ${error.message}`);
        }
    }

    updateModProgress(data) {
        // Update mod progress if needed
        console.log('Mod progress:', data);
    }

    async exportModlist() {
        if (this.mods.length === 0) {
            window.app.showError('No mods to export');
            return;
        }

        try {
            // Filter to only installed mods (or all mods if user wants)
            const modsToExport = this.mods.filter(mod => mod.installed !== false);
            
            if (modsToExport.length === 0) {
                window.app.showError('No installed mods to export');
                return;
            }

            // Get export path from user
            const exportPath = await window.electronAPI.modlistSelectExportPath();
            if (!exportPath) {
                return; // User cancelled
            }

            // Generate modlist HTML
            const result = await window.electronAPI.modlistExport(modsToExport, exportPath);
            
            if (result.success) {
                window.app.showSuccess(`Modlist exported successfully to ${result.path}`);
            } else {
                window.app.showError(result.error || 'Failed to export modlist');
            }
        } catch (error) {
            window.app.showError(`Failed to export modlist: ${error.message}`);
        }
    }
}

// Initialize when DOM and electronAPI are ready
function initializeModPanel() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            if (typeof window.electronAPI !== 'undefined') {
                window.modPanel = new ModPanel();
            }
        });
    } else {
        if (typeof window.electronAPI !== 'undefined') {
            window.modPanel = new ModPanel();
        }
    }
}

initializeModPanel();
