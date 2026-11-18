/**
 * AI Server Setup panel — plan / review / apply / backups
 */
class AISetupPanel {
    constructor() {
        this.currentPlan = null;
        this.busy = false;
        this.setupEventListeners();
        window.electronAPI.onAiProgress((data) => this.addProgressLine(data.message));
        this.loadKeyStatus();
    }

    esc(text) {
        const div = document.createElement('div');
        div.textContent = text ?? '';
        return div.innerHTML;
    }

    setupEventListeners() {
        document.getElementById('ai-save-key').addEventListener('click', () => this.saveKey());
        document.getElementById('ai-generate-plan').addEventListener('click', () => this.generatePlan());
        document.getElementById('ai-apply-plan').addEventListener('click', () => this.applyPlan());
        document.getElementById('ai-discard-plan').addEventListener('click', () => this.discardPlan());
        document.getElementById('ai-refresh-backups').addEventListener('click', () => this.loadBackups());
    }

    onShow() {
        this.loadKeyStatus();
        this.loadBackups();
    }

    async loadKeyStatus() {
        try {
            const cfg = await window.electronAPI.aiGetConfig();
            document.getElementById('ai-key-status').textContent =
                cfg.hasApiKey ? 'A key is saved.' : 'No key saved yet.';
        } catch (_) { /* ignore */ }
    }

    async saveKey() {
        const input = document.getElementById('ai-api-key');
        const key = input.value.trim();
        if (!key) {
            window.app?.showError('Enter an API key first');
            return;
        }
        const result = await window.electronAPI.aiSetApiKey(key);
        if (result.success) {
            input.value = '';
            window.app?.showSuccess('API key saved');
            this.loadKeyStatus();
        } else {
            window.app?.showError(result.error || 'Failed to save API key');
        }
    }

    addProgressLine(message) {
        const log = document.getElementById('ai-progress-log');
        log.style.display = 'block';
        const line = document.createElement('div');
        line.className = 'ai-progress-line';
        line.textContent = message;
        log.appendChild(line);
        log.scrollTop = log.scrollHeight;
    }

    async generatePlan() {
        if (this.busy) return;
        const request = document.getElementById('ai-request').value.trim();
        if (!request) {
            window.app?.showError('Describe how you want the server configured first');
            return;
        }

        this.busy = true;
        const btn = document.getElementById('ai-generate-plan');
        const status = document.getElementById('ai-plan-status');
        btn.disabled = true;
        btn.textContent = 'Planning...';
        status.textContent = 'The AI is reading your config files — this can take a few minutes.';
        const log = document.getElementById('ai-progress-log');
        log.innerHTML = '';
        log.style.display = 'none';
        this.discardPlan();

        try {
            const result = await window.electronAPI.aiGeneratePlan(request);
            if (result.success) {
                this.currentPlan = result.plan;
                this.renderPlan(result.plan);
                status.textContent = 'Plan ready — review it below.';
            } else {
                status.textContent = '';
                window.app?.showError(result.error || 'Failed to generate plan');
            }
        } catch (error) {
            status.textContent = '';
            window.app?.showError(`Failed to generate plan: ${error.message}`);
        } finally {
            this.busy = false;
            btn.disabled = false;
            btn.textContent = 'Generate Plan';
        }
    }

