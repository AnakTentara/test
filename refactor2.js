const fs = require('fs');

let code = fs.readFileSync('handlers/aiChatHandler_step1.js', 'utf8');

// 1. Tambahkan wrapper mapper callGenAI sebelum summarizeHistory
const helper = `
/**
 * Helper Translator Array sebelum masuk ke API rotatur pure native
 */
async function callGenAI(model, rawContext, temperature, maxOutputTokens) {
    let contents = [];
    let sysTexts = [];
    
    for (const msg of rawContext) {
        if (msg.role === 'system') {
            sysTexts.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        } else {
            contents.push(msg);
        }
    }
    
    let config = { temperature, maxOutputTokens };
    if (sysTexts.length > 0) {
        config.systemInstruction = { parts: [{ text: sysTexts.join('\\n\\n') }] };
    }
    
    return await generateContentRotator(model, contents, config);
}

`;
code = code.replace("/**\n * Summarize history Shakaru jika melebihi panjang 50\n */", helper + "/**\n * Summarize history Shakaru jika melebihi panjang 50\n */");

// 2. Ganti blok openaiShakaru yg panjang
// Summarize
code = code.replace(
    /const completion = await openaiShakaru\.chat\.completions\.create\(\{\n\s+model: (.*?),\n\s+messages: \[\{ role: 'user', parts: \[\{ text: promptSummarize \}\] \}\],\n\s+temperature: (.*?),\n\s+max_tokens: (.*?),\n\s+\}\);/,
    "const completionText = await callGenAI($1, [{ role: 'user', parts: [{ text: promptSummarize }] }], $2, $3);"
);
code = code.replace(/historyObj\.summary = completion\.choices\[0\]\.message\.content;/g, "historyObj.summary = completionText;");

// Suggestions, Shakaru, Haikaru (semua yg pakai messages: contextForAI)
code = code.replace(
    /const completion = await openaiShakaru\.chat\.completions\.create\(\{\n\s+model: (.*?),\n\s+messages: contextForAI,\n\s+temperature: (.*?),\n\s+max_tokens: (.*?),\n\s+\}\);/g,
    "const rawAnswer = await callGenAI($1, contextForAI, $2, $3);"
);
code = code.replace(
    /const completion = await localClient\.chat\.completions\.create\(\{\n\s+model: (.*?),\n\s+messages: deepContextForAI,\n\s+temperature: (.*?),\n\s+max_tokens: (.*?),\n\s+\}\);/g,
    "const rawAnswer = await callGenAI($1, deepContextForAI, $2, $3);"
);
code = code.replace(
    /const fallback = await localClient\.chat\.completions\.create\(\{\n\s+model: (.*?),\n\s+messages: fallbackContext,\n\s+temperature: (.*?),\n\s+max_tokens: (.*?),\n\s+\}\);/g,
    "const fbRawAnswer = await callGenAI($1, fallbackContext, $2, $3);"
);
code = code.replace(
    /const completion = await localClient\.chat\.completions\.create\(\{\n\s+model: (.*?),\n\s+messages: simpleContextForAI,\n\s+temperature: (.*?),\n\s+max_tokens: (.*?),\n\s+\}\);/g,
    "const rawAnswer = await callGenAI($1, simpleContextForAI, $2, $3);"
);
code = code.replace(
    /const completion = await localClient\.chat\.completions\.create\(\{\n\s+model: (.*?),\n\s+messages: contextForAI,\n\s+temperature: (.*?),\n\s+max_tokens: (.*?),\n\s+\}\);/g,
    "const rawAnswer = await callGenAI($1, contextForAI, $2, $3);"
);


// 3. Hapus penguraian rawAnswer yg sekarang udah bentuk text lgsung
code = code.replace(/const rawAnswer = completion\.choices\[0\]\.message\.content;/g, "// (rawAnswer langsung returned dari callGenAI)");
code = code.replace(/let suggestionsText = completion\.choices\[0\]\.message\.content;/g, "let suggestionsText = rawAnswer;");
code = code.replace(/const fbAnswer = scrubThoughts\(fallback\.choices\[0\]\.message\.content\);/g, "const fbAnswer = scrubThoughts(fbRawAnswer);");

// 4. Build Vision mapper (image_url -> inlineData)
code = code.replace(
    /type: "image_url",\n\s+image_url: \{ url: `data:\$\{imageObj\.mimeType\};base64,\$\{imageObj\.data\}` \}/g,
    "inlineData: { mimeType: imageObj.mimeType, data: imageObj.data }"
);
code = code.replace(/type: "text", text: (.*?) \}/g, "text: $1 }");
code = code.replace(/content: \[\n\s+\{ text:/g, "parts: [\n                { text:");


fs.writeFileSync('handlers/aiChatHandler.js', code);
console.log("Refactoring part 2 Done!");
