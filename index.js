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
  PermissionFlagsBits 
} = require('discord.js');

// Render 수면 방지용 HTTP 서버
http.createServer((req, res) => {
  res.write("Bot is alive!");
  res.end();
}).listen(process.env.PORT || 10000, '0.0.0.0', () => {
  console.log('HTTP Server is running on port 10000');
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// --- 데이터 파일 관리 (포인트 & 경고) ---
const POINTS_FILE = path.join(__dirname, 'points.json');
const WARNINGS_FILE = path.join(__dirname, 'warnings.json');

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

// 내전 참가자 목록 (유저 ID 저장)
let participants = [];

// 디스코드 역할 이름 매칭 패턴 정의
const tierInfo = [
  { keywords: ['챌린저', '챌'], code: 'C', priority: 1 },
  { keywords: ['그랜드마스터', '그마'], code: 'GM', priority: 2 },
  { keywords: ['마스터', '마'], code: 'M', priority: 3 },
  { keywords: ['다이아몬드', '다이아', '다'], code: 'D', priority: 4 },
  { keywords: ['에메랄드', '에메', '에'], code: 'E', priority: 5 },
  { keywords: ['플래티넘', '플레티넘', '플래', '플레', '플'], code: 'P', priority: 6 },
  { keywords: ['골드', '골'], code: 'G', priority: 7 },
  { keywords: ['실버', '실'], code: 'S', priority: 8 },
  { keywords: ['브론즈', '브'], code: 'B', priority: 9 },
  { keywords: ['아이언', '아'], code: 'I', priority: 10 },
  { keywords: ['언랭'], code: 'U', priority: 11 }
];

// 포지션 키워드 목록
const lineKeywords = ['탑', '정글', '미드', '원딜', '서폿'];

// 슬래시 명령어 정의
const commands = [
  new SlashCommandBuilder().setName('내전인원').setDescription('현재 내전 참가자 명단을 티어/역할순으로 확인합니다.'),
  new SlashCommandBuilder().setName('명단초기화').setDescription('참가자 명단을 초기화합니다.'),

  new SlashCommandBuilder()
    .setName('포인트지급')
    .setDescription('유저에게 포인트를 지급하거나 차감합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('포인트를 받을 유저').setRequired(true))
    .addIntegerOption(option => 
      option.setName('포인트').setDescription('지급할 포인트 (음수 입력 시 차감)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('포인트')
    .setDescription('포인트를 확인합니다.')
    .addUserOption(option => 
      option.setName('대상').setDescription('조회할 유저 (비워두면 본인 조회)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('포인트순위')
    .setDescription('서버 내 포인트 Top 10 순위를 확인합니다.'),

  // --- 경고 관련 명령어 추가 ---
  new SlashCommandBuilder()
    .setName('경고')
    .setDescription('유저에게 경고를 부여합니다. (3회 누적 시 자동 차단)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('경고를 줄 유저').setRequired(true))
    .addStringOption(option => 
      option.setName('사유').setDescription('경고 부여 사유').setRequired(false)),

  new SlashCommandBuilder()
    .setName('경고차감')
    .setDescription('유저의 경고를 1회 차감합니다.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option => 
      option.setName('대상').setDescription('경고를 차감할 유저').setRequired(true)),

  new SlashCommandBuilder()
    .setName('경고확인')
    .setDescription('유저의 현재 경고 횟수를 확인합니다.')
    .addUserOption(option => 
      option.setName('대상').setDescription('조회할 유저 (비워두면 본인 조회)').setRequired(false))
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
});

// 채팅 감지 이벤트 ('ㅅ', '손', 't')
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const text = message.content.trim();
  
  if (text === 'ㅅ' || text === '손' || text === 't') {
    const userId = message.author.id;

    if (participants.includes(userId)) {
      await message.react('⚠️');
      return;
    }

    participants.push(userId);
    await message.react('✅');
  }
});

// 슬래시 명령어 처리
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, options, user, guild } = interaction;
  
  const pointsData = loadData(POINTS_FILE);
  if (!pointsData[guildId]) pointsData[guildId] = {};

  const warningsData = loadData(WARNINGS_FILE);
  if (!warningsData[guildId]) warningsData[guildId] = {};

  // [/내전인원]
  if (commandName === '내전인원') {
    await interaction.deferReply();
    const embed = await buildEmbed(guild);
    await interaction.editReply({ embeds: [embed] });
  }

  // [/명단초기화]
  if (commandName === '명단초기화') {
    participants = [];
    await interaction.reply('🔄 내전 참가자 명단이 초기화되었습니다!');
  }

  // [/포인트지급]
  if (commandName === '포인트지급') {
    const targetUser = options.getUser('대상');
    const amount = options.getInteger('포인트');

    const currentPoints = pointsData[guildId][targetUser.id] || 0;
    const newPoints = currentPoints + amount;

    pointsData[guildId][targetUser.id] = newPoints;
    saveData(POINTS_FILE, pointsData);

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

  // --- [/경고] ---
  if (commandName === '경고') {
    const targetUser = options.getUser('대상');
    const reason = options.getString('사유') || '사유 미기재';

    const currentWarns = (warningsData[guildId][targetUser.id] || 0) + 1;
    warningsData[guildId][targetUser.id] = currentWarns;
    saveData(WARNINGS_FILE, warningsData);

    // 경고 3회 이상이면 자동 차단(Ban)
    if (currentWarns >= 3) {
      try {
        const member = await guild.members.fetch(targetUser.id);
        if (member) {
          await member.ban({ reason: `경고 3회 누적 (사유: ${reason})` });
        }

        const embed = new EmbedBuilder()
          .setColor('#ED4245')
          .setTitle('🚨 경고 3회 누적 - 서버 자동 차단')
          .setDescription(`<@${targetUser.id}> 님이 경고 **3회**를 채워 서버에서 **자동 차단(Ban)** 처리되었습니다.`)
          .addFields({ name: '최근 경고 사유', value: reason })
          .setTimestamp();

        return interaction.reply({ embeds: [embed] });
      } catch (err) {
        console.error('차단 처리 오류:', err);
        return interaction.reply({ 
          content: `⚠️ <@${targetUser.id}> 님의 경고가 3회가 되었지만 봇의 권한 부족 등으로 차단에 실패했습니다. (봇 역할 순위 확인 필요)`, 
          ephemeral: true 
        });
      }
    }

    // 경고 1~2회인 경우
    const embed = new EmbedBuilder()
      .setColor('#FEE75C')
      .setTitle('⚠️ 경고 부여')
      .setDescription(`<@${targetUser.id}> 님에게 경고 1회를 부여했습니다.`)
      .addFields(
        { name: '현재 경고 횟수', value: `**${currentWarns}** / 3 회`, inline: true },
        { name: '사유', value: reason, inline: true }
      )
      .setFooter({ text: '경고 3회 누적 시 서버에서 자동으로 차단됩니다.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // --- [/경고차감] ---
  if (commandName === '경고차감') {
    const targetUser = options.getUser('대상');
    const currentWarns = warningsData[guildId][targetUser.id] || 0;

    if (currentWarns <= 0) {
      return interaction.reply({ content: `<@${targetUser.id}> 님은 차감할 경고가 없습니다!`, ephemeral: true });
    }

    const newWarns = currentWarns - 1;
    warningsData[guildId][targetUser.id] = newWarns;
    saveData(WARNINGS_FILE, warningsData);

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

  // --- [/경고확인] ---
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
});

// 명단 생성 및 티어 감지 + fow.lol 링크 자동 추출 함수
async function buildEmbed(guild) {
  let description = '';

  if (participants.length === 0) {
    description = '아직 참가자가 없습니다. 채팅창에 **`ㅅ`** 또는 **`손`**을 입력해 주세요!';
  } else {
    const list = [];

    for (const userId of participants) {
      try {
        const member = await guild.members.fetch(userId);
        const userRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

        // 1. 티어 감지
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

        // 2. 포지션 감지
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

        // 3. fow.lol 전적 링크 자동 추출
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

    // 티어 순 정렬
    list.sort((a, b) => a.priority - b.priority);

    // 출력 문구 조립
    list.forEach(p => {
      description += `**[${p.tierCode}]** ${p.displayName} / ${p.lineText}${p.fowLink}\n`;
    });
  }

  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🎮 내전 참가자 명단 (서버 역할 기준 / 티어순)')
    .setDescription(description)
    .setFooter({ text: `총 신청 인원: ${participants.length}명` })
    .setTimestamp();
}

client.login(process.env.DISCORD_TOKEN);