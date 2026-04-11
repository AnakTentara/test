require('dotenv').config();
const { OpenAI } = require('openai');

const geminiApiKeys = Array.from({length: 10}, (_, i) => process.env[`GEMINI_API_KEY_${i+1}`]).filter(Boolean);
let currentGeminiKeyIndex = 0;

function getNextGeminiKey() {
    if (geminiApiKeys.length === 0) return null;
    const key = geminiApiKeys[currentGeminiKeyIndex];
    currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % geminiApiKeys.length;
    return key;
}

/**
 * Fitur Reaksi Emoji Otomatis menggunakan Local API Rotator
 */
async function analyzeEmojiReaction(textMessage) {
    const apiKey = getNextGeminiKey();
    if (!apiKey) return null;

    const localOpenai = new OpenAI({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: apiKey
    });

    try {
        const completion = await localOpenai.chat.completions.create({
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

// Client utama untuk Shakaru
const openaiShakaru = new OpenAI({
    baseURL: 'https://ai.aikeigroup.net/v1',
    apiKey: 'aduhkaboaw91h9i28hoablkdl09190jelnkaknldwa90hoi2', // Token khusus Main
});

function getLocalClient() {
    const apiKey = getNextGeminiKey();
    if (!apiKey) return openaiShakaru; // Fallback kalau .env kosong

    return new OpenAI({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: apiKey
    });
}

module.exports = {
    getNextGeminiKey,
    analyzeEmojiReaction,
    openaiShakaru,
    getLocalClient
};
