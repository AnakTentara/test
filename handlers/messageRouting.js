const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { activeChats, disabledChats, saveSingleShakaruMemory, saveActiveChats, deleteMemory, saveDisabledChats, chatMemories, aiSentMessageIds } = require('./dbHandler');
const { processShakaruChat, processHaikaruChat, forceShakaruContinue } = require('./aiChatHandler');
const { analyzeEmojiReaction, getLocalClient } = require('./geminiRotator');
const { generateVoice, isNaturalVNRequest } = require('./voiceHandler');
const { runAgent, isOwner, incrementReply, incrementVN, getPersonaForChat } = require('./agentHandler');
const { getConfig } = require('./configManager');

let reactionCooldowns = new Map();

async function handleIncomingMessage(sock, msg, isShakaruInstance) {
    // Abaikan jika bukan dari bot utama (bot saran tidak membalas chat)
    if (!isShakaruInstance) return;

    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid?.endsWith('@newsletter')) return;

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

    // === QUOTED IMAGE: Jika user REPLY ke gambar, download gambar yang di-reply ===
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage
                   || msg.message?.imageMessage?.contextInfo?.quotedMessage || null;
    if (!imageObj && quotedMsg?.imageMessage) {
        try {
            const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            imageObj = {
                data: buffer.toString('base64'),
                mimeType: quotedMsg.imageMessage.mimetype || 'image/jpeg'
            };
            console.log(`[🖼️ QUOTED IMAGE] Berhasil download gambar dari pesan yang di-reply.`);
        } catch (e) {
            console.error('[ERROR] Gagal download quoted image:', e.message);
        }
    }

    if (!textMessage && !imageObj) return;

    const textBody = textMessage.trim();
    const isGroup = chatId.endsWith('@g.us');

    // ==== CONTEXT PREFIX ====
    const nowDate = new Date();
    const wibTime = new Date(nowDate.getTime() + (7 * 3600 * 1000)); // Sengaja +7 jam dari UTC epoch
    const HH = String(wibTime.getUTCHours()).padStart(2, '0');
    const MM = String(wibTime.getUTCMinutes()).padStart(2, '0');
    const DD = String(wibTime.getUTCDate()).padStart(2, '0');
    const mo = String(wibTime.getUTCMonth() + 1).padStart(2, '0');
    const YYYY = wibTime.getUTCFullYear();
    const jamTanggal = `${DD}/${mo}/${YYYY} ${HH}.${MM}`;

    // Konversi 628xxx → 0xxx (format lokal Indonesia)
    const toLocal = (num) => num && num.startsWith('62') ? '0' + num.slice(2) : (num || 'N/A');
    const stripSuffix = (jid) => jid ? jid.replace(/@.+$/, '') : null;

    const { resolveNumber } = require('./agentHandler');

    // ===== Baileys v7: remoteJidAlt & participantAlt =====
    // Jika chatId adalah @lid, maka remoteJidAlt = PN (@s.whatsapp.net), dan sebaliknya
    const remoteJidAlt = msg.key.remoteJidAlt || null;
    const participantAlt = msg.key.participantAlt || null;

    let numberPart = 'N/A';
    let lidPart = 'N/A';

    if (chatId.endsWith('@s.whatsapp.net')) {
        // Chat biasa pakai PN — coba cari LID-nya dari alt
        numberPart = toLocal(stripSuffix(chatId));
        if (remoteJidAlt && remoteJidAlt.endsWith('@lid')) lidPart = remoteJidAlt;

    } else if (chatId.endsWith('@lid')) {
        // Chat pakai LID — ambil PN dari remoteJidAlt (Baileys v7)
        lidPart = chatId;
        if (remoteJidAlt && remoteJidAlt.endsWith('@s.whatsapp.net')) {
            numberPart = toLocal(stripSuffix(remoteJidAlt));
        } else {
            // Fallback: manual mapping dari contacts.yml
            const resolved = resolveNumber(chatId);
            if (resolved) numberPart = toLocal(resolved);
        }

    } else if (chatId.endsWith('@g.us')) {
        // Pesan grup — pakai participant
        const p = msg.key.participant || '';
        const pAlt = participantAlt || '';
        if (p.endsWith('@s.whatsapp.net')) {
            numberPart = toLocal(stripSuffix(p));
            if (pAlt.endsWith('@lid')) lidPart = pAlt;
        } else if (p.endsWith('@lid')) {
            lidPart = p;
            if (pAlt.endsWith('@s.whatsapp.net')) {
                numberPart = toLocal(stripSuffix(pAlt));
            } else {
                const resolved = resolveNumber(p);
                if (resolved) numberPart = toLocal(resolved);
            }
        }
    }

    // === DYNAMIC BOT TAG REPLACER ===
    // Membantu AI memahami saat dirinya di-tag (karena format mentah dari WA cuma angka).
    const botRawId = sock?.user?.id || sock?.authState?.creds?.me?.id;
    if (textMessage && botRawId) {
        const botNumber = botRawId.split(':')[0].split('@')[0];
        // Replace regex literal tanpa strict boundary yang kadang fail karena parsing
        const tagRegex = new RegExp(`@${botNumber}`, 'g');
        textMessage = textMessage.replace(tagRegex, '@Haikaru (tagging you)');
    }

    // COMMAND: /disable & /enable (KHUSUS OWNER)
    const cmdDisable = getConfig().commands?.disable || '/disable';
    const cmdEnable = getConfig().commands?.enable || '/enable';
    
    if ((textBody === cmdDisable || textBody === cmdEnable) && isFromMe) {
        if (textBody === cmdDisable) {
            disabledChats.add(chatId);
            await sock.sendMessage(chatId, { text: '🔇 AI-Haikaru telah dimatikan di chat ini.' }, { quoted: msg });
        } else {
            disabledChats.delete(chatId);
            await sock.sendMessage(chatId, { text: '🔊 AI-Haikaru telah dihidupkan kembali di chat ini.' }, { quoted: msg });
        }
        saveDisabledChats(); // Simpan ke disabled-chats.yml
        return;
    }

    // Mencegah log & pembacaan jika grup/chat sedang masuk list Disable
    if (disabledChats.has(chatId) && textBody !== cmdEnable && textBody !== cmdDisable) {
        return; 
    }

    const buildPrefix = (text) =>
        `[${jamTanggal} (GMT+7/Jakarta)] [${pushName}] [Number: ${numberPart} ; Lid: ${lidPart}] : ${text}`;
        
    const prefixMessage = buildPrefix(textMessage);
    
    // Log pesan PERSIS seperti yang dilihat AI
    const apiLogMessage = prefixMessage.length > 200 ? prefixMessage.substring(0, 200) + '...' : prefixMessage;
    console.log(`\n[📩 INBOX API] ${apiLogMessage}`);

    // === FILESYSTEM NAME GENERATOR ===
    // Untuk menghasilkan memory terpisah per-chat
    let groupSubject = '';
    if (isGroup) {
        try {
            const metadata = await sock.groupMetadata(chatId);
            groupSubject = metadata.subject;
        } catch { groupSubject = 'Grup'; }
    }
    const safePushName = pushName.replace(/[^a-zA-Z0-9-]/g, '_');
    const safeGroupName = groupSubject.replace(/[^a-zA-Z0-9-]/g, '_');
    const lidPartSafe = lidPart !== 'N/A' ? lidPart.replace('@lid', '') : '';
    
    // File prefix: haikal-08967... / GroupName-18751...
    const memoryFileName = isGroup 
        ? `${safeGroupName}-${lidPartSafe || numberPart}` 
        : `${safePushName}-${numberPart}`;

    // Fungsi generate intro singkat dari AI untuk command otomatis
    async function getAICommandIntro(commandType) {
        try {
            const client = getLocalClient();
            const persona = getPersonaForChat(chatId);
            const completion = await client.chat.completions.create({
                model: getConfig().models?.haikaru || getConfig().models?.default || 'gemini-3.1-flash-lite-preview',
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

    // COMMAND: /resetmemory (KHUSUS OWNER)
    const cmdReset = getConfig().commands?.reset_memory || '/resetmemory';
    if (textBody === cmdReset && isFromMe) {
        deleteMemory(chatId);
        await sock.sendMessage(chatId, { text: '🔥 [SYSTEM] Sukses membersihkan/membakar memori file untuk kontak ini secara tuntas!' }, { quoted: msg });
        return;
    }
    // COMMAND: /rp
    const cmdRP = getConfig().commands?.roleplay_start || '/rp';
    if (textBody === cmdRP) {
        if (!chatId.includes('182218953596969')) {
            await sock.sendMessage(chatId, { text: '❌ Akses Ilegal! Perintah Mode RP ini khusus hanya untuk Nona Acell.' }, { quoted: msg });
            return;
        }

        activeChats.add(chatId);
        const historyObj = { id: chatId, fileName: memoryFileName, summary: "", messages: [] };
        chatMemories.set(chatId, historyObj);
        saveSingleShakaruMemory(chatId);

        await sock.sendMessage(chatId, { text: '🔴 [SYSTEM] Mode Roleplay Shakaru AKTIF. Silakan mulai berinteraksi.' }, { quoted: msg });
        return;
    }

    // COMMAND: /stop
    const cmdStop = getConfig().commands?.roleplay_stop || '/stop';
    if (textBody === cmdStop) {
        if (activeChats.has(chatId)) {
            activeChats.delete(chatId);
            saveActiveChats();
            await sock.sendMessage(chatId, { text: '⚪ [SYSTEM] Mode Roleplay Shakaru DIMATIKAN. Dialihkan ke Asisten Haikaru.' }, { quoted: msg });
        }
        return;
    }

    // COMMAND: /test /ping
    const pingCommands = getConfig().commands?.ping || ['/test', '/ping', '.ping'];
    if (pingCommands.includes(textBody)) {
        const timeNow = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
        const pingData = `🏓 *Pong!* Server running!
⏰ *Waktu server:* ${timeNow}
✅ Bot Baileys Modular aktif.`;
        const intro = await getAICommandIntro('ping');
        const fullMsg = intro ? `${intro}

${pingData}` : pingData;
        await sock.sendMessage(chatId, { text: fullMsg }, { quoted: msg });
        return;
    }

    // COMMAND: .help / /help
    const helpCommands = getConfig().commands?.help || ['.help', '/help'];
    if (helpCommands.includes(textBody)) {
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
        const intro = await getAICommandIntro('help');
        const fullMsg = intro ? `${intro}

${helpText}` : helpText;
        await sock.sendMessage(chatId, { text: fullMsg }, { quoted: msg });
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

    /* DI-DISABLE SEMENTARA (REQUEST USER)
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
            const audioBuffer = await generateVoice(query);
            
            await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
            console.log(`[🎤 VOICE NOTE] Terkirim (OGG/OPUS)!`);
        } catch (e) {
            console.error('[🎤 VOICE NOTE] TTS Error:', e.message);
            await sock.sendMessage(chatId, { text: '❌ Gagal membuat voice note. Coba lagi.' }, { quoted: msg });
        }
        return;
    }
    */

    // =============== ROUTING LOGIC ===============

    // Jika Chat Aktif Mode RP -> Kirim ke Shakaru
    if (activeChats.has(chatId) && !isFromMe) {
        incrementReply();
        await processShakaruChat(sock, chatId, textMessage, imageObj, msg, memoryFileName);
    } 
    // ROUTING UNTUK BUKAN RP (OWNER & PUBLIK)
    else if (!activeChats.has(chatId) && !isFromMe) {
        
        // Pengecekan Grup: Haikaru/Agent HANYA muncul jika di tag atau di-reply!
        if (isGroup) {
            const botNumber = sock.user.id.split(':')[0].split('@')[0];
            const botJid = botNumber + '@s.whatsapp.net';
            
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo 
                             || msg.message?.imageMessage?.contextInfo || {};
                             
            const isMentionedMeta = contextInfo.mentionedJid?.includes(botJid) || false;
            const isMentionedText = textMessage.includes(`@${botNumber}`);
            
            
            const rawLid = sock.user?.lid || sock.authState?.creds?.me?.lid || '';
            const botLid = rawLid ? rawLid.split(':')[0].split('@')[0] : '';
            const botLidJid = botLid + '@lid';
            const isLidMentionedMeta = contextInfo.mentionedJid?.includes(botLidJid) || false;
            const isLidMentionedText = botLid ? textMessage.includes(`@${botLid}`) : false;
            
            // Reply detection: participant bisa berformat PN atau LID
            const repliedParticipant = contextInfo.participant || '';
            const isReplied = (repliedParticipant === botJid || repliedParticipant === botLidJid) && !!contextInfo.stanzaId;

            // console.log(`[DEBUG GROUP MENTION] botNumber:${botNumber} | botLid:${botLid} | RawMentions:`, contextInfo.mentionedJid);
            // console.log(`  -> MetaPN:${isMentionedMeta} | TextPN:${isMentionedText} | MetaLID:${isLidMentionedMeta} | TextLID:${isLidMentionedText} | Replied:${isReplied} | repliedParticipant:${repliedParticipant}`);

            if (!isMentionedMeta && !isMentionedText && !isLidMentionedMeta && !isLidMentionedText && !isReplied) {
                return; // Abaikan chat grup biasa jika tidak dipanggil
            }
        }

        // 1. Emoji Reaction Logic (Berlaku untuk Publik dan Owner)
        const now = Date.now();
        const lastReact = reactionCooldowns.get(chatId) || 0;
        
        let pastHistory = [];
        if (isOwner(chatId)) {
            const h = haikaruMemories.get(chatId);
            if (h && h.messages) pastHistory = h.messages.slice(-10);
        } else {
            const h = chatMemories.get(chatId);
            if (h && h.messages) pastHistory = h.messages.slice(-10);
        }
        
        if (now - lastReact > 30000 && textMessage) { // Bereaksi hanya kalau ada konteks teks 
            reactionCooldowns.set(chatId, now);
            analyzeEmojiReaction(textMessage, pastHistory).then(async (emoji) => {
                if (emoji && (emoji.length > 0 && emoji.length < 10) && !emoji.includes('{')) { 
                    await sock.sendMessage(chatId, { react: { text: emoji, key: msg.key } });
                }
            }).catch(()=>{});
        }

        /* DI-DISABLE SEMENTARA (REQUEST USER)
        // 2. Cek apakah ini request VN secara natural language
        if (textMessage && isNaturalVNRequest(textMessage)) {
            try {
                await sock.sendPresenceUpdate('recording', chatId);
                console.log(`[🎤 VOICE NOTE] Deteksi NL request VN: "${textMessage.substring(0,30)}"`);
                const { processHaikaruText } = require('./aiChatHandler');
                const shortReply = await processHaikaruText(chatId, textMessage);
                const audioBuffer = await generateVoice(shortReply);
                await sock.sendMessage(chatId, { audio: audioBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true }, { quoted: msg });
                incrementVN();
                incrementReply();
                console.log(`[🎤 VOICE NOTE] NL VN terkirim!`);
                return;
            } catch (e) {
                console.error('[🎤 VOICE NOTE] NL VN gagal:', e.message);
            }
        }
        */

        // 3. Jika bukan VN Request, baru cek apakah ini Owner (Sistem Agent)
        if (isOwner(prefixMessage)) {
            incrementReply();
            await runAgent(sock, chatId, prefixMessage, msg, imageObj);
            return;
        }

        // 4. Jika bukan Owner dan bukan VN, jalankan Haikaru Publik biasa
        incrementReply();
        await processHaikaruChat(sock, chatId, prefixMessage, imageObj, msg, memoryFileName);
    }
}

module.exports = {
    handleIncomingMessage
};
