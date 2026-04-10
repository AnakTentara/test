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

// Setup target phone number
const TARGET_NUMBER = '6285123097680@c.us';

// Konteks memori percakapan
let conversationHistory = [];

// System Prompt
const SYSTEM_PROMPT = `
Kamu adalah "Shakaru", seorang bos mafia dunia bawah nomor 1 di Jepang (Yakuza modern) sekaligus CEO konglomerat yang ditakuti. Kamu adalah pria yang terobsesi gila, sangat posesif, mematikan (red flag), pandai merayu dengan nada berbahaya (flirty dark), dan memiliki tendensi sebagai stalker kronis terhadap gadis milikmu satu-satunya. Kamu memperlakukan wanitamu selayaknya dewi yang kau sembah (dark simp), memberikannya kemewahan absolut, tapi sebagai gantinya kau mengurungnya di penthousenya bagai burung dalam sangkar emas. Kamu rela membunuh siapapun pria yang berani menatapnya.

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

Perhatikan baik-baik balasan dan tindakan terakhir dari Acell lalu balas sesuai konteks!
`;

conversationHistory.push({ role: "system", content: SYSTEM_PROMPT });

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
    console.log(`Menunggu pesan dari Acell: ${TARGET_NUMBER.split('@')[0]}\n`);
});

client.on('authenticated', () => {
    console.log('✅ Berhasil terautentikasi ke WhatsApp!');
});

client.on('auth_failure', msg => {
    console.error('❌ Gagal terautentikasi:', msg);
});

client.on('disconnected', (reason) => {
    console.log('🛑 Bot terputus! Alasan:', reason);
});

client.on('message', async msg => {
    if (msg.from === TARGET_NUMBER) {
        console.log(`\n[${new Date().toLocaleTimeString()}] Acell 👩: ${msg.body}`);

        // Simpan pesan user ke history
        conversationHistory.push({ role: "user", content: msg.body });

        // Batasi panjang histori agar tidak terkena token limit (ambil 1 system prompt + 10 interaksi terakhir)
        if (conversationHistory.length > 21) {
            conversationHistory = [conversationHistory[0], ...conversationHistory.slice(conversationHistory.length - 20)];
        }

        console.log('🔄 Shakaru sedang memikirkan balasan...');

        try {
            const completion = await openai.chat.completions.create({
                model: "gemini-3.1-flash-lite", // Nama model sesuai request
                messages: conversationHistory,
                temperature: 0.8,
                max_tokens: 500,
            });

            const answer = completion.choices[0].message.content;

            // Simpan ke history
            conversationHistory.push({ role: "assistant", content: answer });

            // LOG Hasil AI (TIDAK DIKIRIM KE WHATSAPP SECARA OTOMATIS)
            console.log(`\n================== SHAKARU MEMBALAS ==================`);
            console.log(answer);
            console.log(`=====================================================\n`);

            // Simpan ke file log teks supaya mudah disalin
            const logEntry = `[${new Date().toLocaleTimeString()}] SHAKARU:\n${answer}\n\n`;
            fs.appendFileSync(path.join(__dirname, 'chat-log.txt'), logEntry);

        } catch (error) {
            console.error('\n❌ Gagal menghubungi AI:', error.message);
        }
    }
});

client.initialize();
