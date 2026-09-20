import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.EULER_DB_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.EULER_DATA_ROOT = join(tmpdir(), `euler-test-${process.pid}`);
process.env.OPENROUTER_API_KEY = "";
process.env.EULER_OPENROUTER_API_KEY = "";
process.env.EULER_OLLAMA_HOST = "";
process.env.OLLAMA_HOST = "";
process.env.EULER_COMFYUI_HOST = "";
process.env.COMFYUI_HOST = "";
process.env.EULER_SEARXNG_HOST = "";
process.env.SEARXNG_HOST = "";
