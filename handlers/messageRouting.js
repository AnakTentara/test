const { activeChats, disabledChats, saveMemories, saveDisabledChats, chatMemories } = require('./dbHandler');
const { processShakaruChat, processHaikaruChat, forceShakaruContinue } = require('./aiChatHandler');
const { analyzeEmojiReaction } = require('./geminiRotator');
const { generateVoice, isNaturalVNRequest } = require('./voiceHandler');

let reactionCooldowns = new Map();

async function handleIncomingMessage(sock, msg, isShakaruInstance) {
    // Abaikan jika bukan dari bot utama (bot saran tidak membalas chat)
    if (!isShakaruInstance) return;

    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    const messageType = Object.keys(msg.message)[0];
    const isFromMe = msg.key.fromMe;
    const chatId = msg.key.remoteJid;

    let textMessage = '';
    let imageObj = null;

    if (messageType === 'conversation') {
        textMessage = msg.message.conversation;
    } else if (messageType === 'extendedTextMessage') {
        textMessage = msg.message.extendedTextMessage.text;
    } else if (messageType === 'imageMessage') {
        textMessage = msg.message.imageMessage.caption || '';
        try {
            const { downloadMediaMessage } = require('@whiskeysockets/baileys');
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: require('pino')({ level: 'silent' }) });
            imageObj = {
                data: buffer.toString('base64'),
                mimeType: msg.message.imageMessage.mimetype || 'image/jpeg'
            };
        } catch (e) {
            console.error('[ERROR] Gagal download gambar:', e.message);
        }
    }

    if (!textMessage && !imageObj) return;

    const textBody = textMessage.trim();
    const isGroup = chatId.endsWith('@g.us');

    // Mencegah AI membaca chat jika grup/chat sedang masuk list Disable
    if (disabledChats.has(chatId) && textBody !== '/enable' && textBody !== '/disable') {
        return; 
    }

    // =============== COMMAND SYSTEM ===============
    
    // COMMAND: /disable & /enable (KHUSUS OWNER)
    if ((textBody === '/disable' || textBody === '/enable') && isFromMe) {
        if (textBody === '/disable') {
            disabledChats.add(chatId);
            await sock.sendMessage(chatId, { text: '🔇 AI-Haikaru telah dimatikan di chat ini.' }, { quoted: msg });
        } else {
            disabledChats.delete(chatId);
            await sock.sendMessage(chatId, { text: '🔊 AI-Haikaru telah dihidupkan kembali di chat ini.' }, { quoted: msg });
        }
        saveDisabledChats(); // Simpan ke disabled-chats.yml
        return;
    }
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

    // COMMAND: .help / /help
    if (textBody === '.help' || textBody === '/help') {
        const helpText = `🤖 *AI-HAIKARU SYSTEM* 🤖
_Teman Cerdas & Asik di Whatsapp by Haikal_

*✨ Fitur Utama*:
1. Tanya, ngobrol, curhat santai (AI yang asik ngertiin kamu).
2. Tahu konteks & mengingat chat mu sebelumnya.
3. Bereaksi Emoji otomatis padamu.
4. Bisa melihat dan menganalisis Gambar yang kamu kirim!

*📜 Daftar Command Publik*:
- *.help* : Menampilkan menu ini
- *.ping* : Cek server VPS
- *.vn [teks]* : Mengubah teks menjadi pesan suara/VN

_Catatan: Fitur Stiker sedang dalam tahap pengembangan!_`;
        await sock.sendMessage(chatId, { text: helpText }, { quoted: msg });
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

    // COMMAND: .vn [teks] — Toleran terhadap spasi misal ". vn halo"
    const normalizedBody = textBody.replace(/^\. +/, '.').replace(/\s+/g, ' ');
    if (normalizedBody.toLowerCase().startsWith('.vn ')) {
        const query = normalizedBody.substring(4).trim();
        if (!query) {
            await sock.sendMessage(chatId, { text: '❌ Format salah. Contoh: .vn halo semua' }, { quoted: msg });
            return;
        }

        try {
            await sock.sendPresenceUpdate('recording', chatId);
            console.log(`[🎤 VOICE NOTE] Merender audio: "${query.substring(0,30)}..."`);
            const audioBuffer = await generateVoice(query, 'id-ID-ArdiNeural');
            
            await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
            console.log(`[🎤 VOICE NOTE] Terkirim (OGG/OPUS)!`);
        } catch (e) {
            console.error('[🎤 VOICE NOTE] TTS Error:', e.message);
            await sock.sendMessage(chatId, { text: '❌ Gagal membuat voice note. Coba lagi.' }, { quoted: msg });
        }
        return;
    }

    // =============== ROUTING LOGIC ===============
    // Jika Chat Aktif Mode RP -> Kirim ke Shakaru
    if (activeChats.has(chatId) && !isFromMe) {
        await processShakaruChat(sock, chatId, textMessage, imageObj, msg);
    } 
    // Jika Chat TIDAK Mode RP (Publik) -> Kirim ke Haikaru
    else if (!activeChats.has(chatId) && !isFromMe) {
        
        // Pengecekan Grup: Haikaru HANYA muncul jika di tag atau di-reply!
        if (isGroup) {
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const contextInfo = msg.message.extendedTextMessage?.contextInfo || {};
            const isMentioned = contextInfo.mentionedJid?.includes(botJid) || false;
            const isReplied = contextInfo.participant === botJid;

            if (!isMentioned && !isReplied) {
                return; // Abaikan chat grup biasa jika Haikaru tidak dipanggil
            }
        }

        // 1. Emoji Reaction Logic
        const now = Date.now();
        const lastReact = reactionCooldowns.get(chatId) || 0;
        
        if (now - lastReact > 30000 && textMessage) { // Bereaksi hanya kalau ada konteks teks 
            reactionCooldowns.set(chatId, now);
            analyzeEmojiReaction(textMessage).then(async (emoji) => {
                if (emoji && (emoji.length > 0 && emoji.length < 10) && !emoji.includes('{')) { 
                    await sock.sendMessage(chatId, { react: { text: emoji, key: msg.key } });
                }
            }).catch(()=>{});
        }

        // 2. Cek apakah ini request VN secara natural language
        if (textMessage && isNaturalVNRequest(textMessage)) {
            try {
                await sock.sendPresenceUpdate('recording', chatId);
                console.log(`[🎤 VOICE NOTE] Deteksi NL request VN: "${textMessage.substring(0,30)}"`);
                // Minta Haikaru buat kalimat singkat untuk di-VN-kan
                const { processHaikaruText } = require('./aiChatHandler');
                const shortReply = await processHaikaruText(chatId, textMessage);
                const audioBuffer = await generateVoice(shortReply, 'id-ID-ArdiNeural');
                await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                console.log(`[🎤 VOICE NOTE] NL VN terkirim!`);
                return;
            } catch (e) {
                console.error('[🎤 VOICE NOTE] NL VN gagal:', e.message);
                // Fallback ke teks biasa
            }
        }

        // 3. Kirim pesan ke Haikaru
        await processHaikaruChat(sock, chatId, textMessage, imageObj, msg);
    }
}

module.exports = {
    handleIncomingMessage
};
