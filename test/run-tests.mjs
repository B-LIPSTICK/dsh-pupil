// dsh-pupil v0.3 集成测试
// 用真实 cordis + 真实 LlmRuntime + mock adapter（DeepSeek 风格拒图）+ 真实插件代码，
// 走 agent-loop 的完整调用链（prepareCall → preparedCall.stream），验证：
//   1. 图片块绝不透传（无 UNSUPPORTED_CONTENT）
//   2. 模型收到标记/记忆文本
//   3. instantDescribe 预识别 + 图片记忆
//   4. 无 Key 时仍不透传（标记兜底）
//   5. vision_describe 工具按 attachmentIds 看图
//   6. image_generate 画图
import { resolveDep } from "./deps.mjs";
const { Context } = await import(resolveDep("@deepseek-ai/cordis"));
const { LlmRuntime, LlmError } = await import(resolveDep("@deepseek-ai/dsh-llm"));
import { createMockServer, PNG_1PX } from "./mock-server.mjs";
import { apply, Config } from "../lib/index.js";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------- mock 服务 ----------
function makeTools() {
  const tools = [];
  return {
    register(def) {
      tools.push(def);
    },
    list() {
      return tools;
    },
  };
}
function makeSystemPrompt() {
  return {
    section() {},
  };
}
function makeAttachments() {
  return {
    async readImage(ref) {
      if (!ref?.attachmentId) throw new Error("no attachmentId");
      return {
        data: PNG_1PX,
        ref: { attachmentId: ref.attachmentId, mediaType: "image/png" },
      };
    },
    async saveImage({ data, mediaType }) {
      return { attachmentId: `sha256:mock-${data.length}`, mediaType, bytes: data.length, width: 1, height: 1 };
    },
  };
}

// DeepSeek 风格 adapter：messages 里有图片块就抛 UNSUPPORTED_CONTENT
function makeDeepSeekLikeAdapter(label) {
  return {
    providerInfo(provider) {
      return { id: provider, name: provider };
    },
    providerRetryPolicy() {},
    async listModels() {
      return [];
    },
    async resolveModel(provider, model) {
      return { provider, id: model, name: model, context: { contextWindow: 100000 } };
    },
    stream(options) {
      const seen = [];
      const walk = (blocks) => {
        for (const b of blocks ?? []) {
          if (b?.type === "image") seen.push(b);
          if (Array.isArray(b?.content)) walk(b.content);
        }
      };
      for (const m of options.messages ?? []) walk(m.content);
      if (seen.length > 0) {
        return (async function* () {
          throw new LlmError("The DeepSeek chat-completions adapter does not support image content.", "UNSUPPORTED_CONTENT");
        })();
      }
      const text = (options.messages ?? [])
        .map((m) => (m.content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join(""))
        .filter(Boolean)
        .join(" | ");
      return (async function* () {
        yield { type: "text-delta", index: 0, text: `[${label} ok] ${text.slice(0, 200)}` };
        yield { type: "finish", reason: { kind: "stop" } };
      })();
    },
  };
}

async function consume(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return chunks;
}

function imageMessage(attachmentId = "sha256:deadbeef") {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: "看看这张图" },
        {
          type: "image",
          attachment: {
            attachmentId,
            mediaType: "image/png",
            bytes: PNG_1PX.length,
            width: 1,
            height: 1,
            name: "test.png",
          },
        },
      ],
    },
  ];
}

function boot({ config = {}, visionContent, failVision } = {}) {
  const ctx = new Context();
  const llm = new LlmRuntime(ctx);
  const dsAdapter = makeDeepSeekLikeAdapter("deepseek-mock");
  llm.registerAdapter(["deepseek-mock"], dsAdapter);
  const tools = makeTools();
  const sp = makeSystemPrompt();
  const attachments = makeAttachments();
  ctx.tools = tools;
  ctx.systemPrompt = sp;
  ctx.attachments = attachments;
  ctx.llm = llm;
  // 通过 cordis schema 应用默认值
  const result = Config_standardValidate(config);
  apply(ctx, result);
  const toolDefs = tools.list();
  return { ctx, llm, tools, attachments, toolDefs, dsAdapter };
}

