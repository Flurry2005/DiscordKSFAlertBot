import {
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  IntentsBitField,
  MessageFlags,
  TextChannel,
  ThumbnailBuilder,
} from "discord.js";

import dotenv from "dotenv";
import GuildModel from "./backend/models/guildsModel.js";
import DatabaseConnection from "./services/Database.js";
import mapsModel from "./backend/models/mapsModel.js";

dotenv.config();
DatabaseConnection.connect();

/* ---------------- KEEP ALIVE ---------------- */

setInterval(() => {
  fetch("https://discordksfalertbot.onrender.com/").catch(() => {});
}, 30_000);

/* ---------------- TYPES ---------------- */

type GuildCache = {
  guildId: string;
  maps: { map: string; hasAlerted: boolean }[];
  channelId: string;
};

type KSFServerState = {
  ip: string;
  map: string;
  tier: number;
  player_count: number;
};

/* ---------------- MEMORY ---------------- */

const guildMemory: GuildCache[] = [];
const serverByMap = new Map<string, KSFServerState>();

/* ---------------- HELPERS ---------------- */

function upsertGuildMemory(entry: GuildCache) {
  const idx = guildMemory.findIndex((g) => g.guildId === entry.guildId);
  if (idx !== -1) guildMemory[idx] = entry;
  else guildMemory.push(entry);
}

/* ---------------- POLLER ---------------- */

async function pollKSFServers() {
  try {
    const res = await fetch("https://ksf.surf/api/servers?game=css");
    const data = await res.json();

    const newSnapshot = new Map<string, KSFServerState>();

    for (const server of data ?? []) {
      if (!server?.IP || !server?.map) continue;

      const ip = server.IP;

      const normalized: KSFServerState = {
        ip,
        map: server.map,
        tier: server.tier,
        player_count: server.playerCount,
      };

      const previous = serverByMap.get(ip);
      const mapChanged = !previous || previous.map !== normalized.map;

      newSnapshot.set(ip, normalized);

      // ONLY reset when map actually changes
      if (mapChanged) {
        for (const guild of guildMemory) {
          const mapEntry = guild.maps.find((m) => m.map === normalized.map);
          if (!mapEntry) continue;

          mapEntry.hasAlerted = false;

          GuildModel.updateOne(
            { guildId: guild.guildId, "maps.map": mapEntry.map },
            { $set: { "maps.$.hasAlerted": false } },
          ).catch(() => {});
        }
      }
    }

    // swap snapshots atomically
    serverByMap.clear();
    for (const [ip, state] of newSnapshot) {
      serverByMap.set(ip, state);
    }
  } catch (err) {
    console.error("KSF poll error:", err);
  }
}

await pollKSFServers();
setInterval(pollKSFServers, 60_000);

/* ---------------- CLIENT ---------------- */

const client = new Client({
  intents: [IntentsBitField.Flags.Guilds],
});

/* ---------------- ALERT LOCK ---------------- */

let alertLock = false;

/* ---------------- ALERT ENGINE ---------------- */

