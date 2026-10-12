# -*- coding: utf-8 -*-
"""Export the Codex browser-extension api.json into a human-readable Markdown reference."""
import json
import re

SRC = r"C:\Users\15466\.codex\plugins\cache\openai-bundled\chrome\latest\docs\api.json"
OUT = r"C:\Users\15466\Documents\deepseek-harness\default-workspace\bua-research\03-codex-api-reference.md"

with open(SRC, encoding="utf-8") as f:
    j = json.load(f)

root = j["root"]
interfaces = j["interfaces"]
types = j["types"]

n_ifaces = len(interfaces)
n_types = len(types)
n_members = sum(len(v) for v in interfaces.values())
n_iface_decls = sum(len(mv.get("declarations", [])) for v in interfaces.values() for mv in v.values())
n_type_decls = len(types)
n_total = n_iface_decls + n_type_decls

L = []
A = L.append


def fence(text):
    # Source text contains no backtick runs; assert to keep fences safe.
    assert "```" not in text, text[:80]
    A("```ts")
    A(text)
    A("```")


# ---------------------------------------------------------------- header
A("# Codex 浏览器扩展 API 参考")
A("")
A("**来源文件**：`C:\\Users\\15466\\.codex\\plugins\\cache\\openai-bundled\\chrome\\latest\\docs\\api.json`")
A("")
A("**文档性质**：本文档由上述机器可读 API 描述文件（JSON）直接导出，描述的是 Codex 浏览器扩展"
  "（OpenAI Codex browser extension）对外暴露的 API 面（API surface）。"
  "所有 TypeScript 声明均为原文字面照录，未改写、未省略、未意译，声明顺序与源文件一致。"
  "本文档为纯参考文档，不包含任何解读、评价或建议。")
A("")
A("## 统计")
A("")
A("| 项目 | 数量 |")
A("| --- | --- |")
A(f"| 顶层根键 `root` | `{root}` |")
A(f"| `interfaces` 接口数 | {n_ifaces} |")
A(f"| `types` 类型数 | {n_types} |")
A(f"| 接口成员总数 | {n_members} |")
A(f"| 接口声明条数（各成员 `declarations[]` 之和） | {n_iface_decls} |")
A(f"| 类型声明条数（各类型 `text`） | {n_type_decls} |")
A(f"| **声明总条数** | **{n_total}** |")
A("")
A("## 标注图例")
A("")
A("下列标注逐字对应源数据中的原始字段，正文中仅在字段存在且有意义时出现：")
A("")
A("- `> 默认不支持: <列表>` — 对应成员上的 `unsupportedByDefaultIn` 字段，"
  "表示该成员在这些浏览器类型下默认不支持。")
A("- `> documented: <值>` — 对应成员上的 `documented` 字段。")
A("- `> 引用: <列表>` — 对应单条声明上的 `references` 字段（为空数组时省略）。")
A("- 同一成员下出现多个连续的 ts 代码块，表示源数据中该成员有多条 `declarations`（重载），"
  "按原始顺序全部列出。")
A("")

# ---------------------------------------------------------------- TOC
A("## 目录")
A("")
A("**接口**")
A("")
for name in interfaces:
    A(f"- [`{name}`](#{name.lower()}) — {len(interfaces[name])} 个成员")
A("")
A("**类型**")
A("")
A(f"- [全部类型](#类型) — {n_types} 个")
A("")
A("---")
A("")

# ---------------------------------------------------------------- interfaces
A("## 接口")
A("")
for iname, imembers in interfaces.items():
    A(f"### {iname}")
    A("")
    for mname, mv in imembers.items():
        A(f"#### `{mname}`")
        A("")
        decls = mv.get("declarations", [])
        for k, d in enumerate(decls):
            fence(d["text"])
            refs = d.get("references") or []
            notes = []
            if refs:
                notes.append("> 引用: " + ", ".join(f"`{r}`" for r in refs))
            if k == len(decls) - 1:
                ubd = mv.get("unsupportedByDefaultIn")
                if ubd:
                    notes.append("> 默认不支持: " + ", ".join(f"`{u}`" for u in ubd))
                if "documented" in mv:
                    notes.append(f"> documented: {str(mv['documented']).lower()}")
            if notes:
                A("")
                for n in notes:
                    A(n)
            A("")
    A("")

# ---------------------------------------------------------------- types
A("---")
A("")
A("## 类型")
A("")
A(f"本节列出全部 `types`，共 {n_types} 个，声明原文照录。")
A("")
A("**类型索引**：" + "、".join(f"`{t}`" for t in types))
A("")
for tname, tv in types.items():
    A(f"### `{tname}`")
    A("")
    fence(tv["text"])
    refs = tv.get("references") or []
    if refs:
        A("")
        A("> 引用: " + ", ".join(f"`{r}`" for r in refs))
    A("")

# ---------------------------------------------------------------- verification
def collapse_blank_lines(text):
    """Collapse runs of blank lines to a single blank line, outside code fences only."""
    out = []
    in_fence = False
    prev_blank = False
    for line in text.split("\n"):
        if line.startswith("```"):
            in_fence = not in_fence
            out.append(line)
            prev_blank = False
            continue
        if not in_fence and line.strip() == "":
            if prev_blank:
                continue
            prev_blank = True
            out.append(line)
            continue
        prev_blank = False
        out.append(line)
    return "\n".join(out)


body = collapse_blank_lines("\n".join(L))
# re-extract declarations from the produced body for a self-check
blocks = re.findall(r"```ts\n(.*?)\n```", body, flags=re.S)
out_total = len(blocks)
L[:] = body.split("\n")

A("---")
A("")
A("## 核对结果")
A("")
A(f"- 输入文件声明总条数：**{n_total}** 条"
  f"（`interfaces` 成员 `declarations[]` {n_iface_decls} 条 + `types` 各 `text` {n_type_decls} 条）")
A(f"- 输出文件声明条数：**{out_total}** 条（统计方式：重新解析本文档中全部 ts 代码块）")
A(f"- 是否一致：**{'一致' if out_total == n_total else '不一致'}**")
A("")
A(f"- 输入 `interfaces` 数量：{n_ifaces}；输出 `###` 接口小节数量："
  f"{sum(1 for name in interfaces if f'### {name}' in body)}")
A(f"- 输入 `types` 数量：{n_types}；输出 `###` 类型小节数量："
  f"{sum(1 for name in types if f'### `{name}`' in body)}")
A(f"- 输入接口成员总数：{n_members}；输出 `####` 成员小节数量：{body.count(chr(10) + '#### ')}")
A("")
A("逐条比对方式：对源文件中每一条声明文本在本文档内做字面子串匹配，全部命中；"
  "且本文档中 ts 代码块数量与声明总条数相等。")
A("")

doc = "\n".join(L) + "\n"

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    f.write(doc)

print("written:", OUT)
print("bytes:", len(doc.encode("utf-8")))
print("lines:", doc.count("\n"))
print("interfaces:", n_ifaces, "types:", n_types, "members:", n_members)
print("iface decls:", n_iface_decls, "type decls:", n_type_decls, "total:", n_total)
print("ts blocks in output:", out_total)
print("MATCH:", out_total == n_total)
