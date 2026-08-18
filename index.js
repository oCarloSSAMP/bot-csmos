const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder 
} = require('discord.js');
const { Rcon } = require('rcon-client');
const { QuickDB } = require('quick.db');
const db = new QuickDB();
const config = require('./config.json');

// 🖼️ GIFs do Bot
const URL_GIF_ANUNCIO = 'https://i.imgur.com/JPErhA4.gif';
const URL_GIF_MIX = 'https://i.imgur.com/7Vv0uXG.gif';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ],
    allowedMentions: { parse: ['roles', 'users', 'everyone'] }
});

// Lista dos 10 mapas disponíveis com seus respectivos links de download
const POOL_MAPAS = [
    { id: 'de_dust2_csgo_new_v2', nome: 'Dust2', download: 'https://www.mediafire.com/file/yek5axz4dk64azm/MAPA_DUST2.zip/file' },
    { id: 'de_mirage_cs2', nome: 'Mirage', download: 'https://www.mediafire.com/file/qwgwlwrd9cs193d/MAPA+MIRAGE.zip/file' },
    { id: 'de_inferno_csgo_cssold_fix', nome: 'Inferno', download: 'https://www.mediafire.com/file/ksjjrwprcriog6n/MAPA+INFERNO.zip/file' },
    { id: 'de_cache_fps', nome: 'Cache', download: 'https://www.mediafire.com/file/pse7q8hcbcpynyx/MAPA+CACHE.zip/file' },
    { id: 'de_nukenew_csgo', nome: 'Nuke', download: 'https://www.mediafire.com/file/qbb5r99lqj1agdm/MAPA+NUKE.zip/file' },
    { id: 'de_vertigo_csgo_v34_fix', nome: 'Vertigo', download: 'https://www.mediafire.com/file/ovzal4f70ottbt7/MAPA+VERTIGO.zip/file' },
    { id: 'de_overpass_cs2', nome: 'Overpass', download: 'https://www.mediafire.com/file/88dmm4sm5dacypz/MAPA+OVERPASS.zip/file' },
    { id: 'de_train_csgo', nome: 'Train', download: 'https://www.mediafire.com/file/gsbswz6z3zx9t7m/MAPA+TRAIN.zip/file' },
    { id: 'de_ancient_css', nome: 'Ancient', download: 'https://www.mediafire.com/file/bey9ug7yuyt8k81/MAPA+ANCIENT.zip/file' },
    { id: 'Anubis_cs2mix', nome: 'Anubis', download: 'https://www.mediafire.com/file/bglr6dgt3c5nw13/MAPA+ANUBIS.zip/file' }
];

// Gerenciadores de estado para manter mensagens no rodapé
const vetosAtivos = new Map();
const paineisAtivos = new Map();

// Registrando Comandos Slash (/)
const commands = [
    new SlashCommandBuilder()
        .setName('config-rcon')
        .setDescription('Configura o IP, Porta, Senha RCON e Cargos do Bot')
        .addStringOption(opt => opt.setName('ip').setDescription('IP do Servidor CS').setRequired(true))
        .addStringOption(opt => opt.setName('porta').setDescription('Porta RCON (Ex: 27015)').setRequired(true))
        .addStringOption(opt => opt.setName('senha').setDescription('Senha RCON privada').setRequired(true))
        .addRoleOption(opt => opt.setName('cargo_staff').setDescription('Cargo com permissão de admin/staff').setRequired(true))
        .addRoleOption(opt => opt.setName('cargo_mencao').setDescription('Cargo a ser mencionado ao trocar o mapa').setRequired(true)),

    new SlashCommandBuilder()
        .setName('vetarmapa')
        .setDescription('Inicia o veto de mapas entre 2 capitães')
        .addUserOption(opt => opt.setName('capitao1').setDescription('Primeiro Capitão').setRequired(true))
        .addUserOption(opt => opt.setName('capitao2').setDescription('Segundo Capitão').setRequired(true))
];

