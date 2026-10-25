/* 作战台「可见任务」判据的端到端探针 —— 由 tests/test_ops_board.py 通过 node 调用。
 *
 * 为什么要有它：2026-10-25 修的那条「搜索框写着搜物品，实际匹配的是目标 id」
 * 是个**一行字段名**的错误（`t.oids` vs `t.otxt`），构建、lint、断链检查全绿，
 * 只有真人搜一次「电线」才会发现搜不到。这类判据必须能机器复算。
 *
 * 输出一行 JSON，键即用例名。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "content", "javascripts", "ops-board.js");

function stubDoc() {
  const node = () => ({
    style: {}, dataset: {}, children: [],
    appendChild(c) { this.children.push(c); return c; },
    setAttribute() {}, addEventListener() {}, remove() {},
    classList: { toggle() {}, add() {}, remove() {} },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  });
  return {
    readyState: "complete",
    getElementById: () => null,
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: node,
    createTextNode: (t) => ({ textContent: String(t) }),
  };
}

function buildEnv() {
  const doc = stubDoc();
  const win = {
    document: doc,
    addEventListener() {},
    /* 进度账本全空：这里只验「搜索与筛选」的判据，不验状态 */
    TarkovProgress: {
      taskState: () => "",
      isIgnored: () => false,
      isPinned: () => false,
      objDone: () => false,
      mode: () => "pve",
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  win.window = win;
  const sandbox = {
    window: win, document: doc, console,
    Promise, Date, Object, String, Number, Array, JSON, Math, parseInt, RegExp,
    setTimeout, isFinite,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, "utf8"), sandbox);
  return win.TarkovOpsTest;
}

function task(name, map, otxt, oids) {
  /* 列顺序见文件头 COLS：name,en,trader,level,ms,oids,otxt,nObj,keys,flags,pr */
  return [name, name, "prapor", 1, map ? [map] : [], oids || [], otxt || "", 1, 0, "", []];
}

const ID_A = "a".repeat(24);
const ID_B = "b".repeat(24);
const ID_C = "c".repeat(24);

const out = {};

/* ① 搜目标文本（「电线」在 otxt 里，任务名里没有） */
{
  const T = buildEnv();
  T._S.idx = {
    tasks: {
      [ID_A]: task("电工", "customs", "在海关找到 3 个电线|以幸存状态撤离", ["o1"]),
      [ID_B]: task("别的活", "woods", "找到 5 个螺丝", ["o2"]),
    },
  };
  T._S.map = "customs";
  T._S.filter = "open";
  T._S.q = "电线";
  const rows = T._visible();
  out.searchTargetText = rows.map(r => r.t.name);
}

/* ② 搜目标文本搜不到的词不该命中（反向守卫：别把 hay 写成什么都匹配） */
{
  const T = buildEnv();
  T._S.idx = {
    tasks: {
      [ID_A]: task("电工", "customs", "在海关找到 3 个电线", ["o1"]),
    },
  };
  T._S.map = "customs";
  T._S.filter = "open";
  T._S.q = "柴油";
  out.searchNoFalseHit = T._visible().length;
}

/* ③ 跨图搜索时本图的票排在别图之前 */
{
  const T = buildEnv();
  T._S.idx = {
    tasks: {
      [ID_A]: task("别图甲", "woods", "找电线", ["o1"]),
      [ID_B]: task("本图乙", "customs", "找电线", ["o2"]),
      [ID_C]: task("别图丙", "shoreline", "找电线", ["o3"]),
    },
  };
  T._S.map = "customs";
  T._S.filter = "open";
  T._S.q = "电线";
  out.searchMapFirst = T._visible().map(r => r.t.name);
}

/* ④ 不搜时只看本图（原判据，防止改坏） */
{
  const T = buildEnv();
  T._S.idx = {
    tasks: {
      [ID_A]: task("别图甲", "woods", "", ["o1"]),
      [ID_B]: task("本图乙", "customs", "", ["o2"]),
    },
  };
  T._S.map = "customs";
  T._S.filter = "open";
  T._S.q = "";
  out.noQueryStaysInMap = T._visible().map(r => r.t.name);
}

/* ⑤ 行 meta 里要写出「命中的是目标文本」，否则读者不知道为什么这票上榜 */
{
  const T = buildEnv();
  T._S.idx = {
    tasks: { [ID_A]: task("电工", "customs", "在海关找到 3 个电线", ["o1"]) },
  };
  T._S.map = "customs";
  T._S.filter = "open";
  T._S.q = "电线";
  out.rowBitsHint = T._rowBits(T._visible()[0].t, ID_A);
}

/* ⑥ 出击清单按模式分账本：写 pve 不该污染 pvp */
{
  const T = buildEnv();
  out.planIsolated = typeof T._S.plan === "object" && T._S.plan !== null;
}

process.stdout.write(JSON.stringify(out) + "\n");
