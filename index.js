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
    GatewayIntentBits.GuildMembers
  ]
});

// 📌 [설정] 내전 역할 이름
const CIVIL_WAR_ROLE_NAME = '내전'; 

// --- 데이터 파일 관리 (포인트, 경고, 내전정지, 상점, 포럼별 참가자) ---
const POINTS_FILE = path.join(__dirname, 'points.json');
const WARNINGS_FILE = path.join(__dirname, 'warnings.json');
const BANS_FILE = path.join(__dirname, 'bans.json');
const SHOP_FILE = path.join(__dirname, 'shop.json');
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
  // --- 일반 유저 가능 명령어 ---
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
    .setName('내전인원')
    .setDescription('현재 포럼의 내전 참가자 명단을 티어/역할순으로 확인합니다. (관리자 전용)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('명단초기화')
    .setDescription('현재 포럼의 참가자 명단을 초기화합니다. (관리자 전용)')
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
});

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

// 채팅 감지 이벤트 ('ㅅ', '손', 't') - 포럼(스레드/채널)별 구분 적용
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const text = message.content.trim();
  
  if (text === 'ㅅ' || text === '손' || text === 't') {
    const userId = message.author.id;
    const guildId = message.guild?.id;
    if (!guildId) return;

    // 포럼 채널 혹은 스레드인 경우 부모 ID 또는 현재 채널 ID를 기준(포럼 식별자)으로 사용
    let forumId = message.channel.id;
    if (message.channel.isThread()) {
      forumId = message.channel.parentId || message.channel.id;
    }

    const participantsData = loadData(PARTICIPANTS_FILE);
    if (!participantsData[guildId]) participantsData[guildId] = {};
    if (!participantsData[guildId][forumId]) participantsData[guildId][forumId] = [];

    if (participantsData[guildId][forumId].includes(userId)) {
      await message.react('⚠️');
      return;
    }

    participantsData[guildId][forumId].push(userId);
    saveData(PARTICIPANTS_FILE, participantsData);
    await message.react('✅');
  }
});

// 슬래시 명령어 처리
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, options, user, guild, channel } = interaction;
  
  // 현재 명령어가 입력된 포럼/채널 ID 파악
  let forumId = channel.id;
  if (channel.isThread()) {
    forumId = channel.parentId || channel.id;
  }

  const pointsData = loadData(POINTS_FILE);
  if (!pointsData[guildId]) pointsData[guildId] = {};

  const warningsData = loadData(WARNINGS_FILE);
  if (!warningsData[guildId]) warningsData[guildId] = {};

  const bansData = loadData(BANS_FILE);
  if (!bansData[guildId]) bansData[guildId] = {};

  const shopData = loadData(SHOP_FILE);
  if (!shopData[guildId]) shopData[guildId] = { items: {}, userTicketCounts: {} };
  if (!shopData[guildId].userTicketCounts) shopData[guildId].userTicketCounts = {};

  const participantsData = loadData(PARTICIPANTS_FILE);
  if (!participantsData[guildId]) participantsData[guildId] = {};
  if (!participantsData[guildId][forumId]) participantsData[guildId][forumId] = [];

  // [/내전인원]
  if (commandName === '내전인원') {
    await interaction.deferReply();
    const embed = await buildEmbed(guild, participantsData[guildId][forumId]);
    await interaction.editReply({ embeds: [embed] });
  }

  // [/명단초기화]
  if (commandName === '명단초기화') {
    participantsData[guildId][forumId] = [];
    saveData(PARTICIPANTS_FILE, participantsData);
    await interaction.reply('🔄 현재 포럼의 내전 참가자 명단이 초기화되었습니다!');
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

  // [/경고]
  if (commandName === '경고') {
    const targetUser = options.getUser('대상');
    const reason = options.getString('사유') || '사유 미기재';

    const currentWarns = (warningsData[guildId][targetUser.id] || 0) + 1;
    warningsData[guildId][targetUser.id] = currentWarns;
    saveData(WARNINGS_FILE, warningsData);

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

    // 1. 경고 차감권 구매
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

    // 2. 커스텀역할 구매 (30,000 P)
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

    // 3. 강의권 구매
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

    // 4. 일반 등록 역할 구매
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

// 명단 생성 및 티어 감지 + fow.lol 링크 자동 추출 함수 (포럼별 참가자 리스트 전달)
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