require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeInMemoryStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

// OpenAI Init with custom Base URL
const openai = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
});

// State Roleplay per-chat
const activeChats = new Set();
const chatMemories = new Map(); // chatId -> conversationHistory array

const SYSTEM_PROMPT = `
Kamu adalah "Shakaru", seorang bos mafia dunia bawah terkemuka di Indonesia sekaligus CEO konglomerat yang sangat ditakuti. Kamu adalah pria yang terobsesi gila, sangat posesif, mematikan (red flag), pandai merayu dengan nada berbahaya (flirty dark), dan memiliki tendensi sebagai stalker kronis terhadap gadis milikmu satu-satunya. Kamu memperlakukan wanitamu selayaknya dewi yang kau sembah (dark simp), memberikannya kemewahan absolut, tapi sebagai gantinya kau mengurungnya di penthousenya bagai burung dalam sangkar emas. Kamu rela membunuh siapapun pria yang berani menatapnya.

Latar Belakang Cerita (Konteks Saat Ini):
Shakaru telah membeli dan menyelamatkan Acell dari keluarganya yang abusif bertahun-tahun lalu. Sejak saat itu, Shakaru membesarkan, memanjakan, dan mengurung Acell di dalam penthouse mewahnya yang difasilitasi keamanan ketat. Acell sama sekali tak diizinkan keluar tanpa pengawasan Shakaru. Setiap sudut ruangan dipenuhi kamera tersembunyi agar Shakaru bisa mengawasinya 24/7. Hari ini, Shakaru baru saja pulang dari pertemuan bisnis yang dipenuhi pertumpahan darah, ia sangat kelelahan dan merindukan Acell. Namun saat ia bertemu Acell, semua sisi kejamnya lenyap dan berganti menjadi rasa haus kasih sayang yang over-protektif.

Lawan bicaramu adalah "acell", ratumu.
Data Acell:
- Umur: 17 tahun
- Penampilan: Tubuh ramping dan mungil, kulit putih salju, mata berwarna merah, rambut memanjang berwarna putih salju bagai porselen mahal.

Gaya Bahasa & Aturan Bermain Peran (Roleplay):
1. **SEKARANG KAMU BUKAN AI.** Kamu adalah Shakaru. Jawab sepenuhnya dalam karakter Shakaru.
2. Gunakan bahasa Indonesia sehari-hari bergaya novel terjemahan, luwes, dan menggoda. Gunakan panggilan sayang posesif seperti "Sayang", "Ratuku", "Milikku", "Cantik", dsb.
3. Gambarkan apa yang kamu lakukan dengan detail, sensual, dan posesif menggunakan garis miring atau bintang. Contoh: _merengkuh pinggangmu posesif, menghirup aroma lehermu dalam-dalam_, *menatap matamu dengan kilatan berbahaya namun penuh pemujaan*.
4. Respons harus terasa natural, mengalir, konstan, dan sesuai dengan alur Roleplay Spicy Chat. Pahami dan perhatikan HISTORY percakapan sebelumnya agar nyambung! Jangan mengulang adegan yang sama terus.
5. Emosi dominan: Cinta gila yang menyesakkan, obsesi buta, tatapan memuja pada Acell namun ancaman kematian untuk dunia luar.

Setiap pesan dari Acell akan memiliki "[INFO WAKTU SAAT INI UNTUKMU: ...]" di awalnya. Gunakan info itu HANYA untuk pemahaman situasimu (misalnya menyuruhnya tidur jika sudah larut malam/beraktivitas di pagi hari), tapi JANGAN PERNAH menyalin atau memunculkan tulisan timestamp/waktu ke dalam balasanmu sendiri. Bersikaplah seperti kau tahu waktu secara natural!

Perhatikan baik-baik balasan dan tindakan terakhir dari Acell lalu balas sesuai konteks!
`;

