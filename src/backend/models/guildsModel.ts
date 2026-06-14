import mongoose from "mongoose";

export type Guild = {
  guildId: string;
  maps: {
    map: string;
    hasAlerted: boolean;
  }[];
  createdAt: Date;
  updatedAt: Date;
};

const guildSchema = new mongoose.Schema<Guild>(
  {
    guildId: { type: String, required: true, unique: true },
    maps: [
      {
        map: { type: String, required: true },
        hasAlerted: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true },
);

const GuildModel = mongoose.model<Guild>("Guilds", guildSchema);

export default GuildModel;
