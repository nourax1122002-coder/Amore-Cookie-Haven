import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveDatabaseConnection } from "./src/connection";

const database = resolveDatabaseConnection(process.env);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: database.connectionString,
  },
});