function Config_standardValidate(config) {
  const result = Config["~standard"].validate(config);
  if (result.issues) throw new Error(`invalid config: ${result.issues.map((i) => i.message).join("; ")}`);
  return result.value;
}

// ---------- 测试 ----------
const server = await createMockServer();

console.log("\n== 1. 图片轮：不透传 + 标记替换 ==");
{
  const { ctx, llm, attachments } = boot({});
  const signal = new AbortController().signal;
  const preparedCall = await llm.prepareCall({ provider: "deepseek-mock", model: "deepseek-mock" }, signal);
  const chunks = await consume(preparedCall.stream({ provider: "deepseek-mock", model: "deepseek-mock", messages: imageMessage(), signal }));
  const finish = chunks.find((c) => c.type === "finish");
  const text = chunks.map((c) => c.text ?? "").join("");
  check("无 UNSUPPORTED_CONTENT", finish?.reason?.kind !== "error" || finish?.reason?.failure?.code !== "UNSUPPORTED_CONTENT", JSON.stringify(finish?.reason));
  check("模型收到文本", text.includes("图片附件"), text.slice(0, 120));
  check("文本含附件 id", text.includes("sha256:deadbeef"), text.slice(0, 120));
  await ctx.fiber.dispose?.().catch?.(() => {});
}

console.log("\n== 2. 无 Key：仍不透传（标记兜底）==");
{
  const { ctx, llm } = boot({});
  const signal = new AbortController().signal;
  const preparedCall = await llm.prepareCall({ provider: "deepseek-mock", model: "deepseek-mock" }, signal);
  const chunks = await consume(preparedCall.stream({ provider: "deepseek-mock", model: "deepseek-mock", messages: imageMessage(), signal }));
  const finish = chunks.find((c) => c.type === "finish");
  check("无 UNSUPPORTED_CONTENT", finish?.reason?.kind !== "error" || finish?.reason?.failure?.code !== "UNSUPPORTED_CONTENT", JSON.stringify(finish?.reason));
  await ctx.fiber.dispose?.().catch?.(() => {});
}

console.log("\n== 3. instantDescribe：图片轮预识别 ==");
{
  const { ctx, llm } = boot({
    config: { apiKey: "k", baseUrl: server.baseUrl, model: "mock-vision" },
  });
  const signal = new AbortController().signal;
  // 模拟 agent-loop：先 pre-step（claimed 消息）再请求
  const claimed = imageMessage();
  await ctx.events.waterfall(null, "agent/pre-step", { messages: claimed, turn: 1, step: 1, signal }, () =>
    Promise.resolve({ kind: "enter", messages: claimed })
  );
  const preparedCall = await llm.prepareCall({ provider: "deepseek-mock", model: "deepseek-mock" }, signal);
  const chunks = await consume(preparedCall.stream({ provider: "deepseek-mock", model: "deepseek-mock", messages: imageMessage(), signal }));
  const text = chunks.map((c) => c.text ?? "").join("");
  check("预识别调用了视觉后端", server.calls.vision.length >= 1, `vision calls=${server.calls.vision.length}`);
  check("记忆替换生效（模型收到描述）", text.includes("MOCK_VISION_OK"), text.slice(0, 120));
  await ctx.fiber.dispose?.().catch?.(() => {});
}