const rest = new REST({ version: '10' }).setToken(config.token);

client.once('ready', async () => {
    console.log(`✅ Bot CSMOS online como ${client.user.tag}`);
    try {
        for (const guild of client.guilds.cache.values()) {
            await rest.put(
                Routes.applicationGuildCommands(config.clientId, guild.id),
                { body: commands }
            );
            agendarProximaChecagemInatividade(guild);
        }
        console.log('✅ Comandos / atualizados instantaneamente no servidor!');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
});

// Execução de comandos via RCON
async function executarRCON(guildId, comando) {
    const serverConfig = await db.get(`rcon_${guildId}`);
    if (!serverConfig) {
        throw new Error('Servidor RCON não configurado. Use /config-rcon primeiro.');
    }

    const rcon = new Rcon({
        host: serverConfig.ip,
        port: parseInt(serverConfig.porta),
        password: serverConfig.senha,
        timeout: 3000
    });

    await rcon.connect();
    const resposta = await rcon.send(comando);
    await rcon.end();
    return resposta;
}

// AUTO-RODAPÉ: Monitora conversas no chat para mover APENAS os painéis de veto e RCON para o final
client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const channelId = message.channel.id;

    // 1. Mover Painel de VETO ativo
    for (const [sessaoId, sessao] of vetosAtivos.entries()) {
        if (sessao.channelId === channelId && !sessao.processando) {
            sessao.processando = true;
            try {
                if (sessao.lastMessageId) {
                    const msgAntiga = await message.channel.messages.fetch(sessao.lastMessageId).catch(() => null);
                    if (msgAntiga) {
                        await msgAntiga.delete().catch(() => {});
                    }
                }
                const novaMsg = await message.channel.send({
                    embeds: [sessao.latestEmbed],
                    components: sessao.latestComponents
                });
                sessao.lastMessageId = novaMsg.id;
            } catch (err) {
                console.error('❌ Erro ao mover veto para o rodapé:', err.message);
            } finally {
                sessao.processando = false;
            }
            return;
        }
    }

    // 2. Mover Painel RCON (Anúncio do Mapa em Embed) ativo
    const painel = paineisAtivos.get(channelId);
    if (painel && !painel.processando) {
        painel.processando = true;
        try {
            if (painel.lastMessageId) {
                const msgAntiga = await message.channel.messages.fetch(painel.lastMessageId).catch(() => null);
                if (msgAntiga) {
                    await msgAntiga.delete().catch(() => {});
                }
            }
            const novaMsg = await message.channel.send({
                content: painel.content,
                embeds: painel.embeds,
                components: painel.components
            });
            painel.lastMessageId = novaMsg.id;
        } catch (err) {
            console.error('❌ Erro ao mover painel RCON para o rodapé:', err.message);
        } finally {
            painel.processando = false;
        }
    }
});

