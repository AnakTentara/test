const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { generateContentRotator } = require('./geminiRotator');
const { disabledChats, saveDisabledChats, haikaruMemories, saveHaikaruMemories, getRecentChatLog } = require('./dbHandler');
const { setActiveVoice } = require('./voiceHandler');
const { scrubThoughts, sendLongMessage } = require('./utils');
const { getConfig, updateModel } = require('./configManager');
const { classifyComplexity, startThinkingAnimation, startNormalAnimation } = require('./thinkingRouter');

// ===== OWNER CONFIG (dari configManager) =====
function getOwnerNumbers() { return getConfig().owner_numbers || []; }

const PERSONAS_DIR = path.join(__dirname, '..', 'config', 'personas');
const ACTIVE_CONFIG = path.join(PERSONAS_DIR, 'active.yml');
const DEFAULT_PERSONA = path.join(PERSONAS_DIR, 'default.txt');
const CHAT_PERSONAS_FILE = path.join(__dirname, '..', 'config', 'chat-personas.yml');
const CONTACTS_FILE = path.join(__dirname, '..', 'config', 'contacts.yml');

// ===== CONTACTS (LID -> Number Mapping) =====
let contactsMap = {}; // "xxx@lid" -> "628xxx"

function loadContacts() {
    try {
        if (fs.existsSync(CONTACTS_FILE)) {
            const parsed = yaml.load(fs.readFileSync(CONTACTS_FILE, 'utf8'));
            contactsMap = parsed?.lid_map || {};
            console.log(`[INFO] Contacts dimuat: ${Object.keys(contactsMap).length} entri.`);
        }
    } catch (err) { console.error('[ERROR] Gagal muat contacts.yml:', err.message); }
}

function saveContacts() {
    try {
        fs.writeFileSync(CONTACTS_FILE, yaml.dump({ lid_map: contactsMap }, { lineWidth: -1 }));
    } catch (err) { console.error('[ERROR] Gagal simpan contacts.yml:', err.message); }
}

/**
 * Resolve LID ke nomor telepon (628xxx).
 * Return null jika tidak ditemukan.
 */
function resolveNumber(lid) {
    return contactsMap[lid] || null;
}

// ===== BOT STATS =====
const botStats = {
    startTime: Date.now(),
    totalReplies: 0,
    totalVoiceNotes: 0,
};

function incrementReply() { botStats.totalReplies++; }
function incrementVN() { botStats.totalVoiceNotes++; }

// ===== CHAT PERSONA MAPPING =====
let chatPersonaMap = {}; // chatId -> slot number

function loadChatPersonas() {
    try {
        if (fs.existsSync(CHAT_PERSONAS_FILE)) {
            const parsed = yaml.load(fs.readFileSync(CHAT_PERSONAS_FILE, 'utf8'));
            chatPersonaMap = parsed?.assignments || {};
            console.log(`[INFO] Chat persona assignments dimuat: ${Object.keys(chatPersonaMap).length} chat.`);
        }
    } catch (err) {
        console.error('[ERROR] Gagal muat chat-personas.yml:', err.message);
    }
}

function saveChatPersonas() {
    try {
        fs.writeFileSync(CHAT_PERSONAS_FILE, yaml.dump({ assignments: chatPersonaMap }, { lineWidth: -1 }));
    } catch (err) {
        console.error('[ERROR] Gagal simpan chat-personas.yml:', err.message);
    }
}

function assignPersonaToChat(chatId, slot) {
    chatPersonaMap[chatId] = parseInt(slot);
    saveChatPersonas();
}

function removePersonaAssignment(chatId) {
    delete chatPersonaMap[chatId];
    saveChatPersonas();
}

// ===== PERSONA MANAGER =====
function getActiveSlot() {
    try {
        const cfg = yaml.load(fs.readFileSync(ACTIVE_CONFIG, 'utf8'));
        return cfg?.active_slot || 1;
    } catch { return 1; }
}

