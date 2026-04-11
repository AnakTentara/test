const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// id-ID-ArdiNeural = Cowok berat/tegas (CEO)
// id-ID-GadisNeural = Cewek remaja/halus
const DEFAULT_CEO_VOICE = 'id-ID-ArdiNeural';
const DEFAULT_HAIKARU_VOICE = 'id-ID-ArdiNeural'; 

async function generateVoice(text, voiceType = DEFAULT_CEO_VOICE) {
    return new Promise(async (resolve, reject) => {
        try {
            const tts = new EdgeTTS({
                voice: voiceType,
                lang: 'id-ID',
                pitch: '-10%', // Buat suara lebih deep/berat sedikit untuk Shakaru
                rate: '-5%',   // Agak sedikit pelan supaya lebih mengintimidasi
                volume: '+0%'
            });

            // Gunakan pitch normal jika pakai mode Haikaru
            if (voiceType === DEFAULT_HAIKARU_VOICE && arguments.length === 2 && arguments[1] === DEFAULT_HAIKARU_VOICE) {
                // reset pitch (if needed to differentiate haikaru vs shakaru)
            }

            // Temp file
            const tempFileName = `tts_${crypto.randomBytes(4).toString('hex')}.mp3`;
            const tempFilePath = path.join(__dirname, '..', tempFileName);

            await tts.ttsPromise(text, tempFilePath);

            // Baca hasil file nya jadi buffer
            const buffer = fs.readFileSync(tempFilePath);
            
            // Hapus file sementaranya biar ngga nyampah
            fs.unlinkSync(tempFilePath);

            resolve(buffer);
        } catch (error) {
            console.error('Error Generating Voice:', error);
            reject(error);
        }
    });
}

/**
 * Mendeteksi apakah di dalam chat terdapat format roleplay italic _menggenggam tangannya_
 */
function hasPhysicalAction(text) {
    const actionRegex = /_.*?_|\*.*?\*/g; // Jika ada italic atau bold, anggap ada action / RP kompleks
    return actionRegex.test(text);
}

module.exports = {
    generateVoice,
    hasPhysicalAction
};
