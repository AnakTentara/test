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
    // TAHAP 2: Split berdasarkan marker === FINAL ANSWER ===
    //   Jika ada marker ini, ambil SEMUA teks setelahnya
    // ============================================================
    const finalAnswerMarker = '=== FINAL ANSWER ===';
    const markerIdx = cleaned.lastIndexOf(finalAnswerMarker);
    if (markerIdx !== -1) {
        cleaned = cleaned.substring(markerIdx + finalAnswerMarker.length).trim();
        // Langsung ke tahap formatting, skip deteksi struktur
        return cleanWhatsAppFormat(cleaned);
    }

    // ============================================================
    // TAHAP 3: Deteksi thinking Gemma-style berdasarkan STRUKTUR
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
        // --- STRATEGI A: Cari marker teks final ---
        const textMarkers = [
            '*Final Version:*', 'Final Version:', 
            '*Final Answer:*', 'Final Answer:',
            '*Final Polish:*', 'Final Polish:',
            '*Response:*'
        ];

        let extracted = null;
        for (const marker of textMarkers) {
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
            const blocks = cleaned.split(/\n\s*\n/);
            const cleanBlocks = [];

            for (const block of blocks) {
                const blockLines = block.trim().split('\n');
                const blockThinkingLines = blockLines.filter(l => /^\s*\*\s{2,}/.test(l));
                const ratio = blockThinkingLines.length / blockLines.length;

                if (ratio < 0.4 && block.trim().length > 10) {
                    cleanBlocks.push(block.trim());
                }
            }

            if (cleanBlocks.length > 0) {
                cleaned = cleanBlocks[cleanBlocks.length - 1];
            }
        }
    }

    // ============================================================
    // TAHAP 4: Bersihkan sisa-sisa thinking labels 
    // ============================================================
    cleaned = cleaned.replace(/^\s*\*\s*(Self-Correction|Refinement|Draft \d+|Check|Constraint|Bold|No markdown|Tone|Identity|Status|Plan|Context|Persona|User|Response|Output|Answer|Final Polish|Final Version)[^*]*?\*?\s*$/gim, '');

    return cleanWhatsAppFormat(cleaned);
}

/**
 * Bersihkan format agar sesuai standar WhatsApp.
 */
function cleanWhatsAppFormat(text) {
    let cleaned = text;

    // Hapus tanda kutip pembungkus di awal/akhir jika seluruh teks dibungkus quotes
    cleaned = cleaned.replace(/^["']|["']$/g, '').trim();

    // Hapus spasi di awal baris sebelum tanda list (* atau -)
    cleaned = cleaned.replace(/^\s+(\*\s)/gm, '$1');
    cleaned = cleaned.replace(/^\s+(-\s)/gm, '$1');

    // Hapus baris kosong berlebih
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

module.exports = { scrubThoughts };
