/**
 * Mod browser panel
 */
class ModBrowser {
    constructor() {
        this.currentPage = 1;
        this.totalPages = 1;
        this.currentQuery = '';
        this.currentSort = 'relevance';
        this.serverPath = null;
        this.eventListenersAttached = false;
        this.init();
    }

    init() {
        // Wait for DOM and electronAPI to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.waitForElectronAPI();
            });
        } else {
            this.waitForElectronAPI();
        }
    }

    waitForElectronAPI() {
        if (typeof window.electronAPI === 'undefined') {
            setTimeout(() => this.waitForElectronAPI(), 100);
            return;
        }
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Prevent duplicate listeners
        if (this.eventListenersAttached) {
            return;
        }

        const browserPanel = document.getElementById('browser-panel');

        if (!browserPanel) {
            console.error('Browser panel not found, retrying...');
            setTimeout(() => this.setupEventListeners(), 100);
            return;
        }

        // Store bound handler for cleanup
        this.clickHandler = (e) => {
            const target = e.target;
            const id = target.id;
            
            if (id === 'search-mods') {
                e.preventDefault();
                e.stopPropagation();
                this.searchMods();
            } else if (id === 'prev-page') {
                e.preventDefault();
                e.stopPropagation();
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.searchMods();
                }
            } else if (id === 'next-page') {
                e.preventDefault();
                e.stopPropagation();
                if (this.currentPage < this.totalPages) {
                    this.currentPage++;
                    this.searchMods();
                }
            }
        };

        // Use event delegation on the browser panel
        browserPanel.addEventListener('click', this.clickHandler, true);

        // Handle Enter key in search input - use capture phase for reliability
        this.keypressHandler = (e) => {
            if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault();
                e.stopPropagation();
                this.searchMods();
            }
        };

        // Attach to both the input and use capture on the panel
        const searchInput = document.getElementById('mod-search-input');
        if (searchInput) {
            searchInput.setAttribute('data-listener-attached', 'true');
            searchInput.addEventListener('keypress', this.keypressHandler, true);
            // Also attach to the panel as backup
            browserPanel.addEventListener('keypress', (e) => {
                if (e.target.id === 'mod-search-input' && (e.key === 'Enter' || e.keyCode === 13)) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.searchMods();
                }
            }, true);
        }

        // Load popular mods on panel show
        this.observer = new MutationObserver(() => {
            if (browserPanel.classList.contains('active')) {
                // Re-attach listeners if panel becomes active (in case they were lost)
                if (!this.eventListenersAttached) {
                    this.eventListenersAttached = false; // Reset flag to allow re-attachment
                    this.setupEventListeners();
                }
                this.loadPopularMods();
            }
        });
        this.observer.observe(browserPanel, { attributes: true, attributeFilter: ['class'] });

        this.eventListenersAttached = true;
        console.log('Mod browser event listeners attached');

        // Periodic check to ensure listeners are still attached (every 2 seconds when panel is active)
        this.listenerCheckInterval = setInterval(() => {
            const browserPanel = document.getElementById('browser-panel');
            if (browserPanel && browserPanel.classList.contains('active')) {
                const searchInput = document.getElementById('mod-search-input');
                if (searchInput && !searchInput.hasAttribute('data-listener-attached')) {
                    console.log('Search input listener lost, re-attaching...');
                    searchInput.setAttribute('data-listener-attached', 'true');
                    searchInput.addEventListener('keypress', this.keypressHandler, true);
                }
            }
        }, 2000);
    }

    async searchMods() {
        const searchInput = document.getElementById('mod-search-input');
        const sortSelect = document.getElementById('mod-sort');
        
        if (!searchInput || !sortSelect) {
            console.error('Search input or sort select not found');
            window.app.showError('Search elements not found. Please refresh the page.');
            return;
        }

        const query = searchInput.value.trim();
        const sortBy = sortSelect.value;
        
        if (!query) {
            window.app.showError('Please enter a search query');
            return;
        }

        this.currentQuery = query;
        this.currentSort = sortBy;
        this.currentPage = 1;

        await this.performSearch(query, this.currentPage, sortBy);
    }

    async loadPopularMods() {
        if (document.getElementById('mods-grid').innerHTML.includes('empty-state')) {
            await this.performSearch('', 1, 'mostsubscribed');
        }
    }

    async performSearch(query, page, sortBy) {
        try {
            const result = await window.electronAPI.workshopSearch(query, page, sortBy);
            
            if (result.success === false) {
                window.app.showError(result.error || 'Failed to search mods');
                return;
            }

            this.currentPage = result.page || page;
            this.totalPages = result.totalPages || 1;

            this.renderMods(result.mods || []);
            this.updatePagination();
        } catch (error) {
            console.error('Error searching mods:', error);
            window.app.showError(`Failed to search mods: ${error.message}`);
        }
    }

    renderMods(mods) {
        const container = document.getElementById('mods-grid');
        
        if (mods.length === 0) {
            container.innerHTML = '<div class="empty-state">No mods found</div>';
            return;
        }

        container.innerHTML = mods.map(mod => `
            <div class="mod-card" onclick="window.modBrowser.showModDetails('${mod.workshopId}')">
                <div class="mod-card-header">
                    ${mod.thumbnail ? `<img src="${mod.thumbnail}" alt="${mod.name}" class="mod-thumbnail" onerror="this.style.display='none'">` : ''}
                    <div class="mod-info">
                        <div class="mod-name">${this.escapeHtml(mod.name || 'Unknown Mod')}</div>
                        <div class="mod-id">ID: ${mod.workshopId}</div>
                    </div>
                </div>
                <div class="mod-description">${this.escapeHtml(mod.description || 'No description')}</div>
                <div class="mod-stats">
                    <span>${mod.subscriberCount ? `${this.formatNumber(mod.subscriberCount)} subscribers` : ''}</span>
                </div>
                <div class="mod-actions">
                    <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); window.modBrowser.downloadMod('${mod.workshopId}')">Download</button>
                </div>
            </div>
        `).join('');
    }

    updatePagination() {
        const pagination = document.getElementById('mod-pagination');
        const pageInfo = document.getElementById('page-info');
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');

        if (this.totalPages > 1) {
            pagination.style.display = 'flex';
            pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
            prevBtn.disabled = this.currentPage === 1;
            nextBtn.disabled = this.currentPage === this.totalPages;
        } else {
            pagination.style.display = 'none';
        }
    }

    async showModDetails(workshopId) {
        try {
            const details = await window.electronAPI.workshopGetDetails(workshopId);
            
            if (details.success === false) {
                window.app.showError(details.error || 'Failed to load mod details');
                return;
            }

            const modal = document.getElementById('mod-details-modal');
            const title = document.getElementById('mod-details-title');
            const body = document.getElementById('mod-details-body');

            title.textContent = details.name || 'Mod Details';
            body.innerHTML = `
                <div class="mod-details">
                    ${details.thumbnail ? `<img src="${details.thumbnail}" alt="${details.name}" style="max-width: 100%; border-radius: 6px; margin-bottom: 15px;">` : ''}
                    <div><strong>Workshop ID:</strong> ${details.workshopId}</div>
                    <div style="margin-top: 10px;"><strong>Subscribers:</strong> ${this.formatNumber(details.subscriberCount || 0)}</div>
                    ${details.author ? `<div style="margin-top: 10px;"><strong>Author:</strong> ${this.escapeHtml(details.author)}</div>` : ''}
                    ${details.tags && details.tags.length > 0 ? `<div style="margin-top: 10px;"><strong>Tags:</strong> ${details.tags.join(', ')}</div>` : ''}
                    <div style="margin-top: 15px;"><strong>Description:</strong></div>
                    <div style="margin-top: 5px; max-height: 300px; overflow-y: auto; padding: 10px; background: var(--bg-tertiary); border-radius: 6px;">
                        ${this.escapeHtml(details.description || 'No description available')}
                    </div>
                </div>
            `;

            // Store workshop ID for download
            modal.dataset.workshopId = workshopId;
            modal.classList.add('active');
        } catch (error) {
            window.app.showError(`Failed to load mod details: ${error.message}`);
        }
    }

    async downloadMod(workshopId) {
        if (!this.serverPath) {
            this.serverPath = await window.electronAPI.configGetServerPath();
            if (!this.serverPath) {
                window.app.showError('Please set server installation path first');
                return;
            }
        }

        const confirmed = confirm(`Download mod ${workshopId}?`);
        if (!confirmed) return;

        try {
            window.app.showSuccess(`Downloading mod ${workshopId}...`);
            
            const result = await window.electronAPI.workshopDownload(workshopId, this.serverPath);
            
            if (result.success) {
                window.app.showSuccess('Mod downloaded successfully');
                // Re-attach event listeners after download (in case they were lost)
                setTimeout(() => {
                    if (!this.eventListenersAttached) {
                        console.log('Re-attaching mod browser listeners after download...');
                        this.setupEventListeners();
                    }
                }, 100);
            } else {
                window.app.showError(result.error || 'Failed to download mod');
            }
        } catch (error) {
            window.app.showError(`Failed to download mod: ${error.message}`);
        }
    }

    // Modal event listeners
    setupModalListeners() {
        document.getElementById('close-mod-details').addEventListener('click', () => {
            document.getElementById('mod-details-modal').classList.remove('active');
        });

        document.getElementById('cancel-mod-details').addEventListener('click', () => {
            document.getElementById('mod-details-modal').classList.remove('active');
        });

        document.getElementById('download-mod-from-details').addEventListener('click', () => {
            const modal = document.getElementById('mod-details-modal');
            const workshopId = modal.dataset.workshopId;
            if (workshopId) {
                this.downloadMod(workshopId);
                modal.classList.remove('active');
            }
        });
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        } else if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }
}

// Initialize when DOM and electronAPI are ready
function initializeModBrowser() {
    // Wait for electronAPI to be available
    function tryInit() {
        if (typeof window.electronAPI !== 'undefined') {
            if (!window.modBrowser) {
                window.modBrowser = new ModBrowser();
                window.modBrowser.setupModalListeners();
            }
        } else {
            setTimeout(tryInit, 100);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
}

initializeModBrowser();

