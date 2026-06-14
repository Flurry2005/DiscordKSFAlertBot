import mongoose, { Mongoose } from "mongoose";
import dotenv from "dotenv";
dotenv.config();
class DatabaseConnection {
  #client!: Mongoose;

  async connect() {
    if (this.#client != null) return;
    try {
      this.#client = await mongoose.connect(process.env.MONGO_URI!);
      console.log("Database connection established");
    } catch (error) {
      console.error(error);
    }
  }
}

export default new DatabaseConnection();