// Interação dos Comandos Slash (/)
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guildId, channelId } = interaction;

    // Comando /config-rcon
    if (commandName === 'config-rcon') {
        const ip = interaction.options.getString('ip');
        const porta = interaction.options.getString('porta');
        const senha = interaction.options.getString('senha');
        const cargoStaff = interaction.options.getRole('cargo_staff');
        const cargoMencao = interaction.options.getRole('cargo_mencao');

        await db.set(`rcon_${guildId}`, { 
            ip, 
            porta, 
            senha, 
            cargoId: cargoStaff.id,
            cargoMencaoId: cargoMencao.id 
        });

        await interaction.reply({
            content: `✅ Servidor RCON e Cargos configurados com sucesso!\n**IP:** \`${ip}:${porta}\` | **Staff Autorizado:** ${cargoStaff} | **Cargo Mencionado:** ${cargoMencao}`,
            ephemeral: true
        });
    }

    // Comando /vetarmapa
    if (commandName === 'vetarmapa') {
        const cap1 = interaction.options.getUser('capitao1');
        const cap2 = interaction.options.getUser('capitao2');

        paineisAtivos.delete(channelId);

        const numeroVeto = ((await db.get(`veto_count_${guildId}`)) || 0) + 1;
        await db.set(`veto_count_${guildId}`, numeroVeto);

        const sessaoId = Date.now().toString();
        
        const embed = new EmbedBuilder()
            .setTitle(`🚫 Veto de Mapas CSMOS #${numeroVeto}`)
            .setColor('#38bdf8')
            .setDescription(`**Capitão 1:** ${cap1}\n**Capitão 2:** ${cap2}\n\n# Vez de ${cap1} banir 2 mapas!`);

        const rows = criarBotoesMapas(POOL_MAPAS, sessaoId, 'ban', ButtonStyle.Danger, 'Banir ');

        const respostaMsg = await interaction.reply({ embeds: [embed], components: rows, fetchReply: true });

        vetosAtivos.set(sessaoId, {
            numeroVeto: numeroVeto,
            channelId: channelId,
            lastMessageId: respostaMsg.id,
            latestEmbed: embed,
            latestComponents: rows,
            cap1Id: cap1.id,
            cap2Id: cap2.id,
            vezDoCap: cap1.id,
            bansNoTurnoAtual: 0,
            mapasRestantes: [...POOL_MAPAS]
        });
    }
});

