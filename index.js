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
  ChannelType
} = require('discord.js');

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

// 📌 [설정] 내전 역할 이름
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

// 음성방 체류 시간 누적 관리용 메모리 객체
const voiceTimeTracker = {};

// 포인트 로그 전송 함수
async function sendPointLog(guild, title, description, color = '#5865F2') {
  try {
    const logConfig = loadData(LOG_CONFIG_FILE);
    const channelId = logConfig[guild.id];
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`📊 ${title}`)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('포인트 로그 전송 실패:', err);
  }
}

// 경고 로그 전송 함수
async function sendWarningLog(guild, title, description, color = '#ED4245') {
  try {
    const logConfig = loadData(WARNING_LOG_CONFIG_FILE);
    const channelId = logConfig[guild.id];
    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🚨 ${title}`)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('경고 로그 전송 실패:', err);
  }
}

// 디스코드 역할 이름 매칭 패턴 정의
const tierInfo = [
  { keywords: ['챌린저', '챌'], code: 'C', name: '챌린저', priority: 1, color: '#F4C430' },
  { keywords: ['그랜드마스터', '그마'], code: 'GM', name: '그랜드마스터', priority: 2, color: '#CD7F32' },
  { keywords: ['마스터', '마'], code: 'M', name: '마스터', priority: 3, color: '#9932CC' },
  { keywords: ['다이아몬드', '다이아', '다'], code: 'D', name: '다이아몬드', priority: 4, color: '#00BFFF' },
  { keywords: ['에메랄드', '에메', '에'], code: 'E', name: '에메랄드', priority: 5, color: '#2E8B57' },
  { keywords: ['플래티넘', '플레티넘', '플래', '플레', '플'], code: 'P', name: '플래티넘', priority: 6, color: '#20B2AA' },
  { keywords: ['골드', '골'], code: 'G', name: '골드', priority: 7, color: '#FFD700' },
  { keywords: ['실버', '실'], code: 'S', name: '실버', priority: 8, color: '#C0C0C0' },
  { keywords: ['브론즈', '브'], code: 'B', name: '브론즈', priority: 9, color: '#CD853F' },
  { keywords: ['아이언', '아'], code: 'I', name: '아이언', priority: 10, color: '#708090' },
  { keywords: ['언랭'], code: 'U', name: '언랭크', priority: 11, color: '#808080' }
];

const lineKeywords = ['탑', '정글', '미드', '원딜', '서폿'];

// 유저 정보 분석 헬퍼 함수
async function getUserProfileInfo(guild, user) {
  try {
    const member = await guild.members.fetch(user.id);
    const userRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

    let matchedTier = { code: 'U', name: '언랭크', priority: 11, color: '#808080' };
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
      matchedTier: { code: 'U', name: '언랭크', color: '#808080' }, 
      lineText: '정보 없음' 
    };
  }
}

// 슬래시 명령어 정의
const commands = [
  new SlashCommandBuilder()
    .setName('프로필')
    .setDescription('자신 또는 다른 유저의 내전 프로필 정보를 확인합니다.')
    .addUserOption(option => 
      option.setName('대상').setDescription('조회할 유저 (비워두면 본인 프로필 조회)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('출석')
    .setDescription('하루에 한 번 출석체크를 하고 50 포인트를 받습니다!'),

  new SlashCommandBuilder()
    .setName('포인트')
    .setDescription('포인트를 확인합니다.')
    .addUserOption(option => 
      option.setName('대상').setDescription('조회할 유저 (비워두면 본인 조회)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('포인트순위')
    .setDescription('서버 내 포인트 Top 10 순위를 확인합니다.'),

  new SlashCommandBuilder()
    .setName('경고확인')
    .setDescription('유저의 현재 경고 횟수를 확인합니다.')
    .addUserOption(option => 
      option.setName('대상').setDescription('조회할 유저 (비워두면 본인 조회)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('상점')
    .setDescription('포인트로 구매 가능한 상점 목록을 확인합니다.'),

  new SlashCommandBuilder()
    .setName('상점구매')
    .setDescription('포인트를 사용하여 상점의 상품을 구매합니다.')
    .addStringOption(option =>
      option.setName('상품이름')
        .setDescription('구매할 상품이름(경고차감권, 커스텀역할, 강의권 또는 등록된 역할)을 입력하세요.')
        .setRequired(true)),

  // --- 관리자 전용 명령어 ---
  new SlashCommandBuilder()
    .setName('포인트로그설정')
    .setDescription('관리자 포인트 지급/차감 및 음성 보상 로그가 출력될 채널을 설정합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option.setName('채널')
        .setDescription('포인트 로그를 출력할 텍스트 채널을 선택하세요.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('경고로그설정')
    .setDescription('경고 지급 및 차감 로그가 출력될 채널을 설정합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option =>
      option.setName('채널')
        .setDescription('경고 로그를 출력할 텍스트 채널을 선택하세요.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('내전인원')
    .setDescription('현재 게시글의 내전 참가자 명단을 티어/역할순으로 확인합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('명단초기화')
    .setDescription('현재 게시글의 참가자 명단을 초기화합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('포인트지급')
    .setDescription('유저에게 포인트를 지급하거나 차감합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('포인트를 받을 유저').setRequired(true))
    .addIntegerOption(option => 
      option.setName('포인트').setDescription('지급할 포인트 (음수 입력 시 차감)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('경고')
    .setDescription('유저에게 경고를 부여합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('경고를 줄 유저').setRequired(true))
    .addStringOption(option => 
      option.setName('사유').setDescription('경고 부여 사유').setRequired(false)),

  new SlashCommandBuilder()
    .setName('경고차감')
    .setDescription('유저의 경고를 1회 차감합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('경고를 차감할 유저').setRequired(true)),

  new SlashCommandBuilder()
    .setName('내전정지')
    .setDescription('유저의 내전 역할을 7일 동안 박탈합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('내전 정지할 유저').setRequired(true))
    .addStringOption(option => 
      option.setName('사유').setDescription('정지 사유').setRequired(false)),

  new SlashCommandBuilder()
    .setName('내전정지해제')
    .setDescription('유저의 내전 정지를 즉시 해제합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('정지 해제할 유저').setRequired(true)),

  new SlashCommandBuilder()
    .setName('상점등록')
    .setDescription('상점에 판매할 역할을 등록합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option.setName('역할').setDescription('상점에 등록할 역할을 선택하세요.').setRequired(true))
    .addIntegerOption(option =>
      option.setName('가격').setDescription('역할의 가격(포인트)을 입력하세요.').setRequired(true))
    .addStringOption(option =>
      option.setName('설명').setDescription('역할 설명을 입력하세요.').setRequired(false)),

  new SlashCommandBuilder()
    .setName('상점삭제')
    .setDescription('상점에서 역할을 삭제합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addRoleOption(option =>
      option.setName('역할').setDescription('상점에서 삭제할 역할을 선택하세요.').setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} 봇이 준비 완료되었습니다!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    const guilds = client.guilds.cache.map(guild => guild.id);
    for (const guildId of guilds) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
    }
    console.log('✅ 슬래시 명령어 등록 완료!');
  } catch (error) {
    console.error('명령어 등록 오류:', error);
  }

  setInterval(checkExpiredBans, 60 * 1000);
  setInterval(checkVoiceChannels, 60 * 1000);
});

// 음성 채널 체류 시간 및 포인트 지급 백그라운드 함수
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
          if (!voiceTimeTracker[guildId][userId]) {
            voiceTimeTracker[guildId][userId] = 0;
          }

          voiceTimeTracker[guildId][userId] += 1;

          if (voiceTimeTracker[guildId][userId] >= 60) {
            voiceTimeTracker[guildId][userId] = 0;

            const currentPoints = pointsData[guildId][userId] || 0;
            pointsData[guildId][userId] = currentPoints + 10;
            saveData(POINTS_FILE, pointsData);

            await sendPointLog(
              guild, 
              '음성 채널 보상 지급', 
              `<@${userId}> 님이 음성 채널 체류 1시간을 달성하여 **+10 P**를 획득했습니다. (보유 포인트: ${newPoints.toLocaleString()} P)`, 
              '#57F287'
            );
          }
        });
      }
    });
  });
}

// 내전 정지 만료 유저 자동 역할 복구 함수
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
        } catch (err) {
          console.error(`역할 복구 에러 (${userId}):`, err);
        }

        delete bansData[guildId][userId];
        hasChanged = true;
      }
    }
  }

  if (hasChanged) {
    saveData(BANS_FILE, bansData);
  }
}

// 서버 대표(Owner)에게 DM 알림을 보내는 함수
async function notifyOwner(guild, buyer, itemName, price, extraInfo = '') {
  try {
    const owner = await guild.fetchOwner();
    if (!owner) return;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🛒 상점 상품 구매 알림')
      .setDescription(`서버 **[${guild.name}]**에서 새로운 상품 구매가 발생했습니다!`)
      .addFields(
        { name: '구매자', value: `<@${buyer.id}> (${buyer.tag})`, inline: true },
        { name: '구매 상품', value: `**${itemName}**`, inline: true },
        { name: '결제 금액', value: `**${price.toLocaleString()} P**`, inline: true }
      );

    if (extraInfo) {
      embed.addFields({ name: '추가 정보', value: extraInfo });
    }

    embed.setTimestamp();
    await owner.send({ embeds: [embed] });
  } catch (err) {
    console.error('서버 대표 DM 전송 실패:', err);
  }
}

// 채팅 감지 이벤트 ('ㅅ', '손', 't')
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

// 슬래시 명령어 처리
client.on('interactionCreate', async interaction => {
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
  if (!shopData[guildId].userTicketCounts) shopData[guildId].userTicketCounts = {};

  const attendanceData = loadData(ATTENDANCE_FILE);
  if (!attendanceData[guildId]) attendanceData[guildId] = {};

  const participantsData = loadData(PARTICIPANTS_FILE);
  if (!participantsData[guildId]) participantsData[guildId] = {};
  if (!participantsData[guildId][channelId]) participantsData[guildId][channelId] = [];

  // --- [/프로필] ---
  if (commandName === '프로필') {
    const targetUser = options.getUser('대상') || user;
    const { displayName, matchedTier, lineText } = await getUserProfileInfo(guild, targetUser);
    const userPoints = pointsData[guildId][targetUser.id] || 0;
    const userWarns = warningsData[guildId][targetUser.id] || 0;

    const embed = new EmbedBuilder()
      .setColor(matchedTier.color)
      .setAuthor({ name: `${displayName} 님의 내전 프로필`, iconURL: targetUser.displayAvatarURL() })
      .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '🎖️ 티어', value: `**${matchedTier.name} [${matchedTier.code}]**`, inline: true },
        { name: '⚔️ 주요 라인', value: `**${lineText}**`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '💳 보유 포인트', value: `**${userPoints.toLocaleString()} P**`, inline: true },
        { name: '⚠️ 경고 횟수', value: `**${userWarns} / 3회**`, inline: true },
        { name: '\u200b', value: '\u200b', inline: true }
      )
      // 🎮 리그 오브 레전드 공식 월페이퍼(소환사의 협곡 배경)를 하단 배너 이미지로 추가
      .setImage('https://images.contentstack.io/v3/assets/blt731acdce42bb0d6f/blt13e77f0c13fa094d/6308cf2436f563503dc6619a/091322_LoL_MF_Update_Banner.jpg')
      .setTimestamp()
      .setFooter({ text: '리그 오브 레전드 내전 시스템' });

    return interaction.reply({ embeds: [embed] });
  }

  // --- [/포인트로그설정] ---
  if (commandName === '포인트로그설정') {
    const targetChannel = options.getChannel('채널');
    const logConfig = loadData(LOG_CONFIG_FILE);

    logConfig[guildId] = targetChannel.id;
    saveData(LOG_CONFIG_FILE, logConfig);

    return interaction.reply({ 
      content: `✅ 포인트 로그 채널이 <#${targetChannel.id}> (으)로 설정되었습니다!`, 
      ephemeral: true 
    });
  }

  // --- [/경고로그설정] ---
  if (commandName === '경고로그설정') {
    const targetChannel = options.getChannel('채널');
    const warningLogConfig = loadData(WARNING_LOG_CONFIG_FILE);

    warningLogConfig[guildId] = targetChannel.id;
    saveData(WARNING_LOG_CONFIG_FILE, warningLogConfig);

    return interaction.reply({ 
      content: `✅ 경고 로그 채널이 <#${targetChannel.id}> (으)로 설정되었습니다!`, 
      ephemeral: true 
    });
  }

  // --- [/출석] ---
  if (commandName === '출석') {
    const todayStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    
    if (!attendanceData[guildId][user.id]) {
      attendanceData[guildId][user.id] = '';
    }

    if (attendanceData[guildId][user.id] === todayStr) {
      return interaction.reply({ content: '⚠️ 오늘은 이미 출석체크를 완료하셨습니다! 내일 다시 시도해주세요.', ephemeral: true });
    }

    attendanceData[guildId][user.id] = todayStr;
    saveData(ATTENDANCE_FILE, attendanceData);

    const currentPoints = pointsData[guildId][user.id] || 0;
    const newPoints = currentPoints + 50;
    pointsData[guildId][user.id] = newPoints;
    saveData(POINTS_FILE, pointsData);

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('📅 출석체크 완료!')
      .setDescription(`<@${user.id}> 님의 오늘의 출석이 완료되었습니다. **50 P**가 지급되었습니다!`)
      .addFields(
        { name: '지급 포인트', value: `+50 P`, inline: true },
        { name: '내 보유 포인트', value: `${newPoints.toLocaleString()} P`, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // [/내전인원]
  if (commandName === '내전인원') {
    await interaction.deferReply();
    const embed = await buildEmbed(guild, participantsData[guildId][channelId]);
    await interaction.editReply({ embeds: [embed] });
  }

  // [/명단초기화]
  if (commandName === '명단초기화') {
    participantsData[guildId][channelId] = [];
    saveData(PARTICIPANTS_FILE, participantsData);
    await interaction.reply('🔄 현재 게시글의 내전 참가자 명단이 초기화되었습니다!');
  }

  // [/포인트지급]
  if (commandName === '포인트지급') {
    const targetUser = options.getUser('대상');
    const amount = options.getInteger('포인트');

    const currentPoints = pointsData[guildId][targetUser.id] || 0;
    const newPoints = currentPoints + amount;

    pointsData[guildId][targetUser.id] = newPoints;
    saveData(POINTS_FILE, pointsData);

    const actionType = amount >= 0 ? '관리자 포인트 지급' : '관리자 포인트 차감';
    const logColor = amount >= 0 ? '#57F287' : '#ED4245';
    await sendPointLog(
      guild, 
      actionType, 
      `**관리자:** <@${user.id}>\n**대상:** <@${targetUser.id}>\n**변동:** **${amount.toLocaleString()} P** (${amount >= 0 ? '지급' : '차감'})\n(이전: ${currentPoints.toLocaleString()} P ➔ 현재: ${newPoints.toLocaleString()} P)`, 
      logColor
    );

    const embed = new EmbedBuilder()
      .setColor(amount >= 0 ? '#57F287' : '#ED4245')
      .setTitle('💰 포인트 변동 완료')
      .setDescription(`<@${targetUser.id}> 님에게 **${amount.toLocaleString()} P**를 ${amount >= 0 ? '지급' : '차감'}했습니다.`)
      .addFields(
        { name: '이전 포인트', value: `${currentPoints.toLocaleString()} P`, inline: true },
        { name: '현재 포인트', value: `${newPoints.toLocaleString()} P`, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // [/포인트]
  if (commandName === '포인트') {
    const targetUser = options.getUser('대상') || user;
    const userPoints = pointsData[guildId][targetUser.id] || 0;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
      .setTitle('💳 포인트 조회')
      .setDescription(`<@${targetUser.id}> 님의 현재 포인트는 **${userPoints.toLocaleString()} P** 입니다.`)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // [/포인트순위]
  if (commandName === '포인트순위') {
    const serverPoints = pointsData[guildId] || {};
    
    const sortedUsers = Object.keys(serverPoints)
      .map(userId => ({ userId, points: serverPoints[userId] }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);

    if (sortedUsers.length === 0) {
      return interaction.reply({ content: '등록된 포인트 데이터가 없습니다!', ephemeral: true });
    }

    const medals = ['🥇', '🥈', '🥉'];
    let rankingText = '';

    sortedUsers.forEach((item, index) => {
      const rankTag = medals[index] || `**${index + 1}위**`;
      rankingText += `${rankTag} <@${item.userId}> - **${item.points.toLocaleString()} P**\n`;
    });

    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('🏆 포인트 순위 Top 10')
      .setDescription(rankingText)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // [/경고]
  if (commandName === '경고') {
    const targetUser = options.getUser('대상');
    const reason = options.getString('사유') || '사유 미기재';

    const currentWarns = (warningsData[guildId][targetUser.id] || 0) + 1;
    warningsData[guildId][targetUser.id] = currentWarns;
    saveData(WARNINGS_FILE, warningsData);

    await sendWarningLog(
      guild, 
      '경고 부여', 
      `**관리자:** <@${user.id}>\n**대상:** <@${targetUser.id}>\n**현재 경고:** **${currentWarns} / 3 회**\n**사유:** ${reason}`, 
      '#FEE75C'
    );

    if (currentWarns >= 3) {
      try {
        const member = await guild.members.fetch(targetUser.id);
        if (member) {
          await member.ban({ reason: `경고 3회 누적 (사유: ${reason})` });
        }

        await sendWarningLog(
          guild, 
          '경고 3회 누적 - 서버 차단', 
          `**대상:** <@${targetUser.id}> 님이 경고 3회를 누적하여 서버에서 자동 차단(Ban)되었습니다.`, 
          '#ED4245'
        );

        const embed = new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('🚨 경고 3회 누적 - 서버 자동 차단')
          .setDescription(`<@${targetUser.id}> 님이 경고 **3회**를 채워 서버에서 **자동 차단(Ban)** 처리되었습니다.`)
          .addFields({ name: '최근 경고 사유', value: reason })
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      } catch (err) {
        return interaction.reply({ 
          content: `⚠️ <@${targetUser.id}> 님의 경고가 3회가 되었지만 차단에 실패했습니다.`, 
          ephemeral: true 
        });
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('⚠️ 경고 부여')
      .setDescription(`<@${targetUser.id}> 님에게 경고 1회를 부여했습니다.`)
      .addFields(
        { name: '현재 경고 횟수', value: `**${currentWarns}** / 3 회`, inline: true },
        { name: '사유', value: reason, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // [/경고차감]
  if (commandName === '경고차감') {
    const targetUser = options.getUser('대상');
    const currentWarns = warningsData[guildId][targetUser.id] || 0;

    if (currentWarns <= 0) {
      return interaction.reply({ content: `<@${targetUser.id}> 님은 차감할 경고가 없습니다!`, ephemeral: true });
    }

    const newWarns = currentWarns - 1;
    warningsData[guildId][targetUser.id] = newWarns;
    saveData(WARNINGS_FILE, warningsData);

    await sendWarningLog(
      guild, 
      '경고 차감', 
      `**관리자:** <@${user.id}>\n**대상:** <@${targetUser.id}>\n**변동:** 경고 1회 차감 (이전: ${currentWarns}회 ➔ 현재: **${newWarns}회**)`, 
      '#57F287'
    );

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('🟢 경고 차감')
      .setDescription(`<@${targetUser.id}> 님의 경고를 1회 차감했습니다.`)
      .addFields(
        { name: '이전 경고', value: `${currentWarns}회`, inline: true },
        { name: '현재 경고', value: `**${newWarns}**회`, inline: true }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // [/경고확인]
  if (commandName === '경고확인') {
    const targetUser = options.getUser('대상') || user;
    const userWarns = warningsData[guildId][targetUser.id] || 0;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setAuthor({ name: targetUser.username, iconURL: targetUser.displayAvatarURL() })
      .setTitle('📋 경고 조회')
      .setDescription(`<@${targetUser.id}> 님의 현재 경고 횟수는 **${userWarns} / 3 회** 입니다.`)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // [/내전정지]
  if (commandName === '내전정지') {
    const targetUser = options.getUser('대상');
    const reason = options.getString('사유') || '사유 미기재';

    try {
      const member = await guild.members.fetch(targetUser.id);
      const targetRole = guild.roles.cache.find(r => r.name === CIVIL_WAR_ROLE_NAME);

      if (!targetRole) {
        return interaction.reply({ content: `⚠️ 서버에서 **'${CIVIL_WAR_ROLE_NAME}'** 역할을 찾을 수 없습니다.`, ephemeral: true });
      }

      if (!member.roles.cache.has(targetRole.id)) {
        return interaction.reply({ content: `<@${targetUser.id}> 님은 이미 역할을 가지고 있지 않습니다.`, ephemeral: true });
      }

      await member.roles.remove(targetRole);

      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const unbanTime = Date.now() + SEVEN_DAYS_MS;
      const unbanDateStr = new Date(unbanTime).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

      bansData[guildId][targetUser.id] = {
        roleId: targetRole.id,
        unbanTime: unbanTime,
        reason: reason
      };
      saveData(BANS_FILE, bansData);

      const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🚫 내전 참가 정지 (7일)')
        .setDescription(`<@${targetUser.id}> 님의 **'${CIVIL_WAR_ROLE_NAME}'** 역할을 회수했습니다.`)
        .addFields(
          { name: '사유', value: reason },
          { name: '자동 해제 일시', value: `**${unbanDateStr}**` }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });

    } catch (err) {
      return interaction.reply({ content: '⚠️ 내전 정지 처리 중 오류가 발생했습니다.', ephemeral: true });
    }
  }

  // [/내전정지해제]
  if (commandName === '내전정지해제') {
    const targetUser = options.getUser('대상');

    if (!bansData[guildId] || !bansData[guildId][targetUser.id]) {
      return interaction.reply({ content: `<@${targetUser.id}> 님은 내전 정지 상태가 아닙니다!`, ephemeral: true });
    }

    try {
      const member = await guild.members.fetch(targetUser.id);
      const banInfo = bansData[guildId][targetUser.id];
      const targetRole = guild.roles.cache.get(banInfo.roleId);

      if (targetRole && member) {
        await member.roles.add(targetRole);
      }

      delete bansData[guildId][targetUser.id];
      saveData(BANS_FILE, bansData);

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🟢 내전 정지 조기 해제')
        .setDescription(`<@${targetUser.id}> 님의 내전 정지를 해제했습니다.`)
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });

    } catch (err) {
      return interaction.reply({ content: '⚠️ 내전 정지 해제 중 오류가 발생했습니다.', ephemeral: true });
    }
  }

  // --- [/상점등록] ---
  if (commandName === '상점등록') {
    const role = options.getRole('역할');
    const price = options.getInteger('가격');
    const description = options.getString('설명') || '설명 없음';

    if (price <= 0) {
      return interaction.reply({ content: '⚠️ 가격은 1 포인트 이상이어야 합니다.', ephemeral: true });
    }

    if (!shopData[guildId].items) shopData[guildId].items = {};

    shopData[guildId].items[role.id] = {
      roleId: role.id,
      name: role.name,
      price: price,
      description: description
    };
    saveData(SHOP_FILE, shopData);

    const embed = new EmbedBuilder()
      .setColor('#57F287')
      .setTitle('🛒 상점 역할 등록 완료')
      .setDescription(`<@&${role.id}> 역할을 상점에 등록했습니다.`)
      .addFields(
        { name: '역할 이름', value: role.name, inline: true },
        { name: '판매 가격', value: `${price.toLocaleString()} P`, inline: true },
        { name: '설명', value: description }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // --- [/상점삭제] ---
  if (commandName === '상점삭제') {
    const role = options.getRole('역할');

    if (!shopData[guildId].items || !shopData[guildId].items[role.id]) {
      return interaction.reply({ content: `⚠️ <@&${role.id}> 역할은 상점에 등록되어 있지 않습니다.`, ephemeral: true });
    }

    delete shopData[guildId].items[role.id];
    saveData(SHOP_FILE, shopData);

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('🗑️ 상점 역할 삭제 완료')
      .setDescription(`<@&${role.id}> 역할을 상점 목록에서 삭제했습니다.`)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // --- [/상점] ---
  if (commandName === '상점') {
    const itemsObj = shopData[guildId].items || {};
    const items = Object.values(itemsObj);

    const userCounts = shopData[guildId].userTicketCounts || {};
    const myBuyCount = userCounts[user.id] || 0;
    const nextTicketPrice = 3000 + (myBuyCount * 2000);

    let itemListText = `**1. 🎟️ 경고 차감권** - \`${nextTicketPrice.toLocaleString()} P\` *(내 구매 횟수: ${myBuyCount}회)*\n┗ 구매 즉시 누적된 경고 1회가 자동으로 차감됩니다. (재구매 시마다 2,000 P씩 증가)\n\n`;
    itemListText += `**2. 🏷️ 커스텀역할** - \`30,000 P\`\n┗ 본인이 원하는 커스텀 역할을 신청할 수 있습니다.\n\n`;
    itemListText += `**3. 📚 강의권** - \`5,000 P\`\n┗ 강의를 받을 수 있는 수강권을 획득합니다.\n\n`;

    let idxOffset = 4;
    if (items.length > 0) {
      items.forEach((item) => {
        itemListText += `**${idxOffset}. <@&${item.roleId}>** - \`${item.price.toLocaleString()} P\`\n┗ ${item.description}\n\n`;
        idxOffset++;
      });
    }

    const userPoints = pointsData[guildId][user.id] || 0;

    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('🛒 포인트 상점')
      .setDescription(itemListText)
      .addFields({ name: '💳 내 보유 포인트', value: `**${userPoints.toLocaleString()} P**` })
      .setFooter({ text: '구매를 원하시면 /상점구매 명령어를 사용해주세요! (예: /상점구매 상품이름: 커스텀역할)' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // --- [/상점구매] ---
  if (commandName === '상점구매') {
    const query = options.getString('상품이름').trim().toLowerCase();
    const userPoints = pointsData[guildId][user.id] || 0;

    if (!shopData[guildId].userTicketCounts) shopData[guildId].userTicketCounts = {};

    if (query === '경고차감권' || query === '경고 차감권') {
      const currentWarns = warningsData[guildId][user.id] || 0;

      if (currentWarns <= 0) {
        return interaction.reply({ content: '⚠️ 현재 차감될 경고가 없습니다! (경고 0회)', ephemeral: true });
      }

      const buyCount = shopData[guildId].userTicketCounts[user.id] || 0;
      const price = 3000 + (buyCount * 2000);

      if (userPoints < price) {
        return interaction.reply({ content: `⚠️ 포인트가 부족합니다! (필요: **${price.toLocaleString()} P** / 보유: **${userPoints.toLocaleString()} P**)`, ephemeral: true });
      }

      pointsData[guildId][user.id] = userPoints - price;
      saveData(POINTS_FILE, pointsData);

      shopData[guildId].userTicketCounts[user.id] = buyCount + 1;
      saveData(SHOP_FILE, shopData);

      const newWarns = currentWarns - 1;
      warningsData[guildId][user.id] = newWarns;
      saveData(WARNINGS_FILE, warningsData);

      await notifyOwner(guild, user, '경고 차감권', price, `남은 경고: ${newWarns}회`);

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🎟️ 경고 차감권 구매 완료!')
        .setDescription(`<@${user.id}> 님이 **경고 차감권**을 사용하여 경고가 **1회** 차감되었습니다.`)
        .addFields(
          { name: '사용한 포인트', value: `-${price.toLocaleString()} P`, inline: true },
          { name: '남은 포인트', value: `${(userPoints - price).toLocaleString()} P`, inline: true },
          { name: '현재 경고 횟수', value: `**${newWarns}회**`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (query === '커스텀역할' || query === '커스텀 역할') {
      const price = 30000;

      if (userPoints < price) {
        return interaction.reply({ content: `⚠️ 포인트가 부족합니다! (필요: **30,000 P** / 보유: **${userPoints.toLocaleString()} P**)`, ephemeral: true });
      }

      pointsData[guildId][user.id] = userPoints - price;
      saveData(POINTS_FILE, pointsData);

      await notifyOwner(guild, user, '커스텀역할', price, '유저가 커스텀 역할을 신청했습니다. 개별 문의를 확인해주세요!');

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🏷️ 커스텀역할 구매 완료!')
        .setDescription(`<@${user.id}> 님이 **커스텀역할**을 구매하셨습니다! 서버 관리자(대표)에게 알림이 전송되었습니다.`)
        .addFields(
          { name: '사용한 포인트', value: `-30,000 P`, inline: true },
          { name: '남은 포인트', value: `${(userPoints - price).toLocaleString()} P`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (query === '강의권' || query === '강의') {
      const price = 5000;

      if (userPoints < price) {
        return interaction.reply({ content: `⚠️ 포인트가 부족합니다! (필요: **5,000 P** / 보유: **${userPoints.toLocaleString()} P**)`, ephemeral: true });
      }

      pointsData[guildId][user.id] = userPoints - price;
      saveData(POINTS_FILE, pointsData);

      await notifyOwner(guild, user, '강의권', price, '유저가 강의권을 구매했습니다. 일정을 조율해 주세요!');

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('📚 강의권 구매 완료!')
        .setDescription(`<@${user.id}> 님이 **강의권**을 구매하셨습니다! 서버 관리자(대표)에게 알림이 전송되었습니다.`)
        .addFields(
          { name: '사용한 포인트', value: `-5,000 P`, inline: true },
          { name: '남은 포인트', value: `${(userPoints - price).toLocaleString()} P`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    const itemsObj = shopData[guildId].items || {};
    const shopItem = Object.values(itemsObj).find(
      item => item.name.toLowerCase() === query
    );

    if (!shopItem) {
      return interaction.reply({ 
        content: `⚠️ **'${options.getString('상품이름')}'**은(는) 상점에 존재하지 않는 상품입니다. \`/상점\` 목록을 확인해주세요!`, 
        ephemeral: true 
      });
    }

    if (userPoints < shopItem.price) {
      return interaction.reply({ 
        content: `⚠️ 포인트가 부족합니다! (필요: **${shopItem.price.toLocaleString()} P** / 보유: **${userPoints.toLocaleString()} P**)`, 
        ephemeral: true 
      });
    }

    try {
      const member = await guild.members.fetch(user.id);
      const role = guild.roles.cache.get(shopItem.roleId);

      if (!role) {
        return interaction.reply({ content: '⚠️ 서버에서 해당 역할을 찾을 수 없습니다. 관리자에게 문의하세요.', ephemeral: true });
      }

      if (member.roles.cache.has(role.id)) {
        return interaction.reply({ content: `⚠️ 이미 <@&${role.id}> 역할을 보유하고 계십니다!`, ephemeral: true });
      }

      pointsData[guildId][user.id] = userPoints - shopItem.price;
      saveData(POINTS_FILE, pointsData);

      await member.roles.add(role);

      await notifyOwner(guild, user, role.name, shopItem.price, `역할 자동 지급 완료`);

      const embed = new EmbedBuilder()
        .setColor('#57F287')
        .setTitle('🎉 역할 구매 완료!')
        .setDescription(`<@${user.id}> 님이 성공적으로 <@&${role.id}> 역할을 구매하셨습니다!`)
        .addFields(
          { name: '차감 포인트', value: `-${shopItem.price.toLocaleString()} P`, inline: true },
          { name: '남은 포인트', value: `${(userPoints - shopItem.price).toLocaleString()} P`, inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });

    } catch (err) {
      console.error('상점 구매 오류:', err);
      return interaction.reply({ content: '⚠️ 구매 처리 중 오류가 발생했습니다. (봇의 역할 순위가 해당 역할보다 높은지 확인해주세요)', ephemeral: true });
    }
  }
});

// 명단 생성 및 티어 감지 + fow.lol 링크 자동 추출 함수
async function buildEmbed(guild, currentParticipants) {
  let description = '';

  if (!currentParticipants || currentParticipants.length === 0) {
    description = '아직 참가자가 없습니다. 채팅창에 **`ㅅ`** 또는 **`손`**을 입력해 주세요!';
  } else {
    const list = [];

    for (const userId of currentParticipants) {
      try {
        const member = await guild.members.fetch(userId);
        const userRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

        let matchedTier = { code: 'U', priority: 99 };
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
        const displayName = member.nickname || member.user.globalName || member.user.username;

        let fowLink = '';
        const riotIdMatch = displayName.match(/(?:^\d+\s+)?([^#]+#[^\s]+)/);

        if (riotIdMatch) {
          let rawRiotId = riotIdMatch[1].trim(); 
          const parts = rawRiotId.split('#');
          if (parts.length >= 2) {
            const namePart = parts[0].trim();
            const tagPart = parts[1].split(/\s+/)[0];
            const fullRiotId = `${namePart}#${tagPart}`;
            
            const formattedId = fullRiotId.replace('#', '-');
            const encodedUrl = `https://fow.lol/find/${encodeURIComponent(formattedId)}`;
            fowLink = ` ([전적](${encodedUrl}))`;
          }
        }

        list.push({
          displayName,
          tierCode: matchedTier.code,
          priority: matchedTier.priority,
          lineText,
          fowLink
        });
      } catch (err) {
        list.push({
          displayName: `<@${userId}>`,
          tierCode: 'U',
          priority: 99,
          lineText: '정보 오류',
          fowLink: ''
        });
      }
    }

    list.sort((a, b) => a.priority - b.priority);

    list.forEach(p => {
      description += `**[${p.tierCode}]** ${p.displayName} / ${p.lineText}${p.fowLink}\n`;
    });
  }

  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🎮 내전 참가자 명단 (서버 역할 기준 / 티어순)')
    .setDescription(description)
    .setFooter({ text: `총 신청 인원: ${currentParticipants ? currentParticipants.length : 0}명` })
    .setTimestamp();
}

client.login(process.env.DISCORD_TOKEN);