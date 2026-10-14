import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";
import { provisionWasp } from "../lib/provision";

// Load .env.local manually
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, "utf-8");
  for (const line of envConfig.split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?$/);
    if (match) {
      const key = match[1];
      let value = match[2] || "";
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      process.env[key] = value.trim();
    }
  }
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("Error: MONGODB_URI is not defined in .env.local");
  process.exit(1);
}

async function run() {
  console.log("Connecting to MongoDB Atlas...");
  const client = new MongoClient(uri!);
  try {
    await client.connect();
    await provisionWasp(client.db());
    console.log("Database provisioned successfully.");
  } catch (err) {
    console.error("Provisioning failed:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

run();
