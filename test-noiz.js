require('dotenv').config();
const fs = require('fs');

const API_KEY = process.env.NOIZ_API_KEY;
const BASE_URL = 'https://api.noiz.ai';

if (!API_KEY) {
    console.log("⚠️ NOIZ_API_KEY belum di-set di file .env!");
    process.exit(1);
}

async function fetchVoices() {
    console.log('Mengambil daftar voices (built-in) dari NOIZ...\n');
    try {
        const res = await fetch(`${BASE_URL}/v1/voices?voice_type=built-in&limit=100`, {
            method: 'GET',
            headers: { 'Authorization': API_KEY }
        });
        const json = await res.json();

        if (json.code === 401) {
            return console.log('❌ API Key salah / tidak valid!');
        }

        const voices = json.data?.voices || [];
        // Tampilkan 10 voice random cowok berbahasa Inggris (EN) karena ID nggak didukung resmi
        const males = voices.filter(v => v.gender === 'male');
        
        console.log('✅ DAFTAR VOICES (Cowo):');
        males.forEach(v => {
            console.log(`- ID: ${v.voice_id} | Nama: ${v.display_name} | Lang: ${v.language} | Desc: ${v.voice_description}`);
        });

        console.log('\n(Hanya menampilkan suara cowok. Karena "ID" belum didukung resmi, pakai languange "en" kadang bisa baca bhs Indo dengan aksen kebule-bulean)');
    } catch (e) {
        console.log('\n❌ Gagal koneksi:', e.message);
    }
}

async function generateTTS(text, voiceId) {
    console.log(`\n🎙️ Membuat TTS...\nTeks: "${text}"\nVoice ID: ${voiceId}`);
    
    try {
        const fd = new FormData();
        fd.append('text', text);
        fd.append('voice_id', voiceId);
        fd.append('output_format', 'mp3');
        fd.append('target_lang', 'en'); 
        fd.append('speed', '1.0');

        const res = await fetch(`${BASE_URL}/v1/text-to-speech`, {
            method: 'POST',
            headers: { 'Authorization': API_KEY },
            body: fd
        });

        if (!res.ok) {
            const err = await res.text();
            return console.log(`❌ Error TTS (${res.status}):`, err);
        }

        const buf = await res.arrayBuffer();
        fs.writeFileSync('noiz-test.mp3', Buffer.from(buf));
        console.log(`✅ File audio berhasil disimpan ke: noiz-test.mp3 (${buf.byteLength} bytes)`);
        console.log('Silakan putar file tersebut di folder ini.');
        
    } catch (e) {
        console.log('\n❌ Gagal TTS:', e.message);
    }
}

// ===== CARA JALANIN =====
const action = process.argv[2];

if (action === 'voices') {
    fetchVoices();
} else if (action === 'tts') {
    const voice = process.argv[3] || '883b6b7c'; // 883b6b7c = The Mentor (Kai)
    const text = process.argv[4] || 'Halo bos, status bot botWaRolePlay aman terkendali ya.';
    generateTTS(text, voice);
} else {
    console.log('Cara pakai:');
    console.log('1. node test-noiz.js voices      --> Lihat daftar ID suara');
    console.log('2. node test-noiz.js tts <VOICE_ID> "teks pesan" --> Buat Audio');
}
