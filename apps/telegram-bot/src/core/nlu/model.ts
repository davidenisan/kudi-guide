import { resolve } from "node:path";
import {
  getLlama,
  LlamaChatSession,
  resolveModelFile,
  type Llama,
  type LlamaContext,
  type LlamaGrammar,
  type LlamaModel,
  type ChatHistoryItem,
} from "node-llama-cpp";
import { env } from "../../config/env.js";
import { logger } from "../../logger.js";

/**
 * The local language model runtime.
 *
 * Loaded once and kept resident. Everything here is about keeping the model in
 * its lane: a small context, a grammar that constrains output to our schema, a
 * hard timeout, and a single queue so concurrent messages can't interleave.
 *
 * If anything goes wrong — no model file, no memory, a hung generation — this
 * layer reports failure and the caller falls back to the deterministic matcher.
 * The bot must keep working without the model.
 */

export const MODELS_DIR = resolve(process.cwd(), "models");

/** Small on purpose: a system prompt, one short message, one short JSON object. */
const CONTEXT_SIZE = 4096;

/** One sequence per prompt: intent classification and category answers. */
const MAX_SESSIONS = 2;

interface Session {
  session: LlamaChatSession;
  /** The history right after construction — restored after every request. */
  initialHistory: ChatHistoryItem[];
}

interface Runtime {
  llama: Llama;
  model: LlamaModel;
  context: LlamaContext;
  /**
   * One long-lived session per prompt, keyed by schema. Sequences are a finite
   * resource, so they are claimed once rather than per request — which also
   * keeps each system prompt in the KV cache instead of reprocessing ~900
   * tokens on every message.
   */
  sessions: Map<string, Session>;
}

let runtime: Runtime | null = null;
let loading: Promise<Runtime | null> | null = null;
let disabled = false;

/** Serializes generation — one sequence, one request at a time. */
let queue: Promise<unknown> = Promise.resolve();

export function isNluEnabled(): boolean {
  return env.NLU_ENABLED && !disabled;
}

/**
 * Loads the model if it isn't already. Returns null if the model is unavailable
 * for any reason, having logged why. Never throws.
 */
async function load(): Promise<Runtime | null> {
  if (runtime) return runtime;
  if (disabled || !env.NLU_ENABLED) return null;
  if (loading) return loading;

  loading = (async (): Promise<Runtime | null> => {
    try {
      const started = Date.now();
      logger.info("loading local NLU model", { uri: env.NLU_MODEL_URI });

      const modelPath = await resolveModelFile(env.NLU_MODEL_URI, { directory: MODELS_DIR });
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath });
      const context = await model.createContext({ contextSize: CONTEXT_SIZE, sequences: MAX_SESSIONS });

      runtime = { llama, model, context, sessions: new Map() };
      logger.info("NLU model ready", { gpu: llama.gpu, ms: Date.now() - started });
      return runtime;
    } catch (error) {
      // A missing or broken model must not stop the bot from running.
      disabled = true;
      logger.error("NLU model unavailable — falling back to pattern matching", { error });
      return null;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** Loads the model, returning whether it is usable. See warmUpNlu in ./index.ts. */
export async function loadModel(): Promise<boolean> {
  return (await load()) !== null;
}

export async function disposeNlu(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (!current) return;
  await current.context.dispose();
  await current.model.dispose();
}

function getSession(current: Runtime, key: string, systemPrompt: string): Session {
  const cached = current.sessions.get(key);
  if (cached) return cached;

  const session = new LlamaChatSession({
    contextSequence: current.context.getSequence(),
    systemPrompt,
  });
  const entry: Session = { session, initialHistory: session.getChatHistory() };
  current.sessions.set(key, entry);
  return entry;
}

const grammarCache = new Map<string, LlamaGrammar>();

async function grammarFor(llama: Llama, key: string, schema: object): Promise<LlamaGrammar> {
  const cached = grammarCache.get(key);
  if (cached) return cached;

  // The grammar makes invalid output ungenerateable rather than merely unlikely:
  // the model cannot emit a field value outside our enums.
  const grammar = await llama.createGrammarForJsonSchema(schema as never);
  grammarCache.set(key, grammar);
  return grammar;
}

/**
 * Runs one constrained generation and returns the parsed JSON, or null on any
 * failure or timeout. Requests are queued, so this is safe to call concurrently.
 */
export async function generateStructured(
  schemaKey: string,
  schema: object,
  systemPrompt: string,
  userPrompt: string,
): Promise<unknown | null> {
  const run = queue.then(async () => {
    const current = await load();
    if (!current) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.NLU_TIMEOUT_MS);

    try {
      const started = Date.now();
      const grammar = await grammarFor(current.llama, schemaKey, schema);
      const entry = getSession(current, schemaKey, systemPrompt);

      try {
        const response = await entry.session.prompt(userPrompt, {
          grammar,
          // Greedy: classification should be reproducible for the same input.
          temperature: 0,
          maxTokens: 128,
          signal: controller.signal,
        });

        // The grammar guarantees this is JSON matching the schema; the caller
        // still validates every field before trusting any of it.
        const parsed: unknown = JSON.parse(response);
        logger.info("nlu inference", { ms: Date.now() - started });
        return parsed;
      } finally {
        // Each message is judged on its own. Nothing carries over between users.
        entry.session.setChatHistory(entry.initialHistory);
      }
    } catch (error) {
      logger.error("nlu inference failed", { error });
      return null;
    } finally {
      clearTimeout(timer);
    }
  });

  // Keep the chain alive even when a request fails.
  queue = run.catch(() => undefined);
  return run;
}

