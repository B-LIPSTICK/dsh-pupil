// dsh-pupil 测试依赖定位：从常见位置解析 @deepseek-ai/* 包，避免强制 npm install。
// 候选顺序：1) DSH_PUPIL_DEPS 环境变量指向的目录  2) 常见源码/全局安装位置。
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

function candidateRoots() {
  const roots = [];
  if (process.env.DSH_PUPIL_DEPS) roots.push(process.env.DSH_PUPIL_DEPS);
  // 本地 node_modules（npm install 后）
  const local = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@deepseek-ai");
  if (existsSync(join(local, "cordis"))) roots.push(local);
  // 全局 dsh CLI 安装
  const globalDsh = join(homedir(), "AppData", "Roaming", "npm", "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai");
  if (existsSync(join(globalDsh, "cordis"))) roots.push(globalDsh);
  // 常见源码仓库（pupil 开发时依赖安装位置）
  const repos = [join(homedir(), "00-projects", "Github", "dsh-eye", "node_modules", "@deepseek-ai")];
  for (const r of repos) if (existsSync(join(r, "cordis"))) roots.push(r);
  return roots;
}

const roots = candidateRoots();
if (process.env.DSH_PUPIL_DEBUG) console.error("[deps] roots:", roots);

export function resolveDep(pkg, file = "lib/index.js") {
  const bare = pkg.replace(/^@deepseek-ai\//, "");
  for (const root of roots) {
    const candidate = join(root, bare, file);
    if (existsSync(candidate)) return pathToFileURL(candidate).href;
  }
  throw new Error(
    `无法定位依赖 ${pkg}。请设置 DSH_PUPIL_DEPS 指向包含 @deepseek-ai 子目录的 node_modules 目录。`
  );
}
