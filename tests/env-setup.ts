import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.EULER_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.EULER_DATA_ROOT = join(tmpdir(), `euler-test-${process.pid}`);
process.env.OPENROUTER_API_KEY = "";
process.env.EULER_OPENROUTER_API_KEY = "";
