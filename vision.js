// dsh-eye · 视觉模型调用与图片源解析
// 支持：本地路径 / http(s) URL / data URI / 会话附件引用（attachmentId）。
// 任何失败都抛出带可读中文信息的 Error，由调用方决定降级策略。
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const EXT_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 大图保护：超限给出可操作提示而不是晦涩的 4xx。 */
function assertWithinLimit(base64Length, label) {
  if (base64Length > MAX_IMAGE_BYTES * 1.34 + 64) {
    const approxMB = Math.round((base64Length / 1.34 / 1024 / 1024) * 10) / 10;
    throw new Error(
      `dsh-eye: ${label} 体积过大（约 ${approxMB}MB），超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 上限。` +
        `请先用图片工具缩小尺寸或压缩后再试。`
    );
  }
}

/**
 * 把图片来源解析为 OpenAI 兼容 image_url 内容。
 * 支持：本地路径、http(s) URL、data URI。
 */
export async function resolveImageSource(source) {
  if (typeof source !== "string" || source === "") {
    throw new Error("dsh-eye: 图片来源为空");
  }
  if (source.startsWith("data:")) {
    const comma = source.indexOf(",");
    if (comma < 0) throw new Error("无效的 data URI：缺少逗号");
    const header = source.slice(5, comma);
    const mime = /^([^;]+)/.exec(header)?.[1] ?? "application/octet-stream";
    const dataBase64 = source.slice(comma + 1);
    assertWithinLimit(dataBase64.length, "data URI 图片");
    return { mime, dataBase64 };
  }
  if (/^https?:\/\//i.test(source)) {
    return { url: source };
  }
  const data = await readFile(source);
  const mime = EXT_MIME[extname(source).toLowerCase()] ?? "application/octet-stream";
  const dataBase64 = data.toString("base64");
  assertWithinLimit(dataBase64.length, `本地图片 ${source}`);
  return { mime, dataBase64 };
}

function imageContentPart(image) {
  if ("url" in image) {
    return { type: "image_url", image_url: { url: image.url } };
  }
  return {
    type: "image_url",
    image_url: { url: `data:${image.mime};base64,${image.dataBase64}` },
  };
}

function readableApiError(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed.error?.message) return `${parsed.error.message}`.slice(0, 400);
  } catch {
    /* 非 JSON body */
  }
  return String(body ?? "").slice(0, 400);
}

/**
 * 调用 OpenAI 兼容视觉模型。
 * @param config - effectiveConfig 产物（baseUrl/model/apiKey/maxTokens/timeoutMs）
 * @param prompt - 文本指令
 * @param images - 单张（resolveImageSource 产物）或数组
 * @param signal - 可选取消信号
 */
export async function callVisionModel(config, prompt, images, signal) {
  if (!config.apiKey) {
    throw new Error(
      `dsh-eye: 未配置视觉 API Key。已检查：插件配置、环境变量、~/.dsh-eye.json、用户注册表，均未找到。` +
        `请运行 install.cmd（或 setup.ps1）完成配置后重试。`
    );
  }
  const baseUrl = String(config.baseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("dsh-eye: 未配置视觉 API 地址（DASHEYE_BASE_URL）");
  const timeout = AbortSignal.timeout(config.timeoutMs || 120_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const list = Array.isArray(images) ? images : [images];
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.maxTokens || 1024,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: prompt }, ...list.map(imageContentPart)],
        },
      ],
    }),
    signal: combined,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`视觉 API ${response.status} ${response.statusText}: ${readableApiError(body)}`);
  }
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("视觉 API 返回为空");
  }
  return content.trim();
}

/**
 * 从会话附件存储读取图片字节。
 * @param attachments - ctx.attachments 服务
 * @param ref - 完整的 ImageAttachmentRef（attachmentId + mediaType + bytes + width + height）。
 *        附件存储会校验引用与文件元数据一致性，缺字段会抛 ATTACHMENT_CORRUPT。
 * @param signal - 可选取消信号
 */
export async function readAttachmentImage(attachments, ref, signal) {
  if (!ref || typeof ref.attachmentId !== "string" || ref.attachmentId === "") {
    throw new Error("无效的附件引用：缺少 attachmentId");
  }
  const stored = await attachments.readImage(ref, signal);
  if (!stored?.data || stored.data.byteLength === 0) {
    throw new Error(`附件读取失败（${ref.attachmentId}）`);
  }
  const mime = stored.ref?.mediaType ?? ref.mediaType ?? "image/png";
  return { mime, dataBase64: Buffer.from(stored.data).toString("base64") };
}
