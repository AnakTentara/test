/**
 * Membersihkan respon AI dari blok pemikiran (Chain of Thought / CoT)
 * dan memperbaiki format agar sesuai dengan standar WhatsApp.
 * 
 * STRATEGI: "Biarkan model mikir, kita yang bersihkan."
 * Model Gemma-4 tidak punya pemisah thinking bawaan, jadi scrubber ini
 * harus bisa menangani SEMUA kemungkinan format output.
 */
function scrubThoughts(text) {
    if (!text) return text;
    let cleaned = text;

    // ============================================================
    // LAYER 0: Deteksi Native Gemma 4 Thinking Tokens (RESMI GOOGLE)
    // Format: <|channel>thought ... <channel|> (jawaban di luar token ini)
    // Ref: https://ai.google.dev/gemma/docs/capabilities/thinking
    // ============================================================
    
    const gemmaThinkStart = '<|channel>thought';
    const gemmaThinkEnd = '<channel|>';
    const gemmaThinkIdx = cleaned.indexOf(gemmaThinkStart);
    const gemmaThinkEndIdx = cleaned.lastIndexOf(gemmaThinkEnd);

    if (gemmaThinkIdx !== -1 && gemmaThinkEndIdx !== -1 && gemmaThinkEndIdx > gemmaThinkIdx) {
        // Ambil semua teks SETELAH token <channel|> (itu adalah jawaban final)
        const nativeAnswer = cleaned.substring(gemmaThinkEndIdx + gemmaThinkEnd.length).trim();
        // Bersihkan sisa special tokens Gemma yang mungkin ikut
        const cleanedNative = nativeAnswer.replace(/<\|?\w+\|?>/g, '').replace(/<turn\|>/g, '').trim();
        if (cleanedNative.length > 3) {
            return cleanWhatsAppFormat(cleanedNative);
        }
    } else if (gemmaThinkIdx !== -1 && gemmaThinkEndIdx === -1) {
        // Kasus: ada thinking start tapi terpotong (no end token) — buang semuanya dari start
        const beforeThink = cleaned.substring(0, gemmaThinkIdx).trim();
        if (beforeThink.length > 3) return cleanWhatsAppFormat(beforeThink);
        // Jika thinking start ada di awal dan tidak ada end token, seluruh teks adalah thinking terpotong
        return '';
    }

    // Juga deteksi token <|think|> (Gemma 31B style)
    // Jika ada <|think|> DAN <channel|>, treat <channel|> sebagai separator
    if (/<\|think\|>/i.test(cleaned) && cleaned.includes('<channel|>')) {
        const sepIdx = cleaned.lastIndexOf('<channel|>');
        const answerAfterSep = cleaned.substring(sepIdx + '<channel|>'.length).trim()
            .replace(/<\|?\w+\|?>/g, '').replace(/<turn\|>/g, '').trim();
        if (answerAfterSep.length > 3) return cleanWhatsAppFormat(answerAfterSep);
    }
    cleaned = cleaned.replace(/<\|think\|>/gi, '').trim();

    // ============================================================
    // LAYER 1: Ekstraksi tag eksplisit (paling andal jika ada)
    // ============================================================

    // Pre-processing: Hapus mention tag yang dibungkus backtick (model suka nulis `<thought>` dan `<WhatsAppMessage>` sebagai referensi format)
    cleaned = cleaned.replace(/`<\/?(?:thought|WhatsAppMessage)>`/gi, '[TAG_REF]');

    // 1A: Tag <WhatsAppMessage> (Claude-style yang kita inject)
    const startTag = '<WhatsAppMessage>';
    const endTag = '</WhatsAppMessage>';
    const lastStartIdx = cleaned.lastIndexOf(startTag);
    const lastEndIdx = cleaned.lastIndexOf(endTag);

    if (lastStartIdx !== -1) {
        let extracted = '';
        if (lastEndIdx !== -1 && lastEndIdx > lastStartIdx) {
            extracted = cleaned.substring(lastStartIdx + startTag.length, lastEndIdx).trim();
        } else {
            extracted = cleaned.substring(lastStartIdx + startTag.length).trim();
        }
        extracted = extracted.replace(/<\/WhatsAppMessage>?/gi, '').replace(/```+$/g, '').replace(/`+$/g, '').trim();
        // Validasi: pastikan hasil ekstraksi adalah jawaban nyata, bukan sisa CoT pendek
        if (extracted.length > 10 && !looksLikeThinking(extracted)) {
            return cleanWhatsAppFormat(extracted);
        }
    }

    // 1B: Pemisah "=== FINAL ANSWER ===" 
    const finalAnswerMatch = /^(?:=== FINAL ANSWER ===|FINAL ANSWER:)\s*([\s\S]*?)(?:===|$)/im.exec(cleaned);
    if (finalAnswerMatch && finalAnswerMatch[1].trim() !== '') {
        return cleanWhatsAppFormat(finalAnswerMatch[1].trim());
    }

    // 1C: Hapus blok <thought>...</thought> yang sempurna
    cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '').trim();
    // Juga hapus <thought> yang terbuka tanpa penutup (truncated) — hanya di awal baris
    cleaned = cleaned.replace(/^\s*<thought>[\s\S]*/gim, '').trim();

    // Jika setelah pembersihan tag masih ada isi, cek dulu apakah bersih
    if (cleaned.length > 0 && !looksLikeThinking(cleaned)) {
        return cleanWhatsAppFormat(cleaned);
    }

    // ============================================================
    // LAYER 1.5: "Final Quoted Block" Extraction (GEMMA 4 PATTERN)
    // 
    // Gemma 4 26B sering membungkus jawaban FINAL-nya dalam "..."
    // setelah beberapa draft/revisi/self-correction. Kita ambil 
    // quoted block terakhir yang substantial (>20 chars).
    //
    // Pattern khas:
    //   *   *Draft 1*: blabla
    //   *   *Draft 2*: blabla  
    //   *   "JAWABAN FINAL YANG BENAR ADA DI SINI"
    //   *   Single asterisk? Yes.  ← checklist
    // ============================================================

    const quotedAnswer = extractLastQuotedBlock(cleaned);
    if (quotedAnswer && quotedAnswer.length > 20 && !looksLikeThinking(quotedAnswer)) {
        return cleanWhatsAppFormat(quotedAnswer);
    }

    // ============================================================
    // LAYER 2: Heuristic Bullet-Point CoT Detection
    // Mendeteksi pola "mikir keras" khas Gemma-4:
    //   *   User: ...
    //   *   Message: ...
    //   *   Draft: ...
    // ============================================================

    if (looksLikeThinking(cleaned)) {
        const extracted = extractAnswerFromThinking(cleaned);
        if (extracted && extracted.length > 3) {
            return cleanWhatsAppFormat(extracted);
        }
    }

    return cleanWhatsAppFormat(cleaned);
}

