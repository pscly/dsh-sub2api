/**
 * Client-module load test.
 *
 * The browser entry is not a normal module: DSH loads it through
 * `window.__ModuleLoader__.load({id, factory})` and hands the factory a
 * `require` for the host's shared React. This test reproduces exactly that
 * contract, so a broken bundle fails here instead of in the settings page.
 */

import assert from "node:assert/strict";

const results = [];
function pass(label, detail = "") {
  results.push({ ok: true, label });
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label, error) {
  results.push({ ok: false, label, detail: String(error?.message ?? error) });
  console.log(`  ✗ ${label} — ${String(error?.message ?? error)}`);
}

/** The smallest React stand-in that satisfies module-scope destructuring. */
class ComponentStub {
  constructor(props) { this.props = props; }
  setState(next) { this.state = { ...this.state, ...next }; }
  render() { return null; }
}
ComponentStub.getDerivedStateFromError = () => ({ error: null });

const reactStub = {
  Component: ComponentStub,
  createElement: (...args) => ({ type: args[0], props: args[1] ?? {} }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (initial) => ({ current: initial }),
  useMemo: (fn) => fn(),
};

let captured;
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition;
    },
  },
};

console.log("\n[client] 模块加载");
try {
  await import("../lib/client.js");
  assert.ok(captured, "没有调用 window.__ModuleLoader__.load");
  assert.equal(captured.id, "dsh-sub2api");
  assert.equal(typeof captured.factory, "function");
  pass("调用了 ModuleLoader.load", captured.id);
} catch (error) {
  fail("ModuleLoader 契约", error);
}

console.log("\n[client] 工厂与导出");
let moduleExports;
try {
  moduleExports = captured.factory((name) => {
    if (name === "react") return reactStub;
    if (name === "react/jsx-runtime") return { jsx: reactStub.createElement };
    throw new Error(`未预期的 require:${name}`);
  });
  assert.equal(typeof moduleExports.apply, "function");
  assert.deepEqual(moduleExports.inject, ["slots"]);
  assert.equal(typeof moduleExports.Section, "function");
  pass("工厂返回 apply / inject / Section");
} catch (error) {
  fail("工厂执行", error);
}

console.log("\n[client] 插槽注册");
try {
  const registered = [];
  const injected = [];
  const ctx = {
    slots: {
      inject(name, run) {
        injected.push(name);
        run();
      },
      register(spec, component) {
        registered.push({ name: spec.name, id: spec.id, order: spec.order, label: spec.label, component });
        return () => {};
      },
    },
  };

  moduleExports.apply(ctx);

  assert.ok(injected.includes("settings.section"), "应当注入 settings.section");
  const section = registered.find((entry) => entry.name === "settings.section");
  assert.ok(section, "缺少设置页注册");
  assert.equal(section.id, "sub2api");
  assert.equal(section.label(), "Psapi");
  assert.equal(typeof section.component, "function");

  const sidebar = registered.find((entry) => entry.name === "sidebar.footer.action");
  assert.ok(sidebar, "缺少侧边栏卡片注册");
  pass("注册了设置页与侧边栏", registered.map((entry) => entry.id).join("、"));
} catch (error) {
  fail("插槽注册", error);
}

console.log("\n[client] 折叠状态记忆");
try {
  const api = moduleExports;
  const sections = api.__sections;
  assert.ok(sections, "没有导出折叠状态工具");

  globalThis.window.localStorage = {
    getItem: () => JSON.stringify({ recharge: true, account: false }),
    setItem: () => {},
  };
  const restored = sections.readOpenSections();
  assert.equal(restored.recharge, true, "已展开的区块应保持展开");
  assert.equal(restored.account, false, "已折叠的区块应保持折叠");
  assert.equal(restored.models, true, "未记录的区块用默认值");

  globalThis.window.localStorage = {
    getItem: () => { throw new Error("storage disabled"); },
    setItem: () => {},
  };
  assert.deepEqual(sections.readOpenSections(), sections.DEFAULT_OPEN, "读取失败应回落到默认展开");
  pass("折叠状态记忆", "恢复与降级都对");
} catch (error) {
  fail("折叠状态记忆", error);
}

console.log("\n[client] 缺少插槽时的降级");
try {
  // A host without the sidebar slot must not break the settings page.
  const ctx = {
    slots: {
      inject(name, run) {
        if (name === "sidebar.footer.action") throw new Error("no such slot");
        run();
      },
      register: () => () => {},
    },
  };
  moduleExports.apply(ctx);
  pass("侧边栏不可用时不抛错");
} catch (error) {
  fail("缺槽降级", error);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
