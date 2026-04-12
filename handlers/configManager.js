const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'config.yml');

// Default fallback jika config.yml tidak ada
const DEFAULT_CONFIG = {
    models: {
        default: 'gemini-3.1-flash-lite-preview',
        shakaru: 'gemini-3.1-flash-lite-preview',
        haikaru: 'gemini-3.1-flash-lite-preview',
        agent: 'gemini-3.1-flash-lite-preview'
    },
    owner_numbers: ['6289675732001', '6285123097680'],
    commands: {
        ping: ['/test', '/ping', '.ping'],
        help: ['.help', '/help'],
        reset_memory: '/resetmemory',
        roleplay_start: '/rp',
        roleplay_stop: '/stop',
        disable: '/disable',
        enable: '/enable'
    }
};

let _config = null;

/**
 * Muat konfigurasi dari file config.yml.
 * Dipanggil sekali saat boot dan setiap kali ada update.
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            _config = yaml.load(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (err) {
        console.error('[ERROR] Gagal muat config.yml:', err.message);
    }
    if (!_config) {
        _config = { ...DEFAULT_CONFIG };
    }
    // Pastikan semua key utama ada (merge dengan default)
    if (!_config.models) _config.models = { ...DEFAULT_CONFIG.models };
    if (!_config.owner_numbers) _config.owner_numbers = [...DEFAULT_CONFIG.owner_numbers];
    if (!_config.commands) _config.commands = { ...DEFAULT_CONFIG.commands };
    return _config;
}

/**
 * Ambil konfigurasi saat ini (lazy load).
 * Semua module harus pakai ini, bukan meng-cache config sendiri.
 */
function getConfig() {
    if (!_config) loadConfig();
    return _config;
}

/**
 * Update model AI pada config dan simpan ke disk.
 * @param {string} target - Target model: 'all', 'default', 'shakaru', 'haikaru', 'agent'
 * @param {string} modelName - Nama model (contoh: 'gemma-4-31b-it')
 */
function updateModel(target, modelName) {
    const config = getConfig();
    
    if (target === 'all') {
        config.models.default = modelName;
        config.models.shakaru = modelName;
        config.models.haikaru = modelName;
        config.models.agent = modelName;
    } else if (config.models.hasOwnProperty(target)) {
        config.models[target] = modelName;
    } else {
        return false;
    }

    // Simpan ke disk
    try {
        fs.writeFileSync(CONFIG_FILE, yaml.dump(config, { lineWidth: -1 }));
        console.log(`[CONFIG] Model "${target}" diubah ke: ${modelName}`);
    } catch (err) {
        console.error('[ERROR] Gagal simpan config.yml:', err.message);
        return false;
    }
    return true;
}

// Load saat pertama kali di-require
loadConfig();

module.exports = { getConfig, updateModel, loadConfig };
