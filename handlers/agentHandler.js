const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { getLocalClient } = require('./geminiRotator');
const { disabledChats, saveDisabledChats, haikaruMemories, saveHaikaruMemories } = require('./dbHandler');

// ===== OWNER CONFIG =====
const OWNER_NUMBERS = [
    '6289675732001', // Owner (Haikal)
    '6285123097680', // Acell
];

const PERSONAS_DIR = path.join(__dirname, '..', 'config', 'personas');
const ACTIVE_CONFIG = path.join(PERSONAS_DIR, 'active.yml');
const DEFAULT_PERSONA = path.join(PERSONAS_DIR, 'default.txt');

// ===== BOT STATS =====
const botStats = {
    startTime: Date.now(),
    totalReplies: 0,
    totalVoiceNotes: 0,
};

function incrementReply() { botStats.totalReplies++; }
function incrementVN() { botStats.totalVoiceNotes++; }

// ===== PERSONA MANAGER =====
function getActiveSlot() {
    try {
        const cfg = yaml.load(fs.readFileSync(ACTIVE_CONFIG, 'utf8'));
        return cfg?.active_slot || 1;
    } catch { return 1; }
}

function getActivePersona() {
    const slot = getActiveSlot();
    const slotFile = path.join(PERSONAS_DIR, `save-${slot}.txt`);
    try {
        return fs.readFileSync(slotFile, 'utf8').trim();
    } catch {
        return fs.readFileSync(DEFAULT_PERSONA, 'utf8').trim();
    }
}

function setActiveSlot(slot) {
    const cfg = { active_slot: parseInt(slot) };
    fs.writeFileSync(ACTIVE_CONFIG, yaml.dump(cfg));
}