    renderPlan(plan) {
        const card = document.getElementById('ai-plan-card');
        card.style.display = 'block';
        document.getElementById('ai-apply-results').innerHTML = '';

        document.getElementById('ai-plan-summary').innerHTML =
            `<p>${this.esc(plan.summary)}</p>`;

        const warningsEl = document.getElementById('ai-plan-warnings');
        warningsEl.innerHTML = (plan.warnings || []).length
            ? `<div class="ai-warnings">${plan.warnings.map(w => `<div class="ai-warning">⚠ ${this.esc(w)}</div>`).join('')}</div>`
            : '';

        const editsEl = document.getElementById('ai-plan-edits');
        editsEl.innerHTML = (plan.edits || []).map((edit, i) => {
            const badge = edit.valid
                ? '<span class="ai-badge ai-badge-ok">will apply</span>'
                : `<span class="ai-badge ai-badge-err" title="${this.esc(edit.validationError)}">skipped: ${this.esc(edit.validationError)}</span>`;
            const diff = edit.action === 'create'
                ? `<div class="ai-diff"><div class="ai-diff-label">New file content:</div><pre class="ai-diff-add">${this.esc(edit.newContent)}</pre></div>`
                : `<div class="ai-diff">
                       <div class="ai-diff-label">Remove:</div><pre class="ai-diff-del">${this.esc(edit.find)}</pre>
                       <div class="ai-diff-label">Insert:</div><pre class="ai-diff-add">${this.esc(edit.replace)}</pre>
                   </div>`;
            return `<div class="ai-edit ${edit.valid ? '' : 'ai-edit-invalid'}">
                <div class="ai-edit-header">
                    <strong>${i + 1}. ${this.esc(edit.file)}</strong> ${badge}
                </div>
                <div class="ai-edit-meta">${this.esc(edit.description)}<br><em>Where: ${this.esc(edit.location)}</em></div>
                ${diff}
            </div>`;
        }).join('');

        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    discardPlan() {
        this.currentPlan = null;
        document.getElementById('ai-plan-card').style.display = 'none';
        document.getElementById('ai-plan-edits').innerHTML = '';
        document.getElementById('ai-apply-results').innerHTML = '';
    }

    async applyPlan() {
        if (this.busy || !this.currentPlan) return;
        this.busy = true;
        const btn = document.getElementById('ai-apply-plan');
        btn.disabled = true;
        btn.textContent = 'Applying...';

        try {
            const result = await window.electronAPI.aiApplyPlan(this.currentPlan);
            const resultsEl = document.getElementById('ai-apply-results');
            if (result.results) {
                resultsEl.innerHTML = `
                    <h4>Result</h4>
                    ${result.results.map(r => r.success
                        ? `<div class="ai-result-ok">✔ ${this.esc(r.file)} — ${this.esc(r.description)}</div>`
                        : `<div class="ai-result-err">✘ ${this.esc(r.file)} — ${this.esc(r.error)}</div>`).join('')}
                    <p class="settings-hint">Originals backed up to: <code>${this.esc(result.backupDir)}</code></p>`;
                if (result.success) {
                    window.app?.showSuccess('All changes applied');
                } else {
                    window.app?.showError('Some changes failed — see the results list');
                }
                this.currentPlan = null;
                this.loadBackups();
            } else {
                window.app?.showError(result.error || 'Failed to apply plan');
            }
        } catch (error) {
            window.app?.showError(`Failed to apply plan: ${error.message}`);
        } finally {
            this.busy = false;
            btn.disabled = false;
            btn.textContent = 'Approve & Apply';
        }
    }

    async loadBackups() {
        const listEl = document.getElementById('ai-backups-list');
        try {
            const result = await window.electronAPI.aiListBackups();
            const backups = result.backups || [];
            if (backups.length === 0) {
                listEl.innerHTML = '<p class="settings-hint">No backups yet.</p>';
                return;
            }
            listEl.innerHTML = backups.map(b => `
                <div class="ai-backup">
                    <div class="ai-backup-info">
                        <strong>${this.esc(b.name)}</strong>
                        <span class="settings-hint">${b.files.length} file(s): ${this.esc(b.files.slice(0, 5).join(', '))}${b.files.length > 5 ? ', ...' : ''}</span>
                    </div>
                    <button class="btn btn-secondary btn-sm ai-restore-btn" data-backup="${this.esc(b.name)}">Restore</button>
                </div>`).join('');
            listEl.querySelectorAll('.ai-restore-btn').forEach(btn => {
                btn.addEventListener('click', () => this.restoreBackup(btn.dataset.backup));
            });
        } catch (error) {
            listEl.innerHTML = `<p class="settings-hint">Could not list backups: ${this.esc(error.message)}</p>`;
        }
    }

    async restoreBackup(name) {
        if (!confirm(`Restore backup "${name}"?\n\nThe files in this snapshot will be copied back over the current versions. The current versions are saved to a new backup first.`)) {
            return;
        }
        try {
            const result = await window.electronAPI.aiRestoreBackup(name);
            if (result.success) {
                window.app?.showSuccess(`Restored ${result.restored.length} file(s). Current state saved as ${result.preRestoreBackup}`);
                this.loadBackups();
            } else {
                window.app?.showError(result.error || 'Restore failed');
            }
        } catch (error) {
            window.app?.showError(`Restore failed: ${error.message}`);
        }
    }
}

// Initialize when DOM + electronAPI are ready
(function initAISetupPanel() {
    const tryInit = () => {
        if (typeof window.electronAPI === 'undefined' || !document.getElementById('ai-panel')) {
            setTimeout(tryInit, 100);
            return;
        }
        window.aiSetupPanel = new AISetupPanel();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tryInit);
    } else {
        tryInit();
    }
})();
