require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const geminiKeys = [];
for (const envKey of Object.keys(process.env)) {
    if (envKey.startsWith('GEMINI_API_KEY_') && process.env[envKey]) {
        geminiKeys.push({ label: envKey, key: process.env[envKey] });
    }
}

console.log(`[🔑 NATIVE ROTATOR] Loaded ${geminiKeys.length} Gemini API keys dari .env (PURE NATIVE)`);

const genAIclients = geminiKeys.map(k => new GoogleGenAI({ apiKey: k.key }));

let currentKeyIndex = 0;
let deadKeys = new Set(); // Karantina buat key yang mereturn 400 (Invalid/Deleted)

/**
 * Engine Rotator Utama (Pure GoogleGenAI Native)
 */
async function generateContentRotator(modelName, contents, config = {}) {
    if (genAIclients.length === 0) {
        throw new Error("TIDAK ADA GEMINI_API_KEY DI .env!");
    }

    const total = genAIclients.length;
    let attempts = 0;
    let modelToTry = modelName;

    while (attempts < total) {
        const index = currentKeyIndex;
        currentKeyIndex = (currentKeyIndex + 1) % total;

        if (deadKeys.has(index)) {
            attempts++;
            continue;
        }

        const client = genAIclients[index];
        const keyLabel = geminiKeys[index].label;

        try {
            // --- EKSEKUSI PURE NATIVE @google/genai ---
            const resp = await client.models.generateContent({
                model: modelToTry,
                contents: contents,
                config: config
            });

            return resp; // Return FULL OBJECT agar agentHandler bisa baca resp.functionCalls

        } catch (err) {
            const status = err.status || (err.response ? err.response.status : 500);
            
            // Tangkap 400 (Invalid/Deleted Key)
            if (status === 400 || (err.message && err.message.toLowerCase().includes("api key not valid"))) {
                console.log(`[ROTATOR] ☠️ Key ${keyLabel} is DEAD (400 Invalid / Deleted). Dikarantina permanen.`);
                deadKeys.add(index);
                attempts++;
                continue;
            }

            // Kalau kena Rate Limit (429/403) atau error server internal (5xx), lompat ke key lain!
            if (status === 429 || status === 403 || status >= 500) {
                attempts++;
                continue;
            }

            // Error payload/safety issue
            err.statusCode = status;
            throw err;
        }
    }

    // CASCADE FALLBACK BERANTAI
    if (modelName === "gemma-4-31b-it") {
        console.log(`[WARNING] Seluruh key ROTATOR limit untuk model 31B. Fallback tier 1: 31B -> 26B`);
        return generateContentRotator("gemma-4-26b-a4b-it", contents, config);
    }
    if (modelName === "gemma-4-26b-a4b-it") {
        console.log(`[WARNING] Seluruh key ROTATOR limit untuk model 26B. Fallback tier 2: 26B -> gemini-2.5-pro`);
        return generateContentRotator("gemini-2.5-pro", contents, config);
    }
    if (modelName === "gemini-2.5-pro") {
        console.log(`[WARNING] Seluruh key ROTATOR limit untuk model 2.5 Pro. Fallback tier 3: Pro -> Flash Lite`);
        return generateContentRotator("gemini-3.1-flash-lite-preview", contents, config);
    }

    throw new Error(`[FATAL] Semua API Keys exhausted total untuk model ${modelName}`);
}

/**
 * Fitur Reaksi Emoji Otomatis (Pure Native GenAI)
 */
async function analyzeEmojiReaction(textMessage, contextArr = []) {
    try {
        let contents = [];
        const config = {
            systemInstruction: { parts: [{ text: "Kamu adalah AI analis sentimen reaktif. Tugasmu BUKAN membalas obrolan, melainkan memberikan HANYA SATU karakter Emoji Unicode asli (contoh: 😂, 😡, 🥺, ❤️, 🔥). JIKA TIDAK YAKIN atau biasa saja, JANGAN BERIKAN EMOJI APAPUN (kosongkan). HANYA 1 KARAKTER EMOJI atau KOSONG. JANGAN tulis teks huruf." }] },
            temperature: 0.3,
            maxOutputTokens: 5
        };

        if (contextArr && contextArr.length > 0) contents.push(...contextArr);
        contents.push({ role: "user", parts: [{ text: textMessage }] });

        const resp = await generateContentRotator("gemini-3.1-flash-lite-preview", contents, config); 
        return resp.text || null;
    } catch (err) {
        return null; // Silent fail
    }
}

module.exports = {
    generateContentRotator,
    analyzeEmojiReaction
};
