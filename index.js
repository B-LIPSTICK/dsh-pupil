// dsh-pupil v0.3 · DeepSeek Harness 视觉插件
//
// 核心能力：用户把图片粘贴/上传进对话，会话界面照常显示图片，而模型输入层
// 的图片块会被同步替换为文本（记忆描述或附件标记），纯文本模型（DeepSeek）
// 永不收到图片内容 → 不再有 UNSUPPORTED_CONTENT 失败循环。
// 模型按标记调用 vision_describe / vision_ask 主动看图；描述按附件缓存，
// 后续轮次的历史图片直接以记忆替换，模型"记得"发过的图。
//
// 挂点：
//   - llm/stream 瀑布：图片块同步替换（核心防线，纯同步、零失败路径）
//   - agent/pre-step：图片轮预识别（可选，失败静默降级）+ 附件索引
//   - llm.resolveModelInfo（若存在）：声明图片输入能力（准入放行）
import { defineTool } from "@deepseek-ai/dsh-tools";
import { Config, effectiveConfig, DEFAULT_IMAGE_MARKER } from "./config.js";
import { callVisionModel, resolveImageSource, readAttachmentImage } from "./vision.js";
import { generateImage, saveImageToDisk } from "./generate.js";
import { DESCRIBE_PROMPT, OCR_PROMPT, BRIDGE_PROMPT, systemPromptSection } from "./prompts.js";
import {
  replaceImagesSync,
  messagesHaveImage,
  collectImageBlocks,
  instantDescribeBlocks,
  attachmentIdOf,
} from "./bridge.js";

export const name = "dsh-pupil";
export const inject = ["tools", "systemPrompt", "llm", "attachments"];

function shortName(source) {
  const parts = String(source ?? "").replace(/\\/g, "/").split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts[parts.length - 1] ?? source;
}