/**
 * Ekstrak quoted block terakhir dari output Gemma 4.
 * Gemma sering membungkus jawaban final dalam "..." di akhir thinking.
 * Mendukung single-line dan multi-line quoted blocks.
 */
function extractLastQuotedBlock(text) {
    const lines = text.split('\n');
    const candidates = [];
    let quoteLines = null;

    for (const line of lines) {
        const trimmed = line.trim();
        // Strip leading bullet prefix: "*   " 
        const content = trimmed.replace(/^\*\s+/, '').trim();

        if (quoteLines === null) {
            // Not inside a quote — check if one starts here
            if (content.startsWith('"')) {
                const inner = content.slice(1);
                // Check if single-line quote (ends with " too)
                const lastQuoteIdx = inner.lastIndexOf('"');
                if (lastQuoteIdx > 0) {
                    // Single-line quoted block
                    candidates.push(inner.slice(0, lastQuoteIdx));
                } else if (inner.length > 0) {
                    // Multi-line quoted block starts
                    quoteLines = [inner];
                }
            }
        } else {
            // Inside a multi-line quoted block
            const stripped = trimmed.replace(/^\*\s+/, '').trim();

            // Check if this line has a closing quote
            if (stripped.endsWith('"')) {
                quoteLines.push(stripped.slice(0, -1));
                candidates.push(quoteLines.join('\n'));
                quoteLines = null;
            } else if (stripped.startsWith('"')) {
                // A new quote started before old one closed — 
                // discard the broken old one, start fresh
                quoteLines = [stripped.slice(1)];
            } else {
                quoteLines.push(stripped);
            }
        }
    }

    // If a multi-line quote was never closed (truncated), still consider it
    if (quoteLines && quoteLines.length > 0) {
        const joined = quoteLines.join('\n').trim();
        if (joined.length > 20) candidates.push(joined);
    }

    // Return the LAST substantial quoted block
    for (let i = candidates.length - 1; i >= 0; i--) {
        const q = candidates[i].trim();
        // Must be substantial and not look like a copied system instruction
        if (q.length > 20 && !q.startsWith('JANGAN') && !q.startsWith('[ATURAN')) {
            return q;
        }
    }

    return null;
}

