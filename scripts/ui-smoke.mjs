// UI 交互冒烟：jsdom 挂载完整 React App，验证角色切换、列表/指标/日历渲染、
// 阶段推进的行内错误、助理材料登记、前台电话、筛选、导出留痕与 localStorage 持久化。
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";

const entry = path.resolve("scripts/ui-suite.tsx");
const outfile = path.resolve("scripts/ui-app.bundle.mjs");

await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  outfile,
  jsx: "automatic",
  logLevel: "silent",
  plugins: [
    {
      name: "stub-css",
      setup(b) {
        b.onResolve({ filter: /\.css$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path),
          namespace: "css-stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({ contents: "" }));
      },
    },
  ],
});

const { runUiSuite } = await import(pathToFileURL(outfile).href);

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e?.message?.split("\n").join("\n    ")}`);
  }
}

await runUiSuite({ test });
if (failures) {
  console.error(`\n${failures} 项 UI 冒烟失败`);
  process.exit(1);
}
console.log("\nUI 交互冒烟全部通过 ✅");
