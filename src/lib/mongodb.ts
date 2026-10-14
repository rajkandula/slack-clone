import { MongoClient } from "mongodb";
import { provisionWasp } from "./provision";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

/**
 * Open the connection on first use, not at import time.
 *
 * Reading MONGODB_URI (and throwing) at module scope meant that merely importing
 * a route module needed a live database — which fails `next build` inside the
 * Docker image, where no secrets are present. Deferring it keeps the build
 * hermetic while still failing loudly the first time a request needs data.
 */
function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
  }

  const client = new MongoClient(uri, {
    // One container serves many concurrent SSE streams, each of which polls on
    // its own tick. Cap the pool so a burst of connections can't exhaust the
    // Atlas tier's server-side connection limit.
    maxPoolSize: 20,
    minPoolSize: 1,
  });

  return client.connect().then(async (c) => {
    await provisionWasp(c.db());
    return c;
  });
}

/**
 * One client per process, reused across HMR reloads in development.
 */
function clientPromise(): Promise<MongoClient> {
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = connect();
  }
  return global._mongoClientPromise;
}

export default clientPromise;

/**
 * Helper utility to get the database instance directly
 */
export async function getDb(dbName?: string) {
  const mongoClient = await clientPromise();
  return mongoClient.db(dbName);
}