/**
 * Deteksi apakah sebuah teks kemungkinan besar adalah CoT bocor.
 */
function looksLikeThinking(text) {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return false;

    // Hitung baris yang diawali pola bullet-point thinking
    let thinkingCount = 0;
    for (const line of lines) {
        const t = line.trim();
        if (
            /^\*\s{2,}/.test(t) ||                   // *   bullet (3+ spaces = thinking indent)
            /^\*\s*\*[A-Za-z]/.test(t) ||             // *   *Draft:* / *   *Applying*
            /^\*\s+\(?[A-Z][a-zA-Z\s\/-]*\)?:/.test(t) || // *   User: / *   Message:
            /^\(\w+/.test(t) ||                       // (Self-correction:...)
            /^\*\s+\*?(?:Draft|Option|Attempt|Version)\s*\d/i.test(t) || // *   *Draft 1*: / *   Option 2:
            /^\*\s+(?:Wait|Let me|Hmm|Actually|Okay|OK,)/i.test(t) ||   // *   Wait, ... / *   Let me...
            /^-\s+(Single asterisk|No double|Tags used|Simple mode|Draft|Applying|Constraint|Tone|Output)/i.test(t)
        ) {
            thinkingCount++;
        }
    }

    // Jika >25% baris terlihat seperti thinking DAN minimal 2 baris, anggap CoT
    return thinkingCount >= 2 && (thinkingCount / lines.length) > 0.25;
}

/**
 * Ekstrak jawaban final dari teks yang terdeteksi sebagai CoT bocor.
 * Mencoba berbagai strategi extraksi dari yang paling reliable ke fallback.
 */
function extractAnswerFromThinking(text) {

    // === PRE-CHECK: Coba quoted block extraction dulu ===
    const quotedAnswer = extractLastQuotedBlock(text);
    if (quotedAnswer && quotedAnswer.length > 20) {
        return quotedAnswer;
    }

    // === Strategi A: Cari marker yang menandai jawaban final ===
    const finalMarkers = [
        // Marker paling kuat (label "Final" / "Response" / "Polish" / "Applying")
        '*Final Text Construction:*', 'Final Text Construction:',
        '*Final Polish:*', 'Final Polish:',
        '*Final Version:*', 'Final Version:',
        '*Final Answer:*', 'Final Answer:',
        '*Final:*', 'Final:',
        '*Applying Formatting Rules:*', 'Applying Formatting Rules:',
        '*Applying Bold:*', 'Applying Bold:',
        '*Response:*', 'Response:',
        "*Let's go with:*", "Let's go with:",
    ];

    // Marker lemah (Draft — seringkali ada versi awal DAN versi final, ambil yang terakhir)
    const draftMarkers = [
        '*Draft:*', 'Draft:',
        '*Attempt 2*', '*Attempt 3*',
        '*Haikaru Persona*',
    ];

    // Gabungkan, cari dari yang terkuat dulu
    const allMarkers = [...finalMarkers, ...draftMarkers];

    for (const marker of allMarkers) {
        const idx = text.lastIndexOf(marker);
        if (idx !== -1) {
            let extracted = text.substring(idx + marker.length).trim();

            // Bersihkan: Buang baris-baris yang masih berbau checklist di bawahnya
            const cleanedLines = [];
            let hitCleanContent = false;
            for (const line of extracted.split('\n')) {
                const t = line.trim();

                // Skip baris checklist/verification di akhir
                if (hitCleanContent && isChecklistLine(t)) continue;

                // Skip baris kosong di awal sebelum konten mulai
                if (!hitCleanContent && t.length === 0) continue;

                // Baris pertama yang bukan checklist = mulai konten jawaban
                if (!hitCleanContent && !isChecklistLine(t)) {
                    hitCleanContent = true;
                }

                if (hitCleanContent) {
                    cleanedLines.push(line);
                }
            }

            // Trim trailing checklist lines
            while (cleanedLines.length > 0 && isChecklistLine(cleanedLines[cleanedLines.length - 1].trim())) {
                cleanedLines.pop();
            }

            extracted = cleanedLines.join('\n').trim();

            // Buang prefix asterisk jika seluruh teks dimulai dgn satu bullet
            if (/^\*\s+/.test(extracted) && extracted.split('\n').length <= 2) {
                extracted = extracted.replace(/^\*\s+/, '').trim();
            }

            if (extracted.length > 5) return extracted;
        }
    }

    // === Strategi B: Cari blok teks non-bullet terakhir ===
    const lines = text.split('\n');
    const reversedLines = [...lines].reverse();

    // Dari bawah, cari baris pertama yang bukan bullet/checklist dan bukan kosong
    let resultLines = [];
    let collecting = false;

    for (const line of reversedLines) {
        const t = line.trim();
        if (t.length === 0) {
            if (collecting) resultLines.unshift(line);
            continue;
        }
        // Expanded detection: juga tangkap *   *Bold Label*: pola (draft/option bullets)
        if (isChecklistLine(t) || isThinkingBullet(t)) {
            if (collecting) break; // Sudah selesai mengumpulkan
            continue; // Masih skipping thinking dari bawah
        }
        // Baris normal!
        collecting = true;
        resultLines.unshift(line);
    }

    if (resultLines.length > 0) {
        const result = resultLines.join('\n').trim();
        if (result.length > 5) return result;
    }

    // === Strategi C (Nuclear Fallback): Buang SEMUA baris yang terlihat seperti thinking ===
    const survivingLines = lines.filter(l => {
        const t = l.trim();
        if (t.length === 0) return true;
        if (isThinkingBullet(t)) return false;
        if (isChecklistLine(t)) return false;
        return true;
    });

    return survivingLines.join('\n').trim();
}

/**
 * Deteksi apakah sebuah baris adalah thinking bullet.
 * Menangkap pola-pola:
 *   *   User: ...           (label dengan uppercase)
 *   *   *Draft 1*: ...     (bold label)
 *   *   *Option 2*: ...    (bold label)
 *   *Wait*, let me...       (inline self-correction)
 *   (Self-correction)...    (parenthesized)
 */
function isThinkingBullet(line) {
    const t = line.trim();
    return (
        /^\*\s+\(?[A-Z][a-zA-Z\s\/-]*\)?:/.test(t) ||    // *   User: / *   Message: / *   (Context):
        /^\*\s*\*[A-Za-z]/.test(t) ||                      // *   *Draft:* / *   *Option 1*:
        /^\*\s+(?:Wait|Let me|Hmm|Actually|Okay|OK,)/i.test(t) || // *   Wait, ...
        /^\(\w+/.test(t) ||                                 // (Self-correction)
        /^\*\s+"/.test(t)                                   // *   "quoted text" (draft in bullet)
    );
}

/**
 * Deteksi baris yang merupakan checklist verifikasi model
 * (contoh: "*   Single asterisk for bold? Yes.")
 */
function isChecklistLine(line) {
    const t = line.trim();
    return (
        /^\*?\s*\*?\s*(Single asterisk|No double|No `|Tags used|Simple mode|Output Format|Casual|Direct|Emoji|self-correct|check|Bold|Italic|Tone|Persona|Natural|Is it|No markdown|No preamble|WhatsApp style)/i.test(t) ||
        /\?\s*(Yes|No|Check|Checked)\.?\s*$/i.test(t) ||
        /^\(Self-correction/i.test(t) ||
        /^\*?\s*\*?Is (?:it |the |this )/i.test(t) ||      // *  Is it natural? *  Is the bolding correct?
        /^Okay,?\s+ready\.?$/i.test(t)                      // "Okay, ready." filler
    );
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

// Fitur untuk mengirim pesan panjang berpotong-potong (Smart Splitter untuk Limit WA 1160 chars)
async function sendLongMessage(sock, chatId, text, quotedMsg, editKey = null) {
    const { addAiSentMessage } = require('./dbHandler');
    const maxLength = 1160;

    if (text.length <= maxLength) {
        let sendOpts = { text };
        let extraOpts = {};
        
        if (editKey) sendOpts.edit = editKey;
        else if (quotedMsg) extraOpts.quoted = quotedMsg;

        const sent = await sock.sendMessage(chatId, sendOpts, Object.keys(extraOpts).length > 0 ? extraOpts : undefined);
        if (sent?.key?.id) addAiSentMessage(sent.key.id);
        return [sent];
    }

    const paragraphs = text.split(/\n\n+/);
    const chunks = [];
    let currentChunk = "";

    for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i];
        
        if (currentChunk.length + para.length + 2 <= maxLength) {
            currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + para;
        } else {
            // Jika chunk sudah ada isinya, simpan dulu
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = "";
            }
            
            // Jika SATU paragraf ini saja sudah lebih panjang dari limit
            if (para.length > maxLength) {
                let remainingPara = para;
                while (remainingPara.length > 0) {
                    if (remainingPara.length <= maxLength) {
                        currentChunk = remainingPara;
                        break;
                    }
                    
                    // Coba potong di batas spasi terdekat (max mundur 30%)
                    let splitAt = remainingPara.lastIndexOf(' ', maxLength);
                    if (splitAt === -1 || splitAt < maxLength * 0.7) {
                        splitAt = maxLength; // Paksa potong jika ga ketemu spasi rasional
                    }
                    
                    chunks.push(remainingPara.substring(0, splitAt).trim());
                    remainingPara = remainingPara.substring(splitAt).trim();
                }
            } else {
                currentChunk = para;
            }
        }
    }
    
    // Sisa chunk terakhir
    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    const sents = [];
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isFirst = i === 0;
        
        let sendOpts = { text: chunk };
        let extraOpts = {};

        if (isFirst && editKey) {
            sendOpts.edit = editKey;
        } else if (isFirst && quotedMsg) {
            extraOpts.quoted = quotedMsg;
        }

        const sent = await sock.sendMessage(chatId, sendOpts, Object.keys(extraOpts).length > 0 ? extraOpts : undefined);
        if (sent?.key?.id) addAiSentMessage(sent.key.id);
        sents.push(sent);
        if (i < chunks.length - 1) {
            await new Promise(r => setTimeout(r, 600)); // Delay sblm lanjut ngirim pecahan
        }
    }
    return sents;
}

module.exports = { scrubThoughts, sendLongMessage };
