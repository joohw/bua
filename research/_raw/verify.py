# -*- coding: utf-8 -*-
"""Independent verification of the generated Markdown against api.json."""
import json, re, sys

SRC = r"C:\Users\15466\.codex\plugins\cache\openai-bundled\chrome\latest\docs\api.json"
OUT = r"C:\Users\15466\Documents\deepseek-harness\default-workspace\bua-research\03-codex-api-reference.md"

j = json.load(open(SRC, encoding="utf-8"))
doc = open(OUT, encoding="utf-8", newline="").read()

fails = []
def chk(cond, msg):
    if not cond:
        fails.append(msg)

# 1. counts
chk(len(j["interfaces"]) == 22, "interface count != 22")
chk(len(j["types"]) == 67, "type count != 67")

# 2. every declaration text present verbatim
missing = []
total = 0
for n, iv in j["interfaces"].items():
    for mk, mv in iv.items():
        for d in mv["declarations"]:
            total += 1
            if d["text"] not in doc:
                missing.append(("iface", n, mk, d["text"][:60]))
for n, tv in j["types"].items():
    total += 1
    if tv["text"] not in doc:
        missing.append(("type", n, "", tv["text"][:60]))
chk(not missing, f"{len(missing)} declaration texts missing verbatim: {missing[:5]}")

# 3. fenced block count == declaration count, block contents all come from source
blocks = re.findall(r"```ts\n(.*?)\n```", doc, flags=re.S)
chk(len(blocks) == total, f"block count {len(blocks)} != source decl count {total}")

src_texts = set()
for n, iv in j["interfaces"].items():
    for mk, mv in iv.items():
        for d in mv["declarations"]:
            src_texts.add(d["text"])
for n, tv in j["types"].items():
    src_texts.add(tv["text"])
extra = [b[:60] for b in blocks if b not in src_texts]
chk(not extra, f"{len(extra)} output blocks not found in source: {extra[:5]}")

# no duplicate/missing blocks vs source multiset
from collections import Counter
src_c = Counter()
for n, iv in j["interfaces"].items():
    for mk, mv in iv.items():
        for d in mv["declarations"]:
            src_c[d["text"]] += 1
for n, tv in j["types"].items():
    src_c[tv["text"]] += 1
out_c = Counter(blocks)
chk(src_c == out_c, "block multiset != source declaration multiset")

# 4. headings for every interface and type
for n in j["interfaces"]:
    chk(f"\n### {n}\n" in doc, f"missing interface heading: {n}")
for n in j["types"]:
    chk(f"\n### `{n}`\n" in doc, f"missing type heading: {n}")
# member headings
for n, iv in j["interfaces"].items():
    for mk in iv:
        chk(f"\n#### `{mk}`\n" in doc, f"missing member heading: {n}.{mk}")

# 5. unsupportedByDefaultIn annotations
ubd_members = [(n, mk, mv) for n, iv in j["interfaces"].items()
               for mk, mv in iv.items() if mv.get("unsupportedByDefaultIn")]
ubd_lines = [ln for ln in doc.split("\n") if ln.startswith("> 默认不支持: ")]
chk(len(ubd_members) == 89, f"expected 89 ubd members, got {len(ubd_members)}")
chk(len(ubd_lines) == len(ubd_members),
    f"ubd annotation line count {len(ubd_lines)} != {len(ubd_members)}")
for n, mk, mv in ubd_members:
    want = "> 默认不支持: " + ", ".join(f"`{u}`" for u in mv["unsupportedByDefaultIn"])
    chk(want in doc, f"bad ubd annotation for {n}.{mk}: {want}")

# 6. documented flags
docd = [(n, mk, mv) for n, iv in j["interfaces"].items()
        for mk, mv in iv.items() if "documented" in mv]
chk(len(docd) == 7, f"expected 7 documented members, got {len(docd)}")
for n, mk, mv in docd:
    chk(f"> documented: {str(mv['documented']).lower()}" in doc, f"missing documented for {n}.{mk}")

# 7. overload members keep all declarations adjacently
for n, mk in [("AXAPI", "get"), ("AXAPI", "write"), ("PlaywrightAPI", "waitForEvent")]:
    mv = j["interfaces"][n][mk]
    seg = doc.split(f"#### `{mk}`")[1] if f"#### `{mk}`" in doc else ""
    # find the segment right after the right heading occurrence
    idx = doc.index(f"### {n}\n")
    sub = doc[idx:]
    pos = sub.index(f"#### `{mk}`")
    tail = sub[pos:]
    nxt = tail.find("\n#### ", 5)
    seg = tail if nxt == -1 else tail[:nxt]
    got = re.findall(r"```ts\n(.*?)\n```", seg, flags=re.S)
    chk(got == [d["text"] for d in mv["declarations"]],
        f"overload mismatch for {n}.{mk}: {len(got)} blocks, expected {len(mv['declarations'])}")

# 8. references preserved
ref_missing = 0
for n, iv in j["interfaces"].items():
    for mk, mv in iv.items():
        for d in mv["declarations"]:
            if d.get("references"):
                want = "> 引用: " + ", ".join(f"`{r}`" for r in d["references"])
                if want not in doc:
                    ref_missing += 1
chk(ref_missing == 0, f"{ref_missing} references annotations missing")

# 9. file hygiene
chk("\r" not in doc, "file contains CR characters")
chk(doc.startswith("# Codex"), "unexpected file start")
chk("## 核对结果" in doc, "missing 核对结果 section")
m = re.search(r"输出文件声明条数：\*\*(\d+)\*\* 条", doc)
chk(m and int(m.group(1)) == total, "核对结果 输出 count wrong")
chk("已包含" not in doc, "placeholder text present")

print("source declaration total:", total)
print("output ts blocks:", len(blocks))
print("interfaces:", len(j["interfaces"]), "types:", len(j["types"]),
      "members:", sum(len(v) for v in j["interfaces"].values()))
print("ubd annotations:", len(ubd_lines))
print("references annotations:", len([ln for ln in doc.split("\n") if ln.startswith("> 引用: ")]))
print("file lines:", doc.count("\n") if doc.endswith("\n") else doc.count("\n") + 1)
print()
if fails:
    print("VERIFY FAILED:", len(fails))
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("VERIFY PASSED — all checks OK")
