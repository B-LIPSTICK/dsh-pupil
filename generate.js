// dsh-eye · 画图：文字 → 图片（OpenAI 兼容 /images/generations）
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const NAME = "dsh-eye";

/** 根据魔数识别图片格式（不依赖扩展名）。 */
export function sniffMediaType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "webp";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "gif";
  throw new Error(`${NAME}: 生成的图片格式无法识别（仅支持 PNG/JPEG/WebP/GIF）`);
}

/**
 * 调用绘图端点，返回图片字节与格式。
 * @param config - effectiveConfig 产物（genBaseUrl/genModel/genApiKey/genSize）
 * @param prompt - 图片描述
 * @param signal - 可选取消信号
 */
export async function generateImage(config, prompt, size, signal) {
  if (!config.genApiKey) {
    throw new Error(
      `${NAME}: 未配置画图 API Key。已检查：插件配置、环境变量、~/.dsh-eye.json、用户注册表，均未找到。` +
        `请运行 install.cmd（或 setup.ps1）完成配置后重试。`
    );
  }
  const baseUrl = String(config.genBaseUrl ?? "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error(`${NAME}: 未配置画图 API 地址（DASHEYE_GEN_BASE_URL）`);
  const timeout = AbortSignal.timeout(180_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.genApiKey}`,
    },
    body: JSON.stringify({
      model: config.genModel,
      prompt,
      n: 1,
      size: size || config.genSize || "1024x1024",
    }),
    signal: combined,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${NAME}: 绘图 API ${response.status} ${response.statusText}：${body.slice(0, 400)}`);
  }
  const data = await response.json();
  const item = data?.data?.[0];
  if (!item) throw new Error(`${NAME}: 绘图 API 返回为空`);

  let bytes;
  if (item.b64_json) {
    bytes = Uint8Array.from(Buffer.from(item.b64_json, "base64"));
  } else if (item.url) {
    const imgResp = await fetch(item.url, { signal: combined });
    if (!imgResp.ok) throw new Error(`${NAME}: 下载生成图片失败 ${imgResp.status}`);
    bytes = new Uint8Array(await imgResp.arrayBuffer());
  } else {
    throw new Error(`${NAME}: 绘图 API 响应缺少 url / b64_json`);
  }
  const ext = sniffMediaType(bytes);
  const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  return { bytes, ext, mediaType };
}

/** 默认输出目录：%DSH_HOME%/storages/dsh-eye 或系统临时目录。 */
export function defaultOutDir() {
  if (process.env.DSH_HOME) return join(process.env.DSH_HOME, "storages", "dsh-eye");
  return join(tmpdir(), "dsh-eye");
}

/** 保存图片到磁盘，返回文件路径。 */
export async function saveImageToDisk(bytes, ext, outDir) {
  const dir = resolve(outDir || defaultOutDir());
  await mkdir(dir, { recursive: true });
  const file = join(dir, `dsh-eye-${Date.now()}.${ext}`);
  await writeFile(file, bytes);
  return file;
}