export function apply(ctx, config = {}) {
  const cfg = effectiveConfig(config);
  // attachmentId -> 视觉描述（图片记忆）
  const memory = new Map();
  const markerTemplate = () =>
    typeof config.imageMarkerTemplate === "string" && config.imageMarkerTemplate.includes("{id}")
      ? config.imageMarkerTemplate
      : DEFAULT_IMAGE_MARKER;
  const remember = (id, text) => {
    if (!cfg.memoryEnabled || !id || typeof text !== "string" || text.trim() === "") return;
    if (memory.size >= cfg.memoryMaxEntries) memory.delete(memory.keys().next().value);
    memory.set(id, text.trim());
  };
  // 附件服务：inject 已声明；再防御式获取，缺失时返回 undefined（工具降级提示）。
  const attachmentsService = () => {
    try {
      return ctx.get("attachments", false);
    } catch {
      return undefined;
    }
  };

  // ---------- 1. 模型能力声明（准入放行；方法不存在则无害跳过） ----------
  if (cfg.bridgeEnabled) {
    const llm = ctx.llm;
    if (llm && typeof llm.resolveModelInfo === "function") {
      const original = llm.resolveModelInfo.bind(llm);
      llm.resolveModelInfo = async (provider, model, signal) => {
        const info = await original(provider, model, signal);
        if (!info || typeof info !== "object") return info;
        const base = Array.isArray(info.inputModalities) ? info.inputModalities : [];
        if (base.includes("image")) return info;
        return { ...info, inputModalities: [...base, "image"] };
      };
      ctx.on("dispose", () => {
        llm.resolveModelInfo = original;
      });
    }
  }

  // ---------- 2. llm/stream：图片块同步替换（核心防线） ----------
  // 与旧版的关键区别：替换是纯同步文本操作，任何情况下都不会把原图片块
  // 透传给模型——UNSUPPORTED_CONTENT 失败循环从根上被消除。
  if (cfg.bridgeEnabled) {
    ctx.on("llm/stream", async function* (options, next) {
      if (options.purpose) {
        yield* next();
        return;
      }
      let rewritten;
      try {
        rewritten = replaceImagesSync(options.messages, cfg.memoryEnabled ? memory : null, markerTemplate());
        if (!rewritten.changed) {
          yield* next();
          return;
        }
      } catch {
        // replaceImagesSync 是纯同步函数，理论上不可达；保险起见仍走原请求
        yield* next();
        return;
      }
      // 重发替换后的消息（无图片块）。重发本身的失败会正常冒泡给 agent 层
      // 的重试机制，不会产生图片拒绝循环。
      yield* ctx.llm.stream({ ...options, messages: rewritten.messages });
    });
  }

  // ---------- 3. agent/pre-step：图片轮预识别 + 附件索引 ----------
  // 任何异常都不允许阻塞 turn：预识别失败静默降级（llm/stream 仍有标记兜底）。
  if (cfg.bridgeEnabled && (cfg.instantDescribe || cfg.indexEventLog)) {
    ctx.on("agent/pre-step", async (payload, next) => {
      let decision;
      try {
        decision = await next();
      } catch {
        throw new Error("agent/pre-step 前置监听器失败");
      }
      if (!decision || decision.kind === "reject") return decision;
      try {
        const messages = decision.messages ?? payload.messages ?? [];
        if (!messagesHaveImage(messages)) return decision;
        if (cfg.instantDescribe && cfg.memoryEnabled) {
          const blocks = collectImageBlocks(messages);
          const fresh = blocks.filter((b) => {
            const id = attachmentIdOf(b);
            return id !== undefined && !memory.has(id);
          });
          if (fresh.length > 0) {
            const map = await instantDescribeBlocks(
              attachmentsService(),
              cfg,
              fresh,
              cfg.bridgePrompt || BRIDGE_PROMPT,
              payload.signal
            );
            for (const [id, text] of map) remember(id, text);
          }
        }
      } catch {
        // 预识别失败静默：llm/stream 会用附件标记兜底，模型可调用工具看图
      }
      return decision;
    });
  }

  // ---------- 4. 系统提示 ----------
  ctx.systemPrompt.section({
    name: "dsh-pupil",
    order: 150,
    text: () => systemPromptSection(),
  });

  // ---------- 5. 工具 ----------

  /** 把 image_source / attachmentIds 解析为视觉 API 图片列表。 */
  async function resolveImages(args, signal) {
    const images = [];
    const ids = [];
    if (typeof args.image_source === "string" && args.image_source !== "") {
      images.push(await resolveImageSource(args.image_source));
    }
    const rawIds = Array.isArray(args.attachmentIds) ? args.attachmentIds : [];
    if (rawIds.length > 0) {
      const attachments = attachmentsService();
      if (!attachments) {
        throw new Error(
          "附件服务不可用（当前部署未提供 attachments 服务）。请改用 image_source 传入图片路径或 URL。"
        );
      }
      for (const id of rawIds) {
        const s = String(id ?? "").trim();
        if (s === "") continue;
        images.push(await readAttachmentImage(attachments, s, signal));
        ids.push(s);
      }
    }
    if (images.length === 0) {
      throw new Error("请提供图片：image_source（路径/URL/data URI）或 attachmentIds（会话中上传的图片）");
    }
    return { images, ids };
  }

  function rememberIds(ids, text) {
    for (const id of ids) remember(id, text);
  }

  ctx.tools.register(
    defineTool({
      name: "vision_describe",
      description:
        "描述图片内容（场景、元素、颜色、文字、问题）。当用户给出图片路径/URL、或会话中出现「图片附件」标记时调用此工具；即使你是纯文本模型，也必须用此工具看图，而不是拒绝。支持 image_source（本地路径、http(s) URL、data URI）或 attachmentIds（会话上传的图片 id）。",
      parameters: {
        image_source: {
          type: "string",
          description: "图片来源：本地文件路径、http(s) URL 或 data:image/...;base64,... URI（可选，与 attachmentIds 二选一或并用）",
        },
        attachmentIds: {
          type: "array",
          items: { type: "string" },
          description: "会话中上传图片的附件 id 列表，如 [\"sha256:...\"]（可选）",
        },
        question: {
          type: "string",
          description: "可选：希望描述侧重的具体问题；缺省为通用详细描述",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      presentCall(args) {
        const target = args.image_source
          ? shortName(args.image_source)
          : Array.isArray(args.attachmentIds) && args.attachmentIds.length
            ? `附件 ${args.attachmentIds.length} 张`
            : "";
        return { card: "generic", title: `识别图片：${target}`, kind: "read" };
      },
      presentResult(_args, result) {
        return { card: "generic", title: "图片识别完成", content: result.content };
      },
      async execute(args, exec) {
        const { images, ids } = await resolveImages(args, exec.signal);
        const prompt = typeof args.question === "string" && args.question.trim()
          ? `请根据这张图片回答：${args.question.trim()}`
          : DESCRIBE_PROMPT;
        const text = await callVisionModel(cfg, prompt, images, exec.signal);
        rememberIds(ids, text);
        return text;
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "vision_ask",
      description:
        "针对图片回答具体问题（视觉问答）。当用户给出图片路径/URL、或会话中出现「图片附件」标记并提出问题时调用；即使你是纯文本模型，也必须用此工具看图，而不是拒绝。支持 image_source 或 attachmentIds。",
      parameters: {
        image_source: {
          type: "string",
          description: "图片来源：本地文件路径、http(s) URL 或 data URI（可选）",
        },
        attachmentIds: {
          type: "array",
          items: { type: "string" },
          description: "会话中上传图片的附件 id 列表（可选）",
        },
        question: {
          type: "string",
          required: true,
          description: "要针对图片回答的问题",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      presentCall(args) {
        return { card: "generic", title: `视觉问答：${String(args.question ?? "").slice(0, 40)}`, kind: "read" };
      },
      presentResult(_args, result) {
        return { card: "generic", title: "回答完成", content: result.content };
      },
      async execute(args, exec) {
        const { images, ids } = await resolveImages(args, exec.signal);
        const text = await callVisionModel(
          cfg,
          `请根据这张图片回答：${String(args.question ?? "").slice(0, 2000)}`,
          images,
          exec.signal
        );
        rememberIds(ids, text);
        return text;
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "vision_ocr",
      description:
        "提取图片中的全部文字（OCR），保持原始排版顺序。支持 image_source 或 attachmentIds。",
      parameters: {
        image_source: {
          type: "string",
          description: "图片来源：本地文件路径、http(s) URL 或 data URI（可选）",
        },
        attachmentIds: {
          type: "array",
          items: { type: "string" },
          description: "会话中上传图片的附件 id 列表（可选）",
        },
        language: {
          type: "string",
          description: "识别语言提示，如 zh / en，默认自动识别",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => [{ type: "text", text: value }],
      },
      presentCall() {
        return { card: "generic", title: "OCR 文字识别", kind: "read" };
      },
      presentResult(_args, result) {
        return { card: "generic", title: "OCR 完成", content: result.content };
      },
      async execute(args, exec) {
        const { images, ids } = await resolveImages(args, exec.signal);
        const prompt =
          typeof args.language === "string" && args.language
            ? `${OCR_PROMPT}（优先识别语言：${args.language}）`
            : OCR_PROMPT;
        const text = await callVisionModel(cfg, prompt, images, exec.signal);
        rememberIds(ids, text);
        return text;
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "image_generate",
      description:
        "根据文字描述生成图片（画图），使用独立的绘图后端配置。生成后作为附件直接显示在对话中。",
      parameters: {
        prompt: {
          type: "string",
          required: true,
          description: "图片描述，越详细效果越好（可包含主体、风格、构图、光线）",
        },
        size: {
          type: "string",
          description: "可选生成尺寸，默认 1024x1024（如 512x512、1024x1792）",
        },
      },
      output: {
        schema: {
          type: "object",
          properties: {
            text: { type: "string", required: true },
            path: { type: "string" },
            image: { type: "json" },
          },
          additionalProperties: true,
        },
        render: (_args, value) => {
          const blocks = [];
          if (value.image) blocks.push({ type: "image", attachment: value.image });
          blocks.push({ type: "text", text: value.text });
          return blocks;
        },
      },
      presentCall(args) {
        return {
          card: "generic",
          title: `画图：${String(args.prompt ?? "").slice(0, 40)}`,
          kind: "execute",
        };
      },
      presentResult(_args, result) {
        return { card: "generic", title: "图片已生成", content: result.content };
      },
      async execute(args, exec) {
        const img = await generateImage(cfg, String(args.prompt ?? ""), args.size, exec.signal);
        const attachments = attachmentsService();
        if (attachments && typeof attachments.saveImage === "function") {
          try {
            const ref = await attachments.saveImage({
              data: img.bytes,
              mediaType: img.mediaType,
              name: `dsh-pupil-${Date.now()}`,
            });
            return {
              text: `图片已生成（${img.mediaType}，${img.bytes.length} 字节），已在对话中展示。`,
              image: ref,
            };
          } catch {
            /* 附件服务失败 → 落盘 */
          }
        }
        const file = await saveImageToDisk(img.bytes, img.ext);
        return { text: `图片已生成并保存到：${file}`, path: file };
      },
    })
  );
}

export { Config };
