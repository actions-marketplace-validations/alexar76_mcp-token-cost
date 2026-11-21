#!/usr/bin/env python3
"""Build data/distribution.json: how many tokens MCP tool lists cost, over every server HISTOR observes.

Reads one HISTOR weekly snapshot (CC BY 4.0, https://histor.modelmarket.dev/datasets/), streaming its 3.5 GB
toolsets file, and counts each listed server's current tool list the way mcp-token-cost counts yours:
for each tool {"name","description","input_schema"} as compact JSON, tokenizer o200k_base (tiktoken).

    curl -s https://histor.modelmarket.dev/datasets/2026-11-16/toolsets.jsonl.gz | gzip -dc | \
      python3 build_distribution.py <folder with servers.jsonl.gz and manifest.json> - ../data/distribution.json
"""
import gzip
import json
import sys
import urllib.parse

import tiktoken

ENC = tiktoken.get_encoding("o200k_base")
QS = [10, 25, 50, 75, 90, 95, 99]


def _json(v):
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def n(text):
    return len(ENC.encode_ordinary(text)) if text else 0


def count(tools):
    """HISTOR's method (histor/toolcost.py): a list costs the sum of its tools; parts are counted as JSON values."""
    total = names = descs = schemas = k = 0
    for t in tools:
        if not isinstance(t, dict):
            continue
        s = {"name": t.get("name"), "description": t.get("description") or "", "input_schema": t.get("inputSchema") or {"type": "object"}}
        total += n(_json(s))
        names += n(_json(s["name"]))
        descs += n(_json(s["description"]))
        schemas += n(_json(s["input_schema"]))
        k += 1
    return {"total": total, "names": names, "descriptions": descs, "inputSchemas": schemas, "tools": k}


def quantiles(values):
    v = sorted(values)
    if not v:
        return {}
    out = {f"p{q}": v[min(len(v) - 1, int(round(q / 100 * (len(v) - 1))))] for q in QS}
    out.update(min=v[0], max=v[-1], mean=round(sum(v) / len(v), 1), n=len(v))
    return out


def main(folder, toolsets, out):
    manifest = json.load(open(f"{folder}/manifest.json", encoding="utf-8"))
    want = {}
    with gzip.open(f"{folder}/servers.jsonl.gz", "rt", encoding="utf-8") as fh:
        for line in fh:
            s = json.loads(line)
            if s.get("delisted") or not s.get("toolSetDigest"):
                continue
            ep = s.get("endpoint") or ""
            if ep.startswith(("npm:", "pypi:")):
                kind, owner = "package", ep
            else:
                kind, owner = "remote", (urllib.parse.urlsplit(ep).hostname or ep).lower()
            want.setdefault(s["toolSetDigest"], []).append((kind, owner))
    counts = {}
    src = sys.stdin if toolsets == "-" else gzip.open(toolsets, "rt", encoding="utf-8")
    for line in src:
        r = json.loads(line)
        if r.get("digest") not in want or r["digest"] in counts:
            continue
        tools = r["toolsJson"]
        tools = json.loads(tools) if isinstance(tools, str) else tools
        if isinstance(tools, list) and tools:
            counts[r["digest"]] = count(tools)
    per_server = {"package": [], "remote": []}
    per_list = {}  # one row per distinct tool list: the population a percentile is read against
    per_host = {}  # remote: one row per host (its heaviest list), packages: one per package
    for digest, owners in want.items():
        c = counts.get(digest)
        if not c:
            continue
        for kind, owner in owners:
            per_server[kind].append(c)
            key = (kind, owner)
            if key not in per_host or per_host[key]["total"] < c["total"]:
                per_host[key] = c
        per_list[digest] = c
    fields = ("total", "descriptions", "inputSchemas", "names", "tools")
    q = lambda rows: {f: quantiles([r[f] for r in rows]) for f in fields}
    lists = list(per_list.values())
    hosts = list(per_host.values())
    curve = lambda rows: (lambda t: [t[min(len(t) - 1, int(round(p / 100 * (len(t) - 1))))] for p in range(0, 101)])(sorted(r["total"] for r in rows))
    result = {
        "source": {"dataset": f"https://histor.modelmarket.dev/datasets/{manifest['createdAt'][:10]}/",
                   "createdAt": manifest["createdAt"], "treeHead": manifest["treeHead"]["rootHash"],
                   "treeSize": manifest["treeHead"]["treeSize"], "license": "CC-BY-4.0"},
        "method": "HISTOR tool-cost method: each tool {name, description, input_schema} as compact JSON, a list = sum of its tools, o200k_base encode_ordinary (tiktoken "
                  + tiktoken.__version__ + ")",
        "population": "one tool list per owner: each npm or PyPI package, and each remote host (its heaviest current list), so a publisher that serves near-identical lists on many endpoints counts once; percentiles are read against this (perOwner)",
        "counts": {"owners": len(hosts), "servers": sum(len(v) for v in per_server.values()), "packages": len(per_server["package"]),
                   "remoteServers": len(per_server["remote"]), "distinctLists": len(lists),
                   "remoteHosts": sum(1 for k in per_host if k[0] == "remote")},
        "all": q(hosts),
        "perServer": {k: q(v) for k, v in per_server.items()},
        "perDistinctList": q(lists),
        "allTotalPercentiles": curve(hosts),
        "distinctListPercentiles": curve(lists),
    }
    json.dump(result, open(out, "w"), indent=1)
    print(json.dumps({"counts": result["counts"], "median_owner": result["all"]["total"]["p50"],
                      "median_lists": result["perDistinctList"]["total"]["p50"]}))


if __name__ == "__main__":
    main(*sys.argv[1:4])
