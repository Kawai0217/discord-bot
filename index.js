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
  AttachmentBuilder
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
  { keywords: ['챌린저', '챌'], code: 'C', name: 'Challenger', priority: 1, color: '#F4C430' },
  { keywords: ['그랜드마스터', '그마'], code: 'GM', name: 'Grandmaster', priority: 2, color: '#CD7F32' },
  { keywords: ['마스터', '마'], code: 'M', name: 'Master', priority: 3, color: '#9932CC' },
  { keywords: ['다이아몬드', '다이아', '다'], code: 'D', name: 'Diamond', priority: 4, color: '#00BFFF' },
  { keywords: ['에메랄드', '에메', '에'], code: 'E', name: 'Emerald', priority: 5, color: '#2E8B57' },
  { keywords: ['플래티넘', '플레티넘', '플래', '플레', '플'], code: 'P', name: 'Platinum', priority: 6, color: '#20B2AA' },
  { keywords: ['골드', '골'], code: 'G', name: 'Gold', priority: 7, color: '#FFD700' },
  { keywords: ['실버', '실'], code: 'S', name: 'Silver', priority: 8, color: '#C0C0C0' },
  { keywords: ['브론즈', '브'], code: 'B', name: 'Bronze', priority: 9, color: '#CD853F' },
  { keywords: ['아이언', '아'], code: 'I', name: 'Iron', priority: 10, color: '#708090' },
  { keywords: ['언랭'], code: 'U', name: 'Unranked', priority: 11, color: '#808080' }
];

const lineKeywords = ['탑', '정글', '미드', '원딜', '서폿'];

// 유저 정보 분석 헬퍼 함수
async function getUserProfileInfo(guild, user) {
  try {
    const member = await guild.members.fetch(user.id);
    const userRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

    let matchedTier = { code: 'U', name: 'Unranked', priority: 11, color: '#808080' };
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
      matchedTier: { code: 'U', name: 'Unranked', color: '#808080' }, 
      lineText: '정보 없음' 
    };
  }
}

// 🎨 background.png와 font.ttf를 활용한 커스텀 프로필 카드 생성 함수
async function generateProfileCard(user, displayName, matchedTier, lineText, points, warns) {
  const canvas = createCanvas(800, 450);
  const ctx = canvas.getContext('2d');

  // 1. 배경 이미지(background.png) 불러오기
  try {
    const bgImage = await loadImage(path.join(__dirname, 'background.png'));
    ctx.drawImage(bgImage, 0, 0, 800, 450);
  } catch (e) {
    ctx.fillStyle = '#111318';
    ctx.fillRect(0, 0, 800, 450);
  }

  // 2. 유저 프로필 아바타 원형으로 그리기
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
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(105, 135, 56, 0, Math.PI * 2, true);
    ctx.stroke();
  } catch (e) {
    ctx.fillStyle = '#444';
    ctx.beginPath();
    ctx.arc(105, 135, 55, 0, Math.PI * 2, true);
    ctx.fill();
  }

  // 3. 둥근모꼴 폰트로 텍스트 레이아웃 배치
  ctx.fillStyle = '#ffffff';
  ctx.font = '26px CustomFont';
  ctx.fillText(displayName, 185, 115);

  ctx.font = '18px CustomFont';
  ctx.fillStyle = '#d0d0d0';
  ctx.fillText(`티어 : ${matchedTier.name} [${matchedTier.code}]`, 185, 155);
  ctx.fillText(`주요 라인 : ${lineText}`, 185, 190);

  ctx.font = '18px CustomFont';
  ctx.fillStyle = '#57F287';
  ctx.fillText(`보유 포인트 : ${points.toLocaleString()} P`, 185, 270);

  ctx.fillStyle = warns > 0 ? '#ED4245' : '#ffffff';
  ctx.fillText(`누적 경고 : ${warns}회`, 480, 270);

  return canvas.toBuffer();
}

