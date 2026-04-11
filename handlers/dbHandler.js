const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '..', 'data', 'memory.json');
const HAIKARU_MEMORY_FILE = path.join(__dirname, '..', 'data', 'haikaru_memory.json');

let activeChats = new Set();
// Default Disable Grup yang diminta Bos
let disabledChats = new Set(['120363404404808548@g.us']); 
let chatMemories = new Map();
let haikaruMemories = new Map();

// --- SHAKARU DB ---
function saveMemories() {
    try {
        // Buat folder data jika belum ada
        if (!fs.existsSync(path.dirname(MEMORY_FILE))) {
            fs.mkdirSync(path.dirname(MEMORY_FILE), { recursive: true });
        }
        const data = {
            activeChats: Array.from(activeChats),
            disabledChats: Array.from(disabledChats),
            chatMemories: Object.fromEntries(chatMemories)
        };
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[ERROR] Gagal simpan memori Shakaru:', err.message);
    }
}

function loadMemories() {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
            
            activeChats.clear();
            (data.activeChats || []).forEach(c => activeChats.add(c));
            
            disabledChats.clear();
            (data.disabledChats || ['120363404404808548@g.us']).forEach(c => disabledChats.add(c));
            
            chatMemories.clear();
            Object.entries(data.chatMemories || {}).forEach(([k, v]) => chatMemories.set(k, v));
            
            console.log(`[INFO] Berhasil memuat memori Shakaru: ${activeChats.size} chat aktif.`);
        }
    } catch (err) {
        console.error('[ERROR] Gagal muat memori Shakaru:', err.message);
    }
}

// --- HAIKARU DB ---
function saveHaikaruMemories() {
    try {
        if (!fs.existsSync(path.dirname(HAIKARU_MEMORY_FILE))) {
            fs.mkdirSync(path.dirname(HAIKARU_MEMORY_FILE), { recursive: true });
        }
        const data = Object.fromEntries(haikaruMemories);
        fs.writeFileSync(HAIKARU_MEMORY_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('[ERROR] Gagal simpan Haikaru memory:', err.message);
    }
}

function loadHaikaruMemories() {
    try {
        if (fs.existsSync(HAIKARU_MEMORY_FILE)) {
            const data = JSON.parse(fs.readFileSync(HAIKARU_MEMORY_FILE, 'utf8'));
            
            haikaruMemories.clear();
            Object.entries(data || {}).forEach(([k, v]) => haikaruMemories.set(k, v));
            
            console.log(`[INFO] Berhasil memuat memori Haikaru dari file.`);
        }
    } catch (err) {
        console.error('[ERROR] Gagal muat memori Haikaru:', err.message);
    }
}

module.exports = {
    activeChats,
    disabledChats,
    chatMemories,
    haikaruMemories,
    saveMemories,
    loadMemories,
    saveHaikaruMemories,
    loadHaikaruMemories
};
