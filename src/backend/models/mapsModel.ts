import mongoose from "mongoose";

const mapsSchema = new mongoose.Schema(
  {
    map: { type: String, required: true, unique: true },
    Tier: { type: Number, required: true },
    Type: { type: String, required: true },
  },
  { timestamps: true },
);

export default mongoose.model("Maps", mapsSchema);
