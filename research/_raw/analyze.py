import json, collections

SRC = r"C:\Users\15466\.codex\plugins\cache\openai-bundled\chrome\latest\docs\api.json"
with open(SRC, encoding="utf-8") as f:
    j = json.load(f)

print("top keys:", sorted(j.keys()))
print("root:", j["root"])
print("interfaces:", len(j["interfaces"]))
print("types:", len(j["types"]))

# shape census
ishapes = collections.Counter()
for name, iface in j["interfaces"].items():
    ishapes[type(iface).__name__] += 1
tshapes = collections.Counter()
for name, t in j["types"].items():
    tshapes[type(t).__name__] += 1
print("interface value types:", ishapes)
print("type value types:", tshapes)

# member key census
memkeys = collections.Counter()
for name, iface in j["interfaces"].items():
    for mk, mv in iface.items():
        memkeys["iface:" + ",".join(sorted(mv.keys()))] += 1
for name, t in j["types"].items():
    memkeys["type:" + ",".join(sorted(t.keys()))] += 1
print("value key sets:", dict(memkeys))

# unsupportedByDefaultIn census
ubd = collections.Counter()
ubd_examples = []
for name, iface in j["interfaces"].items():
    for mk, mv in iface.items():
        if "unsupportedByDefaultIn" in mv:
            ubd[(name, mk)] += 1
            ubd_examples.append((name, mk, mv["unsupportedByDefaultIn"]))
print("members with unsupportedByDefaultIn:", len(ubd_examples))
vals = collections.Counter()
for _, _, v in ubd_examples:
    vals[json.dumps(v, sort_keys=True)] += 1
print("unsupported values:", dict(vals))
for e in ubd_examples:
    print("   UBD", e)

# any other unexpected keys
other = collections.Counter()
def walk(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            other[path + "/" + k] += 1
            walk(v, path + "/" + k)
    elif isinstance(o, list):
        for v in o:
            walk(v, path + "[]")
walk(j["interfaces"], "interfaces")
walk(j["types"], "types")
for k, v in sorted(other.items()):
    print(f"  key {k}: {v}")

# declaration counts
idecl = 0
multi = []
for name, iface in j["interfaces"].items():
    for mk, mv in iface.items():
        d = mv.get("declarations", [])
        idecl += len(d)
        if len(d) > 1:
            multi.append((name, mk, len(d)))
print("interface declarations total:", idecl)
print("members with multiple declarations:", len(multi))
for m in multi:
    print("   MULTI", m)

tdecl = 0
for name, t in j["types"].items():
    if "declarations" in t:
        print("TYPE HAS declarations!", name)
    if "text" in t:
        tdecl += 1
print("types with text:", tdecl)

# unsupportedByDefaultIn in types?
tubd = [(n, t["unsupportedByDefaultIn"]) for n, t in j["types"].items() if "unsupportedByDefaultIn" in t]
print("types with unsupportedByDefaultIn:", len(tubd))
for x in tubd:
    print("   TUBD", x)

# documentation member special
print("Agent keys:", list(j["interfaces"]["Agent"].keys()))
print("Agent.documentation:", json.dumps(j["interfaces"]["Agent"]["documentation"], ensure_ascii=False)[:500])
print()
print("grand total member-blocks:", idecl + tdecl)
print()
print("interface names:", list(j["interfaces"].keys()))
print()
print("type names:", list(j["types"].keys()))
