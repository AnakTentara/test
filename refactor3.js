const fs = require('fs');

let code = fs.readFileSync('handlers/agentHandler.js', 'utf8');

// 1. Ganti import
code = code.replace(
    /const \{ getLocalClient \} = require\('\.\/geminiRotator'\);/g,
    "const { generateContentRotator } = require('./geminiRotator');"
);

code = code.replace(
    /const \{ classifyComplexity, startThinkingAnimation, startNormalAnimation \} = require\('\.\/thinkingRouter'\);/g,
    "const { classifyComplexity, startThinkingAnimation, startNormalAnimation } = require('./thinkingRouter');\nconst { GoogleGenAI } = require('@google/genai');"
);

// 2. Ganti blok update_persona_slot yang call .chat.completions.create
// Di executeTool case 'update_persona_slot':
code = code.replace(
    /const mergeCompletion = await client\.chat\.completions\.create\(\{\n\s+model: getConfig\(\)\.models\?\.agent \|\| 'gemini-3\.1-flash-lite-preview',\n\s+messages: \[\n\s+\{ role: 'system', content: '(.*?)' \},\n\s+\{ role: 'user', content: `(.*?)` \}\n\s+\],\n\s+temperature: (.*?),\n\s+max_tokens: (.*?)\n\s+\}\);/,
    "const mergeCompletionText = await generateContentRotator(getConfig().models?.agent || 'gemini-3.1-flash-lite-preview', [{ role: 'user', parts: [{ text: `$2` }] }], { systemInstruction: { parts: [{ text: '$1' }] }, temperature: $3, maxOutputTokens: $4 });"
);
code = code.replace(
    /const newPersona = mergeCompletion\.choices\[0\]\.message\.content\.trim\(\);/,
    "const newPersona = mergeCompletionText.trim();"
);

// 3. Modifikasi map userMessage di runAgent
code = code.replace(
    /const userMessage = imageObj \? \{\n\s+role: 'user',\n\s+content: \[\n\s+\{ type: 'text', text: textMessage \|\| 'Apa isi gambar ini\?' \},\n\s+\{\n\s+type: 'image_url',\n\s+image_url: \{ url: `data:\$\{imageObj\.mimeType\};base64,\$\{imageObj\.data\}` \}\n\s+\}\n\s+\]\n\s+\} : \{ role: 'user', content: textMessage \};/,
    "const userMessage = imageObj ? {\n            role: 'user',\n            parts: [\n                { text: textMessage || 'Apa isi gambar ini?' },\n                { inlineData: { mimeType: imageObj.mimeType, data: imageObj.data } }\n            ]\n        } : { role: 'user', parts: [{ text: textMessage }] };"
);

