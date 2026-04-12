const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

// Set ffmpeg binary dari ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegPath);

const NOIZ_API_KEY = process.env.NOIZ_API_KEY;
const VOICE_CONFIG_FILE = path.join(__dirname, '..', 'config', 'active-voice.txt');

// Default Voice: The Mentor (Kai)
let currentVoiceId = '883b6b7c';

function loadActiveVoice() {
    try {
        if (fs.existsSync(VOICE_CONFIG_FILE)) {
            currentVoiceId = fs.readFileSync(VOICE_CONFIG_FILE, 'utf8').trim();
        }
    } catch {}
}
loadActiveVoice();

function setActiveVoice(voiceId) {
    currentVoiceId = voiceId;
    try {
        fs.writeFileSync(VOICE_CONFIG_FILE, voiceId);
    } catch {}
}

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
 * Generate voice note dari NOIZ AI lalu konversi ke OGG/OPUS
 */
async function generateVoice(text, voiceIdOvr = null) {
    const voiceId = voiceIdOvr || currentVoiceId;

    if (!NOIZ_API_KEY) {
        throw new Error("NOIZ_API_KEY belum di-set di file .env");
    }

    const fd = new FormData();
    fd.append('text', text);
    fd.append('voice_id', voiceId);
    fd.append('output_format', 'mp3');
    fd.append('target_lang', 'en'); // pake english biar support suara asing tp logat indo
    fd.append('speed', '1.0');

    console.log(`[🎤 NOIZ] Generating TTS... (Voice: ${voiceId})`);

    const res = await fetch('https://api.noiz.ai/v1/text-to-speech', {
        method: 'POST',
        headers: {
            'Authorization': NOIZ_API_KEY
        },
        body: fd
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`NOIZ API Error (${res.status}): ${err}`);
    }

    const buf = await res.arrayBuffer();
    const mp3Buffer = Buffer.from(buf);

    // Convert MP3 → OGG/OPUS
    console.log(`[🎤 NOIZ] Converting to OPUS OGG...`);
    const oggBuffer = await convertMp3ToOgg(mp3Buffer);
    return oggBuffer;
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
    setActiveVoice,
    getCurrentVoice: () => currentVoiceId
};
