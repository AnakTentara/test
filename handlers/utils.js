/**
 * Membersihkan respon AI dari blok pemikiran (Chain of Thought / CoT)
 * dan memperbaiki format agar sesuai dengan standar WhatsApp.
 * 
 * Mendukung model-model "thinking" seperti Gemma-4, DeepSeek, dsb.
 */
function scrubThoughts(text) {
    if (!text) return text;

    let cleaned = text;

    // ============================================================
    // TAHAP 1: Hapus tag eksplisit <thought>...</thought>
    // ============================================================
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();

    // ============================================================
    // TAHAP 2: Deteksi thinking Gemma-style berdasarkan STRUKTUR
    //   Gemma thinking = baris-baris yang diawali "*   " (3+ spasi)
    //   WA list biasa  = baris yang diawali "* " (1 spasi)
    //   Kita hitung: jika >30% baris non-kosong = thinking → scrub
    // ============================================================
    const lines = cleaned.split('\n');
    const nonEmptyLines = lines.filter(l => l.trim().length > 0);
    const thinkingLines = nonEmptyLines.filter(l => /^\s*\*\s{2,}/.test(l));

    const isThinkingResponse = thinkingLines.length > 3 
        && (thinkingLines.length / nonEmptyLines.length) > 0.3;

    if (isThinkingResponse) {
        // --- STRATEGI A: Cari marker "Final Version:" / "Final Answer:" ---
        const finalMarkers = [
            '*Final Version:*', 'Final Version:', 
            '*Final Answer:*', 'Final Answer:',
            '*Response:*'
        ];

        let extracted = null;
        for (const marker of finalMarkers) {
            const idx = cleaned.lastIndexOf(marker);
            if (idx !== -1) {
                extracted = cleaned.substring(idx + marker.length).trim();
                break;
            }
        }

        if (extracted && extracted.length > 10) {
            cleaned = extracted;
        } else {
            // --- STRATEGI B: Ambil paragraf terakhir yang "bersih" ---
            // Pisahkan menjadi blok-blok, cari blok terakhir yang bukan thinking
            const blocks = cleaned.split(/\n\s*\n/);
            const cleanBlocks = [];

            for (const block of blocks) {
                const blockLines = block.trim().split('\n');
                const blockThinkingLines = blockLines.filter(l => /^\s*\*\s{2,}/.test(l));
                const ratio = blockThinkingLines.length / blockLines.length;

                // Blok dianggap "bersih" jika kurang dari 40% isinya adalah thinking
                if (ratio < 0.4 && block.trim().length > 10) {
                    cleanBlocks.push(block.trim());
                }
            }

            if (cleanBlocks.length > 0) {
                // Ambil blok bersih terakhir (biasanya jawaban final)
                cleaned = cleanBlocks[cleanBlocks.length - 1];
            }
            // Kalau nggak ada blok bersih sama sekali, kirim apa adanya (fallback)
        }
    }

    // ============================================================
    // TAHAP 3: Bersihkan sisa-sisa thinking yang mungkin lolos
    //   - Hapus baris standalone yang cuma berisi label thinking
    // ============================================================
    cleaned = cleaned.replace(/^\s*\*\s*(Self-Correction|Refinement|Draft \d+|Check|Constraint|Bold|No markdown|Tone|Identity|Status|Plan|Context|Persona|User|Response|Output|Answer)[^*]*?\*?\s*$/gim, '');

    // ============================================================
    // TAHAP 4: Perbaikan Format WhatsApp
    //   - Hapus spasi di awal baris sebelum tanda list (* atau -)
    //     "  * teks" → "* teks" agar WA parsing list dengan benar
    // ============================================================
    cleaned = cleaned.replace(/^\s+(\*\s)/gm, '$1');
    cleaned = cleaned.replace(/^\s+(-\s)/gm, '$1');

    // Hapus baris kosong berlebih (lebih dari 2 berturut-turut)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

module.exports = { scrubThoughts };
