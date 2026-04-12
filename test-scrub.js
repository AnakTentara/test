/**
 * Test script untuk scrubThoughts
 */
const { scrubThoughts } = require('./handlers/utils');

// Simulasi output Gemma-4 yang bocor thinking-nya
const gemmaOutput = `*   User (Haikal/Owner) is teasing/prompting the AI (Haikaru).
    *   The tone is playful/teasing ("mana ni kok ga dikirim teks nya :v").
    *   The context is a chat log format.
    *   Role: Haikaru (AI Gaul, friendly, humorous, uses emojis, uses *bold* for emphasis, no markdown).

    *   Name: Haikaru.
    *   Creator: Haikal Mabrur (anak MAN 1 Muara Enim, jago JS/Python, pacarnya Acell).
    *   Style: Casual, "lo/gue" or "aku/kamu", uses emojis (Unicode), responds to humor with :v or 😭.
    *   Format: *text* for bold.

    *   Haikal is asking why I haven't sent the text yet (teasingly).
    *   I need to respond in character: playful, a bit defensive but funny, using the :v or 😭 reaction.

    *   *Draft 1:* Wkwkwk sabar dong Kal! Gue lagi mikir nih biar jawabannya keren.
    *   *Draft 2:* Elah, baru bentar udah ditagih aja 😭 Gue lagi nyusun kata-kata puitis biar lo terpesona
    *   *Draft 3 (Refining for Haikaru's vibe):* Wkwkwk santai dong *Bos*! 😭 Gue lagi proses loading nih

    *   *Use *bold* instead of **bold**.*
    *   *Use Unicode emojis.*
    *   *Don't use markdown code blocks.*
    *   *Stay in character.*

    *   "Wkwkwk santai dong *Bos*! 😭 Gue lagi proses loading nih, otak AI gue lagi muter-muter nyari jawaban"

    *   Does it follow the owner's instruction? Yes.
    *   Is the tone right? Yes.
    *   Is the formatting correct? Yes (*text*).

    *Self-Correction during drafting:* The user is the owner. I shouldn't be too formal.

    *Final Version:*
    Wkwkwk santai dong *Bos*! 😭 Gue lagi proses loading nih, otak AI gue lagi muter-muter nyari jawaban yang paling asik buat lo :v Sabar dikit napa! 😂✨`;

console.log('=== INPUT (RAW GEMMA) ===');
console.log(gemmaOutput.substring(0, 200) + '...');
console.log('\\n=== OUTPUT (SCRUBBED) ===');
console.log(scrubThoughts(gemmaOutput));
console.log('\\n=== TEST 2: Output tanpa Final Version marker ===');

const gemmaOutput2 = `*   User: Haikal is asking about something.
    *   Context: Chatting on WhatsApp.
    *   Tone: Casual, fun.

    *   Plan: I'll respond casually.

Eh, apa kabar nih Kal? 🔥 Lama nggak ngobrol, kangen tau nggak gue! :v`;

console.log(scrubThoughts(gemmaOutput2));

console.log('\\n=== TEST 3: Output normal (tanpa thinking) ===');
const normalOutput = "Halo bosku! Aman nih, ada yang bisa dibantu? 😎🔥";
console.log(scrubThoughts(normalOutput));
