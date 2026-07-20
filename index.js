const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  SlashCommandBuilder, 
  REST, 
  Routes, 
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const { createCanvas, loadImage, registerFont } = require('canvas');

// 📌 둥근모꼴 폰트 등록
try {
  registerFont(path.join(__dirname, 'font.ttf'), { family: 'CustomFont' });
  console.log('✅ 둥근모꼴 폰트 등록 완료!');
} catch (e) {
  console.log('⚠️ font.ttf 파일을 찾지 못했습니다.');
}

// Render 수면 방지용 HTTP 서버
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Bot is alive!');
}).listen(process.env.PORT || 10000, '0.0.0.0', () => {
  console.log('HTTP Server is running on port 10000');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const CIVIL_WAR_ROLE_NAME = '내전'; 

// --- 데이터 파일 관리 ---
const POINTS_FILE = path.join(__dirname, 'points.json');
const WARNINGS_FILE = path.join(__dirname, 'warnings.json');
const BANS_FILE = path.join(__dirname, 'bans.json');
const SHOP_FILE = path.join(__dirname, 'shop.json');
const ATTENDANCE_FILE = path.join(__dirname, 'attendance.json');
const LOG_CONFIG_FILE = path.join(__dirname, 'logConfig.json');
const WARNING_LOG_CONFIG_FILE = path.join(__dirname, 'warningLogConfig.json');
const PARTICIPANTS_FILE = path.join(__dirname, 'participants.json');

function loadData(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({}));
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const voiceTimeTracker = {};

// 로그 전송 함수들
async function sendPointLog(guild, title, description, color = '#5865F2') {
  try {
    const logConfig = loadData(LOG_CONFIG_FILE);
    const channelId = logConfig[guild.id];
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const embed = new EmbedBuilder().setColor(color).setTitle(`📊 ${title}`).setDescription(description).setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (err) {}
}

async function sendWarningLog(guild, title, description, color = '#FEE75C') {
  try {
    const logConfig = loadData(WARNING_LOG_CONFIG_FILE);
    const channelId = logConfig[guild.id];
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;
    const embed = new EmbedBuilder().setColor(color).setTitle(`⚠️ ${title}`).setDescription(description).setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch (err) {}
}

const tierInfo = [
  { keywords: ['챌린저', '챌'], code: 'C', name: 'Challenger', color: '#FFD700', rank: 1 },
  { keywords: ['그랜드마스터', '그마'], code: 'GM', name: 'Grandmaster', color: '#FF8C00', rank: 2 },
  { keywords: ['마스터', '마'], code: 'M', name: 'Master', color: '#BA55D3', rank: 3 },
  { keywords: ['다이아몬드', '다이아', '다'], code: 'D', name: 'Diamond', color: '#00BFFF', rank: 4 },
  { keywords: ['에메랄드', '에메', '에'], code: 'E', name: 'Emerald', color: '#00FA9A', rank: 5 },
  { keywords: ['플래티넘', '플레티넘', '플래', '플레', '플'], code: 'P', name: 'Platinum', color: '#20B2AA', rank: 6 },
  { keywords: ['골드', '골'], code: 'G', name: 'Gold', color: '#FFD700', rank: 7 },
  { keywords: ['실버', '실'], code: 'S', name: 'Silver', color: '#C0C0C0', rank: 8 },
  { keywords: ['브론즈', '브'], code: 'B', name: 'Bronze', color: '#CD853F', rank: 9 },
  { keywords: ['아이언', '아'], code: 'I', name: 'Iron', color: '#708090', rank: 10 },
  { keywords: ['언랭'], code: 'U', name: 'Unranked', color: '#808080', rank: 11 }
];

const lineKeywords = ['탑', '정글', '미드', '원딜', '서폿'];

async function getUserProfileInfo(guild, user) {
  try {
    const member = await guild.members.fetch(user.id);
    const userRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

    let matchedTier = { code: 'U', name: 'Unranked', color: '#808080', rank: 11 };
    for (const t of tierInfo) {
      const isMatch = userRoleNames.some(roleName => 
        t.keywords.some(kw => roleName.includes(kw.toLowerCase()))
      );
      if (isMatch) {
        matchedTier = t;
        break;
      }
    }

    const userLines = [];
    userRoleNames.forEach(roleName => {
      lineKeywords.forEach(line => {
        if (roleName.includes(line) && !userLines.includes(line)) {
          userLines.push(line);
        }
      });
    });

    const lineText = userLines.length > 0 ? userLines.join(', ') : '포지션 없음';
    const displayName = member.nickname || user.globalName || user.username;

    return { displayName, matchedTier, lineText };
  } catch (err) {
    return { 
      displayName: user.username, 
      matchedTier: { code: 'U', name: 'Unranked', color: '#808080', rank: 11 }, 
      lineText: '정보 없음' 
    };
  }
}

// 🎨 프로필 카드 생성 함수
async function generateProfileCard(user, displayName, matchedTier, lineText, points, warns) {
  const canvas = createCanvas(800, 450);
  const ctx = canvas.getContext('2d');

  try {
    const bgImage = await loadImage(path.join(__dirname, 'background.png'));
    ctx.drawImage(bgImage, 0, 0, 800, 450);
  } catch (e) {
    ctx.fillStyle = '#ffb6c1';
    ctx.fillRect(0, 0, 800, 450);
  }

  const drawTextWithShadow = (text, x, y, font, fillColor) => {
    ctx.font = font;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
  };

  try {
    const avatarURL = user.displayAvatarURL({ extension: 'png', size: 128 });
    const avatar = await loadImage(avatarURL);
    ctx.save();
    ctx.beginPath();
    ctx.arc(105, 135, 55, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 50, 80, 110, 110);
    ctx.restore();

    ctx.strokeStyle = matchedTier.color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(105, 135, 57, 0, Math.PI * 2, true);
    ctx.stroke();
  } catch (e) {
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(105, 135, 55, 0, Math.PI * 2, true);
    ctx.fill();
  }

  drawTextWithShadow(displayName, 185, 115, '34px CustomFont', '#ffffff');
  drawTextWithShadow(`티어 : ${matchedTier.name} [${matchedTier.code}]`, 185, 160, '22px CustomFont', '#00ffff');
  drawTextWithShadow(`주요 라인 : ${lineText}`, 185, 200, '22px CustomFont', '#ffeb3b');
  drawTextWithShadow(`보유 포인트 : ${points.toLocaleString()} P`, 185, 285, '22px CustomFont', '#76ff03');
  
  const warnColor = warns > 0 ? '#ff1744' : '#ffffff';
  drawTextWithShadow(`누적 경고 : ${warns}회`, 490, 285, '22px CustomFont', warnColor);

  return canvas.toBuffer();
}

// 전체 슬래시 명령어 정의
const commands = [
  new SlashCommandBuilder().setName('프로필').setDescription('레트로 프로필 카드를 확인합니다.').addUserOption(option => option.setName('대상').setDescription('조회할 유저').setRequired(false)),
  new SlashCommandBuilder().setName('출석').setDescription('출석체크를 하고 포인트를 받습니다!'),
  new SlashCommandBuilder().setName('포인트').setDescription('포인트를 확인합니다.').addUserOption(option => option.setName('대상').setDescription('조회할 유저').setRequired(false)),
  new SlashCommandBuilder().setName('포인트순위').setDescription('포인트 순위 Top 10을 확인합니다.'),
  new SlashCommandBuilder().setName('경고확인').setDescription('경고 횟수를 확인합니다.').addUserOption(option => option.setName('대상').setDescription('조회할 유저').setRequired(false)),
  new SlashCommandBuilder().setName('상점').setDescription('포인트로 구매 가능한 상점 목록을 확인합니다.'),
  new SlashCommandBuilder().setName('상점구매').setDescription('상점의 상품을 구매합니다.').addStringOption(option => option.setName('상품이름').setDescription('상품 이름').setRequired(true)),
  
  new SlashCommandBuilder().setName('문의패널').setDescription('문의하기 티켓 패널을 생성합니다. (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder().setName('포인트로그설정').setDescription('포인트 로그 채널 설정 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(option => option.setName('채널').setDescription('텍스트 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName('경고로그설정').setDescription('경고 로그 채널 설정 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(option => option.setName('채널').setDescription('텍스트 채널').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName('내전인원').setDescription('내전 참가자 명단 확인 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('명단초기화').setDescription('명단 초기화 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('포인트지급').setDescription('포인트 지급/차감 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setDescription('대상').setRequired(true)).addIntegerOption(option => option.setName('포인트').setDescription('포인트').setRequired(true)),
  
  new SlashCommandBuilder().setName('경고').setDescription('경고 부여 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setDescription('대상').setRequired(true)).addStringOption(option => option.setName('사유').setDescription('사유')),
  new SlashCommandBuilder().setName('경고차감').setDescription('경고 차감 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setDescription('대상').setRequired(true)),
  
  new SlashCommandBuilder().setName('내전정지').setDescription('내전 정지 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setDescription('대상').setRequired(true)).addStringOption(option => option.setName('사유').setDescription('사유')),
  new SlashCommandBuilder().setName('내전정지해제').setDescription('정지 해제 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setDescription('대상').setRequired(true)),
  new SlashCommandBuilder().setName('상점등록').setDescription('상점 역할 등록 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addRoleOption(option => option.setName('역할').setDescription('역할').setRequired(true)).addIntegerOption(option => option.setName('가격').setDescription('가격').setRequired(true)).addStringOption(option => option.setName('설명').setDescription('설명')),
  new SlashCommandBuilder().setName('상점삭제').setDescription('상점 역할 삭제 (관리자)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addRoleOption(option => option.setName('역할').setDescription('역할').setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} 봇 준비 완료!`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    const guilds = client.guilds.cache.map(guild => guild.id);
    for (const guildId of guilds) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
    }
    console.log('✅ 모든 슬래시 명령어 등록 완료!');
  } catch (error) {
    console.error('명령어 등록 오류:', error);
  }

  setInterval(checkExpiredBans, 60 * 1000);
  setInterval(checkVoiceChannels, 60 * 1000);
});

async function checkVoiceChannels() {
  const pointsData = loadData(POINTS_FILE);
  client.guilds.cache.forEach(async guild => {
    const guildId = guild.id;
    if (!pointsData[guildId]) pointsData[guildId] = {};
    if (!voiceTimeTracker[guildId]) voiceTimeTracker[guildId] = {};

    guild.channels.cache.forEach(channel => {
      if (channel.isVoiceBased() && channel.members.size > 0) {
        channel.members.forEach(async member => {
          if (member.user.bot) return;
          const userId = member.id;
          if (!voiceTimeTracker[guildId][userId]) voiceTimeTracker[guildId][userId] = 0;
          voiceTimeTracker[guildId][userId] += 1;

          if (voiceTimeTracker[guildId][userId] >= 60) {
            voiceTimeTracker[guildId][userId] = 0;
            const currentPoints = pointsData[guildId][userId] || 0;
            pointsData[guildId][userId] = currentPoints + 10;
            saveData(POINTS_FILE, pointsData);
          }
        });
      }
    });
  });
}

async function checkExpiredBans() {
  const bansData = loadData(BANS_FILE);
  const now = Date.now();
  let hasChanged = false;

  for (const guildId in bansData) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    for (const userId in bansData[guildId]) {
      const banInfo = bansData[guildId][userId];

      if (now >= banInfo.unbanTime) {
        try {
          const member = await guild.members.fetch(userId);
          const role = guild.roles.cache.get(banInfo.roleId);

          if (member && role) {
            await member.roles.add(role);
          }
        } catch (err) {}

        delete bansData[guildId][userId];
        hasChanged = true;
      }
    }
  }

  if (hasChanged) {
    saveData(BANS_FILE, bansData);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const text = message.content.trim();
  if (text === 'ㅅ' || text === '손' || text === 't') {
    const userId = message.author.id;
    const guildId = message.guild?.id;
    if (!guildId) return;
    const channelId = message.channel.id;

    const participantsData = loadData(PARTICIPANTS_FILE);
    if (!participantsData[guildId]) participantsData[guildId] = {};
    if (!participantsData[guildId][channelId]) participantsData[guildId][channelId] = [];

    if (participantsData[guildId][channelId].includes(userId)) {
      await message.react('⚠️');
      return;
    }
    participantsData[guildId][channelId].push(userId);
    saveData(PARTICIPANTS_FILE, participantsData);
    await message.react('✅');
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    const { customId, channel, user, member, guild } = interaction;
    
    // 티켓 생성 버튼 처리
    if (customId.startsWith('ticket_') && customId !== 'ticket_close' && customId !== 'ticket_delete') {
      const ticketTypeMap = {
        'ticket_server': '서버-문의',
        'ticket_report': '유저-신고및분쟁',
        'ticket_verify': '명의-인증',
        'ticket_event': '이벤트-문의',
        'ticket_etc': '기타-문의'
      };

      const typeName = ticketTypeMap[customId] || '기타-문의';
      const threadName = `${typeName}-${user.username}`;

      await interaction.deferReply({ ephemeral: true });

      try {
        const thread = await channel.threads.create({
          name: threadName,
          autoArchiveDuration: 1440,
          type: ChannelType.PrivateThread,
          reason: '유저 문의 티켓 생성'
        });

        await thread.members.add(user.id);

        const welcomeEmbed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle(`🎫 ${typeName.replace('-', ' ')} 채널입니다.`)
          .setDescription(`<@${user.id}> 님, 문의 내용을 남겨주시면 관리자가 확인 후 답변해 드립니다.\n\n업무가 완료되면 아래 버튼을 눌러 티켓을 닫아주세요.`);

        const ticketButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('🔒 티켓 닫기')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('ticket_delete')
            .setLabel('🗑️ 티켓 삭제 (관리자용)')
            .setStyle(ButtonStyle.Danger)
        );

        await thread.send({ content: `<@${user.id}>`, embeds: [welcomeEmbed], components: [ticketButtons] });
        return await interaction.editReply({ content: `✅ 문의 스레드가 생성되었습니다: <#${thread.id}>` });
      } catch (err) {
        console.error('스레드 생성 오류:', err);
        return await interaction.editReply({ content: '⚠️ 스레드 생성 중 오류가 발생했습니다.' });
      }
    }

    if (customId === 'ticket_close') {
      if (!channel.isThread()) {
        return interaction.reply({ content: '⚠️ 스레드 채널에서만 사용할 수 있습니다.', ephemeral: true });
      }

      await interaction.reply({ content: '🔒 티켓이 닫혔습니다. 관리자가 확인 후 삭제할 수 있습니다.', ephemeral: false });
      try {
        await channel.setArchived(true);
      } catch (e) {}
      return;
    }

    if (customId === 'ticket_delete') {
      if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '⚠️ 티켓 삭제는 관리자만 할 수 있습니다!', ephemeral: true });
      }

      await interaction.reply({ content: '🗑️ 5초 뒤에 티켓이 영구 삭제됩니다...', ephemeral: false });
      setTimeout(async () => {
        try {
          if (channel.isThread()) {
            await channel.delete();
          }
        } catch (e) {}
      }, 5000);
      return;
    }

    // 🎮 내전인원 페이지네이션 버튼 처리 (page_prev 또는 page_next)
    if (customId.startsWith('page_')) {
      const participantsData = loadData(PARTICIPANTS_FILE);
      const guildId = guild.id;
      const channelId = channel.id;
      const currentParticipants = participantsData[guildId]?.[channelId] || [];

      if (currentParticipants.length === 0) {
        return interaction.update({ content: '참가자가 없습니다.', embeds: [], components: [] });
      }

      // 기존 메시지의 임베드 푸터에서 현재 페이지 번호 추출 (예: "페이지 1 / 3")
      const footerText = interaction.message.embeds[0]?.footer?.text || '';
      const match = footerText.match(/페이지\s*(\d+)\s*\/\s*(\d+)/);
      let currentPage = match ? parseInt(match[1]) : 1;
      const totalPages = match ? parseInt(match[2]) : 1;

      if (customId === 'page_prev') {
        currentPage = currentPage > 1 ? currentPage - 1 : totalPages;
      } else if (customId === 'page_next') {
        currentPage = currentPage < totalPages ? currentPage + 1 : 1;
      }

      // 유저 세부 정보 재구성
      const userDetails = [];
      for (const userId of currentParticipants) {
        try {
          const memberObj = await guild.members.fetch(userId);
          const userRoleNames = memberObj.roles.cache.map(r => r.name.toLowerCase());

          let matchedTier = { code: 'U', name: 'Unranked', color: '#808080', rank: 11 };
          for (const t of tierInfo) {
            const isMatch = userRoleNames.some(roleName => 
              t.keywords.some(kw => roleName.includes(kw.toLowerCase()))
            );
            if (isMatch) {
              matchedTier = t;
              break;
            }
          }

          const userLines = [];
          userRoleNames.forEach(roleName => {
            lineKeywords.forEach(line => {
              if (roleName.includes(line) && !userLines.includes(line)) {
                userLines.push(line);
              }
            });
          });

          const lineText = userLines.length > 0 ? userLines.join(' ') : '포지션 없음';
          const rawName = memberObj.nickname || memberObj.user.globalName || memberObj.user.username;

          let cleanName = rawName.replace(/^\d{2}\s*/, '').trim();
          const tagIndex = cleanName.indexOf('#');
          if (tagIndex !== -1) {
            const beforeTag = cleanName.substring(0, tagIndex);
            const afterTagPart = cleanName.substring(tagIndex);
            const tagMatch = afterTagPart.match(/#[^\s#]+/);
            cleanName = beforeTag + (tagMatch ? tagMatch[0] : '');
          } else {
            cleanName = cleanName
              .replace(/\b(여|남)\b/g, '')
              .replace(/\b(c|gm|m|d|e|p|g|s|b|i|u)\b/gi, '')
              .trim();
          }
          if (!cleanName) cleanName = rawName;

          const encodedName = encodeURIComponent(cleanName);
          const fowLink = `https://fow.lol/find/${encodedName}`;

          userDetails.push({
            rank: matchedTier.rank,
            text: `[${matchedTier.code}] ${rawName} / ${lineText} ([전적](${fowLink}))`
          });
        } catch (e) {}
      }

      userDetails.sort((a, b) => a.rank - b.rank);

      const itemsPerPage = 10;
      const newTotalPages = Math.ceil(userDetails.length / itemsPerPage);
      // 페이지 범위 초과 방지
      if (currentPage > newTotalPages) currentPage = newTotalPages;

      const startIndex = (currentPage - 1) * itemsPerPage;
      const slicedItems = userDetails.slice(startIndex, startIndex + itemsPerPage);
      const listDesc = slicedItems.map(u => u.text).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎮 내전 참가자 명단 (티어순)')
        .setDescription(listDesc)
        .setFooter({ text: `총 참가 인원: ${userDetails.length}명 | 페이지 ${currentPage} / ${newTotalPages}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('page_prev').setLabel('◀ 이전').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('page_next').setLabel('다음 ▶').setStyle(ButtonStyle.Primary)
      );

      return await interaction.update({ embeds: [embed], components: newTotalPages > 1 ? [row] : [] });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, options, user, guild, channel } = interaction;
  const channelId = channel.id;

  const pointsData = loadData(POINTS_FILE);
  if (!pointsData[guildId]) pointsData[guildId] = {};
  const warningsData = loadData(WARNINGS_FILE);
  if (!warningsData[guildId]) warningsData[guildId] = {};
  const bansData = loadData(BANS_FILE);
  if (!bansData[guildId]) bansData[guildId] = {};
  const shopData = loadData(SHOP_FILE);
  if (!shopData[guildId]) shopData[guildId] = { items: {}, userTicketCounts: {} };
  const participantsData = loadData(PARTICIPANTS_FILE);
  if (!participantsData[guildId]) participantsData[guildId] = {};
  if (!participantsData[guildId][channelId]) participantsData[guildId][channelId] = [];

  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ ephemeral: false });
    } catch (e) {}
  }

  try {
    // --- ✉️ [/문의패널] ---
    if (commandName === '문의패널') {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('✉️ 문의하기')
        .setDescription(
          '아래 버튼 중 문의 유형을 골라 누르면, 관리자와 대화할 수 있는 비공개 채널이 생성됩니다.\n\n' +
          '🏠 서버 문의\n' +
          '🚨 유저 신고 및 분쟁 관련\n' +
          '🪪 명의 인증\n' +
          '🏆 이벤트 문의\n' +
          '💬 기타 문의\n\n' +
          '생성된 채널 이름에 문의 분류가 표시돼 관리자가 바로 확인할 수 있어요.'
        );

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_server').setLabel('서버 문의').setEmoji('🏠').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket_report').setLabel('유저 신고 및 분쟁').setEmoji('🚨').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket_verify').setLabel('명의 인증').setEmoji('🪪').setStyle(ButtonStyle.Success)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_event').setLabel('이벤트 문의').setEmoji('🏆').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('ticket_etc').setLabel('기타 문의').setEmoji('💬').setStyle(ButtonStyle.Secondary)
      );

      return await interaction.editReply({ content: '✅ 문의 패널이 생성되었습니다!', embeds: [embed], components: [row1, row2] });
    }

    // --- 📊 [/포인트로그설정] ---
    if (commandName === '포인트로그설정') {
      const targetChannel = options.getChannel('채널');
      const logConfig = loadData(LOG_CONFIG_FILE);
      logConfig[guildId] = targetChannel.id;
      saveData(LOG_CONFIG_FILE, logConfig);
      return await interaction.editReply({ content: `✅ 포인트 로그 채널이 <#${targetChannel.id}> (으)로 설정되었습니다!` });
    }

    // --- 🚨 [/경고로그설정] ---
    if (commandName === '경고로그설정') {
      const targetChannel = options.getChannel('채널');
      const warningLogConfig = loadData(WARNING_LOG_CONFIG_FILE);
      warningLogConfig[guildId] = targetChannel.id;
      saveData(WARNING_LOG_CONFIG_FILE, warningLogConfig);
      return await interaction.editReply({ content: `✅ 경고 로그 채널이 <#${targetChannel.id}> (으)로 설정되었습니다!` });
    }

    // --- [/프로필] ---
    if (commandName === '프로필') {
      const targetUser = options.getUser('대상') || user;
      const { displayName, matchedTier, lineText } = await getUserProfileInfo(guild, targetUser);
      const userPoints = pointsData[guildId][targetUser.id] || 0;
      const userWarns = warningsData[guildId][targetUser.id] || 0;

      const cardBuffer = await generateProfileCard(targetUser, displayName, matchedTier, lineText, userPoints, userWarns);
      const attachment = new AttachmentBuilder(cardBuffer, { name: 'retro-profile.png' });
      return await interaction.editReply({ files: [attachment] });
    }

    // --- [/출석] ---
    if (commandName === '출석') {
      const todayStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
      const attendanceData = loadData(ATTENDANCE_FILE);
      if (!attendanceData[guildId]) attendanceData[guildId] = {};

      if (attendanceData[guildId][user.id] === todayStr) {
        return await interaction.editReply({ content: '⚠️ 오늘은 이미 출석체크를 완료하셨습니다!' });
      }
      attendanceData[guildId][user.id] = todayStr;
      saveData(ATTENDANCE_FILE, attendanceData);

      const currentPoints = pointsData[guildId][user.id] || 0;
      const newPoints = currentPoints + 50;
      pointsData[guildId][user.id] = newPoints;
      saveData(POINTS_FILE, pointsData);

      return await interaction.editReply({ content: `📅 출석체크 완료! **50 P**가 지급되었습니다. (보유: ${newPoints} P)` });
    }

    // --- [/포인트] ---
    if (commandName === '포인트') {
      const targetUser = options.getUser('대상') || user;
      const userPoints = pointsData[guildId][targetUser.id] || 0;
      return await interaction.editReply({ content: `<@${targetUser.id}> 님의 현재 포인트는 **${userPoints.toLocaleString()} P** 입니다.` });
    }

    // --- [/포인트순위] ---
    if (commandName === '포인트순위') {
      const serverPoints = pointsData[guildId] || {};
      const sortedUsers = Object.keys(serverPoints)
        .map(userId => ({ userId, points: serverPoints[userId] }))
        .sort((a, b) => b.points - a.points)
        .slice(0, 10);

      if (sortedUsers.length === 0) {
        return await interaction.editReply({ content: '등록된 포인트 데이터가 없습니다!' });
      }

      let rankingText = '';
      sortedUsers.forEach((item, index) => {
        const rankNum = index + 1;
        rankingText += `**${rankNum}위** <@${item.userId}> - **${item.points.toLocaleString()} P**\n`;
      });

      const embed = new EmbedBuilder().setColor('#FEE75C').setTitle('🏆 포인트 순위 Top 10').setDescription(rankingText);
      return await interaction.editReply({ embeds: [embed] });
    }

    // --- [/경고확인] ---
    if (commandName === '경고확인') {
      const targetUser = options.getUser('대상') || user;
      const userWarns = warningsData[guildId][targetUser.id] || 0;
      return await interaction.editReply({ content: `<@${targetUser.id}> 님의 현재 경고 횟수는 **${userWarns} / 3 회** 입니다.` });
    }

    // --- 🛒 [/상점] ---
    if (commandName === '상점') {
      const userPoints = pointsData[guildId][user.id] || 0;
      const embed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('🛒 포인트 상점')
        .setDescription(
          '**1. 🎟️ 경고 차감권**\n' +
          '- `3,000 P` (내 구매 횟수: 0회)\n' +
          'ㄴ구매 즉시 누적된 경고 1회가 자동으로 차감됩니다. (재구매 시마다 2,000 P씩 증가)\n\n' +
          '**2. 🏷️ 커스텀역할**\n' +
          '- `30,000 P`\n' +
          'ㄴ본인이 원하는 커스텀 역할을 신청할 수 있습니다.\n\n' +
          '**3. 📚 강의권**\n' +
          '- `5,000 P`\n' +
          'ㄴ강의를 받을 수 있는 수강권을 획득합니다.'
        )
        .addFields({ name: '💳 내 보유 포인트', value: `**${userPoints.toLocaleString()} P**` })
        .setFooter({ text: '구매를 원하시면 /상점구매 명령어를 사용해주세요! (예: /상점구매 상품이름: 커스텀역할)' });

      return await interaction.editReply({ embeds: [embed] });
    }

    // --- 🛒 [/상점구매] (포인트 자동 차감 및 상품 처리) ---
    if (commandName === '상점구매') {
      const rawInput = options.getString('상품이름').trim().toLowerCase();
      const userId = user.id;
      const userPoints = pointsData[guildId][userId] || 0;

      // 상품 이름 매칭 (띄어쓰기 무시)
      let selectedItem = null;
      let cost = 0;

      if (rawInput.includes('경고') || rawInput.includes('차감권')) {
        selectedItem = '경고 차감권';
        // 구매 횟수에 따른 가격 계산 (기본 3,000 P, 재구매 시마다 +2,000 P)
        if (!shopData[guildId].userTicketCounts) shopData[guildId].userTicketCounts = {};
        const buyCount = shopData[guildId].userTicketCounts[userId] || 0;
        cost = 3000 + (buyCount * 2000);
      } else if (rawInput.includes('커스텀') || rawInput.includes('역할')) {
        selectedItem = '커스텀역할';
        cost = 30000;
      } else if (rawInput.includes('강의') || rawInput.includes('강의권')) {
        selectedItem = '강의권';
        cost = 5000;
      } else {
        return await interaction.editReply({ content: '⚠️ 존재하지 않는 상품입니다. `/상점` 명령어로 상품 목록을 확인해주세요.' });
      }

      if (userPoints < cost) {
        return await interaction.editReply({ content: `⚠️ 포인트가 부족합니다! (필요: **${cost.toLocaleString()} P** / 보유: **${userPoints.toLocaleString()} P**)` });
      }

      // 포인트 차감
      pointsData[guildId][userId] = userPoints - cost;
      saveData(POINTS_FILE, pointsData);

      let successDescription = `<@${userId}> 님이 **${selectedItem}** 상품을 **${cost.toLocaleString()} P**에 구매하셨습니다!`;

      // 경고 차감권인 경우 즉시 경고 1회 차감 적용
      if (selectedItem === '경고 차감권') {
        if (!shopData[guildId].userTicketCounts) shopData[guildId].userTicketCounts = {};
        shopData[guildId].userTicketCounts[userId] = (shopData[guildId].userTicketCounts[userId] || 0) + 1;
        saveData(SHOP_FILE, shopData);

        const currentWarns = warningsData[guildId][userId] || 0;
        if (currentWarns > 0) {
          const newWarns = currentWarns - 1;
          warningsData[guildId][userId] = newWarns;
          saveData(WARNINGS_FILE, warningsData);
          successDescription += `\n\n🛡️ 구매 즉시 누적 경고 1회가 차감되었습니다. (현재 경고: ${newWarns}회)`;
        } else {
          successDescription += `\n\n🛡️ 차감할 경고가 없어 포인트만 차감되었습니다.`;
        }
      }

      // 포인트 로그 전송
      await sendPointLog(
        guild,
        '상점 상품 구매',
        `<@${userId}> 님 수량/상품: **${selectedItem}**\n사용 포인트: **-${cost.toLocaleString()} P**\n잔여 포인트: **${pointsData[guildId][userId].toLocaleString()} P**`,
        '#57F287'
      );

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🛒 상점 구매 완료')
        .setDescription(successDescription)
        .addFields({ name: '💳 잔여 포인트', value: `**${pointsData[guildId][userId].toLocaleString()} P**` })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // --- 관리자 명령어 처리 ---
    if (commandName === '포인트지급') {
      const targetUser = options.getUser('대상');
      const amount = options.getInteger('포인트');
      const currentPoints = pointsData[guildId][targetUser.id] || 0;
      const newPoints = currentPoints + amount;
      pointsData[guildId][targetUser.id] = newPoints;
      saveData(POINTS_FILE, pointsData);
      return await interaction.editReply({ content: `<@${targetUser.id}> 님에게 **${amount.toLocaleString()} P**를 지급/차감했습니다. (현재: ${newPoints} P)` });
    }

    // --- ⚠️ [/경고] ---
    if (commandName === '경고') {
      const targetUser = options.getUser('대상');
      const reason = options.getString('사유') || '사유 미기재';
      const currentWarns = (warningsData[guildId][targetUser.id] || 0) + 1;
      warningsData[guildId][targetUser.id] = currentWarns;
      saveData(WARNINGS_FILE, warningsData);

      await sendWarningLog(
        guild, 
        '경고 부여', 
        `<@${targetUser.id}> 님에게 경고 1회를 부여했습니다.\n\n**현재 경고 횟수:** ${currentWarns} / 3 회\n**사유:** ${reason}\n**경고 부여 관리자:** <@${user.id}>`, 
        '#FEE75C'
      );

      const embed = new EmbedBuilder()
        .setColor('#FEE75C')
        .setTitle('⚠️ 경고 부여')
        .setDescription(`<@${targetUser.id}> 님에게 경고 1회를 부여했습니다.`)
        .addFields(
          { name: '현재 경고 횟수', value: `${currentWarns} / 3 회`, inline: true },
          { name: '사유', value: reason, inline: true },
          { name: '경고 부여 관리자', value: `<@${user.id}>` }
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // --- ⚠️ [/경고차감] ---
    if (commandName === '경고차감') {
      const targetUser = options.getUser('대상');
      const currentWarns = warningsData[guildId][targetUser.id] || 0;
      if (currentWarns <= 0) return await interaction.editReply({ content: '차감할 경고가 없습니다!' });

      const newWarns = currentWarns - 1;
      warningsData[guildId][targetUser.id] = newWarns;
      saveData(WARNINGS_FILE, warningsData);

      await sendWarningLog(
        guild, 
        '경고 차감', 
        `<@${targetUser.id}> 님의 경고를 1회 차감했습니다.\n\n**현재 경고 횟수:** ${newWarns} / 3 회\n**경고 차감 관리자:** <@${user.id}>`, 
        '#57F287'
      );

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🛡️ 경고 차감')
        .setDescription(`<@${targetUser.id}> 님의 경고를 1회 차감했습니다.`)
        .addFields(
          { name: '현재 경고 횟수', value: `${newWarns} / 3 회`, inline: true },
          { name: '경고 차감 관리자', value: `<@${user.id}>`, inline: true }
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    if (commandName === '내전정지') {
      const targetUser = options.getUser('대상');
      const reason = options.getString('사유') || '사유 미기재';
      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      const targetRole = guild.roles.cache.find(r => r.name === CIVIL_WAR_ROLE_NAME);

      if (!targetRole || !member) {
        return await interaction.editReply({ content: `⚠️ 서버에서 **'${CIVIL_WAR_ROLE_NAME}'** 역할을 찾을 수 없거나 유저를 찾지 못했습니다.` });
      }

      if (member.roles.cache.has(targetRole.id)) {
        await member.roles.remove(targetRole);
      }

      const unbanTime = Date.now() + (7 * 24 * 60 * 60 * 1000);
      if (!bansData[guildId]) bansData[guildId] = {};
      bansData[guildId][targetUser.id] = {
        roleId: targetRole.id,
        unbanTime: unbanTime
      };
      saveData(BANS_FILE, bansData);

      const unbanDateStr = new Date(unbanTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

      const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🚫 내전 참가 정지 (7일)')
        .setDescription(`<@${targetUser.id}> 님의 '${CIVIL_WAR_ROLE_NAME}' 역할을 회수했습니다.`)
        .addFields(
          { name: '사유', value: reason },
          { name: '자동 해제 일시', value: unbanDateStr }
        )
        .setFooter({ text: '일주일 뒤 자동으로 내전 역할이 복구됩니다.' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    if (commandName === '내전정지해제') {
      const targetUser = options.getUser('대상');
      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      const targetRole = guild.roles.cache.find(r => r.name === CIVIL_WAR_ROLE_NAME);

      if (!targetRole || !member) {
        return await interaction.editReply({ content: `⚠️ 역할을 찾을 수 없습니다.` });
      }

      if (!member.roles.cache.has(targetRole.id)) {
        await member.roles.add(targetRole);
      }

      if (bansData[guildId] && bansData[guildId][targetUser.id]) {
        delete bansData[guildId][targetUser.id];
        saveData(BANS_FILE, bansData);
      }

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🟢 내전 참가 정지 해제')
        .setDescription(`<@${targetUser.id}> 님의 내전 정지가 해제되어 역할이 복구되었습니다.`)
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // --- 🎮 [/내전인원] (10명 단위 페이지네이션 적용) ---
    if (commandName === '내전인원') {
      const currentParticipants = participantsData[guildId][channelId] || [];
      if (currentParticipants.length === 0) {
        const embed = new EmbedBuilder().setColor('#5865F2').setTitle('🎮 내전 참가자 명단 (티어순)').setDescription('참가자가 없습니다.');
        return await interaction.editReply({ embeds: [embed] });
      }

      const userDetails = [];
      for (const userId of currentParticipants) {
        try {
          const member = await guild.members.fetch(userId);
          const userRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

          let matchedTier = { code: 'U', name: 'Unranked', color: '#808080', rank: 11 };
          for (const t of tierInfo) {
            const isMatch = userRoleNames.some(roleName => 
              t.keywords.some(kw => roleName.includes(kw.toLowerCase()))
            );
            if (isMatch) {
              matchedTier = t;
              break;
            }
          }

          const userLines = [];
          userRoleNames.forEach(roleName => {
            lineKeywords.forEach(line => {
              if (roleName.includes(line) && !userLines.includes(line)) {
                userLines.push(line);
              }
            });
          });

          const lineText = userLines.length > 0 ? userLines.join(' ') : '포지션 없음';
          const rawName = member.nickname || member.user.globalName || member.user.username;

          let cleanName = rawName.replace(/^\d{2}\s*/, '').trim();
          const tagIndex = cleanName.indexOf('#');
          if (tagIndex !== -1) {
            const beforeTag = cleanName.substring(0, tagIndex);
            const afterTagPart = cleanName.substring(tagIndex);
            const tagMatch = afterTagPart.match(/#[^\s#]+/);
            cleanName = beforeTag + (tagMatch ? tagMatch[0] : '');
          } else {
            cleanName = cleanName
              .replace(/\b(여|남)\b/g, '')
              .replace(/\b(c|gm|m|d|e|p|g|s|b|i|u)\b/gi, '')
              .trim();
          }
          if (!cleanName) cleanName = rawName;

          const encodedName = encodeURIComponent(cleanName);
          const fowLink = `https://fow.lol/find/${encodedName}`;

          userDetails.push({
            rank: matchedTier.rank,
            text: `[${matchedTier.code}] ${rawName} / ${lineText} ([전적](${fowLink}))`
          });
        } catch (e) {}
      }

      userDetails.sort((a, b) => a.rank - b.rank);

      const itemsPerPage = 10;
      const totalPages = Math.ceil(userDetails.length / itemsPerPage);
      const currentPage = 1;

      const slicedItems = userDetails.slice(0, itemsPerPage);
      const listDesc = slicedItems.map(u => u.text).join('\n');

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎮 내전 참가자 명단 (티어순)')
        .setDescription(listDesc)
        .setFooter({ text: `총 참가 인원: ${userDetails.length}명 | 페이지 ${currentPage} / ${totalPages}` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('page_prev').setLabel('◀ 이전').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('page_next').setLabel('다음 ▶').setStyle(ButtonStyle.Primary)
      );

      return await interaction.editReply({ 
        embeds: [embed], 
        components: totalPages > 1 ? [row] : [] 
      });
    }

    if (commandName === '명단초기화') {
      participantsData[guildId][channelId] = [];
      saveData(PARTICIPANTS_FILE, participantsData);
      return await interaction.editReply({ content: '🔄 내전 참가자 명단이 초기화되었습니다!' });
    }

  } catch (err) {
    console.error('명령어 실행 오류:', err);
    try {
      await interaction.editReply({ content: '⚠️ 명령어를 처리하는 도중 오류가 발생했습니다.' });
    } catch (e) {}
  }
});

client.login(process.env.DISCORD_TOKEN);