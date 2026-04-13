require('dotenv').config();
const { OpenAI } = require('openai');
const { GoogleGenAI } = require('@google/genai');

// Client utama dengan AI Proxy untuk menghindari 403 pemblokiran Region/IP dari Google
const openaiShakaru = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
});

function getLocalClient() {
    return openaiShakaru;
}

// ===== GOOGLE GENAI CLIENT (Direct ke Google, buat native thinking) =====
// Kumpulkan semua GEMINI_API_KEY_* dari .env
const geminiKeys = [];
for (let i = 1; i <= 100; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) geminiKeys.push(key);
    else break;
}
let currentKeyIndex = 0;

/**
 * Ambil Google GenAI client dengan rotasi key.
 * Setiap panggilan akan merotasi ke key berikutnya.
 */
function getGenaiClient() {
    if (geminiKeys.length === 0) return null;
    const key = geminiKeys[currentKeyIndex % geminiKeys.length];
    currentKeyIndex++;
    return new GoogleGenAI({ apiKey: key });
}

/**
 * Ambil API key saat ini (untuk debugging/logging)
 */
function getCurrentKeyName() {
    return `GEMINI_API_KEY_${((currentKeyIndex - 1) % geminiKeys.length) + 1}`;
}

console.log(`[🔑 GENAI] Loaded ${geminiKeys.length} Gemini API keys for native GenAI client`);

/**
 * Fitur Reaksi Emoji Otomatis menggunakan Local API
 */
async function analyzeEmojiReaction(textMessage, contextArr = []) {
    try {
        const client = getLocalClient();
        
        let messagesContext = [
            { role: "system", content: "Kamu adalah AI analis sentimen reaktif. Tugasmu BUKAN membalas obrolan, melainkan memberikan HANYA SATU karakter Emoji Unicode asli (contoh: 😂, 😡, 🥺, ❤️, 🔥) yang paling menggambarkan ekspresi yang tepat untuk membalas pesan terakhir user berdasarkan konteks. JIKA TIDAK YAKIN atau biasa saja, JANGAN BERIKAN EMOJI APAPUN (kosongkan). Ingat: HANYA 1 KARAKTER EMOJI atau KOSONG. JANGAN tulis teks huruf." }
        ];

        // Masukkan history jika ada
        if (contextArr && contextArr.length > 0) {
            messagesContext.push(...contextArr);
        }
        
        messagesContext.push({ role: "user", content: textMessage });

        const completion = await client.chat.completions.create({
            model: "gemini-3.1-flash-lite",
            messages: messagesContext,
            temperature: 0.3,
            max_tokens: 5
        });
        const resp = completion.choices[0].message.content.trim();
        return resp; 
    } catch (err) {
        return null;
    }
}

module.exports = {
    analyzeEmojiReaction,
    openaiShakaru,
    getLocalClient,
    getGenaiClient,
    getCurrentKeyName
};
