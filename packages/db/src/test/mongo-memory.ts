// Shared mongodb-memory-server harness for repository/aggregation
// integration tests (BACKLOG.md DATA-10, ARCHITECTURE.md §7.5: repository
// and aggregation-pipeline tests get a real Mongo instance, not a stubbed
// driver, since $dateTrunc/$merge/$facet semantics aren't something a mock
// would catch). Each test file calls setupTestDb() once and gets back
// lifecycle hooks to wire into its own beforeAll/afterEach/afterAll.
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

export interface TestDbHandle {
  connect: () => Promise<void>;
  clear: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function setupTestDb(): TestDbHandle {
  let mongod: MongoMemoryServer | null = null;

  return {
    async connect() {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri());
    },
    async clear() {
      const collections = mongoose.connection.collections as Record<string, mongoose.Collection>;
      await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
    },
    async disconnect() {
      await mongoose.disconnect();
      await mongod?.stop();
      mongod = null;
    },
  };
}
