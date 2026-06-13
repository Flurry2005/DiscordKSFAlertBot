import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("addmap")
  .setDescription("Add a map for this server")
  .addStringOption((option) =>
    option.setName("name").setDescription("Map name").setRequired(true),
  );
