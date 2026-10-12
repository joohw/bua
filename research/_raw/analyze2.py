import json

SRC = r"C:\Users\15466\.codex\plugins\cache\openai-bundled\chrome\latest\docs\api.json"
with open(SRC, encoding="utf-8") as f:
    j = json.load(f)

# documented values
for n, i in j["interfaces"].items():
    for mk, mv in i.items():
        if "documented" in mv:
            print("documented:", n, mk, repr(mv["documented"]))

# backticks / fence risk
alltexts = []
for n, i in j["interfaces"].items():
    for mk, mv in i.items():
        for d in mv["declarations"]:
            alltexts.append(("iface", n, mk, d["text"]))
for n, t in j["types"].items():
    alltexts.append(("type", n, "", t["text"]))
print("total texts:", len(alltexts))
print("containing ```:", sum(1 for x in alltexts if "```" in x[3]))
print("containing '~':", sum(1 for x in alltexts if "~" in x[3]))
print("containing '\\r':", sum(1 for x in alltexts if "\r" in x[3]))
print("containing '|':", sum(1 for x in alltexts if "|" in x[3]))
print("multiline count:", sum(1 for x in alltexts if "\n" in x[3]))
print("references non-empty:", sum(1 for x in alltexts if x[3] and False))
# max text length
print("max text len:", max(len(x[3]) for x in alltexts))

# members count
mem = sum(len(i) for i in j["interfaces"].values())
print("total members:", mem)
print("string check:", all(isinstance(x[3], str) for x in alltexts))
