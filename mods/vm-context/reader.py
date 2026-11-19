# Context use of a Claude Code session, from the process id of its `claude`.
# ~/.claude/sessions/<pid>.json names the session; its transcript records the
# token usage of every reply: input + cache reads + cache writes = context.
import glob, json, os, sys

POINTS = 48
home = os.path.expanduser("~/.claude")
try:
    session = json.load(open(f"{home}/sessions/{sys.argv[1]}.json"))["sessionId"]
except Exception:
    print(json.dumps({"error": "no session"})); sys.exit()
files = glob.glob(f"{home}/projects/*/{session}.jsonl")
if not files:
    print(json.dumps({"session": session, "used": None})); sys.exit()
usage, model = {}, None
with open(max(files, key=os.path.getmtime), "rb") as f:
    for line in f:
        if b'"usage"' not in line or b'"assistant"' not in line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("type") != "assistant" or d.get("isSidechain"):
            continue
        m = d.get("message") or {}
        u = m.get("usage") or {}
        total = sum(u.get(k) or 0 for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
        if not total:
            continue
        # One reply's blocks share a request: the last one wins, order is kept.
        usage[d.get("requestId") or m.get("id") or len(usage)] = total
        if m.get("model") and not m["model"].startswith("<"):
            model = m["model"]
pts = list(usage.values())
if len(pts) > POINTS:
    step = len(pts) / POINTS
    pts = [pts[min(len(pts) - 1, int((i + 1) * step) - 1)] for i in range(POINTS)]
print(json.dumps({"session": session, "model": model, "used": pts[-1] if pts else None, "points": pts}))
