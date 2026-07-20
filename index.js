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

// 티어 정보 정의
const tierInfo = [
  { keywords: ['챌린저', '챌'], code: 'C', name: 'Challenger', color: '#FFD700' },
  { keywords: ['그랜드마스터', '그마'], code: 'GM', name: 'Grandmaster', color: '#FF8C00' },
  { keywords: ['마스터', '마'], code: 'M', name: 'Master', color: '#BA55D3' },
  { keywords: ['다이아몬드', '다이아', '다'], code: 'D', name: 'Diamond', color: '#00BFFF' },
  { keywords: ['에메랄드', '에메', '에'], code: 'E', name: 'Emerald', color: '#00FA9A' },
  { keywords: ['플래티넘', '플레티넘', '플래', '플레', '플'], code: 'P', name: 'Platinum', color: '#20B2AA' },
  { keywords: ['골드', '골'], code: 'G', name: 'Gold', color: '#FFD700' },
  { keywords: ['실버', '실'], code: 'S', name: 'Silver', color: '#C0C0C0' },
  { keywords: ['브론즈', '브'], code: 'B', name: 'Bronze', color: '#CD853F' },
  { keywords: ['아이언', '아'], code: 'I', name: 'Iron', color: '#708090' },
  { keywords: ['언랭'], code: 'U', name: 'Unranked', color: '#808080' }
];

const lineKeywords = ['탑', '정글', '미드', '원딜', '서폿'];

async function getUserProfileInfo(guild, user) {
  try {
    const member = await guild.members.fetch(user.id);
    const userRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

    let matchedTier = { code: 'U', name: 'Unranked', color: '#808080' };
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

// 🎨 글씨 크기를 키우고 가독성을 극대화한 프로필 카드 생성 함수
async function generateProfileCard(user, displayName, matchedTier, lineText, points, warns) {
  const canvas = createCanvas(800, 450);
  const ctx = canvas.getContext('2d');

  // 1. 배경 이미지 로드
  try {
    const bgImage = await loadImage(path.join(__dirname, 'background.png'));
    ctx.drawImage(bgImage, 0, 0, 800, 450);
  } catch (e) {
    ctx.fillStyle = '#ffb6c1';
    ctx.fillRect(0, 0, 800, 450);
  }

  // 글씨가 핑크 배경에 묻히지 않도록 글자에 어두운 테두리(그림자) 효과 주는 헬퍼 함수
  const drawTextWithShadow = (text, x, y, font, fillColor) => {
    ctx.font = font;
    // 테두리 (가독성 강화)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    ctx.strokeText(text, x, y);
    // 본체 글씨
    ctx.fillStyle = fillColor;
    ctx.fillText(text, x, y);
  };

  // 2. 프로필 아바타 원형 그리기
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

  // 3. 닉네임 (크기 대폭 키움: 34px)
  drawTextWithShadow(displayName, 185, 115, '34px CustomFont', '#ffffff');

  // 4. 티어 & 주요 라인 (크기 키움: 22px)
  drawTextWithShadow(`티어 : ${matchedTier.name} [${matchedTier.code}]`, 185, 160, '22px CustomFont', '#00ffff');
  drawTextWithShadow(`주요 라인 : ${lineText}`, 185, 200, '22px CustomFont', '#ffeb3b');

  // 5. 포인트 & 경고 (크기 키움: 22px)
  drawTextWithShadow(`보유 포인트 : ${points.toLocaleString()} P`, 185, 285, '22px CustomFont', '#76ff03');
  
  const warnColor = warns > 0 ? '#ff1744' : '#ffffff';
  drawTextWithShadow(`누적 경고 : ${warns}회`, 490, 285, '22px CustomFont', warnColor);

  return canvas.toBuffer();
}

// 슬래시 명령어 등록
const commands = [
  new SlashCommandBuilder().setName('프로필').setDescription('레트로 프로필 카드를 확인합니다.').addUserOption(option => option.setName('대상').setDescription('조회할 유저').setRequired(false)),
  new SlashCommandBuilder().setName('출석').setDescription('출석체크를 하고 포인트를 받습니다!'),
  new SlashCommandBuilder().setName('포인트').setDescription('포인트를 확인합니다.').addUserOption(option => option.setName('대상').setRequired(false)),
  new SlashCommandBuilder().setName('포인트순위').setDescription('포인트 순위 Top 10을 확인합니다.'),
  new SlashCommandBuilder().setName('경고확인').setDescription('경고 횟수를 확인합니다.').addUserOption(option => option.setName('대상').setRequired(false)),
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
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, options, user, guild } = interaction;
  const pointsData = loadData(POINTS_FILE);
  if (!pointsData[guildId]) pointsData[guildId] = {};
  const warningsData = loadData(WARNINGS_FILE);
  if (!warningsData[guildId]) warningsData[guildId] = {};

  // --- [/프로필] ---
  if (commandName === '프로필') {
    await interaction.deferReply();
    const targetUser = options.getUser('대상') || user;
    const { displayName, matchedTier, lineText } = await getUserProfileInfo(guild, targetUser);
    const userPoints = pointsData[guildId][targetUser.id] || 0;
    const userWarns = warningsData[guildId][targetUser.id] || 0;

    try {
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
      rankingText += `**${index + 1}위** <@${item.userId}> - **${item.points.toLocaleString()} P**\n`;
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