// Helper para gerar linhas de botões
function criarBotoesMapas(mapasDisponiveis, sessaoId, acao, estilo, prefixoRotulo = '') {
    const rows = [];
    let rowAtual = new ActionRowBuilder();

    mapasDisponiveis.forEach((mapa, index) => {
        if (index > 0 && index % 5 === 0) {
            rows.push(rowAtual);
            rowAtual = new ActionRowBuilder();
        }

        rowAtual.addComponents(
            new ButtonBuilder()
                .setCustomId(`${acao}:${sessaoId}:${mapa.id}`)
                .setLabel(`${prefixoRotulo}${mapa.nome}`)
                .setStyle(estilo)
        );
    });

    if (rowAtual.components.length > 0) rows.push(rowAtual);

    const rowCancelar = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cancel_veto:${sessaoId}`)
            .setLabel('🛑 Cancelar Veto')
            .setStyle(ButtonStyle.Secondary)
    );
    rows.push(rowCancelar);

    return rows;
}

// Gerenciador de cliques nos Botões
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    // BOTÃO: CANCELAR VETO
    if (customId.startsWith('cancel_veto:')) {
        const [, sessaoId] = customId.split(':');
        const sessao = vetosAtivos.get(sessaoId);

        if (!sessao) {
            return interaction.reply({ content: '❌ Esta sessão de veto já foi finalizada ou expirou.', ephemeral: true });
        }

        const serverConfig = await db.get(`rcon_${interaction.guildId}`);
        let autorizacaoOK = false;

        if (serverConfig && serverConfig.cargoId) {
            autorizacaoOK = interaction.member.roles.cache.has(serverConfig.cargoId);
        } else {
            autorizacaoOK = interaction.member.permissions.has('Administrator');
        }

        if (!autorizacaoOK) {
            return interaction.reply({ content: '🚫 Apenas membros do cargo Staff autorizado podem cancelar o veto!', ephemeral: true });
        }

        vetosAtivos.delete(sessaoId);

        const embedCancelado = new EmbedBuilder()
            .setTitle(`🛑 Veto de Mapas CSMOS #${sessao.numeroVeto} - CANCELADO`)
            .setColor('#ef4444')
            .setDescription(`**Capitão 1:** <@${sessao.cap1Id}>\n**Capitão 2:** <@${sessao.cap2Id}>\n\n❌ **Veto cancelado por ${interaction.user}!**`);

        await interaction.update({ embeds: [embedCancelado], components: [] });
        return;
    }

    // FASE 1: BANIMENTO DE MAPAS
    if (customId.startsWith('ban:')) {
        const parts = customId.split(':');
        const sessaoId = parts[1];
        const mapaId = parts.slice(2).join(':');

        const sessao = vetosAtivos.get(sessaoId);

        if (!sessao) {
            return interaction.reply({ content: '❌ Esta sessão de veto expirou.', ephemeral: true });
        }

        if (interaction.user.id !== sessao.vezDoCap) {
            return interaction.reply({ content: '⚠️ Aguarde a sua vez de banir!', ephemeral: true });
        }

        const mapaBani = sessao.mapasRestantes.find(m => m.id === mapaId);
        sessao.mapasRestantes = sessao.mapasRestantes.filter(m => m.id !== mapaId);
        sessao.bansNoTurnoAtual++;

        if (sessao.bansNoTurnoAtual >= 2) {
            sessao.bansNoTurnoAtual = 0;
            sessao.vezDoCap = sessao.vezDoCap === sessao.cap1Id ? sessao.cap2Id : sessao.cap1Id;
        }

        const capAtual = `<@${sessao.vezDoCap}>`;

        if (sessao.mapasRestantes.length === 2) {
            const embedEscolha = new EmbedBuilder()
                .setTitle(`🎯 ESCOLHA FINAL DO MAPA #${sessao.numeroVeto}`)
                .setColor('#34d399')
                .setDescription(`**Capitão 1:** <@${sessao.cap1Id}>\n**Capitão 2:** <@${sessao.cap2Id}>\n\n🚫 **Último mapa banido:** ${mapaBani ? mapaBani.nome : 'N/A'}\n\n# ${capAtual}, clique no mapa que deseja JOGAR!`);

            const rowsPick = criarBotoesMapas(sessao.mapasRestantes, sessaoId, 'pick', ButtonStyle.Success, '✅ JOGAR ');

            sessao.latestEmbed = embedEscolha;
            sessao.latestComponents = rowsPick;

            await interaction.update({ embeds: [embedEscolha], components: rowsPick });
            return;
        }

        const mensagemStatusTurno = sessao.bansNoTurnoAtual === 1 
            ? `# ${capAtual}, você precisa banir mais 1 mapa!` 
            : `# Vez de ${capAtual} banir 2 mapas!`;

        const embed = new EmbedBuilder()
            .setTitle(`🚫 Veto de Mapas CSMOS #${sessao.numeroVeto}`)
            .setColor('#38bdf8')
            .setDescription(`**Capitão 1:** <@${sessao.cap1Id}>\n**Capitão 2:** <@${sessao.cap2Id}>\n\n🚫 **Último mapa banido:** ${mapaBani ? mapaBani.nome : 'N/A'}\n\n${mensagemStatusTurno}`);

        const rows = criarBotoesMapas(sessao.mapasRestantes, sessaoId, 'ban', ButtonStyle.Danger, 'Banir ');

        sessao.latestEmbed = embed;
        sessao.latestComponents = rows;

        await interaction.update({ embeds: [embed], components: rows });
    }

    // FASE 2: ESCOLHA FINAL (PICK)
    if (customId.startsWith('pick:')) {
        await interaction.deferUpdate().catch(() => {});

        const parts = customId.split(':');
        const sessaoId = parts[1];
        const mapaId = parts.slice(2).join(':');

        const sessao = vetosAtivos.get(sessaoId);

        if (!sessao) {
            return interaction.followUp({ content: '❌ Esta sessão expirou.', ephemeral: true }).catch(() => {});
        }

        if (interaction.user.id !== sessao.vezDoCap) {
            return interaction.followUp({ content: '⚠️ Apenas o capitão da vez pode escolher o mapa final!', ephemeral: true }).catch(() => {});
        }

        const mapaEscolhido = sessao.mapasRestantes.find(m => m.id === mapaId) || sessao.mapasRestantes[0];
        const channelId = interaction.channelId;

        vetosAtivos.delete(sessaoId);

        const embedConcluido = new EmbedBuilder()
            .setTitle(`🎯 ESCOLHA FINAL DO MAPA #${sessao.numeroVeto} - CONCLUÍDO`)
            .setColor('#34d399')
            .setDescription(`**Capitão 1:** <@${sessao.cap1Id}>\n**Capitão 2:** <@${sessao.cap2Id}>\n\n✅ **Mapa Escolhido:** **${mapaEscolhido.nome.toUpperCase()}**`);

        await interaction.editReply({
            embeds: [embedConcluido],
            components: []
        }).catch(err => console.error('Erro ao editar veto:', err));

        let statusRcon = '✅ Mapa alterado no servidor!';
        let senhaJogo = 'sem senha';

        try {
            await executarRCON(interaction.guildId, `changelevel ${mapaEscolhido.id}`);
        } catch (err) {
            console.error('⚠️ Erro RCON ao trocar mapa:', err.message);
            statusRcon = `⚠️ **Falha RCON:** Não foi possível trocar o mapa no servidor (${err.message}).`;
        }

        try {
            const respSenha = await executarRCON(interaction.guildId, 'sv_password');
            const match = respSenha.match(/"sv_password"\s*(?:is|=)\s*"([^"]*)"/i) || respSenha.match(/"([^"]*)"/);
            if (match && match[1] && match[1].trim() !== '') {
                senhaJogo = match[1];
            }
        } catch (err) {
            console.error('⚠️ Erro RCON ao buscar sv_password:', err.message);
        }

        // Calcula o horário atual + 8 minutos de carência para entrar na partida
        const dataComCarencia = new Date(Date.now() + 8 * 60 * 1000);
        const horarioGo = dataComCarencia.toLocaleTimeString('pt-BR', { 
            timeZone: 'America/Sao_Paulo', 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: false 
        });

        const serverConfig = await db.get(`rcon_${interaction.guildId}`);
        const tagCargoMencao = serverConfig && serverConfig.cargoMencaoId 
            ? `<@&${serverConfig.cargoMencaoId}>` 
            : '@Ranked CSMOS PLAYER';

        const embedAnuncio = new EmbedBuilder()
            .setTitle('🎯 MAPA TROCADO')
            .setColor('#10b981')
            .addFields(
                { name: '🗺️ MAPA', value: `\`\`\`text\n${mapaEscolhido.nome.toUpperCase()}\n\`\`\``, inline: true },
                { name: '⏰ GO', value: `\`\`\`text\n${horarioGo}\n\`\`\``, inline: true },
                { name: '🔑 PASSWORD', value: `\`\`\`text\n${senhaJogo}\n\`\`\``, inline: true },
                { name: '📥 DOWNLOAD DO MAPA', value: `[👉 Clique aqui para baixar ${mapaEscolhido.nome.toUpperCase()}](${mapaEscolhido.download})`, inline: false }
            )
            .setImage(URL_GIF_ANUNCIO)
            .setFooter({ text: statusRcon });

        // Linha 1 de Botões do Painel RCON
        const painelLinha1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rcon_go').setLabel('🚀 GO (exec mix)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rcon_warmup').setLabel('🔥 Warmup (999s)').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rcon_warmup_end').setLabel('🛑 Fim Warmup').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('rcon_restart').setLabel('⚡ Restart (1s)').setStyle(ButtonStyle.Secondary)
        );

        // Linha 2 de Botões do Painel RCON (Com Pause e Despause)
        const painelLinha2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rcon_live').setLabel('🟢 LIVE (3s)').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rcon_pause').setLabel('⏸️ Pause').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rcon_unpause').setLabel('▶️ Despause').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rcon_status').setLabel('📊 Status').setStyle(ButtonStyle.Primary)
        );

        try {
            const novaMsgAnuncio = await interaction.followUp({
                content: tagCargoMencao,
                embeds: [embedAnuncio],
                components: [painelLinha1, painelLinha2]
            });

            paineisAtivos.set(channelId, {
                lastMessageId: novaMsgAnuncio.id,
                content: tagCargoMencao,
                embeds: [embedAnuncio],
                components: [painelLinha1, painelLinha2]
            });
            console.log('📌 [SUCESSO] Nova mensagem enviada com o GIF do Imgur!');
        } catch (errSend) {
            console.error('❌ Erro ao enviar a nova mensagem:', errSend);
        }
    }

    // AÇÕES DO PAINEL RCON (GO, Warmup, Fim Warmup, Restart, LIVE, Pause, Despause, Status)
    if (customId.startsWith('rcon_')) {
        await interaction.deferReply({ ephemeral: true });

        if (customId === 'rcon_status') {
            try {
                const respStatus = await executarRCON(interaction.guildId, 'status');

                let senhaJogo = 'sem senha';
                try {
                    const respSenha = await executarRCON(interaction.guildId, 'sv_password');
                    const match = respSenha.match(/"sv_password"\s*(?:is|=)\s*"([^"]*)"/i) || respSenha.match(/"([^"]*)"/);
                    if (match && match[1] && match[1].trim() !== '') {
                        senhaJogo = match[1];
                    }
                } catch (e) {}

                const matchMapa = respStatus.match(/map\s*:\s*([^\s\r\n]+)/i);
                const mapaAtual = matchMapa ? matchMapa[1] : 'Desconhecido';

                const linhas = respStatus.split('\n');
                const jogadores = linhas
                    .filter(l => l.trim().startsWith('#') && !l.includes('userid'))
                    .map(l => l.trim())
                    .join('\n');

                const embedStatus = new EmbedBuilder()
                    .setTitle('📊 Status Atual do Servidor CS')
                    .setColor('#38bdf8')
                    .addFields(
                        { name: '🗺️ Mapa Atual', value: `\`${mapaAtual}\``, inline: true },
                        { name: '🔑 Senha', value: `\`${senhaJogo}\``, inline: true },
                        { name: '👥 Jogadores Conectados', value: jogadores ? `\`\`\`text\n${jogadores.slice(0, 1000)}\n\`\`\`` : '_Nenhum jogador conectado no momento._' }
                    );

                return interaction.editReply({ embeds: [embedStatus] });
            } catch (error) {
                return interaction.editReply({ content: `❌ Erro ao consultar o status RCON: ${error.message}` });
            }
        }

        const serverConfig = await db.get(`rcon_${interaction.guildId}`);

        if (serverConfig && serverConfig.cargoId) {
            const temCargo = interaction.member.roles.cache.has(serverConfig.cargoId);
            if (!temCargo) {
                return interaction.editReply({ content: '🚫 Você não tem o cargo de Staff autorizado para controlar o servidor!' });
            }
        }

        try {
            if (customId === 'rcon_go') {
                await executarRCON(interaction.guildId, 'exec mix');
                await interaction.editReply({ content: '🚀 Comando **exec mix** enviado com sucesso!' });
            } else if (customId === 'rcon_warmup') {
                await executarRCON(interaction.guildId, 'mp_warmuptime 999; mp_warmup_start');
                await interaction.editReply({ content: '🔥 **Warmup** iniciado (999s)!' });
            } else if (customId === 'rcon_warmup_end') {
                await executarRCON(interaction.guildId, 'mp_warmup_end');
                await interaction.editReply({ content: '🛑 **Warmup** encerrado!' });
            } else if (customId === 'rcon_restart') {
                await executarRCON(interaction.guildId, 'mp_restartgame 1');
                await interaction.editReply({ content: '⚡ **Restart de 1s** enviado!' });
            } else if (customId === 'rcon_live') {
                await executarRCON(interaction.guildId, 'mp_restartgame 3');
                await interaction.editReply({ content: '🟢 **PARTIDA LIVE (3s)**!' });
            } else if (customId === 'rcon_pause') {
                await executarRCON(interaction.guildId, 'exec pause');
                await interaction.editReply({ content: '⏸️ Comando **exec pause** enviado!' });
            } else if (customId === 'rcon_unpause') {
                await executarRCON(interaction.guildId, 'exec unpause');
                await interaction.editReply({ content: '▶️ Comando **exec unpause** enviado!' });
            }
        } catch (error) {
            await interaction.editReply({ content: `❌ Erro ao enviar RCON: ${error.message}` });
        }
    }
});

