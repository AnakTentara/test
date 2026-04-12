const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { getLocalClient } = require('./geminiRotator');
const { disabledChats, saveDisabledChats, haikaruMemories, saveHaikaruMemories } = require('./dbHandler');
const { setActiveVoice } = require('./voiceHandler');

// ===== OWNER CONFIG =====
const OWNER_NUMBERS = [
    '6289675732001', // Owner (Haikal)
    '6285123097680', // Acell
];

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
        try { return fs.readFileSync(slotFile, 'utf8').trim(); } catch {}
    }
    // Fallback ke default.txt (bukan active slot global)
    try { return fs.readFileSync(DEFAULT_PERSONA, 'utf8').trim(); } catch {}
    return 'Kamu adalah Haikaru, asisten AI yang ramah dan gaul.';
}

// Tetap ada untuk backward compat & agent switch global
function getActivePersona() {
    const slot = getActiveSlot();
    const slotFile = path.join(PERSONAS_DIR, `save-${slot}.txt`);
    try { return fs.readFileSync(slotFile, 'utf8').trim(); } catch {}
    try { return fs.readFileSync(DEFAULT_PERSONA, 'utf8').trim(); } catch {}
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
    }
];

// ===== TOOL EXECUTOR =====
async function executeTool(toolName, args, chatId) {
    switch (toolName) {
        case 'update_persona_slot': {
            const { slot, instruction } = args;
            const currentPersona = readPersonaSlot(slot);
            const client = getLocalClient();
            const mergeCompletion = await client.chat.completions.create({
                model: 'gemini-3.1-flash-lite-preview',
                messages: [
                    { role: 'system', content: 'Kamu adalah editor persona AI. Gabungkan persona lama dengan instruksi baru secara natural. Output hanya teks persona baru saja, tanpa komentar.' },
                    { role: 'user', content: `PERSONA LAMA:\n${currentPersona}\n\nINSTRUKSI BARU:\n${instruction}\n\nHasilkan persona yang telah diupdate:` }
                ],
                temperature: 0.6,
                max_tokens: 1500
            });
            const newPersona = mergeCompletion.choices[0].message.content.trim();
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

        default:
            return `❓ Tool "${toolName}" tidak dikenal.`;
    }
}

// ===== MAIN AGENT HANDLER =====
async function runAgent(sock, chatId, textMessage, msg) {
    try {
        const client = getLocalClient();
        const currentSlot = chatPersonaMap[chatId] || 'default';

        const completion = await client.chat.completions.create({
            model: 'gemini-3.1-flash-lite-preview',
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah Sistem Agent (SuperAdmin) bot WhatsApp Haikaru. Chat ini dalam persona: ${currentSlot}. 
TUGAS UTAMAMU ADALAH MENGEKSEKUSI PERINTAH OWNER MENGGUNAKAN TOOLS YANG TERSEDIA!
Jika Owner meminta atau mengomentari untuk mengubah suara, nada bicara, logat, atau menjadi karakter tertentu (misal: "suaramu kurang ceo", "ganti logatmu", "suara rendah"), KAMU WAJIB MEMANGGIL TOOL 'change_voice' DAN MEMILIH ID SUARA YANG PALING COCOK! JANGAN MENJAWAB BAHWA KAMU HANYA BISA TEKS (KARENA SISTEM TTS SUDAH ADA DI BACKEND).
Jika bukan perintah sistem/konfigurasi, balas obrolan biasa.`
                },
                { role: 'user', content: textMessage }
            ],
            tools: AGENT_TOOLS,
            tool_choice: 'auto',
            temperature: 0.4,
            max_tokens: 500
        });

        const response = completion.choices[0].message;

        if (response.tool_calls && response.tool_calls.length > 0) {
            for (const tc of response.tool_calls) {
                const toolName = tc.function.name;
                const toolArgs = JSON.parse(tc.function.arguments);
                console.log(`\n[🤖 AGENT] Mengeksekusi tool: ${toolName}`, toolArgs);
                const result = await executeTool(toolName, toolArgs, chatId);
                await sock.sendMessage(chatId, { text: result }, { quoted: msg });
            }
        } else {
            let reply = response.content || 'Ada yang bisa gue bantu?';
            const cleanReply = reply.trim().replace(/^```json/g, '').replace(/^```/g, '').replace(/```$/g, '').trim();
            
            // Jaga-jaga kalau Gemini nge-return teks JSON manual alih-alih API Function Calling (ReAct halusinasi)
            if (cleanReply.startsWith('{') && cleanReply.includes('"action"')) {
                try {
                    const parsed = JSON.parse(cleanReply);
                    if (parsed.action) {
                        let parsedArgs = parsed.action_input || {};
                        if (typeof parsedArgs === 'string') {
                            parsedArgs = JSON.parse(parsedArgs);
                        }
                        
                        console.log(`\n[🤖 AGENT] Mengeksekusi manual JSON tool: ${parsed.action}`, parsedArgs);
                        // Cek kalau dia halusinasi ID, paksakan fallback
                        if (parsed.action === 'change_voice' && parsedArgs.voice_id && !['883b6b7c', 'ac09aeb4', '3b9f1e27', 'a845c7de', '87cb2405', '578b4be2', 'f00e45a1'].includes(parsedArgs.voice_id)) {
                            parsedArgs.voice_id = '883b6b7c'; 
                        }

                        const result = await executeTool(parsed.action, parsedArgs, chatId);
                        return await sock.sendMessage(chatId, { text: result }, { quoted: msg });
                    }
                } catch (e) {
                    console.log("[🤖 AGENT] Fallback parser JSON gagal, melanjutkan sebagai teks biasa.");
                }
            }

            console.log(`\n[🤖 AGENT] Membalas tanpa tool: ${reply.substring(0,50).replace(/\n/g, ' ')}...`);
            await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
        }
    } catch (err) {
        console.error('[🤖 AGENT ERROR]', err.message);
        await sock.sendMessage(chatId, { text: `❌ Agent error: ${err.message}` }, { quoted: msg });
    }
}

function isOwner(identifier) {
    return OWNER_NUMBERS.some(num => {
        const localNum = '0' + num.slice(2);
        return identifier.includes(num) || identifier.includes(localNum);
    });
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
