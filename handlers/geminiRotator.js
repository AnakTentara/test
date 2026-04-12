require('dotenv').config();
const { OpenAI } = require('openai');

// Client utama dengan AI Proxy untuk menghindari 403 pemblokiran Region/IP dari Google
const openaiShakaru = new OpenAI({
    baseURL: 'https://ai.aikeigroup.net/v1',
    apiKey: process.env.AIKEI_API_KEY || 'aduhkaboaw91h9i28hoablkdl09190jelnkaknldwa90hoi2',
});

function getLocalClient() {
    return openaiShakaru;
}

/**
 * Fitur Reaksi Emoji Otomatis menggunakan Local API
 */
async function analyzeEmojiReaction(textMessage) {
    try {
        const client = getLocalClient();
        const completion = await client.chat.completions.create({
            model: "gemini-3.1-flash-lite-preview",
            messages: [
                { role: "system", content: "Kamu analis sentimen. Berikan HANYA SATU karakter Emoji Unicode asli (bukan kode text) yang paling menggambarkan sentimen pesan user. Kalau tidak ada emoji yang cocok biarkan kosong. Ingat HANYA 1 EMOJI." },
                { role: "user", content: textMessage }
            ],
            temperature: 0.5,
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