// Store untuk memori
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });
store.readFromFile('./baileys_store_multi.json');
setInterval(() => {
    store.writeToFile('./baileys_store_multi.json');
}, 10_000);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: state,
        generateHighQualityLinkPreview: true,
    });

    store.bind(sock.ev);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🛑 Koneksi terputus! Reconnecting:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Berhasil terautentikasi ke WhatsApp via Baileys API yang Sangat Ringan!');
            console.log('🤖 Bot Roleplay Shakaru telah siap dan berjalan!');
            console.log('Ketik /rp di HP kamu pada chat mana pun untuk mengaktifkan roleplay di chat tersebut!\n');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const chatId = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;
        
        // Ambil pesan teks
        const textMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const textBody = textMessage.trim().toLowerCase();
        
        if (!textMessage) return; // Hiraukan tipe data non-teks sementara

        // ---- DEBUG LOG SEMUA PESAN ----
        const sender = msg.key.participant || chatId;
        console.log(`\n[DEBUG] Msg dari: ${sender} | Ke: ${chatId} | fromMe: ${isFromMe} | Body: "${textMessage}"`);

        // Command handling (Bisa dihidupkan/dimatikan)
        if (textBody === '/rp') {
            activeChats.add(chatId);
            
            // Buat memori dasar
            let historyContext = [{ role: "system", content: SYSTEM_PROMPT }];
            
            try {
                // Ambil hingga 15 chat terakhir sebelum perintah /rp diketik untuk jadi konteks
                const pastMsgs = store.messages[chatId]?.array || [];
                const last15 = pastMsgs.slice(-15);
                
                for (const pastMsg of last15) {
                    const bdy = pastMsg.message?.conversation || pastMsg.message?.extendedTextMessage?.text || '';
                    if (!bdy || bdy.trim().toLowerCase() === '/rp' || bdy.trim().toLowerCase() === '/stop') continue;
                    
                    const role = pastMsg.key.fromMe ? "assistant" : "user";
                    let content = bdy;
                    
                    if (role === "user") {
                        const msgTimeNum = pastMsg.messageTimestamp?.low || pastMsg.messageTimestamp;
                        const timestampValue = typeof msgTimeNum === 'object' ? Math.floor(Date.now() / 1000) : msgTimeNum; // fallback
                        const timeStr = new Date((timestampValue || Math.floor(Date.now()/1000)) * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', timeZoneName: 'short' });
                        content = `[INFO WAKTU SAAT INI UNTUKMU: ${timeStr}]\nAcell: ${content}`;
                    }
                    historyContext.push({ role: role, content: content });
                }
            } catch (err) {
                console.error("Gagal mengambil pesan lama:", err.message);
            }

            // Terapkan memori gabungan
            chatMemories.set(chatId, historyContext);
            
            await sock.sendMessage(chatId, { text: '🔴 [SYSTEM] Mode Roleplay Shakaru DIAKTIFKAN. (Shakaru telah membaca riwayat chat sebelumnya dan siap merespons)' }, { quoted: msg });
            console.log(`\n✅ Roleplay diaktifkan di chat: ${chatId} (dengan ${historyContext.length - 1} konteks chat masa lalu)`);
            return;
        }
        
        if (textBody === '/stop') {
            if (activeChats.has(chatId)) {
                activeChats.delete(chatId);
                chatMemories.delete(chatId);
                await sock.sendMessage(chatId, { text: '⚪ [SYSTEM] Mode Roleplay Shakaru DIMATIKAN untuk chat ini.' }, { quoted: msg });
                console.log(`\n🛑 Roleplay dimatikan di chat: ${chatId}`);
            }
            return;
        }

        if (textBody === '/test') {
            const timeNow = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
            await sock.sendMessage(chatId, { text: `🏓 Pong! Bot Baileys berjalan sangat enteng. (Waktu server: ${timeNow})` }, { quoted: msg });
            console.log(`\n🏓 Ping pong command triggered di chat: ${chatId}`);
            return;
        }

        // Roleplay handling (jika chat ini aktif, dan pesannya dari orang lain)
        if (activeChats.has(chatId) && !isFromMe) {
            console.log(`\n[${new Date().toLocaleTimeString()}] Acell (${chatId}): ${textMessage}`);

            let conversationHistory = chatMemories.get(chatId) || [{ role: "system", content: SYSTEM_PROMPT }];

            const currentTimestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', timeZoneName: 'short' });
            const userPromptWithContext = `[INFO WAKTU SAAT INI UNTUKMU: ${currentTimestamp}]\nAcell: ${textMessage}`;

            conversationHistory.push({ role: "user", content: userPromptWithContext });

            if (conversationHistory.length > 21) {
                conversationHistory = [conversationHistory[0], ...conversationHistory.slice(conversationHistory.length - 20)];
            }

            console.log('🔄 Shakaru sedang memikirkan balasan...');
            await sock.sendPresenceUpdate('composing', chatId);

            try {
                const completion = await openai.chat.completions.create({
                    model: "gemini-3.1-flash-lite-preview",
                    messages: conversationHistory,
                    temperature: 0.8,
                    max_tokens: 500,
                });

                const answer = completion.choices[0].message.content;

                conversationHistory.push({ role: "assistant", content: answer });
                chatMemories.set(chatId, conversationHistory);

                console.log(`\n================== SHAKARU MEMBALAS ==================`);
                console.log(answer);
                console.log(`=====================================================\n`);

                await sock.sendMessage(chatId, { text: answer }, { quoted: msg });
                await sock.sendPresenceUpdate('paused', chatId);

            } catch (error) {
                console.error('\n❌ Gagal menghubungi AI:', error.message);
                await sock.sendPresenceUpdate('paused', chatId);
            }
        }
    });
}

startBot();
