// dsh-pupil 测试用 mock 视觉后端（OpenAI 兼容）
import { createServer } from "node:http";

export const PNG_1PX = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89, 0, 0, 0, 0x0d,
  0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x0, 0x6, 0x0, 0x5, 0x5, 0x1, 0x2d, 0x0, 0x2e, 0x91, 0x87, 0x1e, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

/**
 * 启动 mock 视觉后端。
 * @param options.visionContent - chat/completions 返回的 content
 * @param options.failVision - 若为 true，chat/completions 返回 500
 * @returns { baseUrl, close, calls } calls 记录每次请求摘要
 */
export async function createMockServer({ visionContent = "MOCK_VISION_OK", failVision = false } = {}) {
  const calls = { vision: [], gen: [] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = {};
      }
      if (req.url.includes("/chat/completions")) {
        const hasImage = JSON.stringify(body).includes('"image_url"');
        calls.vision.push({ hasImage, model: parsed.model, prompt: parsed.messages?.[0]?.content?.[0]?.text });
        if (failVision) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "mock vision failure" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: visionContent } }] }));
        return;
      }
      if (req.url.includes("/images/generations")) {
        calls.gen.push({ model: parsed.model, prompt: parsed.prompt });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ b64_json: Buffer.from(PNG_1PX).toString("base64") }],
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