// 슬래시 명령어 정의
const commands = [
  new SlashCommandBuilder()
    .setName('프로필')
    .setDescription('자신 또는 다른 유저의 레트로 프로필 카드를 확인합니다.')
    .addUserOption(option => 
      option.setName('대상').setDescription('조회할 유저 (비워두면 본인 프로필 조회)').setRequired(false)),

  new SlashCommandBuilder().setName('출석').setDescription('하루에 한 번 출석체크를 하고 50 포인트를 받습니다!'),
  new SlashCommandBuilder().setName('포인트').setDescription('포인트를 확인합니다.').addUserOption(option => option.setName('대상').setDescription('조회할 유저').setRequired(false)),
  new SlashCommandBuilder().setName('포인트순위').setDescription('서버 내 포인트 Top 10 순위를 확인합니다.'),
  new SlashCommandBuilder().setName('경고확인').setDescription('유저의 현재 경고 횟수를 확인합니다.').addUserOption(option => option.setName('대상').setDescription('조회할 유저').setRequired(false)),
  new SlashCommandBuilder().setName('상점').setDescription('포인트로 구매 가능한 상점 목록을 확인합니다.'),
  new SlashCommandBuilder().setName('상점구매').setDescription('포인트를 사용하여 상점의 상품을 구매합니다.').addStringOption(option => option.setName('상품이름').setDescription('상품 이름').setRequired(true)),

  new SlashCommandBuilder().setName('포인트로그설정').setDescription('포인트 로그 채널 설정 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(option => option.setName('채널').setDescription('채널').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName('경고로그설정').setDescription('경고 로그 채널 설정 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addChannelOption(option => option.setName('채널').setDescription('채널').addChannelTypes(ChannelType.GuildText).setRequired(true)),
  new SlashCommandBuilder().setName('내전인원').setDescription('내전 참가자 명단 확인 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('명단초기화').setDescription('명단 초기화 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('포인트지급').setDescription('포인트 지급 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setRequired(true)).addIntegerOption(option => option.setName('포인트').setRequired(true)),
  new SlashCommandBuilder().setName('경고').setDescription('경고 부여 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setRequired(true)).addStringOption(option => option.setName('사유')),
  new SlashCommandBuilder().setName('경고차감').setDescription('경고 차감 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setRequired(true)),
  new SlashCommandBuilder().setName('내전정지').setDescription('내전 정지 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setRequired(true)).addStringOption(option => option.setName('사유')),
  new SlashCommandBuilder().setName('내전정지해제').setDescription('정지 해제 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(option => option.setName('대상').setRequired(true)),
  new SlashCommandBuilder().setName('상점등록').setDescription('상점 등록 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addRoleOption(option => option.setName('역할').setRequired(true)).addIntegerOption(option => option.setName('가격').setRequired(true)).addStringOption(option => option.setName('설명')),
  new SlashCommandBuilder().setName('상점삭제').setDescription('상점 삭제 (관리자 전용)').setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addRoleOption(option => option.setName('역할').setRequired(true))
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} 봇 준비 완료!`);
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
          if (member && role) await member.roles.add(role);
        } catch (err) {}
        delete bansData[guildId][userId];
        hasChanged = true;
      }
    }
  }
  if (hasChanged) saveData(BANS_FILE, bansData);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, options, user, guild } = interaction;
  const pointsData = loadData(POINTS_FILE);
  if (!pointsData[guildId]) pointsData[guildId] = {};
  const warningsData = loadData(WARNINGS_FILE);
  if (!warningsData[guildId]) warningsData[guildId] = {};

  // --- [/프로필] ---
  if (commandName === '프로필') {
    // 1단계: 응답 지연을 방지하기 위해 먼저 빠른 deferReply 실행
    await interaction.deferReply();

    const targetUser = options.getUser('대상') || user;
    const { displayName, matchedTier, lineText } = await getUserProfileInfo(guild, targetUser);
    const userPoints = pointsData[guildId][targetUser.id] || 0;
    const userWarns = warningsData[guildId][targetUser.id] || 0;

    try {
      // 2단계: 이미지를 그린 후 안전하게 editReply로 전송
      const cardBuffer = await generateProfileCard(targetUser, displayName, matchedTier, lineText, userPoints, userWarns);
      const attachment = new AttachmentBuilder(cardBuffer, { name: 'retro-profile.png' });
      return await interaction.editReply({ files: [attachment] });
    } catch (err) {
      console.error('프로필 이미지 생성 오류:', err);
      return await interaction.editReply({ content: '⚠️ 프로필 명함 카드를 생성하는 도중 오류가 발생했습니다.' });
    }
  }

  // --- [/출석] ---
  if (commandName === '출석') {
    const todayStr = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    const attendanceData = loadData(ATTENDANCE_FILE);
    if (!attendanceData[guildId]) attendanceData[guildId] = {};

    if (attendanceData[guildId][user.id] === todayStr) {
      return interaction.reply({ content: '⚠️ 오늘은 이미 출석체크를 완료하셨습니다!', ephemeral: true });
    }
    attendanceData[guildId][user.id] = todayStr;
    saveData(ATTENDANCE_FILE, attendanceData);

    const currentPoints = pointsData[guildId][user.id] || 0;
    const newPoints = currentPoints + 50;
    pointsData[guildId][user.id] = newPoints;
    saveData(POINTS_FILE, pointsData);

    return interaction.reply({ content: `📅 출석체크 완료! **50 P**가 지급되었습니다. (보유: ${newPoints} P)` });
  }

  // --- [/포인트] ---
  if (commandName === '포인트') {
    const targetUser = options.getUser('대상') || user;
    const userPoints = pointsData[guildId][targetUser.id] || 0;
    return interaction.reply({ content: `<@${targetUser.id}> 님의 현재 포인트는 **${userPoints.toLocaleString()} P** 입니다.` });
  }

  // --- [/포인트순위] ---
  if (commandName === '포인트순위') {
    const serverPoints = pointsData[guildId] || {};
    const sortedUsers = Object.keys(serverPoints)
      .map(userId => ({ userId, points: serverPoints[userId] }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);

    if (sortedUsers.length === 0) {
      return interaction.reply({ content: '등록된 포인트 데이터가 없습니다!', ephemeral: true });
    }

    let rankingText = '';
    sortedUsers.forEach((item, index) => {
      rankingText += `**${index + 1위}** <@${item.userId}> - **${item.points.toLocaleString()} P**\n`;
    });

    const embed = new EmbedBuilder().setColor('#FEE75C').setTitle('🏆 포인트 순위 Top 10').setDescription(rankingText);
    return interaction.reply({ embeds: [embed] });
  }

  // --- [/경고확인] ---
  if (commandName === '경고확인') {
    const targetUser = options.getUser('대상') || user;
    const userWarns = warningsData[guildId][targetUser.id] || 0;
    return interaction.reply({ content: `<@${targetUser.id}> 님의 현재 경고 횟수는 **${userWarns} / 3 회** 입니다.` });
  }
});

client.login(process.env.DISCORD_TOKEN);