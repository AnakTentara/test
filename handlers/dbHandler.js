const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SHAKARU_DIR = path.join(DATA_DIR, 'shakaru_chats');
const HAIKARU_DIR = path.join(DATA_DIR, 'haikaru_chats');
const ACTIVE_CHATS_FILE = path.join(DATA_DIR, 'active_chats.json');
const DISABLED_CHATS_FILE = path.join(__dirname, '..', 'config', 'disabled-chats.yml');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SHAKARU_DIR)) fs.mkdirSync(SHAKARU_DIR, { recursive: true });
if (!fs.existsSync(HAIKARU_DIR)) fs.mkdirSync(HAIKARU_DIR, { recursive: true });

let activeChats = new Set();
let disabledChats = new Set(); // Diload dari disabled-chats.yml
let chatMemories = new Map();
let haikaruMemories = new Map();

// --- DISABLED CHATS CONFIG (YAML) ---
function loadDisabledChats() {
    try {
        if (fs.existsSync(DISABLED_CHATS_FILE)) {
            const parsed = yaml.load(fs.readFileSync(DISABLED_CHATS_FILE, 'utf8'));
            disabledChats.clear();
            (parsed?.disabled || []).forEach(id => disabledChats.add(id));
            console.log(`[INFO] Disabled chats dimuat: ${disabledChats.size} chat.`);
        }
    } catch (err) {
        console.error('[ERROR] Gagal muat disabled-chats.yml:', err.message);
    }
}

function saveDisabledChats() {
    try {
        const data = { disabled: Array.from(disabledChats) };
        fs.writeFileSync(DISABLED_CHATS_FILE, yaml.dump(data, { lineWidth: -1 }));
    } catch (err) {
        console.error('[ERROR] Gagal simpan disabled-chats.yml:', err.message);
    }
}

function saveActiveChats() {
    try {
        fs.writeFileSync(ACTIVE_CHATS_FILE, JSON.stringify({ activeChats: Array.from(activeChats) }));
    } catch(err) {
        console.error('[ERROR] Gagal simpan active_chats.json', err.message);
    }
}

// --- SHAKARU DB ---
function saveSingleShakaruMemory(chatId) {
    try {
        saveActiveChats(); // Simpan state config global juga
        const mem = chatMemories.get(chatId);
        if (!mem) return;
        const fName = mem.fileName || `Unknown-${chatId.replace(/[^a-zA-Z0-9]/g, '')}`;
        fs.writeFileSync(path.join(SHAKARU_DIR, fName + '.json'), JSON.stringify(mem, null, 2));
    } catch (err) {
        console.error('[ERROR] Gagal simpan Shakaru memory:', err.message);
    }
}

function loadMemories() {
    try {
        if (fs.existsSync(ACTIVE_CHATS_FILE)) {
            const d = JSON.parse(fs.readFileSync(ACTIVE_CHATS_FILE, 'utf8'));
            activeChats.clear();
            (d.activeChats || []).forEach(c => activeChats.add(c));
        }

        chatMemories.clear();
        if (fs.existsSync(SHAKARU_DIR)) {
            const files = fs.readdirSync(SHAKARU_DIR);
            for (const f of files) {
                if (f.endsWith('.json')) {
                    const data = JSON.parse(fs.readFileSync(path.join(SHAKARU_DIR, f), 'utf8'));
                    if (data.id) chatMemories.set(data.id, data);
                }
            }
            console.log(`[INFO] Berhasil memuat memori Shakaru: ${files.length} percakapan.`);
        }
    } catch (err) {
        console.error('[ERROR] Gagal muat memori Shakaru:', err.message);
    }
}

// --- HAIKARU DB ---
function saveSingleHaikaruMemory(chatId) {
    try {
        const mem = haikaruMemories.get(chatId);
        if (!mem) return;
        const fName = mem.fileName || `Unknown-${chatId.replace(/[^a-zA-Z0-9]/g, '')}`;
        fs.writeFileSync(path.join(HAIKARU_DIR, fName + '.json'), JSON.stringify(mem, null, 2));
    } catch (err) {
        console.error('[ERROR] Gagal simpan Haikaru memory:', err.message);
    }
}

function loadHaikaruMemories() {
    try {
        haikaruMemories.clear();
        if (fs.existsSync(HAIKARU_DIR)) {
            const files = fs.readdirSync(HAIKARU_DIR);
            for (const f of files) {
                if (f.endsWith('.json')) {
                    const data = JSON.parse(fs.readFileSync(path.join(HAIKARU_DIR, f), 'utf8'));
                    if (data.id) haikaruMemories.set(data.id, data);
                }
            }
            console.log(`[INFO] Berhasil memuat memori Haikaru dari direktori (${files.length} chat).`);
        }
    } catch (err) {
        console.error('[ERROR] Gagal muat memori Haikaru:', err.message);
    }
}

// --- GLOBAL DELETE ---
function deleteMemory(chatId) {
    try {
        const sMem = chatMemories.get(chatId);
        if (sMem) {
            const p = path.join(SHAKARU_DIR, (sMem.fileName || `Unknown-${chatId.replace(/[^a-zA-Z0-9]/g, '')}`) + '.json');
            if (fs.existsSync(p)) fs.unlinkSync(p);
            chatMemories.delete(chatId);
        }
        
        const hMem = haikaruMemories.get(chatId);
        if (hMem) {
            const p = path.join(HAIKARU_DIR, (hMem.fileName || `Unknown-${chatId.replace(/[^a-zA-Z0-9]/g, '')}`) + '.json');
            if (fs.existsSync(p)) fs.unlinkSync(p);
            haikaruMemories.delete(chatId);
        }
        
        // Coba force refresh hapus active chat juga
        if (activeChats.has(chatId)) {
            activeChats.delete(chatId);
            saveActiveChats();
        }
    } catch (err) {
        console.error(`[ERROR] Gagal hapus memory untuk ${chatId}:`, err.message);
    }
}

module.exports = {
    activeChats,
    disabledChats,
    chatMemories,
    haikaruMemories,
    saveSingleShakaruMemory,
    loadMemories,
    saveSingleHaikaruMemory,
    loadHaikaruMemories,
    loadDisabledChats,
    saveDisabledChats,
    deleteMemory,
    saveActiveChats
};
