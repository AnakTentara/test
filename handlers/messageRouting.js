const { activeChats, saveMemories, chatMemories } = require('./dbHandler');
const { processShakaruChat, processHaikaruChat, forceShakaruContinue } = require('./aiChatHandler');
const { analyzeEmojiReaction } = require('./geminiRotator');

let reactionCooldowns = new Map();

async function handleIncomingMessage(sock, msg, isShakaruInstance) {
    // Abaikan jika bukan dari bot utama (bot saran tidak membalas chat)
    if (!isShakaruInstance) return;

    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    const messageType = Object.keys(msg.message)[0];
    const isFromMe = msg.key.fromMe;
    const chatId = msg.key.remoteJid;

    let textMessage = '';
    if (messageType === 'conversation') {
        textMessage = msg.message.conversation;
    } else if (messageType === 'extendedTextMessage') {
        textMessage = msg.message.extendedTextMessage.text;
    }

    if (!textMessage) return;

    const textBody = textMessage.trim();

    // =============== COMMAND SYSTEM ===============
    // COMMAND: /rp
    if (textBody === '/rp') {
        if (!chatId.includes('182218953596969')) {
            await sock.sendMessage(chatId, { text: '❌ Akses Ilegal! Perintah Mode RP ini khusus hanya untuk Nona Acell.' }, { quoted: msg });
            return;
        }

        activeChats.add(chatId);
        const historyObj = { summary: "", messages: [] };
        chatMemories.set(chatId, historyObj);
        saveMemories();

        await sock.sendMessage(chatId, { text: '🔴 [SYSTEM] Mode Roleplay Shakaru AKTIF. Silakan mulai berinteraksi.' }, { quoted: msg });
        return;
    }

    // COMMAND: /stop
    if (textBody === '/stop') {
        if (activeChats.has(chatId)) {
            activeChats.delete(chatId);
            chatMemories.delete(chatId);
            saveMemories();
            await sock.sendMessage(chatId, { text: '⚪ [SYSTEM] Mode Roleplay Shakaru DIMATIKAN. Dialihkan ke Asisten Haikaru.' }, { quoted: msg });
        }
        return;
    }

    // COMMAND: /test /ping
    if (textBody === '/test' || textBody === '/ping' || textBody === '.ping') {
        const timeNow = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
        await sock.sendMessage(chatId, { text: `🏓 Pong! Bot Baileys Modular berjalan. (Waktu server: ${timeNow})` }, { quoted: msg });
        return;
    }

    // COMMAND: /continue
    if (textBody === '/continue') {
        if (!chatId.includes('182218953596969')) {
            await sock.sendMessage(chatId, { text: '❌ Akses Ilegal.' }, { quoted: msg });
            return;
        }
        if (!activeChats.has(chatId)) {
            await sock.sendMessage(chatId, { text: '❌ Mode Roleplay belum aktif. Ketik /rp untuk memulai.' }, { quoted: msg });
            return;
        }
        await forceShakaruContinue(sock, chatId, msg);
        return;
    }

    // =============== ROUTING LOGIC ===============
    // Jika Chat Aktif Mode RP -> Kirim ke Shakaru
    if (activeChats.has(chatId) && !isFromMe) {
        await processShakaruChat(sock, chatId, textMessage, msg);
    } 
    // Jika Chat TIDAK Mode RP (Publik) -> Kirim ke Haikaru
    else if (!activeChats.has(chatId) && !isFromMe) {
        // 1. Emoji Reaction Logic
        const now = Date.now();
        const lastReact = reactionCooldowns.get(chatId) || 0;
        
        if (now - lastReact > 30000) { 
            reactionCooldowns.set(chatId, now);
            analyzeEmojiReaction(textMessage).then(async (emoji) => {
                if (emoji && (emoji.length > 0 && emoji.length < 10) && !emoji.includes('{')) { 
                    await sock.sendMessage(chatId, { react: { text: emoji, key: msg.key } });
                }
            }).catch(()=>{});
        }

        // 2. Kirim pesan ke Haikaru
        await processHaikaruChat(sock, chatId, textMessage, msg);
    }
}

module.exports = {
    handleIncomingMessage
};
