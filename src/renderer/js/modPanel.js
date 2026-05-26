/**
 * Mod management panel
 */
class ModPanel {
    constructor() {
        this.mods = [];
        this.serverPath = null;
        this.filterQuery = '';
        this.selectedModIds = new Set();
        this.init();
    }

    getModId(mod) {
        return mod.isLocal ? `local:${mod.modName}` : String(mod.workshopId);
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

        document.getElementById('check-mod-updates').addEventListener('click', () => {
            this.openUpdateCheckModal();
        });

        document.getElementById('close-mod-updates').addEventListener('click', () => {
            this.closeUpdateCheckModal();
        });

        document.getElementById('mod-updates-recheck').addEventListener('click', () => {
            this.runUpdateCheck();
        });

        document.getElementById('mod-updates-apply').addEventListener('click', () => {
            this.applySelectedUpdates();
        });

        document.getElementById('mod-updates-select-all').addEventListener('change', (e) => {
            this.toggleAllUpdateSelections(e.target.checked);
        });

        document.getElementById('refresh-mods').addEventListener('click', () => {
            this.loadMods(true);
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

        const scanLocalModsBtn = document.getElementById('scan-local-mods');
        if (scanLocalModsBtn) {
            scanLocalModsBtn.addEventListener('click', () => this.scanLocalMods());
        }

        document.getElementById('export-modlist').addEventListener('click', () => {
            this.exportModlist();
        });

        const checkDepsBtn = document.getElementById('check-dependencies');
        if (checkDepsBtn) {
            checkDepsBtn.addEventListener('click', () => {
                this.checkDependencies();
            });
        }

        const filterInput = document.getElementById('mods-filter-input');
        if (filterInput) {
            filterInput.addEventListener('input', () => {
                this.filterQuery = (filterInput.value || '').trim();
                this.renderMods();
                this.setupDragAndDrop();
                this.setupContextMenu();
                this.setupBulkListeners();
            });
        }

        const selectAllBtn = document.getElementById('mods-select-all');
        if (selectAllBtn) selectAllBtn.addEventListener('click', () => this.selectAllVisible());
        const clearSelBtn = document.getElementById('mods-clear-selection');
        if (clearSelBtn) clearSelBtn.addEventListener('click', () => this.clearSelection());
        const removeSelBtn = document.getElementById('mods-remove-selected');
        if (removeSelBtn) removeSelBtn.addEventListener('click', () => this.bulkRemoveSelected());
    }

    async checkDependencies() {
        try {
            const serverPath = await window.electronAPI.configGetServerPath();
            if (!serverPath) {
                window.app?.showError('Please set server path in Settings');
                return;
            }
            const result = await window.electronAPI.modsCheckDependencies(serverPath);
            if (result.valid) {
                window.app?.showSuccess('All mod dependencies are satisfied');
            } else if (result.violations && result.violations.length > 0) {
                const msg = result.violations.map(v => v.message).join('\n');
                alert('Dependency violations found:\n\n' + msg + '\n\nMove required mods higher in load order.');
            } else {
                window.app?.showSuccess('No dependency issues found');
            }
        } catch (error) {
            window.app?.showError(`Dependency check failed: ${error.message}`);
        }
    }

    async loadMods(userRefreshed = false) {
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
                // Local mods (not from Workshop)
                if (configMod.isLocal && configMod.modName) {
                    const installedMod = installedMods.find(im => im.isLocal && im.modName === configMod.modName);
                    return {
                        ...(installedMod || {}),
                        isLocal: true,
                        modName: configMod.modName,
                        name: configMod.name || configMod.modName,
                        workshopId: null,
                        loadOrder: configMod.loadOrder || 999999,
                        installed: !!installedMod
                    };
                }

                // Workshop mods
                const installedMod = installedMods.find(im => 
                    !im.isLocal && (
                        im.workshopId === configMod.workshopId || 
                        im.workshopId === configMod.workshopId?.toString() ||
                        String(im.workshopId) === String(configMod.workshopId)
                    )
                );
                let modName = configMod.name;
                let modNameFromInfo = installedMod?.modName;
                
                if (installedMod) {
                    return {
                        ...installedMod,
                        name: modName || installedMod.name || `Mod ${configMod.workshopId}`,
                        modName: modNameFromInfo || modName?.replace(/@/g, '').replace(/[^a-zA-Z0-9_-]/g, '') || `Mod${configMod.workshopId}`,
                        workshopId: configMod.workshopId,
                        loadOrder: configMod.loadOrder || 999999,
                        installed: true
                    };
                } else {
                    try {
                        const modInfo = await window.electronAPI.workshopGetInfo(configMod.workshopId, this.serverPath);
                        if (modInfo && modInfo.serverModPath) {
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

            if (userRefreshed && this.mods.length > 0) {
                const updateBtn = document.getElementById('update-all-mods');
                if (updateBtn) updateBtn.style.display = '';
            }
        } catch (error) {
            console.error('Error loading mods:', error);
            window.app.showError(`Failed to load mods: ${error.message}`);
        }
    }

    getFilteredMods() {
        const q = this.filterQuery.toLowerCase();
        if (!q) return this.mods;
        return this.mods.filter(mod => {
            const name = (mod.name || mod.modName || '').toLowerCase();
            const id = (mod.workshopId != null ? String(mod.workshopId) : '').toLowerCase();
            const atName = (mod.modName ? `@${mod.modName}` : '').toLowerCase();
            return name.includes(q) || id.includes(q) || atName.includes(q);
        });
    }

    renderMods() {
        const container = document.getElementById('mods-list');
        const counter = document.getElementById('mod-counter');
        const filterHint = document.getElementById('mods-filter-hint');
        const bulkBar = document.getElementById('mods-bulk-bar');
        const selectedCountEl = document.getElementById('mods-selected-count');

        const totalMods = this.mods.length;
        const installedMods = this.mods.filter(mod => mod.installed !== false).length;
        if (counter) {
            counter.textContent = `${totalMods} mod${totalMods !== 1 ? 's' : ''} (${installedMods} installed)`;
        }

        if (filterHint) {
            if (this.filterQuery) {
                const filtered = this.getFilteredMods();
                filterHint.textContent = `Showing ${filtered.length} of ${totalMods} mods`;
                filterHint.style.display = '';
            } else {
                filterHint.textContent = '';
                filterHint.style.display = 'none';
            }
        }

        if (bulkBar) {
            bulkBar.style.display = this.mods.length > 0 ? '' : 'none';
        }
        if (selectedCountEl) {
            selectedCountEl.textContent = this.selectedModIds.size;
        }
        const showRemoveSelected = this.selectedModIds.size > 0;
        const removeSelectedBtn = document.getElementById('mods-remove-selected');
        if (removeSelectedBtn) removeSelectedBtn.style.display = showRemoveSelected ? '' : 'none';

        if (this.mods.length === 0) {
            container.innerHTML = '<div class="empty-state">No mods installed</div>';
            return;
        }

        const toRender = this.getFilteredMods();
        if (toRender.length === 0) {
            container.innerHTML = '<div class="empty-state">No mods match the filter</div>';
            return;
        }

        // Build rows from filtered list; each mod's loadOrder/index is from full list
        container.innerHTML = toRender.map((mod, visibleIndex) => {
            const fullIndex = this.mods.indexOf(mod);
            const isInstalled = mod.installed !== false;
            const statusClass = isInstalled ? 'installed' : 'not-installed';
            const statusText = isInstalled ? 'Installed' : 'Not Installed';
            const loadOrder = mod.loadOrder || (fullIndex + 1);
            const modId = this.getModId(mod);
            const displayName = mod.name || (mod.isLocal ? mod.modName : `Mod ${mod.workshopId}`);
            const idLabel = mod.isLocal ? `@${mod.modName}` : `Workshop ID: ${mod.workshopId}`;
            const updateBtn = (!mod.isLocal && isInstalled) ? `<button class="btn btn-secondary btn-sm" onclick="window.modPanel.updateMod('${mod.workshopId}')">Update</button>` : '';
            const checked = this.selectedModIds.has(modId) ? ' checked' : '';

            return `
            <div class="mod-item" draggable="true" data-mod-id="${this.escapeHtml(modId)}" data-workshop-id="${mod.workshopId || ''}" data-load-order="${loadOrder}">
                <div class="mod-item-checkbox"><input type="checkbox" class="mod-select-cb" data-mod-id="${this.escapeHtml(modId)}"${checked}></div>
                <div class="mod-load-order-number">${loadOrder}</div>
                <div class="mod-item-info">
                    <div class="mod-item-name">${this.escapeHtml(displayName)}${mod.isLocal ? ' <span class="mod-badge local">Local</span>' : ''}</div>
                    <div class="mod-item-id">${idLabel}</div>
                </div>
                <div class="mod-actions">
                    <span class="mod-status ${statusClass}">${statusText}</span>
                    ${updateBtn}
                    <button class="btn btn-secondary btn-sm" onclick="window.modPanel.removeMod('${this.escapeHtml(modId)}')">Remove</button>
                </div>
            </div>
        `;
        }).join('');

        this.setupBulkListeners();
    }

    setupBulkListeners() {
        const container = document.getElementById('mods-list');
        if (!container) return;
        container.querySelectorAll('.mod-select-cb').forEach(cb => {
            cb.replaceWith(cb.cloneNode(true));
        });
        container.querySelectorAll('.mod-select-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.getAttribute('data-mod-id');
                if (e.target.checked) this.selectedModIds.add(id);
                else this.selectedModIds.delete(id);
                const countEl = document.getElementById('mods-selected-count');
                if (countEl) countEl.textContent = this.selectedModIds.size;
                const removeBtn = document.getElementById('mods-remove-selected');
                if (removeBtn) removeBtn.style.display = this.selectedModIds.size > 0 ? '' : 'none';
            });
        });
    }

    selectAllVisible() {
        this.getFilteredMods().forEach(mod => this.selectedModIds.add(this.getModId(mod)));
        this.renderMods();
    }

    clearSelection() {
        this.selectedModIds.clear();
        this.renderMods();
    }

    async bulkRemoveSelected() {
        const n = this.selectedModIds.size;
        if (n === 0) return;
        const msg = `Remove ${n} mod(s) from the list? Workshop mods will have their @ folder and keys removed; local mods are only removed from the list.`;
        if (!confirm(msg)) return;

        const ids = Array.from(this.selectedModIds);
        let removed = 0;
        for (const modId of ids) {
            try {
                await this.removeMod(modId, true);
                removed++;
            } catch (err) {
                console.warn('Bulk remove failed for', modId, err);
            }
        }
        this.selectedModIds.clear();
        await this.loadMods();
        if (removed > 0) {
            window.app.showSuccess(removed < ids.length ? `Removed ${removed} of ${ids.length} mod(s)` : `Removed ${removed} mod(s) successfully`);
        }
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
                const draggedId = draggedElement.getAttribute('data-mod-id');
                const dropTargetId = modItem.getAttribute('data-mod-id');
                const rect = modItem.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                const insertAfter = e.clientY > midpoint;

                let modOrder;
                if (this.filterQuery) {
                    // Filtered view: compute full list order with dragged mod moved relative to drop target
                    modOrder = this.mods.map(m => this.getModId(m));
                    const fromIdx = modOrder.indexOf(draggedId);
                    let toIdx = modOrder.indexOf(dropTargetId);
                    if (insertAfter) toIdx += 1;
                    if (fromIdx === -1 || toIdx === -1) return;
                    modOrder.splice(fromIdx, 1);
                    const newToIdx = modOrder.indexOf(dropTargetId) + (insertAfter ? 1 : 0);
                    modOrder.splice(newToIdx, 0, draggedId);
                } else {
                    const dropIndex = Array.from(newContainer.children).indexOf(modItem);
                    const targetIndex = insertAfter ? dropIndex + 1 : dropIndex;
                    const finalIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
                    modOrder = Array.from(newContainer.children)
                        .map(child => child.getAttribute('data-mod-id'))
                        .filter(id => id);
                    modOrder.splice(draggedIndex, 1);
                    modOrder.splice(finalIndex, 0, draggedId);
                }

                await this.reorderMods(modOrder);
            }

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

        // Right-click handler (data-mod-id = workshopId or "local:ModName")
        container.addEventListener('contextmenu', (e) => {
            const modItem = e.target.closest('.mod-item');
            if (modItem) {
                e.preventDefault();
                currentModWorkshopId = modItem.getAttribute('data-mod-id');
                
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

        // Set load order handler (currentModWorkshopId can be workshopId or "local:ModName")
        document.getElementById('set-load-order-item').addEventListener('click', async () => {
            if (!currentModWorkshopId) return;
            
            const mod = this.mods.find(m => 
                m.isLocal ? `local:${m.modName}` === currentModWorkshopId : String(m.workshopId) === String(currentModWorkshopId)
            );
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

    async removeMod(modId, silent = false) {
        const mod = this.mods.find(m => 
            m.isLocal ? `local:${m.modName}` === modId : String(m.workshopId) === String(modId)
        );
        const displayName = mod?.name || mod?.modName || modId;
        const isLocal = String(modId).startsWith('local:');

        if (!silent) {
            const confirmMsg = isLocal
                ? `Remove local mod "${displayName}" from the list? (The @${mod?.modName || modId.replace(/^local:/, '')} folder will not be deleted.)`
                : `Remove mod "${displayName}" (${modId})? This will remove it from the list and delete the @ModName folder and keys. The workshop files will remain.`;
            if (!confirm(confirmMsg)) return;
        }

        try {
            if (!this.serverPath) {
                this.serverPath = await window.electronAPI.configGetServerPath();
            }

            if (isLocal) {
                const modName = String(modId).replace(/^local:/, '');
                await window.electronAPI.configRemoveLocalMod(modName);
            } else {
                await window.electronAPI.configRemoveMod(modId);
                if (this.serverPath && mod?.modName) {
                    try {
                        const result = await window.electronAPI.removeModFolder(this.serverPath, mod.modName);
                        if (!result.success) {
                            console.warn('Could not remove mod folder:', result.error);
                        }
                    } catch (error) {
                        console.warn('Could not remove mod folder:', error);
                    }
                }
            }

            if (!silent) {
                window.app.showSuccess('Mod removed successfully');
                await this.loadMods();
            }
        } catch (error) {
            window.app.showError(`Failed to remove mod: ${error.message}`);
        }
    }

    async scanLocalMods() {
        try {
            if (!this.serverPath) {
                this.serverPath = await window.electronAPI.configGetServerPath();
            }
            if (!this.serverPath) {
                window.app.showError('Please set server installation path first');
                return;
            }

            const localMods = await window.electronAPI.workshopListLocalMods(this.serverPath);
            if (localMods.length === 0) {
                window.app.showSuccess('No local @ mods found in server directory');
                return;
            }

            const configMods = await window.electronAPI.configGet('mods') || [];
            const existingLocal = new Set(
                configMods.filter(m => m.isLocal).map(m => m.modName)
            );
            let added = 0;
            for (const mod of localMods) {
                if (!existingLocal.has(mod.modName)) {
                    const result = await window.electronAPI.configAddLocalMod(mod.modName, mod.name || mod.modName);
                    if (result.success) {
                        added++;
                        existingLocal.add(mod.modName);
                    }
                }
            }

            if (added > 0) {
                window.app.showSuccess(`Added ${added} local mod(s) to the list`);
                await this.loadMods();
            } else {
                window.app.showSuccess('All local mods are already in the list');
            }
        } catch (error) {
            window.app.showError(`Failed to scan local mods: ${error.message}`);
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
        const workshopMods = this.mods.filter(m => !m.isLocal && m.workshopId);
        if (workshopMods.length === 0) {
            window.app.showError('No workshop mods to update');
            return;
        }

        if (!this.serverPath) {
            this.serverPath = await window.electronAPI.configGetServerPath();
        }

        const confirmed = confirm(`Update all ${workshopMods.length} workshop mod(s)? This may take a while.`);
        if (!confirmed) return;

        try {
            const result = await window.electronAPI.workshopUpdateAll(workshopMods, this.serverPath);
            
            if (result.success) {
                const successCount = result.results.filter(r => r.success).length;
                window.app.showSuccess(`Updated ${successCount} of ${workshopMods.length} mods`);
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

    async openUpdateCheckModal() {
        const modal = document.getElementById('mod-updates-modal');
        modal.classList.add('active');
        await this.runUpdateCheck();
    }

    closeUpdateCheckModal() {
        document.getElementById('mod-updates-modal').classList.remove('active');
    }

    async runUpdateCheck() {
        const summary = document.getElementById('mod-updates-summary');
        const list = document.getElementById('mod-updates-list');
        const apply = document.getElementById('mod-updates-apply');
        const selectAll = document.getElementById('mod-updates-select-all');

        apply.disabled = true;
        apply.textContent = 'Update Selected (0)';
        selectAll.checked = false;
        list.innerHTML = '';
        summary.textContent = 'Checking Steam Workshop…';

        if (!this.serverPath) {
            this.serverPath = await window.electronAPI.configGetServerPath();
        }

        const workshopMods = this.mods.filter(m => !m.isLocal && m.workshopId);
        if (workshopMods.length === 0) {
            summary.textContent = 'No workshop mods installed.';
            return;
        }

        try {
            const res = await window.electronAPI.workshopCheckUpdates(this.serverPath, workshopMods);
            if (!res.success) {
                summary.innerHTML = `<span class="text-error">Check failed: ${res.error}</span>`;
                return;
            }
            this.updateCheckResults = res.results || [];
            this.renderUpdateCheckResults();
        } catch (error) {
            summary.innerHTML = `<span class="text-error">Check failed: ${error.message}</span>`;
        }
    }

    renderUpdateCheckResults() {
        const summary = document.getElementById('mod-updates-summary');
        const list = document.getElementById('mod-updates-list');
        const results = this.updateCheckResults || [];

        const upToDate = results.filter(r => r.status === 'up-to-date').length;
        const needs = results.filter(r => r.hasUpdate).length;
        const errors = results.filter(r => r.status === 'not-found' || r.status === 'unavailable').length;

        summary.innerHTML = `
            <span class="upd-tag upd-tag-update">${needs} update${needs === 1 ? '' : 's'} available</span>
            <span class="upd-tag upd-tag-ok">${upToDate} up to date</span>
            ${errors ? `<span class="upd-tag upd-tag-err">${errors} unavailable</span>` : ''}
        `;

        const fmt = (ms) => {
            if (!ms) return '—';
            const d = new Date(ms);
            return d.toLocaleString();
        };

        const statusLabel = {
            'update-available': 'UPDATE',
            'up-to-date': 'CURRENT',
            'missing': 'MISSING',
            'not-found': 'GONE',
            'unavailable': 'ERROR',
            'unknown': '?'
        };

        list.innerHTML = results.map(r => `
            <div class="upd-row status-${r.status}">
                <label class="upd-check">
                    <input type="checkbox" data-id="${r.workshopId}" ${r.hasUpdate ? 'checked' : ''} ${r.status === 'not-found' || r.status === 'unavailable' ? 'disabled' : ''}>
                </label>
                <div class="upd-name">
                    <div class="upd-title">${this.escapeHtml(r.name)}</div>
                    <div class="upd-id">${r.workshopId}</div>
                </div>
                <div class="upd-times">
                    <div><span class="upd-label">LOCAL</span> ${fmt(r.localTime)}</div>
                    <div><span class="upd-label">STEAM</span> ${fmt(r.remoteTime)}</div>
                </div>
                <div class="upd-status">
                    <span class="upd-badge upd-badge-${r.status}">${statusLabel[r.status] || r.status}</span>
                    ${r.error ? `<div class="upd-err">${this.escapeHtml(r.error)}</div>` : ''}
                </div>
            </div>
        `).join('');

        list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => this.refreshApplyButton());
        });

        this.refreshApplyButton();
    }

    escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    refreshApplyButton() {
        const apply = document.getElementById('mod-updates-apply');
        const checked = document.querySelectorAll('#mod-updates-list input[type="checkbox"]:checked');
        apply.disabled = checked.length === 0;
        apply.textContent = `Update Selected (${checked.length})`;
    }

    toggleAllUpdateSelections(on) {
        const list = document.getElementById('mod-updates-list');
        list.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach(cb => {
            const row = cb.closest('.upd-row');
            if (on) {
                // Only re-check rows that actually have updates if user is selecting all
                if (row && row.classList.contains('status-update-available')) cb.checked = true;
                if (row && row.classList.contains('status-missing')) cb.checked = true;
            } else {
                cb.checked = false;
            }
        });
        this.refreshApplyButton();
    }

    async applySelectedUpdates() {
        const checked = Array.from(document.querySelectorAll('#mod-updates-list input[type="checkbox"]:checked'));
        if (checked.length === 0) return;

        const ids = new Set(checked.map(c => c.dataset.id));
        const modsToUpdate = (this.updateCheckResults || [])
            .filter(r => ids.has(r.workshopId))
            .map(r => ({ workshopId: r.workshopId, name: r.name }));

        if (!this.serverPath) {
            this.serverPath = await window.electronAPI.configGetServerPath();
        }

        const apply = document.getElementById('mod-updates-apply');
        apply.disabled = true;
        apply.textContent = `Updating ${modsToUpdate.length}…`;

        try {
            const result = await window.electronAPI.workshopUpdateAll(modsToUpdate, this.serverPath);
            if (result.success) {
                const ok = (result.results || []).filter(r => r.success).length;
                window.app.showSuccess(`Updated ${ok} of ${modsToUpdate.length} mod${modsToUpdate.length === 1 ? '' : 's'}`);
                this.closeUpdateCheckModal();
                await this.loadMods();
            } else {
                window.app.showError(result.error || 'Update failed');
                apply.disabled = false;
                this.refreshApplyButton();
            }
        } catch (error) {
            window.app.showError(`Update failed: ${error.message}`);
            apply.disabled = false;
            this.refreshApplyButton();
        }
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
