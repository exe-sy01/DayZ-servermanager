const fs = require('fs-extra');
const path = require('path');
const EventEmitter = require('events');
const configEditor = require('./configEditor');

const MODEL = 'claude-opus-5';
const MAX_AGENT_TURNS = 25;

const SYSTEM_PROMPT = `You are the configuration assistant inside "DayZ Server Manager", an app that manages a DayZ dedicated server installation. The user describes how they want their server configured, and you configure it for them by planning precise edits to the server's config files.

You can read any config/mission file in the server directory with the tools provided. Typical files: serverDZ.cfg (hostname, password, maxPlayers, time acceleration, mission template...), basic.cfg (network tuning), mpmissions/<mission>/ files such as cfgeconomycore.xml, types.xml, cfgspawnabletypes.xml, events.xml, globals.xml (loot economy, zombie/animal counts, stamina, weather), cfggameplay.json, init.c (starting gear, day/night), cfgeventspawns.xml, and mission env/*.xml.

Workflow:
1. Use list_files to see what exists, then read_file on every file you intend to change (and any file you need for context). Never propose an edit to a file you have not read, except when creating a brand-new file.
2. When you know exactly what to change, call submit_plan exactly once with the complete plan, then stop.

Rules for the plan:
- Each edit targets one file (path relative to the server root, forward slashes).
- For changes to an existing file use action "replace" with a "find" string copied EXACTLY, byte-for-byte, from the file content you read (including whitespace and line breaks) and a "replace" string. The "find" string must be unique within the file — include enough surrounding context to make it unique.
- To create a new file use action "create" with "newContent".
- Give every edit a short human-readable "description" and a "location" (e.g. "line ~42, inside class Missions" or "hostname line near top of file") so the user can find and undo it.
- Only change what the user's request requires. Keep the file's existing formatting style and line endings.
- If part of the request cannot be done by editing files (e.g. requires installing a mod), note it in "warnings" instead of guessing.
- If the request is ambiguous, choose the most common sensible interpretation and note the assumption in the plan summary.`;

const TOOLS = [
  {
    name: 'list_files',
    description: 'List the editable config files, missions and file tree of the DayZ server directory. Call this first.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'read_file',
    description: 'Read a file inside the server directory. Path is relative to the server root, e.g. "serverDZ.cfg" or "mpmissions/dayzOffline.chernarusplus/cfgeconomycore.xml".',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the server root' }
      },
      required: ['path'],
      additionalProperties: false
    }
  },
  {
    name: 'submit_plan',
    description: 'Submit the final configuration plan. Call exactly once, after reading all files you will edit. This ends the planning session.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Short summary of what the plan does and any assumptions made' },
        warnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Things the user should know: parts of the request that cannot be done via config files, risky changes, etc.'
        },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              file: { type: 'string', description: 'Path relative to server root, forward slashes' },
              action: { type: 'string', enum: ['replace', 'create'] },
              description: { type: 'string', description: 'What this edit changes, in one sentence' },
              location: { type: 'string', description: 'Where in the file the change happens (approx line / section name)' },
              find: { type: 'string', description: 'Exact existing text to replace (action=replace). Must be unique in the file.' },
              replace: { type: 'string', description: 'Replacement text (action=replace)' },
              newContent: { type: 'string', description: 'Full file content (action=create)' }
            },
            required: ['file', 'action', 'description', 'location'],
            additionalProperties: false
          }
        }
      },
      required: ['summary', 'edits'],
      additionalProperties: false
    }
  }
];

/**
 * AI-driven server configuration (Claude API).
 * Plans edits first (read-only), applies them only after user approval,
 * backing every touched file up to <serverRoot>/backups/<timestamp>/...
 */
class AISetup extends EventEmitter {
  constructor() {
    super();
    this.planning = false;
  }

  progress(message) {
    this.emit('progress', { message, time: new Date().toISOString() });
  }

