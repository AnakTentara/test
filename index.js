require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
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

// System Prompt
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

// System prompt akan disuntikkan per-chat saat /rp diaktifkan

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=ImprovedCookieControls,LazyFrameLoading',
            '--disable-extensions',
            '--disable-web-security',
            '--disable-features=AudioServiceOutOfProcess',
            '--memory-pressure-off'
        ],
        defaultViewport: null,
        ignoreHTTPSErrors: true
    }
});

client.on('loading_screen', (percent, message) => {
    console.log(`[LOADING] ${percent}% - ${message}`);
});

client.on('qr', (qr) => {
    console.log('Scan QR Code di bawah ini menggunakan WhatsApp-mu:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🤖 Bot Roleplay Shakaru telah siap dan berjalan!');
    console.log(`Ketik /rp di HP kamu pada chat mana pun untuk mengaktifkan roleplay di chat tersebut!\n`);
});

client.on('authenticated', () => {
    console.log('✅ Berhasil terautentikasi ke WhatsApp!');
});

client.on('auth_failure', message => {
    console.error('❌ Gagal terautentikasi:', message);
});

client.on('disconnected', (reason) => {
    console.log('🛑 Bot terputus! Alasan:', reason);
});

client.on('message_create', async message => {
    // ---- DEBUG LOG SEMUA PESAN ----
    console.log(`\n[DEBUG] Msg dari: ${message.from} | Ke: ${message.to} | fromMe: ${message.fromMe} | Tipe: ${message.type} | Body: "${message.body}"`);
    
    // Abaikan status WhatsApp / broadcast agar bot tidak crash saat mengambil getChat()
    if (message.isStatus || message.id.remote === 'status@broadcast' || message.type === 'protocolMessage') {
        console.log(`[DEBUG] Pesan diabaikan karena tipe tidak didukung.`);
        return;
    }

    let chat;
    try {
        chat = await message.getChat();
    } catch (error) {
        // Abaikan jika pesan berasal dari tipe chat yang tidak didukung (misal WhatsApp Channels)
        return;
    }

    const chatId = chat.id._serialized;

    // Pengecekan aman body text
    const textBody = message.body ? message.body.trim().toLowerCase() : '';

    // Command handling (Bisa dihidupkan/dimatikan baik dari HP bot maupun oleh si pengirim)
    if (textBody === '/rp') {
        activeChats.add(chatId);
        
        // Buat memori dasar
        let historyContext = [{ role: "system", content: SYSTEM_PROMPT }];
        
        try {
            // Ambil 15 chat terakhir sebelum perintah /rp diketik untuk jadi konteks
            const pastMessages = await chat.fetchMessages({ limit: 15 });
            for (const pastMsg of pastMessages) {
                if (pastMsg.body.trim() === '/rp' || pastMsg.body.trim() === '/stop') continue;
                if (pastMsg.isStatus || pastMsg.type !== 'chat') continue;
                
                const role = pastMsg.fromMe ? "assistant" : "user";
                let content = pastMsg.body;
                
                if (role === "user") {
                    const timeStr = new Date(pastMsg.timestamp * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', timeZoneName: 'short' });
                    content = `[INFO WAKTU SAAT INI UNTUKMU: ${timeStr}]\nAcell: ${content}`;
                }
                historyContext.push({ role: role, content: content });
            }
        } catch (err) {
            console.error("Gagal mengambil pesan lama:", err.message);
        }

        // Terapkan memori gabungan
        chatMemories.set(chatId, historyContext);
        
        await message.reply('🔴 [SYSTEM] Mode Roleplay Shakaru DIAKTIFKAN. (Shakaru telah membaca riwayat chat sebelumnya dan siap merespons)');
        console.log(`\n✅ Roleplay diaktifkan di chat: ${chat.name || chatId} (dengan ${historyContext.length - 1} konteks chat masa lalu)`);
        return;
    }
    
    if (textBody === '/stop') {
        if (activeChats.has(chatId)) {
            activeChats.delete(chatId);
            chatMemories.delete(chatId);
            await message.reply('⚪ [SYSTEM] Mode Roleplay Shakaru DIMATIKAN untuk chat ini.');
            console.log(`\n🛑 Roleplay dimatikan di chat: ${chat.name || chatId}`);
        }
        return;
    }

    if (textBody === '/test') {
        const timeNow = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });
        await message.reply(`🏓 Pong! Bot berjalan normal. (Waktu server: ${timeNow})`);
        console.log(`\n🏓 Ping pong command triggered di chat: ${chat.name || chatId}`);
        return;
    }

    // Roleplay handling (jika chat ini aktif, dan pesannya dari orang lain)
    if (activeChats.has(chatId) && !message.fromMe) {
        console.log(`\n[${new Date().toLocaleTimeString()}] Acell (${chat.name}): ${message.body}`);

        // Ambil riwayat chat dari map, atau inisialisasi jika tidak ada
        let conversationHistory = chatMemories.get(chatId) || [{ role: "system", content: SYSTEM_PROMPT }];

        // Inject timestamp (GMT+7 WIB) ke dalam prompt agar Shakaru tahu persis jam berapa Acell chatting
        const currentTimestamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', timeZoneName: 'short' });
        const userPromptWithContext = `[INFO WAKTU SAAT INI UNTUKMU: ${currentTimestamp}]\nAcell: ${message.body}`;

        // Simpan pesan user ke history
        conversationHistory.push({ role: "user", content: userPromptWithContext });

        // Batasi panjang histori agar tidak terkena token limit (ambil 1 system prompt + 20 interaksi terakhir)
        if (conversationHistory.length > 21) {
            conversationHistory = [conversationHistory[0], ...conversationHistory.slice(conversationHistory.length - 20)];
        }

        console.log('🔄 Shakaru sedang memikirkan balasan...');
        await chat.sendStateTyping(); // Munculkan status "Typing..." di WA Acell

        try {
            const completion = await openai.chat.completions.create({
                model: "gemini-3.1-flash-lite-preview", // Nama model sesuai request
                messages: conversationHistory,
                temperature: 0.8,
                max_tokens: 500,
            });

            const answer = completion.choices[0].message.content;

            // Simpan ke history
            conversationHistory.push({ role: "assistant", content: answer });

            // Perbarui memori di map
            chatMemories.set(chatId, conversationHistory);

            // LOG Hasil AI
            console.log(`\n================== SHAKARU MEMBALAS ==================`);
            console.log(answer);
            console.log(`=====================================================\n`);

            // LANGSUNG KIRIM KE WHATSAPP (Acell)
            await message.reply(answer);



        } catch (error) {
            console.error('\n❌ Gagal menghubungi AI:', error.message);
        }
    }
});

client.initialize();
