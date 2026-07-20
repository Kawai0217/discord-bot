require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// 내전 참가자 목록 (유저 ID 저장)
let participants = [];

// 디스코드 역할 이름 매칭 패턴 정의 (오타 및 약칭 모두 대응)
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
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`🤖 ${client.user.tag} 봇이 티어 자동 감지 개선 모드로 켜졌습니다!`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
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

  if (interaction.commandName === '내전인원') {
    await interaction.deferReply();

    const guild = interaction.guild;
    const embed = await buildEmbed(guild);
    await interaction.editReply({ embeds: [embed] });
  }

  if (interaction.commandName === '명단초기화') {
    participants = [];
    await interaction.reply('🔄 내전 참가자 명단이 초기화되었습니다!');
  }
});

// 명단 생성 및 티어 감지
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

        // 1. 티어 감지 (유연한 키워드 검사)
        let matchedTier = { code: 'U', priority: 99 };
        
        for (const t of tierInfo) {
          const isMatch = userRoleNames.some(roleName => 
            t.keywords.some(kw => roleName.includes(kw.toLowerCase()))
          );

          if (isMatch) {
            matchedTier = t;
            break; // 상위 티어부터 순서대로 매칭되면 종료
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

        list.push({
          displayName,
          tierCode: matchedTier.code,
          priority: matchedTier.priority,
          lineText
        });
      } catch (err) {
        list.push({
          displayName: `<@${userId}>`,
          tierCode: 'U',
          priority: 99,
          lineText: '정보 오류'
        });
      }
    }

    // 티어 높은 순 정렬
    list.sort((a, b) => a.priority - b.priority);

    // 문구 작성
    list.forEach(p => {
      description += `**[${p.tierCode}]** ${p.displayName} / ${p.lineText}\n`;
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