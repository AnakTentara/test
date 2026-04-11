const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set ffmpeg binary dari ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath);

// Suara tersedia:
// id-ID-ArdiNeural = Cowok berat/tegas (CEO/Mafia)
// id-ID-GadisNeural = TIDAK ADA (ini bukan nama resmi Edge TTS)
// Suara wanita resmi: id-ID-ArdiNeural (pria), gunakan en-US-AnaNeural untuk cewek
const SHAKARU_VOICE = 'id-ID-ArdiNeural';

/**
 * Convert MP3 buffer ke OGG/OPUS buffer untuk WhatsApp PTT
 */
function convertMp3ToOgg(mp3Buffer) {
    return new Promise((resolve, reject) => {
        const tempMp3 = path.join(__dirname, '..', `tmp_${crypto.randomBytes(4).toString('hex')}.mp3`);
        const tempOgg = path.join(__dirname, '..', `tmp_${crypto.randomBytes(4).toString('hex')}.ogg`);

        fs.writeFileSync(tempMp3, mp3Buffer);

        ffmpeg(tempMp3)
            .audioCodec('libopus')
            .audioChannels(1)
            .audioFrequency(48000)
            .format('ogg')
            .on('end', () => {
                const oggBuffer = fs.readFileSync(tempOgg);
                // Cleanup temp files
                try { fs.unlinkSync(tempMp3); } catch {}
                try { fs.unlinkSync(tempOgg); } catch {}
                resolve(oggBuffer);
            })
            .on('error', (err) => {
                try { fs.unlinkSync(tempMp3); } catch {}
                try { fs.unlinkSync(tempOgg); } catch {}
                reject(err);
            })
            .save(tempOgg);
    });
}

/**
 * Generate voice note sebagai OGG/OPUS buffer (siap kirim ke WA)
 */
async function generateVoice(text, voice = SHAKARU_VOICE) {
    const tts = new EdgeTTS({
        voice: voice,
        lang: 'id-ID',
        pitch: voice === SHAKARU_VOICE ? '-5Hz' : 'default',
        rate: voice === SHAKARU_VOICE ? '-5%' : 'default',
    });

    const tempMp3Path = path.join(__dirname, '..', `tts_${crypto.randomBytes(4).toString('hex')}.mp3`);

    try {
        // Step 1: Generate MP3 dari Edge TTS
        await tts.ttsPromise(text, tempMp3Path);
        const mp3Buffer = fs.readFileSync(tempMp3Path);
        try { fs.unlinkSync(tempMp3Path); } catch {}

        // Step 2: Convert MP3 → OGG/OPUS
        const oggBuffer = await convertMp3ToOgg(mp3Buffer);
        return oggBuffer;
    } catch (error) {
        try { fs.unlinkSync(tempMp3Path); } catch {}
        throw error;
    }
}

/**
 * Mendeteksi apakah pesan mengandung aksi fisik RP (italic/bold)
 */
function hasPhysicalAction(text) {
    return /_.*?_|\*.*?\*/gs.test(text);
}

/**
 * Deteksi apakah pesan adalah permintaan VN secara natural language
 * Contoh: "kirim vn dong", "bisa vn nggak", "voice note dulu"
 */
function isNaturalVNRequest(text) {
    const lower = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const patterns = [
        /\bvn\b/, /voice\s*note/, /kirim\s*suara/, /suara\s*dong/, /vn\s*dong/,
        /bisa\s*vn/, /pake\s*vn/, /audio\s*dong/, /ngomong\s*langsung/
    ];
    return patterns.some(p => p.test(lower));
}

module.exports = {
    generateVoice,
    hasPhysicalAction,
    isNaturalVNRequest,
    SHAKARU_VOICE
};
