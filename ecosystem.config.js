module.exports = {
    apps: [{
        name: 'haikaru-bot',
        script: 'index.js',
        watch: true,
        ignore_watch: ['data', 'config', '*.log', 'baileys_auth_info', 'baileys_auth_info_saran', 'memory.json']
    }]
};