  /**
   * Resolve a model-supplied relative path and confine it to the server root.
   */
  resolveSafe(serverPath, relPath) {
    const root = path.resolve(serverPath);
    const resolved = path.resolve(root, String(relPath || ''));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error(`Path escapes server directory: ${relPath}`);
    }
    return resolved;
  }

  async buildFileInventory(serverPath) {
    const lines = [];
    const configFiles = await configEditor.listConfigFiles(serverPath);
    lines.push('Known config files (relative to server root):');
    for (const f of configFiles) {
      const rel = path.relative(serverPath, f.path).split(path.sep).join('/');
      lines.push(`- ${rel} [${f.category}]`);
    }
    const missions = await configEditor.listMissions(serverPath);
    if (missions.length) {
      lines.push('', 'Missions in mpmissions/:');
      for (const m of missions) {
        lines.push(`- ${m.name}`);
        try {
          const entries = await fs.readdir(m.path);
          const shown = entries.slice(0, 60);
          lines.push(`  files: ${shown.join(', ')}${entries.length > 60 ? ', ...' : ''}`);
        } catch (_) { /* unreadable mission folder */ }
      }
    }
    return lines.join('\n');
  }

  /**
   * Phase 1: read-only planning session with Claude.
   * Returns { success, plan } — no files are touched here.
   */
  async generatePlan(serverPath, apiKey, userRequest) {
    if (this.planning) throw new Error('A plan is already being generated');
    if (!serverPath || !await fs.pathExists(serverPath)) throw new Error('Server path is not set or does not exist');
    if (!apiKey) throw new Error('Anthropic API key not set (see the API key field above)');
    if (!userRequest || !userRequest.trim()) throw new Error('Describe how you want the server configured');

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    this.planning = true;
    try {
      this.progress('Scanning server directory...');
      const inventory = await this.buildFileInventory(serverPath);

      const messages = [{
        role: 'user',
        content: `Server root: (paths below are relative to it)\n\n${inventory}\n\nUser request:\n${userRequest.trim()}`
      }];

      let plan = null;

      for (let turn = 0; turn < MAX_AGENT_TURNS && !plan; turn++) {
        const response = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default'
        });

        if (response.stop_reason === 'refusal') {
          throw new Error('The AI declined this request' +
            (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : '.'));
        }

        const toolUses = response.content.filter(b => b.type === 'tool_use');
        if (toolUses.length === 0) {
          // Model stopped without submitting a plan — nudge it once, then give up
          const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
          if (turn >= MAX_AGENT_TURNS - 2) {
            throw new Error(`The AI ended without producing a plan. It said: ${text || '(nothing)'}`);
          }
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: 'Please continue and finish by calling submit_plan with the complete plan.' });
          continue;
        }

        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const tu of toolUses) {
          let resultText;
          try {
            if (tu.name === 'list_files') {
              this.progress('AI is listing server files...');
              resultText = inventory;
            } else if (tu.name === 'read_file') {
              const rel = tu.input?.path;
              this.progress(`AI is reading ${rel}...`);
              const abs = this.resolveSafe(serverPath, rel);
              if (!await fs.pathExists(abs)) {
                resultText = `ERROR: file not found: ${rel}`;
              } else {
                const stat = await fs.stat(abs);
                if (stat.size > 2 * 1024 * 1024) {
                  resultText = `ERROR: file too large to read (${stat.size} bytes): ${rel}`;
                } else {
                  resultText = await fs.readFile(abs, 'utf-8');
                }
              }
            } else if (tu.name === 'submit_plan') {
              this.progress('AI submitted a plan, validating...');
              plan = tu.input;
              resultText = 'Plan received.';
            } else {
              resultText = `ERROR: unknown tool ${tu.name}`;
            }
          } catch (err) {
            resultText = `ERROR: ${err.message}`;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: resultText,
            is_error: typeof resultText === 'string' && resultText.startsWith('ERROR:')
          });
        }
        messages.push({ role: 'user', content: toolResults });
      }

      if (!plan) throw new Error('The AI did not produce a plan within the turn limit');

      const validated = await this.validatePlan(serverPath, plan);
      this.progress('Plan ready for review.');
      return { success: true, plan: validated };
    } finally {
      this.planning = false;
    }
  }

  /**
   * Dry-run validation: checks each edit against the files on disk without writing.
   */
  async validatePlan(serverPath, plan) {
    const edits = Array.isArray(plan.edits) ? plan.edits : [];
    for (const edit of edits) {
      edit.valid = false;
      edit.validationError = null;
      try {
        const abs = this.resolveSafe(serverPath, edit.file);
        if (edit.action === 'replace') {
          if (!edit.find || edit.replace === undefined) throw new Error('Missing find/replace text');
          if (!await fs.pathExists(abs)) throw new Error('File does not exist');
          const content = await fs.readFile(abs, 'utf-8');
          const occurrences = content.split(edit.find).length - 1;
          if (occurrences === 0) throw new Error('Text to replace was not found in the file');
          if (occurrences > 1) throw new Error(`Text to replace is not unique (${occurrences} matches)`);
        } else if (edit.action === 'create') {
          if (edit.newContent === undefined) throw new Error('Missing file content');
          if (await fs.pathExists(abs)) throw new Error('File already exists (expected a new file)');
        } else {
          throw new Error(`Unknown action: ${edit.action}`);
        }
        edit.valid = true;
      } catch (err) {
        edit.validationError = err.message;
      }
    }
    return {
      summary: plan.summary || '',
      warnings: Array.isArray(plan.warnings) ? plan.warnings : [],
      edits
    };
  }

  /**
   * Phase 2: apply an approved plan. Every file that will be modified is first
   * copied into <serverRoot>/backups/<timestamp>/<same relative path>, so the
   * backup folder mirrors the server directory and files can be copied back.
   */
  async applyPlan(serverPath, plan) {
    if (!serverPath || !await fs.pathExists(serverPath)) throw new Error('Server path is not set or does not exist');
    const edits = (plan?.edits || []).filter(e => e.valid !== false);
    if (edits.length === 0) throw new Error('Plan has no valid edits to apply');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupDir = path.join(serverPath, 'backups', timestamp);

    // Back up every existing file the plan touches, mirroring the directory structure
    this.progress(`Backing up files to backups/${timestamp}/ ...`);
    for (const edit of edits) {
      const abs = this.resolveSafe(serverPath, edit.file);
      if (await fs.pathExists(abs)) {
        const rel = path.relative(serverPath, abs);
        await fs.copy(abs, path.join(backupDir, rel));
      }
    }

    const results = [];
    for (const edit of edits) {
      const result = { file: edit.file, description: edit.description, success: false };
      try {
        const abs = this.resolveSafe(serverPath, edit.file);
        if (edit.action === 'replace') {
          const content = await fs.readFile(abs, 'utf-8');
          const occurrences = content.split(edit.find).length - 1;
          if (occurrences !== 1) throw new Error(occurrences === 0 ? 'Text to replace no longer found (file changed?)' : 'Text to replace is not unique');
          await fs.writeFile(abs, content.replace(edit.find, edit.replace), 'utf-8');
        } else if (edit.action === 'create') {
          await fs.ensureDir(path.dirname(abs));
          await fs.writeFile(abs, edit.newContent, 'utf-8');
        }
        result.success = true;
        this.progress(`Applied: ${edit.file} — ${edit.description}`);
      } catch (err) {
        result.error = err.message;
        this.progress(`FAILED: ${edit.file} — ${err.message}`);
      }
      results.push(result);
    }

    return {
      success: results.every(r => r.success),
      backupDir,
      backupName: timestamp,
      results
    };
  }

  /**
   * List backup snapshots in <serverRoot>/backups/
   */
  async listBackups(serverPath) {
    const backupsRoot = path.join(serverPath, 'backups');
    if (!await fs.pathExists(backupsRoot)) return [];
    const entries = await fs.readdir(backupsRoot);
    const backups = [];
    for (const entry of entries) {
      const dir = path.join(backupsRoot, entry);
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue;
        const files = [];
        const walk = async (d) => {
          for (const e of await fs.readdir(d, { withFileTypes: true })) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) await walk(full);
            else files.push(path.relative(dir, full).split(path.sep).join('/'));
          }
        };
        await walk(dir);
        backups.push({ name: entry, path: dir, files });
      } catch (_) { /* skip unreadable entries */ }
    }
    return backups.sort((a, b) => b.name.localeCompare(a.name));
  }

  /**
   * Restore a backup snapshot: copies every file in the snapshot back to the
   * same relative path in the server root. The current versions of those files
   * are first saved to a new snapshot so the restore itself can be undone.
   */
  async restoreBackup(serverPath, backupName) {
    const backupDir = this.resolveSafe(serverPath, path.join('backups', backupName));
    if (!await fs.pathExists(backupDir)) throw new Error(`Backup not found: ${backupName}`);

    const backups = await this.listBackups(serverPath);
    const backup = backups.find(b => b.name === backupName);
    if (!backup || backup.files.length === 0) throw new Error('Backup is empty');

    // Safety snapshot of the current state of the files being restored
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const preRestoreDir = path.join(serverPath, 'backups', `${timestamp}_pre-restore`);
    for (const rel of backup.files) {
      const live = this.resolveSafe(serverPath, rel);
      if (await fs.pathExists(live)) {
        await fs.copy(live, path.join(preRestoreDir, rel));
      }
    }

    const restored = [];
    for (const rel of backup.files) {
      const live = this.resolveSafe(serverPath, rel);
      await fs.ensureDir(path.dirname(live));
      await fs.copy(path.join(backupDir, rel), live);
      restored.push(rel);
    }

    return { success: true, restored, preRestoreBackup: `${timestamp}_pre-restore` };
  }
}

module.exports = new AISetup();
