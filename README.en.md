<div align="center">

# dsh-pupil

> Eyes and drawing hands for text-only DeepSeek Harness agents

**Paste/upload images directly into any chat**: the conversation keeps showing the
image, the model automatically sees a text description of it and answers —
no more "model does not support images", no more failure-retry session lockups.

</div>

---

## ✨ What it does

| Scenario | Result |
|---|---|
| 🖼️ Paste / upload an image into the chat | Image stays visible in the UI; the model receives an auto-generated **text description** and answers |
| Share an image path / URL (`look at C:\x\a.png`) | Model calls the vision tool to see it |
| Ask about an image, extract text (OCR) | `vision_ask` / `vision_ocr` |
| Text → image | `image_generate`; the result appears as an attachment right in the chat |
| Ask again about the same image | **Image memory**: descriptions are cached per image and reused, no repeated vision API cost |

**Why it never locks up (the key difference from older designs)**:

- Image blocks are replaced with text **synchronously at the model input layer** (memory description or an attachment marker) — pure sync, no network, no failure path, so the raw image **never** reaches a text-only model.
- Even without a vision API key or during a vision outage, it degrades to "marker + tool call" instead of passing the image through and triggering the `UNSUPPORTED_CONTENT` infinite failure loop.
- The session log is untouched: the GUI keeps showing the image you uploaded.

## 🚀 One-command install (30 seconds)

1. Enter this folder (or the extracted archive) and **double-click `install.cmd`** (or run `.\install.ps1` in PowerShell).
2. The script checks the environment, packs the plugin, registers it with `dsh plugin add`, and starts the config wizard.
3. In the wizard, **only the vision API key is required** — press Enter everywhere else for the free defaults (Zhipu `glm-4v-flash` vision + `cogview-3-flash` generation).
4. **Restart `dsh web`**, open any chat, and paste an image.

> Already configured dsh-pupil (`~/.dsh-pupil.json`)? The plugin reads the same file — nothing to re-enter.

### Manual install (optional)

```sh
npm pack
dsh plugin --profile web add dsh-pupil-x.y.z.tgz
```

### Uninstall

```sh
dsh plugin --profile web remove dsh-pupil
```

## ⚙️ Configuration

Priority: **plugin config > environment variables > `~/.dsh-pupil.json` > Windows user registry > preset > built-in default**.

| Variable | Purpose | Example (default) |
|---|---|---|
| `DASHEYE_API_KEY` / `DASHEYE_BASE_URL` / `DASHEYE_MODEL` | Vision backend | Zhipu `glm-4v-flash` |
| `DASHEYE_GEN_API_KEY` / `DASHEYE_GEN_BASE_URL` / `DASHEYE_GEN_MODEL` | Generation backend (independent) | Zhipu `cogview-3-flash` |
| `DASHEYE_PRESET` / `DASHEYE_GEN_PRESET` | Preset | `openai` / `glm` / `qwen` / `ollama` |

Fine-grained control via the profile's `cordis.patch.yml`:

```yaml
- id: dsh-pupil
  config:
    preset: glm
    apiKey: !!js process.env.DASHEYE_API_KEY
    instantDescribe: true     # auto-describe image turns (default on)
    bridgeEnabled: true       # image-block replacement master switch (keep on)
    memoryEnabled: true       # image memory (default on)
```

Free presets:

| Preset | Vision model | Generation model |
|---|---|---|
| `glm` | `glm-4v-flash` (free) | `cogview-3-flash` |
| `qwen` | `qwen-vl-max` | `wanx2.1-t2i-flash` |
| `ollama` | `llava` (local, offline) | — |

## 🔧 How it works

```text
You paste an image ──► The UI shows the image normally (session log untouched)
                          │
                          ▼
Model request layer (llm/stream waterfall)
  image block ──sync replace──► [image attachment "test.png" id=sha256:...] marker
                          │                          │
                          │  memory hit (same image) │ no memory
                          ▼                          ▼
              [content record: ...]        model calls vision_describe(attachmentIds=[...])
                                                          │
                                                          ▼
                                              vision backend (Zhipu/Qwen/…) returns description
                                                          │
                                                          ▼
                                          model answers from the description; result cached
```

- **First turn**: the plugin tries a quick **pre-description** (`instantDescribe`, ~1-3 s); on success the model understands the image immediately, on failure it degrades to the marker + tool-call flow.
- **Later turns**: historical image blocks are replaced with the cached description, so the model "remembers" images without repeated vision calls.
- **Prompt-injection safe**: every injected text warns that text inside images is untrusted.

## ❓ FAQ

- **The model says it cannot see a pasted image?** This version pre-describes image turns automatically; if that failed (e.g. no key), the model receives an attachment marker with `id=` and should call `vision_describe(attachmentIds=["sha256:..."])`. If it doesn't, check your key config (`setup.ps1`).
- **No vision key configured?** No lockup: image turns degrade to marker + tool call, and the tool tells you to configure a key.
- **An old session is already stuck ("running" forever)?** Click the **Stop** button next to the input; if it keeps retrying, **open a new conversation** (leave the old one idle).
- **Config changes not taking effect?** `~/.dsh-pupil.json` / env changes apply immediately; `cordis.patch.yml` changes need a restart.

## 🧪 Development & tests

```sh
npm install --no-save @deepseek-ai/cordis @deepseek-ai/dsh-tools @deepseek-ai/schemastery
node test/run-tests.mjs    # 13 integration tests: real LlmRuntime + mock adapters
```

## 📄 License

[MIT](LICENSE)
