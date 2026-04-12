require('dotenv').config();
const { OpenAI } = require('openai');

// Client utama dengan AI Proxy untuk menghindari 403 pemblokiran Region/IP dari Google
const openaiShakaru = new OpenAI({
    baseURL: process.env.OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY,
});

function getLocalClient() {
    return openaiShakaru;
}

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
    getLocalClient
};