async function runAlerts() {
  if (alertLock) return;
  alertLock = true;

  try {
    for (const guild of guildMemory) {
      const textChannel = await resolveGuildForAlerts(guild);

      if (!textChannel) {
        console.error(
          "Failed to resolve text channel for guild:",
          guild.guildId,
        );
        continue;
      }

      for (const mapEntry of guild.maps) {
        if (mapEntry.hasAlerted) continue;
        const server = [...serverByMap.values()].find(
          (s) => s.map === mapEntry.map,
        );
        if (!server) continue;

        console.log(
          `Alerting guild ${guild.guildId} about map ${mapEntry.map} (server ${server.ip})`,
        );
        mapEntry.hasAlerted = true;

        await GuildModel.updateOne(
          { guildId: guild.guildId, "maps.map": mapEntry.map },
          { $set: { "maps.$.hasAlerted": true } },
        );

        const container = new ContainerBuilder()
          .setAccentColor(0x0099ff)
          .addTextDisplayComponents((t) =>
            t.setContent(
              `# ${server.map.toUpperCase()} has gone live!\nKSF Alert!`,
            ),
          )
          .addSeparatorComponents((s) => s)
          .addSectionComponents((section) =>
            section
              .addTextDisplayComponents((t) =>
                t.setContent(
                  `### ${server.map.toUpperCase()}
Server is now online.

IP: \`${server.ip}\`
Tier: \`${server.tier}\`
Players: \`${server.player_count}\``,
                ),
              )
              .setThumbnailAccessory(
                new ThumbnailBuilder().setURL(
                  `https://ksf.surf/images/${server.map.toLowerCase()}.jpg`,
                ),
              ),
          )
          .addSectionComponents((section) =>
            section
              .addTextDisplayComponents((t) =>
                t.setContent("Click below to connect."),
              )
              .setButtonAccessory(
                new ButtonBuilder()
                  .setLabel("Connect")
                  .setStyle(ButtonStyle.Link)
                  .setURL(
                    `${process.env.WEBSITE_URL ?? "https://example.com"}/${server.ip}`,
                  ),
              ),
          );

        await textChannel.send({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
      }
    }
  } catch (err) {
    console.error("runAlerts error:", err);
  } finally {
    alertLock = false;
  }
}

setInterval(runAlerts, 10_000);

/* ---------------- SETUP ---------------- */

async function resolveGuildForAlerts(guildCache: GuildCache) {
  let channel = await client.channels
    .fetch(guildCache.channelId)
    .catch(() => null);

  if (channel?.isTextBased()) {
    return channel as TextChannel;
  }

  const guild = await client.guilds.fetch(guildCache.guildId).catch(() => null);

  if (!guild) return null;

  await setupGuild(guild);

  const updated = guildMemory.find((g) => g.guildId === guild.id);
  if (!updated) return null;

  channel = await client.channels.fetch(updated.channelId).catch(() => null);

  if (!channel?.isTextBased()) return null;

  return channel as TextChannel;
}

async function setupGuild(guild: any) {
  try {
    await guild.channels.fetch();

    let channel = guild.channels.cache.find(
      (c: any) => c.name === "ksf" && c.type === ChannelType.GuildText,
    ) as TextChannel | undefined;

    if (!channel) {
      channel = await guild.channels.create({
        name: "ksf",
        type: ChannelType.GuildText,
        reason: "Auto-created KSF channel",
      });

      await channel!.send({ content: "KSF alert channel created." });
    }

    const doc = await GuildModel.findOne({ guildId: guild.id });

    upsertGuildMemory({
      guildId: guild.id,
      maps: doc?.maps ?? [],
      channelId: channel!.id,
    });
  } catch (err) {
    console.error(`setupGuild failed (${guild.name})`, err);
  }
}

/* ---------------- HYDRATION ---------------- */

async function hydrateGuildMemory() {
  const docs = await GuildModel.find();

  console.log(`Hydrating guild memory with ${docs.length} entries from DB...`);

  guildMemory.length = 0;

  for (const doc of docs) {
    try {
      const guild = await client.guilds.fetch(doc.guildId).catch(() => null);
      if (!guild) continue;

      await guild.channels.fetch().catch(() => null);

      // try to find existing KSF channel
      let channel = guild.channels.cache.find((c: any) => {
        const name = (c?.name ?? "").toLowerCase();
        return (
          (c?.type === ChannelType.GuildText || c?.isTextBased?.()) &&
          name.includes("ksf")
        );
      }) as TextChannel | undefined;

      // fallback full scan (cache miss protection)
      if (!channel) {
        const fetched = await guild.channels.fetch().catch(() => null);

        channel = fetched?.find((c: any) => {
          const name = (c?.name ?? "").toLowerCase();
          return (
            (c?.type === ChannelType.GuildText || c?.isTextBased?.()) &&
            name.includes("ksf")
          );
        }) as TextChannel | undefined;
      }

      // 🔥 SELF-HEAL: recreate missing channel instead of skipping guild
      if (!channel) {
        console.log(`Recreating missing KSF channel in guild ${guild.id}`);

        channel = (await guild.channels.create({
          name: "ksf",
          type: ChannelType.GuildText,
          reason: "Auto-recreated missing KSF channel during hydration",
        })) as TextChannel;

        await channel.send({
          content: "KSF alert channel recreated.",
        });
      }

      // IMPORTANT: persist corrected channel id
      await GuildModel.updateOne(
        { guildId: guild.id },
        { $set: { channelId: channel.id } },
        { upsert: true },
      );

      upsertGuildMemory({
        guildId: doc.guildId,
        maps: doc.maps ?? [],
        channelId: channel.id,
      });

      console.log(`Loaded guild into memory: ${guild.name}`);
    } catch (err) {
      console.error(`Hydration failed for ${doc.guildId}`, err);
    }
  }

  console.log(`Hydration complete. Loaded ${guildMemory.length} guilds.`);
}

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await hydrateGuildMemory();
});

/* ---------------- EVENTS ---------------- */

client.on("guildCreate", setupGuild);

/* ---------------- COMMANDS ---------------- */

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.guildId) return;

  const guildData = guildMemory.find((g) => g.guildId === interaction.guildId);

  if (!guildData) {
    return interaction.reply({
      content: "Guild not ready yet.",
      ephemeral: true,
    });
  }

  /* ADD MAP */
  if (interaction.commandName === "addmap") {
    const mapName = interaction.options
      .getString("name", true)
      .trim()
      .toLowerCase();

    if (!/^[a-z0-9_\-]+$/.test(mapName)) {
      return interaction.reply({
        content: "Invalid map name.",
        ephemeral: true,
      });
    }

    const exists = await mapsModel.findOne({ map: mapName });

    if (!exists) {
      return interaction.reply({
        content: "Map does not exist in KSF.",
        ephemeral: true,
      });
    }

    if (guildData.maps.some((m) => m.map === mapName)) {
      return interaction.reply({
        content: "Map already exists.",
        ephemeral: true,
      });
    }

    const newMap = { map: mapName, hasAlerted: false };

    await GuildModel.updateOne(
      { guildId: interaction.guildId },
      { $push: { maps: newMap } },
      { upsert: true },
    );

    guildData.maps.push(newMap);

    return interaction.reply({
      content: `Added map **${mapName}**`,
      ephemeral: true,
    });
  }

  /* LIST MAPS */
  if (interaction.commandName === "listmaps") {
    if (!guildData.maps.length) {
      return interaction.reply({
        content: "No maps added yet.",
        ephemeral: true,
      });
    }

    return interaction.reply({
      content:
        "Maps being tracked:\n" +
        guildData.maps.map((m) => `- ${m.map}`).join("\n"),
      ephemeral: true,
    });
  }
});

/* ---------------- LOGIN ---------------- */

client.login(process.env.DISCORD_BOT_TOKEN!);
