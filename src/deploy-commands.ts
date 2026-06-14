import { REST, Routes } from "discord.js";
import dotenv from "dotenv";
import { data as addmap } from "./addmap.js";
import { data as listmaps } from "./listmaps.js";

dotenv.config();

console.log("STARTING DEPLOY");

const commands = [addmap.toJSON(), listmaps.toJSON()];

const rest = new REST({ version: "10" }).setToken(
  process.env.DISCORD_BOT_TOKEN!,
);

try {
  const result = await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID!),
    { body: commands },
  );

  console.log("DEPLOY SUCCESS:", result);
} catch (err) {
  console.error("DEPLOY FAILED:", err);
}
