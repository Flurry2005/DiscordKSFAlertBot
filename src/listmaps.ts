import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("listmaps")
  .setDescription("List all maps for this server");