/**
 * Ambil persona untuk chat tertentu.
 * Priority: per-chat assignment > global active slot > default.txt
 */
function getPersonaForChat(chatId) {
    const slot = chatPersonaMap[chatId] || null;
    if (slot) {
        const slotFile = path.join(PERSONAS_DIR, `save-${slot}.txt`);
        try { return fs.readFileSync(slotFile, 'utf8').trim(); } catch { }
    }
    // Fallback ke default.txt (bukan active slot global)
    try { return fs.readFileSync(DEFAULT_PERSONA, 'utf8').trim(); } catch { }
    return 'Kamu adalah Haikaru, asisten AI yang ramah dan gaul.';
}

// Tetap ada untuk backward compat & agent switch global
function getActivePersona() {
    const slot = getActiveSlot();
    const slotFile = path.join(PERSONAS_DIR, `save-${slot}.txt`);
    try { return fs.readFileSync(slotFile, 'utf8').trim(); } catch { }
    try { return fs.readFileSync(DEFAULT_PERSONA, 'utf8').trim(); } catch { }
    return 'Kamu adalah Haikaru, asisten AI yang ramah dan gaul.';
}

function setActiveSlot(slot) {
    const cfg = { active_slot: parseInt(slot) };
    fs.writeFileSync(ACTIVE_CONFIG, yaml.dump(cfg));
}

function updatePersonaSlot(slot, newContent) {
    fs.writeFileSync(path.join(PERSONAS_DIR, `save-${slot}.txt`), newContent);
}

function readPersonaSlot(slot) {
    const file = path.join(PERSONAS_DIR, `save-${slot}.txt`);
    try { return fs.readFileSync(file, 'utf8').trim(); }
    catch { return fs.readFileSync(DEFAULT_PERSONA, 'utf8').trim(); }
}

function resetSlotToDefault(slot) {
    const defaultContent = fs.readFileSync(DEFAULT_PERSONA, 'utf8');
    updatePersonaSlot(slot, defaultContent);
}