// ========================================================
// SISTEMA DE PING DO MIX
// ========================================================
const CANAL_TEXTO_MIX_ID = '1464788173170413743'; 
const CANAL_VOZ_ESPERA_ID = '1414067786056990822'; 
const LINK_CONVITE_CALL = 'https://discord.gg/hZ2dceHZ5J';
const PALAVRAS_CHAVE_NEATQUEUE = ['fila', 'time', 'team'];

let timerMixDebounce = null;
let timerLoopInatividade = null;

async function verificarEEnviarMix(guild) {
    try {
        if (!guild) return;

        const canalTexto = guild.channels.cache.get(CANAL_TEXTO_MIX_ID);
        const canalEspera = guild.channels.cache.get(CANAL_VOZ_ESPERA_ID);

        if (!canalTexto || !canalEspera) return;

        const temPartidaOuRascunhoRolando = guild.channels.cache.some(channel => 
            channel.isVoiceBased() && 
            channel.id !== CANAL_VOZ_ESPERA_ID && 
            channel.members.size > 0 &&
            PALAVRAS_CHAVE_NEATQUEUE.some(palavra => channel.name.toLowerCase().includes(palavra))
        );

        if (temPartidaOuRascunhoRolando) {
            agendarProximaChecagemInatividade(guild);
            return;
        }

        const conectados = canalEspera.members.size;

        try {
            const mensagensAntigas = await canalTexto.messages.fetch({ limit: 15 });
            const mensagensDoBot = mensagensAntigas.filter(m => m.author.id === client.user.id);
            for (const [, msg] of mensagensDoBot) {
                await msg.delete().catch(() => {});
            }
        } catch (err) {
            console.error('Erro ao limpar mensagens antigas:', err);
        }

        if (conectados > 0 && conectados < 10) {
            const faltam = 10 - conectados;

            const serverConfig = await db.get(`rcon_${guild.id}`);
            const tagCargo = serverConfig && serverConfig.cargoMencaoId 
                ? `<@&${serverConfig.cargoMencaoId}>` 
                : '@Ranked CSMOS PLAYER';

            const embedMix = new EmbedBuilder()
                .setTitle(`⚔️ LOBBY CS:MOS - SALA DE ESPERA`)
                .setColor('#f59e0b')
                .setDescription(`# +${faltam} MIX\n\n📌 **Status:** \`${conectados}/10\` jogadores conectados na sala.`)
                .setImage(URL_GIF_MIX)
                .setFooter({ text: 'Clique no botão abaixo para entrar na chamada de voz.' });

            const rowBotaoCall = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('🎧 Clique aqui para Entrar na Call')
                    .setStyle(ButtonStyle.Link)
                    .setURL(LINK_CONVITE_CALL)
            );

            await canalTexto.send({
                content: tagCargo,
                embeds: [embedMix],
                components: [rowBotaoCall]
            });
        }

        agendarProximaChecagemInatividade(guild);

    } catch (error) {
        console.error('❌ Erro no sistema de Mix:', error);
        agendarProximaChecagemInatividade(guild);
    }
}

function agendarProximaChecagemInatividade(guild) {
    if (timerLoopInatividade) clearTimeout(timerLoopInatividade);
    timerLoopInatividade = setTimeout(async () => {
        await verificarEEnviarMix(guild);
    }, 60 * 1000);
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;

    const envolveuCallEspera = oldState.channelId === CANAL_VOZ_ESPERA_ID || newState.channelId === CANAL_VOZ_ESPERA_ID;
    if (!envolveuCallEspera) return;

    const guild = newState.guild || oldState.guild;

    if (timerMixDebounce) clearTimeout(timerMixDebounce);

    timerMixDebounce = setTimeout(async () => {
        await verificarEEnviarMix(guild);
    }, 6000);
});

client.login(config.token);