console.log("\n== 4. 图片记忆：后续轮次历史图片用记忆 ==");
{
  const { ctx, llm } = boot({
    config: { apiKey: "k", baseUrl: server.baseUrl, model: "mock-vision" },
  });
  const signal = new AbortController().signal;
  const id = "sha256:memory1";
  // 第一轮：图片轮（先 pre-step 预识别，再请求，模拟真实 agent-loop）
  const claimed = imageMessage(id);
  await ctx.events.waterfall(null, "agent/pre-step", { messages: claimed, turn: 1, step: 1, signal }, () =>
    Promise.resolve({ kind: "enter", messages: claimed })
  );
  const preparedCall1 = await llm.prepareCall({ provider: "deepseek-mock", model: "deepseek-mock" }, signal);
  await consume(preparedCall1.stream({ provider: "deepseek-mock", model: "deepseek-mock", messages: imageMessage(id), signal }));
  // 第二轮：文字轮（历史含图片，模拟 deriveMessages 全量重建）
  const before = server.calls.vision.length;
  const history = [
    { role: "user", content: [{ type: "text", text: "看看这张图" }, { type: "image", attachment: { attachmentId: id, mediaType: "image/png", bytes: 1, width: 1, height: 1, name: "a.png" } }] },
    { role: "assistant", source: { kind: "model", provider: "deepseek-mock", model: "deepseek-mock" }, content: [{ type: "text", text: "（上一轮回答）" }] },
    { role: "user", content: [{ type: "text", text: "继续" }] },
  ];
  const preparedCall2 = await llm.prepareCall({ provider: "deepseek-mock", model: "deepseek-mock" }, signal);
  const chunks = await consume(preparedCall2.stream({ provider: "deepseek-mock", model: "deepseek-mock", messages: history, signal }));
  const text = chunks.map((c) => c.text ?? "").join("");
  const finish2 = chunks.find((c) => c.type === "finish");
  check("第二轮正常完成", finish2?.reason?.kind === "stop", JSON.stringify(finish2?.reason));
  check("历史图片被记忆替换", text.includes("MOCK_VISION_OK"), JSON.stringify(text.slice(0, 260)));
  check("未重复调用视觉后端", server.calls.vision.length === before, `before=${before} after=${server.calls.vision.length}`);
  await ctx.fiber.dispose?.().catch?.(() => {});
}

console.log("\n== 5. vision_describe 工具：按 attachmentIds 看图 ==");
{
  const { toolDefs } = boot({ config: { apiKey: "k", baseUrl: server.baseUrl, model: "mock-vision" } });
  const tool = toolDefs.find((t) => t.name === "vision_describe");
  check("工具已注册", Boolean(tool), "vision_describe 未注册");
  if (tool) {
    const text = await tool.execute({ attachmentIds: ["sha256:tool1"], question: "图里有什么？" }, { signal: new AbortController().signal });
    check("返回视觉结果", typeof text === "string" && text.includes("MOCK_VISION_OK"), String(text).slice(0, 80));
  }
}

console.log("\n== 6. image_generate 画图 ==");
{
  const { toolDefs } = boot({
    config: { apiKey: "k", baseUrl: server.baseUrl, model: "mock-vision", genApiKey: "k", genBaseUrl: server.baseUrl, genModel: "mock-gen" },
  });
  const tool = toolDefs.find((t) => t.name === "image_generate");
  check("工具已注册", Boolean(tool), "image_generate 未注册");
  if (tool) {
    const result = await tool.execute({ prompt: "一只猫" }, { signal: new AbortController().signal });
    check("返回附件引用", Boolean(result?.image?.attachmentId), JSON.stringify(result).slice(0, 120));
  }
}

console.log("\n== 7. 系统提示段落 ==");
{
  const { ctx, tools, attachments } = boot({});
  const sp = { section(sec) { sections.push(sec); } };
  const sections = [];
  ctx.systemPrompt = sp;
  ctx.tools = tools;
  ctx.attachments = attachments;
  apply(ctx, Config_standardValidate({}));
  const text = sections.map((s) => s.text()).join("\n");
  check("含图片附件标记说明", text.includes("attachmentIds"), text.slice(0, 80));
}

await server.close();
console.log(`\n${failures === 0 ? "🎉 全部测试通过" : `❌ ${failures} 项失败`}`);
process.exitCode = failures === 0 ? 0 : 1;