// ===== TOOL DEFINITIONS =====
const AGENT_TOOLS = [
    {
        type: "function",
        function: {
            name: "update_persona_slot",
            description: "Update atau tambahkan instruksi baru ke dalam persona Haikaru di slot tertentu. AI akan membaca persona lama lalu menambahkan/mengupdate instruksi baru secara alami.",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", enum: [1, 2, 3], description: "Nomor slot persona (1, 2, atau 3)" },
                    instruction: { type: "string", description: "Instruksi baru yang ingin ditambahkan atau diubah" }
                },
                required: ["slot", "instruction"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "switch_persona_slot",
            description: "Ganti slot persona aktif global (default untuk chat yang tidak punya assignment)",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", enum: [1, 2, 3], description: "Nomor slot yang ingin diaktifkan" }
                },
                required: ["slot"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "assign_persona_to_chat",
            description: "Tetapkan slot persona tertentu untuk satu chat atau grup spesifik",
            parameters: {
                type: "object",
                properties: {
                    chatId: { type: "string", description: "Chat ID target, atau 'this' untuk chat saat ini" },
                    slot: { type: "number", enum: [1, 2, 3], description: "Slot persona yang ingin digunakan" }
                },
                required: ["chatId", "slot"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "remove_persona_assignment",
            description: "Hapus assignment persona dari chat tertentu (kembali ke default)",
            parameters: {
                type: "object",
                properties: {
                    chatId: { type: "string", description: "Chat ID target, atau 'this' untuk chat saat ini" }
                },
                required: ["chatId"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "reset_persona_slot",
            description: "Reset slot persona ke konten default awal",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", enum: [1, 2, 3], description: "Nomor slot yang ingin di-reset" }
                },
                required: ["slot"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_persona_slot",
            description: "Baca isi persona di slot tertentu, atau tampilkan persona aktif chat ini",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", enum: [0, 1, 2, 3], description: "Nomor slot (0 = persona chat saat ini)" }
                },
                required: ["slot"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_bot_status",
            description: "Dapatkan status bot: uptime, total pesan dibalas, total VN, info assignment persona",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "disable_chat",
            description: "Matikan AI di chat tertentu atau chat saat ini",
            parameters: {
                type: "object",
                properties: {
                    chatId: { type: "string", description: "Chat ID target, atau 'this' untuk chat saat ini" }
                },
                required: ["chatId"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "enable_chat",
            description: "Hidupkan kembali AI di chat tertentu atau chat saat ini",
            parameters: {
                type: "object",
                properties: {
                    chatId: { type: "string", description: "Chat ID target, atau 'this' untuk chat saat ini" }
                },
                required: ["chatId"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "map_contact",
            description: "Daftarkan mapping LID ke nomor telepon. Gunakan saat user minta 'simpan nomor ini', 'daftarkan kontakku', atau sejenisnya.",
            parameters: {
                type: "object",
                properties: {
                    lid: { type: "string", description: "LID user dalam format xxx@lid" },
                    phone: { type: "string", description: "Nomor telepon format 628xxx atau 08xxx" }
                },
                required: ["lid", "phone"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "change_voice",
            description: "Ubah suara AI ke ID spesifik dari NOIZ saat user minta ganti suara. Pilihan ID (NOIZ MALE): '883b6b7c' (The Mentor/CEO Dingin), 'ac09aeb4' (Pemuda Host/Magnetik), '3b9f1e27' (Pemuda Tech/Ceram), 'a845c7de' (Bule Audiobook), '87cb2405' (Bapak2 Edukasi), '578b4be2' (Jepang Marah/Game), 'f00e45a1' (Jepang Kalem). Pilih ID yang paling cocok dengan request.",
            parameters: {
                type: "object",
                properties: {
                    voice_id: {
                        type: "string",
                        description: "ID Suara NOIZ yang dipilih",
                        enum: ['883b6b7c', 'ac09aeb4', '3b9f1e27', 'a845c7de', '87cb2405', '578b4be2', 'f00e45a1']
                    }
                },
                required: ["voice_id"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "change_model",
            description: "Ganti model AI yang digunakan. Target bisa 'all' (semua), 'haikaru' (publik), 'shakaru' (roleplay), atau 'agent' (owner). Contoh model: 'gemini-3.1-flash-lite-preview', 'gemma-4-31b-it', 'gemma-4-26b-a4b-it'.",
            parameters: {
                type: "object",
                properties: {
                    target: { type: "string", enum: ["all", "default", "haikaru", "shakaru", "agent"], description: "Target mana yang diganti modelnya" },
                    model_name: { type: "string", description: "Nama model AI yang akan digunakan" }
                },
                required: ["target", "model_name"]
            }
        }
    }
];

// ===== TOOL EXECUTOR =====
async function executeTool(toolName, args, chatId) {
    switch (toolName) {
        case 'update_persona_slot': {
            const { slot, instruction } = args;
            const currentPersona = readPersonaSlot(slot);
            const mergeResp = await generateContentRotator(getConfig().models?.agent || 'gemini-3.1-flash-lite-preview', [{ role: 'user', parts: [{ text: `PERSONA LAMA:\n${currentPersona}\n\nINSTRUKSI BARU:\n${instruction}\n\nHasilkan persona yang telah diupdate:` }] }], { systemInstruction: { parts: [{ text: 'Kamu adalah editor persona AI. Gabungkan persona lama dengan instruksi baru secara natural. Output hanya teks persona baru saja, tanpa komentar.' }] }, temperature: 0.6, maxOutputTokens: 1500 });
            const newPersona = mergeResp.text.trim();
            updatePersonaSlot(slot, newPersona);
            return `✅ Persona *Slot ${slot}* berhasil diupdate!\n\n_Instruksi baru:_ ${instruction}`;
        }

        case 'switch_persona_slot': {
            setActiveSlot(args.slot);
            return `✅ Default persona global sekarang menggunakan *Slot ${args.slot}*.`;
        }

        case 'assign_persona_to_chat': {
            const target = args.chatId === 'this' ? chatId : args.chatId;
            assignPersonaToChat(target, args.slot);
            return `✅ Chat *${target}* sekarang menggunakan *Persona Slot ${args.slot}*.`;
        }

        case 'remove_persona_assignment': {
            const target = args.chatId === 'this' ? chatId : args.chatId;
            removePersonaAssignment(target);
            return `✅ Assignment persona dihapus dari *${target}*. Kembali ke default.`;
        }

        case 'reset_persona_slot': {
            resetSlotToDefault(args.slot);
            return `✅ Persona *Slot ${args.slot}* telah di-reset ke default.`;
        }

        case 'read_persona_slot': {
            if (args.slot === 0) {
                const persona = getPersonaForChat(chatId);
                const assignment = chatPersonaMap[chatId];
                const label = assignment ? `Slot ${assignment}` : 'Default';
                return `📄 *Persona aktif chat ini (${label}):*\n\n${persona}`;
            }
            const content = readPersonaSlot(args.slot);
            return `📄 *Isi Persona Slot ${args.slot}:*\n\n${content}`;
        }

        case 'get_bot_status': {
            const uptimeMs = Date.now() - botStats.startTime;
            const h = Math.floor(uptimeMs / 3600000);
            const m = Math.floor((uptimeMs % 3600000) / 60000);
            const s = Math.floor((uptimeMs % 60000) / 1000);
            const assignmentCount = Object.keys(chatPersonaMap).length;
            const memoryCount = haikaruMemories.size;
            const disabledCount = disabledChats.size;

            const assignmentList = assignmentCount > 0
                ? Object.entries(chatPersonaMap).map(([id, slot]) => `  - ${id}: Slot ${slot}`).join('\n')
                : '  (tidak ada)';

            return `🤖 *STATUS BOT HAIKARU*\n\n` +
                `⏱️ *Uptime:* ${h}j ${m}m ${s}d\n` +
                `💬 *Total Pesan Dibalas:* ${botStats.totalReplies}\n` +
                `🎤 *Total Voice Note:* ${botStats.totalVoiceNotes}\n` +
                `🧠 *Chat dalam Memori:* ${memoryCount}\n` +
                `🔇 *Chat Dinonaktifkan:* ${disabledCount}\n` +
                `🎭 *Chat dengan Persona Custom:*\n${assignmentList}`;
        }

        case 'disable_chat': {
            const target = args.chatId === 'this' ? chatId : args.chatId;
            disabledChats.add(target);
            saveDisabledChats();
            return `🔇 AI dimatikan di *${target}*.`;
        }

        case 'enable_chat': {
            const target = args.chatId === 'this' ? chatId : args.chatId;
            disabledChats.delete(target);
            saveDisabledChats();
            return `🔊 AI dihidupkan di *${target}*.`;
        }

        case 'map_contact': {
            let lid = args.lid;
            if (!lid.endsWith('@lid')) lid = lid + '@lid';
            // Normalisasi number: 08xxx → 628xxx
            let phone = args.phone;
            if (phone.startsWith('0')) phone = '62' + phone.slice(1);
            contactsMap[lid] = phone;
            saveContacts();
            return `✅ Kontak terdaftar! *${lid}* → *${phone}*`;
        }

        case 'change_voice': {
            setActiveVoice(args.voice_id);
            return `✅ Suara berhasil diubah ke ID: *${args.voice_id}*`;
        }

        case 'change_model': {
            const { target, model_name } = args;
            const success = updateModel(target, model_name);
            if (success) {
                const cfg = getConfig();
                const modelList = Object.entries(cfg.models).map(([k, v]) => `  - *${k}*: ${v}`).join('\n');
                return `✅ Model "${target}" berhasil diubah ke *${model_name}*!\n\n📋 *Model saat ini:*\n${modelList}`;
            }
            return `❌ Gagal mengubah model. Target "${target}" tidak valid.`;
        }

        default:
            return `❓ Tool "${toolName}" tidak dikenal.`;
    }
}

// ===== MAIN AGENT HANDLER =====
async function runAgent(sock, chatId, textMessage, msg, imageObj) {
    try {
        const basePersona = getPersonaForChat(chatId);
        const userMessage = imageObj ? {
            role: 'user',
            parts: [
                { text: textMessage || 'Apa isi gambar ini?' },
                { inlineData: { mimeType: imageObj.mimeType, data: imageObj.data } }
            ]
        } : { role: 'user', parts: [{ text: textMessage }] };

        const recentLog = getRecentChatLog(chatId, 15);
        let logText = "";
        if (recentLog.length > 0) {
            logText = "[RECENT CHAT LOG]\n" + recentLog.map(l => `[${l.time}] ${l.name}: ${l.text}`).join('\n');
        }

        const thinkingModel = getConfig().models?.thinking;
        const isComplex = (!!thinkingModel) && textMessage && textMessage.length > 5 ? await classifyComplexity(textMessage) : false;

        let completion;
        const genAiTools = [{ functionDeclarations: AGENT_TOOLS.map(t => t.function) }];

        if (isComplex) {
            console.log(`[🧠 AGENT DEEP THINK] Routing ke model thinking: ${thinkingModel}`);
            const complexInstruct = `\n\n[ATURAN OUTPUT MUTLAK]\n1. Kamu dalam mode DEEP THINKING.\n2. Detail, Komprehensif, dan Panjang.\n3. THINKING di <thought> tag.\n4. Jawaban WhatsApp final di <WhatsAppMessage> tag.`;
            const sys = `${basePersona}\n\n[=== INSTRUKSI KHUSUS OWNER ===]\n${logText}\n${complexInstruct}`;

            completion = await generateContentRotator(thinkingModel, [userMessage], { systemInstruction: { parts: [{ text: sys }] }, tools: genAiTools, temperature: 0.7, maxOutputTokens: 2500 });
        } else {
            const simpleInstruct = `\n\n[ATURAN OUTPUT]\nBalas natural. Thinking di <thought>. Jawaban final di <WhatsAppMessage>.`;
            const sys = `${basePersona}\n\n[=== INSTRUKSI KHUSUS OWNER ===]\n${logText}\n${simpleInstruct}`;

            completion = await generateContentRotator(getConfig().models?.agent || 'gemini-3.1-flash-lite-preview', [userMessage], { systemInstruction: { parts: [{ text: sys }] }, tools: genAiTools, temperature: 0.7, maxOutputTokens: 2000 });
        }

        const rawAnswer = completion.text || '';
        console.log(`\n============== AGENT AI RAW RESPONSE ==============\n${rawAnswer}\n====================================================\n`);

        const answer = scrubThoughts(rawAnswer);
        const functionCalls = completion.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
            for (const tc of functionCalls) {
                console.log(`\n[🤖 AGENT] Tool: ${tc.name}`, tc.args);
                const result = await executeTool(tc.name, tc.args, chatId);
                await sock.sendMessage(chatId, { text: result }, { quoted: msg });
            }
        } else {
            await sendLongMessage(sock, chatId, answer, msg);
        }
    } catch (err) {
        console.error('[🤖 AGENT ERROR]', err.message);
        await sock.sendMessage(chatId, { text: `❌ Agent error: ${err.message}` }, { quoted: msg });
    }
}

module.exports = {
    runAgent,
    isOwner,
    getActivePersona,
    getPersonaForChat,
    loadChatPersonas,
    loadContacts,
    resolveNumber,
    botStats,
    incrementReply,
    incrementVN
};