function updatePersonaSlot(slot, newContent) {
    const slotFile = path.join(PERSONAS_DIR, `save-${slot}.txt`);
    fs.writeFileSync(slotFile, newContent);
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
            description: "Update atau tambahkan instruksi baru ke dalam persona Haikaru di slot tertentu. AI akan membaca persona lama lalu menambahkan/mengupdate instruksi baru.",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", description: "Nomor slot persona (1, 2, atau 3)", enum: [1, 2, 3] },
                    instruction: { type: "string", description: "Instruksi baru yang ingin ditambahkan atau diubah dalam persona" }
                },
                required: ["slot", "instruction"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "switch_persona_slot",
            description: "Ganti slot persona aktif yang digunakan Haikaru",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", description: "Nomor slot yang ingin diaktifkan (1, 2, atau 3)", enum: [1, 2, 3] }
                },
                required: ["slot"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "reset_persona_slot",
            description: "Reset slot persona ke default awal",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", description: "Nomor slot yang ingin di-reset (1, 2, atau 3)", enum: [1, 2, 3] }
                },
                required: ["slot"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_bot_status",
            description: "Dapatkan status bot saat ini: uptime, total pesan, total VN, info memori",
            parameters: { type: "object", properties: {}, required: [] }
        }
    },
    {
        type: "function",
        function: {
            name: "clear_memory",
            description: "Hapus memori percakapan Haikaru di chat ini atau semua chat",
            parameters: {
                type: "object",
                properties: {
                    target: { type: "string", description: "'this' untuk chat ini saja, 'all' untuk semua chat" }
                },
                required: ["target"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "disable_chat",
            description: "Matikan AI di chat ID tertentu atau chat saat ini",
            parameters: {
                type: "object",
                properties: {
                    chatId: { type: "string", description: "Chat ID yang ingin dimatikan, atau 'this' untuk chat saat ini" }
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
                    chatId: { type: "string", description: "Chat ID yang ingin dihidupkan, atau 'this' untuk chat saat ini" }
                },
                required: ["chatId"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "read_persona_slot",
            description: "Baca isi persona di slot tertentu",
            parameters: {
                type: "object",
                properties: {
                    slot: { type: "number", description: "Nomor slot (1, 2, atau 3)", enum: [1, 2, 3] }
                },
                required: ["slot"]
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
            
            // Minta AI untuk menggabungkan persona lama + instruksi baru
            const client = getLocalClient();
            const mergeCompletion = await client.chat.completions.create({
                model: 'gemini-3.1-flash-lite-preview',
                messages: [
                    { role: 'system', content: 'Kamu adalah editor persona AI. Tugasmu adalah menggabungkan persona lama dengan instruksi baru secara natural dan kohesif. Hasilkan persona baru yang lengkap tanpa menghilangkan identitas aslinya. Output hanya teks persona baru saja, tanpa komentar apapun.' },
                    { role: 'user', content: `PERSONA LAMA:\n${currentPersona}\n\nINSTRUKSI BARU YANG PERLU DITAMBAHKAN/DIUBAH:\n${instruction}\n\nHasilkan persona baru yang telah diupdate:` }
                ],
                temperature: 0.6,
                max_tokens: 1500
            });
            
            const newPersona = mergeCompletion.choices[0].message.content.trim();
            updatePersonaSlot(slot, newPersona);
            return `✅ Persona slot ${slot} berhasil diupdate dengan instruksi baru!`;
        }

        case 'switch_persona_slot': {
            const { slot } = args;
            setActiveSlot(slot);
            return `✅ Persona aktif sekarang menggunakan *Slot ${slot}*.`;
        }

        case 'reset_persona_slot': {
            const { slot } = args;
            resetSlotToDefault(slot);
            return `✅ Persona slot ${slot} telah di-reset ke default.`;
        }

        case 'get_bot_status': {
            const uptimeMs = Date.now() - botStats.startTime;
            const uptimeHrs = Math.floor(uptimeMs / 3600000);
            const uptimeMins = Math.floor((uptimeMs % 3600000) / 60000);
            const uptimeSecs = Math.floor((uptimeMs % 60000) / 1000);

            const activeSlot = getActiveSlot();
            const memoryChatCount = haikaruMemories.size;
            const disabledCount = disabledChats.size;

            return `🤖 *STATUS BOT HAIKARU*\n\n` +
                `⏱️ *Uptime:* ${uptimeHrs}j ${uptimeMins}m ${uptimeSecs}d\n` +
                `💬 *Total Pesan Dibalas:* ${botStats.totalReplies}\n` +
                `🎤 *Total Voice Note Dikirim:* ${botStats.totalVoiceNotes}\n` +
                `🧠 *Chat dalam Memori:* ${memoryChatCount}\n` +
                `🔇 *Chat Dinonaktifkan:* ${disabledCount}\n` +
                `🎭 *Persona Aktif:* Slot ${activeSlot}`;
        }

        case 'clear_memory': {
            const { target } = args;
            if (target === 'all') {
                haikaruMemories.clear();
                saveHaikaruMemories();
                return `🧹 Semua memori Haikaru berhasil dihapus.`;
            } else {
                haikaruMemories.delete(chatId);
                saveHaikaruMemories();
                return `🧹 Memori chat ini berhasil dihapus.`;
            }
        }

        case 'disable_chat': {
            const target = args.chatId === 'this' ? chatId : args.chatId;
            disabledChats.add(target);
            saveDisabledChats();
            return `🔇 AI dimatikan di chat *${target}*.`;
        }

        case 'enable_chat': {
            const target = args.chatId === 'this' ? chatId : args.chatId;
            disabledChats.delete(target);
            saveDisabledChats();
            return `🔊 AI dihidupkan di chat *${target}*.`;
        }

        case 'read_persona_slot': {
            const { slot } = args;
            const content = readPersonaSlot(slot);
            return `📄 *Isi Persona Slot ${slot}:*\n\n${content}`;
        }

        default:
            return `❓ Tool "${toolName}" tidak dikenal.`;
    }
}

// ===== MAIN AGENT HANDLER =====
async function runAgent(sock, chatId, textMessage, msg) {
    try {
        const client = getLocalClient();
        const activePersonaSummary = `(Slot aktif: ${getActiveSlot()})`;

        const completion = await client.chat.completions.create({
            model: 'gemini-3.1-flash-lite-preview',
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah Sistem Agent untuk bot WhatsApp Haikaru ${activePersonaSummary}. Tugasmu mengeksekusi perintah dari Owner bot. Deteksi perintah dari pesan Owner dan panggil tool yang tepat. Jika bukan perintah, balas dengan chat biasa sebagai Haikaru.`
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
            // Eksekusi semua tool yang dipanggil
            for (const tc of response.tool_calls) {
                const toolName = tc.function.name;
                const toolArgs = JSON.parse(tc.function.arguments);
                
                console.log(`\n[🤖 AGENT] Menjalankan tool: ${toolName}`, toolArgs);
                const result = await executeTool(toolName, toolArgs, chatId);
                await sock.sendMessage(chatId, { text: result }, { quoted: msg });
            }
        } else {
            // Bukan perintah agent, balas sebagai Haikaru biasa
            const reply = response.content || 'Hmm, ada yang bisa gue bantu?';
            await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
        }
    } catch (err) {
        console.error('[🤖 AGENT ERROR]', err.message);
        await sock.sendMessage(chatId, { text: `❌ Agent error: ${err.message}` }, { quoted: msg });
    }
}

// ===== OWNER CHECKER =====
function isOwner(chatId) {
    return OWNER_NUMBERS.some(num => chatId.includes(num));
}

module.exports = {
    runAgent,
    isOwner,
    getActivePersona,
    botStats,
    incrementReply,
    incrementVN
};
