import { ChannelType, Client, IntentsBitField, TextChannel } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

type GuildData = {
  maps: GuildMap[];
};

type GuildMap = { map: string; hasAlerted: boolean };

const guildMemory = new Map<string, GuildData>();

let ksfMapData: any[] = [];

setInterval(async () => {
  try {
    const res = await fetch("https://ksf.surf/api/servers?game=css");

    const data = await res.json();

    ksfMapData = data.map((server: any) => {
      const previous = ksfMapData.find((s) => s.ip === server.IP);

      const mapChanged = !previous ? true : previous.map !== server.map;
      if (mapChanged) {
        guildMemory.forEach((guildData) => {
          const mapEntry = guildData.maps.find((m) => m.map === server.map);
          if (mapEntry) {
            mapEntry.hasAlerted = false;
          }
        });
      }
      return {
        ip: server.IP,
        map: server.map,
      };
    });
  } catch (err) {
    console.error("KSF poll error:", err);
  }
}, 1000);

const client = new Client({
  intents: [IntentsBitField.Flags.Guilds],
});

async function setupGuild(guild: any) {
  try {
    await guild.channels.fetch();

    let channel = guild.channels.cache.find(
      (c: any) => c.name === "ksf" && c.type === ChannelType.GuildText,
    );

    // Create if missing
    if (!channel) {
      channel = await guild.channels.create({
        name: "ksf",
        type: ChannelType.GuildText,
        reason: "Auto-created on bot startup",
      });

      const textChannel = channel as TextChannel;

      await textChannel.send({
        content:
          "@everyone Hello! This channel was created by the bot to post KSF alerts.",
        allowedMentions: {
          parse: ["everyone"],
        },
      });

      console.log(`Created #${channel.name} in ${guild.name}`);
    } else {
      console.log(`Found #${channel.name} in ${guild.name}`);
    }

    guildMemory.set(guild.id, { maps: [] });
    mapAlertInterval(guild.id, channel.id);

    console.log(`Stored memory for ${guild.name}: ${channel.id}`);
  } catch (err) {
    console.error(`Failed for guild ${guild.name}:`, err);
  }
}

async function mapAlertInterval(guildId: string, channelId: string) {
  setInterval(async () => {
    const guildData = guildMemory.get(guildId);
    if (!guildData) return;

    if (guildData.maps.length > 0) {
      client.channels
        .fetch(channelId)
        .then(async (channel) => {
          if (
            channel &&
            ksfMapData.some((server: any) =>
              guildData.maps.some((m) => m.map === server.map),
            )
          ) {
            const TextChannel = channel as TextChannel;

            guildData.maps.map((mapEntry) => {
              const server = ksfMapData.find((s) => s.map === mapEntry.map);
              if (!server?.ip) return;

              TextChannel.send(
                `@everyone KSF Alert! [${server.map}](${process.env.WEBSITE_URL}/${server.ip}) has gone live!`,
              );
            });
          }
        })
        .catch((err) => {
          console.error(`Failed to fetch channel ${channelId}:`, err);
        });
    }
  }, 1000);
}

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user?.tag}!`);

  for (const guild of client.guilds.cache.values()) {
    await setupGuild(guild);
  }
});

client.on("guildCreate", async (guild) => {
  console.log(`Joined ${guild.name}`);
  await setupGuild(guild);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "addmap") {
    const mapName = interaction.options.getString("name", true);

    const guildId = interaction.guildId;
    if (!guildId) return;

    if (!guildMemory.has(guildId)) {
      guildMemory.set(guildId, { maps: [] });
    }

    const current = guildMemory.get(guildId)!.maps;

    if (current.some((m) => m.map.toLowerCase() === mapName.toLowerCase())) {
      return interaction.reply({
        content: "Map already exists.",
        ephemeral: true,
      });
    }

    current.push({ map: mapName, hasAlerted: false });
    guildMemory.set(guildId, { maps: current });

    return interaction.reply({
      content: `Added map **${mapName}**`,
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_BOT_TOKEN!);