// Ganti chatLogContext
code = code.replace(
    /chatLogContext = \{\n\s+role: 'system',\n\s+content: `\[RECENT CHAT LOG(.*?)\n\s+\};\n\s+\}/s,
    "chatLogContext = `[RECENT CHAT LOG$1`;\n        }"
);

// 4. Modifikasi eksekusi aiPromise model thinking di runAgent
code = code.replace(
    /const aiPromise = client\.chat\.completions\.create\(\{([\s\S]*?)\}\);\n\s+const timeoutPromise/g,
    "const genAiTools = [{ functionDeclarations: AGENT_TOOLS.map(t => t.function) }];\n" +
    "                let sysInstruction = `${basePersona}\\n\\n[=== INSTRUKSI KHUSUS UNTUK CHAT INI (KARENA INI OWNER) ===]\\nDi chat private ini, selain menjadi karakter di atas, KAMU JUGA MEMILIKI AKSES KE TOOLS SISTEM (Tugas Utama: Mengganti suara, dll). Walaupun kamu punya alat, tetaplah membalas dengan riang dan santai sesuai karaktermu utamamu!\\n\\nJIKA OWNER MEMINTA/MENGOMENTARI untuk mengubah suara, nada bicara, logat, atau menjadi karakter tertentu (misal: \"suaramu kurang ceo\", \"ganti logatmu\", \"suara rendah\"), KAMU WAJIB MEMANGGIL TOOL 'change_voice' DAN MEMILIH ID SUARA YANG PALING COCOK! JANGAN MENJAWAB BAHWA KAMU HANYA BISA TEKS.\\n\\n${complexInstruct}`;\n" +
    "                if (chatLogContext) sysInstruction += `\\n\\n${chatLogContext}`;\n" +
    "                \n" +
    "                const aiPromise = generateContentRotator(thinkingModel, [\n" +
    "                    userMessage\n" +
    "                ], {\n" +
    "                    systemInstruction: { parts: [{ text: sysInstruction }] },\n" +
    "                    tools: genAiTools,\n" +
    "                    temperature: 0.7,\n" +
    "                    maxOutputTokens: 2000,\n" +
    "                    // tool_choice is omitted for auto\n" +
    "                });\n\n                const timeoutPromise"
);

// Fallback biasa (catch)
code = code.replace(
    /completion = await client\.chat\.completions\.create\(\{([\s\S]*?)max_tokens: 500\n\s+\}\);/g,
    "let fbSysInstruction = `${basePersona}\\n\\n[=== INSTRUKSI KHUSUS UNTUK CHAT INI (KARENA INI OWNER) ===]\\nDi chat private ini, selain menjadi karakter di atas, KAMU JUGA MEMILIKI AKSES KE TOOLS SISTEM (Tugas Utama: Mengganti suara, dll). Walaupun kamu punya alat, tetaplah membalas dengan riang dan santai sesuai karaktermu utamamu!\\n\\nJIKA OWNER MEMINTA/MENGOMENTARI untuk mengubah suara, nada bicara, logat, atau menjadi karakter tertentu (misal: \"suaramu kurang ceo\", \"ganti logatmu\", \"suara rendah\"), KAMU WAJIB MEMANGGIL TOOL 'change_voice' DAN MEMILIH ID SUARA YANG PALING COCOK! JANGAN MENJAWAB BAHWA KAMU HANYA BISA TEKS.\\n\\n[ATURAN OUTPUT - WAJIB DIPATUHI]\\nLANGSUNG BALAS PESAN USER. JANGAN menulis analisis, JANGAN menulis bullet point, JANGAN menulis draft, JANGAN menulis checklist. LANGSUNG TULIS JAWABAN CHAT SAJA seperti kamu sedang mengetik di WhatsApp. Tidak perlu memikirkan format, langsung jawab secara natural.`;\n" +
    "                if (chatLogContext) fbSysInstruction += `\\n\\n${chatLogContext}`;\n" +
    "                const genAiTools2 = [{ functionDeclarations: AGENT_TOOLS.map(t => t.function) }];\n" +
    "                completion = await generateContentRotator(getConfig().models?.agent || 'gemini-3.1-flash-lite-preview', [\n" +
    "                    userMessage\n" +
    "                ], {\n" +
    "                    systemInstruction: { parts: [{ text: fbSysInstruction }] },\n" +
    "                    tools: genAiTools2,\n" +
    "                    temperature: 0.7,\n" +
    "                    maxOutputTokens: 500\n" +
    "                });"
);

// Mode Normal Agent (Simple)
code = code.replace(
    /completion = await client\.chat\.completions\.create\(\{([\s\S]*?)max_tokens: 2000\n\s+\}\);/g,
    "let normSysInstruction = `${basePersona}\\n\\n[=== INSTRUKSI KHUSUS UNTUK CHAT INI (KARENA INI OWNER) ===]\\nDi chat private ini, selain menjadi karakter di atas, KAMU JUGA MEMILIKI AKSES KE TOOLS SISTEM (Tugas Utama: Mengganti suara, dll). Walaupun kamu punya alat, tetaplah membalas dengan riang dan santai sesuai karaktermu utamamu!\\n\\nJIKA OWNER MEMINTA/MENGOMENTARI untuk mengubah suara, nada bicara, logat, atau menjadi karakter tertentu (misal: \"suaramu kurang ceo\", \"ganti logatmu\", \"suara rendah\"), KAMU WAJIB MEMANGGIL TOOL 'change_voice' DAN MEMILIH ID SUARA YANG PALING COCOK! JANGAN MENJAWAB BAHWA KAMU HANYA BISA TEKS.\\n\\n${simpleInstruct}`;\n" +
    "            if (chatLogContext) normSysInstruction += `\\n\\n${chatLogContext}`;\n" +
    "            const genAiTools3 = [{ functionDeclarations: AGENT_TOOLS.map(t => t.function) }];\n" +
    "            completion = await generateContentRotator(getConfig().models?.agent || 'gemini-3.1-flash-lite-preview', [\n" +
    "                userMessage\n" +
    "            ], {\n" +
    "                systemInstruction: { parts: [{ text: normSysInstruction }] },\n" +
    "                tools: genAiTools3,\n" +
    "                temperature: 0.7,\n" +
    "                maxOutputTokens: 2000\n" +
    "            });"
);

// 5. Ubah parsing response (karena generateContentRotator return Teks, tapi kalo ada func call GenAI beda balikan)
// Wait! Kalo pake generateContentRotator, kita return `resp.text` saja! String doang!
// Bagaimana kalau dia tool_call? `resp.text` mungkin kosong, tapi toolCalls ada di `resp.functionCalls`.
// Solusi: Kita ubah geminiRotator.js supaya me-return FULL OBJECT dari `resp` BUKAN HANYA `.text`.

fs.writeFileSync('handlers/agentHandler.js', code);
console.log('Done refactor 3');
