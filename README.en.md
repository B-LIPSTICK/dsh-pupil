<div align="center">

**English** | [简体中文](README.md)

<!-- 🎨 Logo placeholder: to be generated once a generation API key is configured -->

# 👁️ dsh-pupil

> Eyes to see images, hands to draw them — for text-only agents.

**dsh-pupil is a vision plugin for DeepSeek Harness**: pasted images are
auto-recognized, generated images render inline in the chat, follow-up questions
and OCR just work — text-only models can finally "see" and "create".
Zero dependencies, one-command install, config takes effect instantly.

![Node](https://img.shields.io/badge/Node-%3E%3D22-37e6c8?style=flat-square&labelColor=0a0f14)
![Deps](https://img.shields.io/badge/Dependencies-zero-37e6c8?style=flat-square&labelColor=0a0f14)
![License](https://img.shields.io/badge/License-MIT-ffb454?style=flat-square&labelColor=0a0f14)
![Platform](https://img.shields.io/badge/Platform-Windows%20·%20macOS%20·%20Linux-eafffb?style=flat-square&labelColor=0a0f14)

</div>

---

## What it is

**dsh-pupil is a vision plugin for DeepSeek Harness**, the plugin counterpart of the
[dsh-eye skill](https://github.com/B-LIPSTICK/dsh-eye):

| | dsh-pupil (this repo) | dsh-eye (skill repo) |
|---|---|---|
| Form | **Plugin**: registered into DSH, works automatically | **Skill**: SKILL.md + CLI scripts |
| Paste images | ✅ auto-recognized, works out of the box | ❌ needs a path/URL |
| Generate images | ✅ rendered inline in the chat | ✅ saved to disk by script |
| Config | shared `~/.dsh-eye.json` | shared `~/.dsh-eye.json` |

**In one sentence**: install the plugin for a set-and-forget experience; use the
skill for lightweight scripts. They share config and can coexist.

## Quick start (3 steps, 1 minute)

**PowerShell**

```powershell
git clone git@github.com:B-LIPSTICK/dsh-pupil.git
cd dsh-pupil
.\install.cmd
```

**cmd (or just double-click `install.cmd`)**

```cmd
git clone git@github.com:B-LIPSTICK/dsh-pupil.git
cd dsh-pupil
install.cmd
```

> ⚠️ The two shells differ: PowerShell needs the `.\` prefix, cmd does not. Can't remember? Just **double-click** `install.cmd`.

| Step | What happens | What you do |
|---|---|---|
| ① Install | `install.cmd` packs → `dsh plugin add` registers → wizard starts | double-click, press Enter |
| ② Configure | colored wizard: vision/generation backends + keys | fill in only the **vision key**; Enter for free defaults (Zhipu) |
| ③ Use | restart `dsh web` → paste an image in any chat | paste, done |

> 💡 Already configured dsh-eye (`~/.dsh-eye.json`)? The plugin reuses it — just press Enter through the wizard.

### Manual install / uninstall

```sh
npm pack && dsh plugin --profile web add dsh-pupil-*.tgz    # install
dsh plugin --profile web remove dsh-pupil                   # uninstall
```

## Features

| Scenario | Result |
|---|---|
| 🖼️ **Paste / upload an image** | Image stays visible in the UI; the model receives an auto-generated **text description** and answers |
| 🔗 Share an image path / URL | Model calls the vision tool to see it |
| ❓ Ask about an image · 📝 OCR | `vision_ask` / `vision_ocr` |
| 🎨 Text → image | `image_generate`, rendered **inline in the chat** (client-side card) |
| 🔁 Ask again about the same image | **Image memory**: descriptions cached per image, reused later |
| 🛡️ Prompt-injection guard | Every visual transcription warns that text inside images is untrusted |

## Why it never locks up

Text-only models (DeepSeek) reject image content blocks (`UNSUPPORTED_CONTENT`).
Older designs passed the image through, triggering an **infinite failure-retry
loop** that left sessions stuck in "running".

dsh-pupil eliminates the loop at the root:

- Image blocks are replaced with text **synchronously at the model input layer** (memory description or an attachment marker) — pure sync, no network, no failure path, so the raw image **never** reaches a text-only model;
- Even without a vision key or during a vision outage, it degrades to "marker + tool call" — never a passthrough;
- The session log is untouched: the GUI keeps showing the uploaded image; only the model input is rewritten.

## Usage

**In chat (most common)**

```
(paste an image directly)      → model auto-recognizes and answers
look at C:\x\a.png             → vision by path
what does this say? https://example.com/a.png  → vision by URL
draw a cyberpunk cat           → generates an image, shown inline
```

**Model-side tools** (called automatically by the model)

| Tool | Purpose |
|---|---|
| `vision_describe` | Describe images (path / URL / data URI / session `attachmentIds`) |
| `vision_ask` | Answer a specific question about an image |
| `vision_ocr` | Extract text from images |
| `image_generate` | Text → image (independent generation backend) |

## Configuration

Priority: **plugin config > environment variables > `~/.dsh-eye.json` > Windows user registry > preset > built-in default**.

| Variable | Purpose | Default |
|---|---|---|
| `DASHEYE_API_KEY` / `DASHEYE_BASE_URL` / `DASHEYE_MODEL` | Vision backend | Zhipu `glm-4v-flash` |
| `DASHEYE_GEN_API_KEY` / `DASHEYE_GEN_BASE_URL` / `DASHEYE_GEN_MODEL` | Generation backend (independent) | Zhipu `cogview-3-flash` |
| `DASHEYE_PRESET` / `DASHEYE_GEN_PRESET` | Preset | `openai` / `glm` / `qwen` / `ollama` |

Fine-grained control (profile `cordis.patch.yml`):

```yaml
- id: dsh-pupil
  config:
    preset: glm
    apiKey: !!js process.env.DASHEYE_API_KEY
    instantDescribe: true     # auto pre-describe image turns (default on)
    bridgeEnabled: true       # image-block replacement master switch (keep on)
    memoryEnabled: true       # image memory (default on)
```

Free presets:

| Preset | Vision model | Generation model |
|---|---|---|
| `glm` | `glm-4v-flash` (free) | `cogview-3-flash` |
| `qwen` | `qwen-vl-max` | `wanx2.1-t2i-flash` |
| `ollama` | `llava` (local, offline) | — |

## How it works

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

- **First turn**: the plugin tries a quick **pre-description** (`instantDescribe`, ~1-3 s); on failure it degrades to the marker + tool-call flow.
- **Later turns**: historical image blocks are replaced with cached descriptions — the model "remembers" images without repeated vision calls.
- **Generated images**: `image_generate` results carry an image attachment rendered **inline** by the client-side card (`lib/client.js`); click to open the full view.

## FAQ

- **The model says it cannot see a pasted image?** Image turns are pre-described automatically; if that failed (e.g. no key), the model receives an attachment marker with `id=` and should call `vision_describe(attachmentIds=["sha256:..."])`. If it doesn't, check your key config (`setup.ps1`).
- **No vision key configured?** No lockup: image turns degrade to marker + tool call, and the tool tells you to configure a key.
- **An old session is already stuck ("running" forever)?** Click the **Stop** button; if it keeps retrying, **open a new conversation**. New lockups are prevented at the root by this version.
- **Config changes not taking effect?** `~/.dsh-eye.json` / env changes apply immediately; `cordis.patch.yml` changes need a restart.
- **Generated image not shown?** Make sure the plugin is ≥ 0.4.0, `dsh web` was restarted, and the **browser page was refreshed** (the client rendering card needs a reload).
- **Disable pre-description?** Set `instantDescribe: false` in `cordis.patch.yml`.

## Development & tests

```sh
npm install --no-save @deepseek-ai/cordis @deepseek-ai/dsh-tools @deepseek-ai/schemastery
node test/run-tests.mjs    # 24 integration tests: real LlmRuntime + mock adapters
```

Coverage: no image passthrough (no `UNSUPPORTED_CONTENT`), no-key fallback, pre-description, image memory, attachment indexing, tool lookup by `attachmentIds`, attachment-service-missing degradation, BOM guard.

## Directory layout

```
dsh-pupil/
├── lib/
│   ├── index.js        # plugin entry: hooks (llm/stream, agent/pre-step) + 4 tools
│   ├── bridge.js       # sync image-block replacement (memory/marker, never passthrough)
│   ├── client.js       # browser half: inline generated-image rendering card
│   ├── config.js       # config resolution (schema + env + user config + registry + presets)
│   ├── vision.js       # vision API calls + image source resolution
│   ├── generate.js     # text → image
│   └── prompts.js      # system prompt section & prompts
├── test/               # integration tests (mock vision backend + real LlmRuntime)
├── install.cmd / install.ps1   # one-command install (pack + register + colored wizard)
├── setup.cmd / setup.ps1       # config wizard (standalone)
└── cordis.patch.yml    # bundle patch (registers into DSH composition)
```

## Roadmap

- [ ] Logo & brand visuals (once a generation API key is configured)
- [ ] npm release of 0.4.0 (npm still hosts the legacy 0.2.2)
- [ ] More vision backend presets (Gemini, local vLLM)
- [ ] Local OCR (tesseract) first
- [ ] Image downscaling (auto-compress large images to save tokens)

## License

[MIT](LICENSE)
