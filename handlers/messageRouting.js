const { activeChats, disabledChats, saveMemories, saveDisabledChats, chatMemories } = require('./dbHandler');
const { processShakaruChat, processHaikaruChat, forceShakaruContinue } = require('./aiChatHandler');
const { analyzeEmojiReaction, getLocalClient } = require('./geminiRotator');
const { generateVoice, isNaturalVNRequest } = require('./voiceHandler');
const { runAgent, isOwner, incrementReply, incrementVN, getPersonaForChat } = require('./agentHandler');

let reactionCooldowns = new Map();

async function handleIncomingMessage(sock, msg, isShakaruInstance) {
    // Abaikan jika bukan dari bot utama (bot saran tidak membalas chat)
    if (!isShakaruInstance) return;

    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    const messageType = Object.keys(msg.message)[0];
    const isFromMe = msg.key.fromMe;
    const chatId = msg.key.remoteJid;
    const pushName = msg.pushName || 'Pengguna'; // Nama kontak pengirim

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

    // ==== CONTEXT PREFIX (untuk disuntik ke AI context) ====
    const now = new Date();
    const jamTanggal = now.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit', minute: '2-digit', hour12: false,
        day: '2-digit', month: '2-digit', year: 'numeric'
    }).replace(',', '');

    // Pisahkan Number vs LID dari chatId
    let numberPart = 'N/A';
    let lidPart = 'N/A';
    if (chatId.endsWith('@s.whatsapp.net')) {
        numberPart = chatId.replace('@s.whatsapp.net', '');
    } else if (chatId.endsWith('@lid')) {
        lidPart = chatId;
        if (msg.key.participant) numberPart = msg.key.participant.replace('@s.whatsapp.net', '');
    } else if (chatId.endsWith('@g.us') && msg.key.participant) {
        const p = msg.key.participant;
        if (p.endsWith('@s.whatsapp.net')) numberPart = p.replace('@s.whatsapp.net', '');
        else if (p.endsWith('@lid')) lidPart = p;
    }

    const buildPrefix = (text) =>
        `[${jamTanggal} (GMT+7/Muara Enim/Jakarta)] [${pushName}] [Number: ${numberPart} ; Lid: ${lidPart}] : ${text}`;

    // Fungsi generate intro singkat dari AI untuk command otomatis
    async function getAICommandIntro(commandType) {
        try {
            const client = getLocalClient();
            const persona = getPersonaForChat(chatId);
            const completion = await client.chat.completions.create({
                model: 'gemini-3.1-flash-lite-preview',
                messages: [
                    { role: 'system', content: persona },
                    { role: 'user', content: `[SISTEM] User ${pushName} memanggil command .${commandType}. Berikan SATU kalimat singkat sebagai intro/pembuka yang ceria dan natural sebelum datanya muncul. JANGAN tambah info teknis, cukup kalimat pembuka!` }
                ],
                temperature: 0.9,
                max_tokens: 80
            });
            return completion.choices[0].message.content.trim();
        } catch { return null; }
    }

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
        const pingData = `🏓 *Pong!* Server running!
⏰ *Waktu server:* ${timeNow}
✅ Bot Baileys Modular aktif.`;
        // Step 1: AI intro
        const intro = await getAICommandIntro('ping');
        if (intro) await sock.sendMessage(chatId, { text: intro }, { quoted: msg });
        // Step 2: Data teknis
        await sock.sendMessage(chatId, { text: pingData });
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
        // Step 1: AI intro
        const intro = await getAICommandIntro('help');
        if (intro) await sock.sendMessage(chatId, { text: intro }, { quoted: msg });
        // Step 2: Menu teknis
        await sock.sendMessage(chatId, { text: helpText });
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
        incrementReply();
        await processShakaruChat(sock, chatId, textMessage, imageObj, msg);
    } 
    // Jika Owner chat -> Cek apakah ada perintah Agent
    else if (!activeChats.has(chatId) && isOwner(chatId) && !isFromMe) {
        incrementReply();
        await runAgent(sock, chatId, buildPrefix(textMessage), msg);
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
                const { processHaikaruText } = require('./aiChatHandler');
                const shortReply = await processHaikaruText(chatId, textMessage);
                const audioBuffer = await generateVoice(shortReply, 'id-ID-ArdiNeural');
                await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                incrementVN();
                incrementReply();
                console.log(`[🎤 VOICE NOTE] NL VN terkirim!`);
                return;
            } catch (e) {
                console.error('[🎤 VOICE NOTE] NL VN gagal:', e.message);
            }
        }

        // 3. Kirim pesan ke Haikaru (dengan konteks prefix)
        incrementReply();
        await processHaikaruChat(sock, chatId, buildPrefix(textMessage), imageObj, msg);
    }
}

module.exports = {
    handleIncomingMessage
};
