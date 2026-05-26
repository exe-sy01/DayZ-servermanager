const fs = require('fs-extra');
const path = require('path');

/**
 * Mod dependency checker - validates load order against requiredAddons
 */
class ModDependencyChecker {
  /**
   * Parse required addons from mod.info or meta.cpp
   */
  async parseRequiredAddons(modPath) {
    const addons = new Set();

    const tryParse = async (filePath, patterns) => {
      if (!await fs.pathExists(filePath)) return;
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match && match[1]) {
            const list = match[1].split(/[;,]/).map(s => s.replace(/"/g, '').trim()).filter(Boolean);
            list.forEach(a => addons.add(a));
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    const modInfoPath = path.join(modPath, 'mod.info');
    await tryParse(modInfoPath, [
      /requiredAddons\s*=\s*"([^"]*)"/i,
      /requiredAddons\s*=\s*\[([^\]]*)\]/i
    ]);

    const metaPath = path.join(modPath, 'meta.cpp');
    await tryParse(metaPath, [
      /requiredAddons\[\]\s*=\s*\{([^}]*)\}/i
    ]);

    const configPath = path.join(modPath, 'config.cpp');
    await tryParse(configPath, [
      /requiredAddons\[\]\s*=\s*\{([^}]*)\}/i
    ]);

    return Array.from(addons);
  }

  /**
   * Check mod dependencies against load order
   * Supports both workshop mods and local mods.
   */
  async checkDependencies(installPath, orderedMods, installedMods) {
    const violations = [];
    const modNameToId = new Map();
    const loadOrderIndex = new Map();
    const getModId = (m) => m.isLocal ? `local:${m.modName}` : String(m.workshopId);
    const findInstalled = (m) =>
      m.isLocal
        ? installedMods.find(im => im.isLocal && im.modName === m.modName)
        : installedMods.find(im => !im.isLocal && String(im.workshopId) === String(m.workshopId));

    orderedMods.forEach((mod, index) => {
      loadOrderIndex.set(getModId(mod), index);
      const installed = findInstalled(mod);
      if (installed && installed.modName) {
        const id = getModId(mod);
        modNameToId.set(installed.modName.toLowerCase(), id);
        modNameToId.set(installed.modName.toLowerCase().replace(/^@/, ''), id);
      }
    });

    for (let i = 0; i < orderedMods.length; i++) {
      const mod = orderedMods[i];
      const installed = findInstalled(mod);
      if (!installed) continue;

      let modPath = mod.isLocal
        ? (installed.serverModPath || path.join(installPath, `@${mod.modName}`))
        : path.join(installPath, 'steamapps', 'workshop', 'content', '221100', mod.workshopId.toString());
      if (installed.serverModPath && await fs.pathExists(installed.serverModPath)) {
        try {
          const stat = await fs.lstat(installed.serverModPath);
          if (stat.isSymbolicLink()) {
            modPath = await fs.readlink(installed.serverModPath);
          } else {
            modPath = installed.serverModPath;
          }
        } catch (e) {
          // Use fallback path
        }
      }

      if (!await fs.pathExists(modPath)) continue;

      const required = await this.parseRequiredAddons(modPath);
      if (required.length === 0) continue;

      for (const req of required) {
        const reqLower = req.toLowerCase().replace(/^@/, '');
        if (['dz_data', 'dz_scripts', 'dz_core', 'cf', 'chernarus', 'enoch'].includes(reqLower)) continue;

        const depId = modNameToId.get(reqLower) ||
          Array.from(modNameToId.entries()).find(([name]) => name.includes(reqLower) || reqLower.includes(name))?.[1];

        if (!depId) continue;

        const depIndex = loadOrderIndex.get(depId);
        if (depIndex !== undefined && depIndex > i) {
          const depMod = orderedMods[depIndex];
          const depInstalled = depMod.isLocal
            ? installedMods.find(im => im.isLocal && im.modName === depMod.modName)
            : installedMods.find(im => !im.isLocal && String(im.workshopId) === String(depMod.workshopId));
          violations.push({
            mod: mod.name || mod.modName || mod.workshopId,
            workshopId: mod.workshopId,
            required: depInstalled?.modName || depMod?.name || depMod?.modName || depId,
            requiredWorkshopId: depId,
            message: `${mod.name || mod.modName || mod.workshopId} requires ${depInstalled?.modName || depMod?.name || depMod?.modName || depId} to load first`
          });
        }
      }
    }

    return { valid: violations.length === 0, violations };
  }
}

module.exports = new ModDependencyChecker();
