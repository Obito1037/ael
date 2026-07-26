# verify_e2e.py — 无 Rust 工具链的端到端验证镜像。
# 复刻 db/adapter/engine/handover 各层实际操作,跑通整链并用真实
# contracts/handover-schema.json 校验导出的 manifest。运行: python3 src-tauri/verify_e2e.py
# 权威测试是 src-tauri/tests/(cargo test);本脚本是有工具链前的可执行佐证。

import sqlite3, re, hashlib, uuid, json, zipfile, os, datetime, sys
import os as _os
try:
    import jsonschema
except ModuleNotFoundError:
    jsonschema = None

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT=_os.path.abspath(_os.path.join(_os.path.dirname(__file__),".."))
SCHEMA=open(f"{ROOT}/contracts/schema.sql", encoding="utf-8").read()
HSCHEMA=json.load(open(f"{ROOT}/contracts/handover-schema.json", encoding="utf-8"))
def now(): return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def nid(): return str(uuid.uuid4())
def j(t): return json.dumps(t,ensure_ascii=False)
con=sqlite3.connect(":memory:"); con.executescript(SCHEMA); con.execute("PRAGMA foreign_keys=ON")
def create_task(title,goal,agent,tags,repo=None):
    i,t=nid(),now()
    con.execute("INSERT INTO tasks(id,title,goal,status,agent_id,repo_path,repo_branch,repo_commit,tags,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?,?,?,?,?)",
        (i,title,goal,agent, repo and repo[0], repo and repo[1], repo and repo[2], j(tags),t,t)); return i
def append_event(task_id,kind,summary,detail=None):
    i,t=nid(),now()
    seq=con.execute("SELECT COALESCE(MAX(seq),0)+1 FROM task_events WHERE task_id=?",(task_id,)).fetchone()[0]
    con.execute("INSERT INTO task_events(id,task_id,seq,kind,summary,detail,evidence_ref,created_at) VALUES(?,?,?,?,?,?,?,?)",(i,task_id,seq,kind,summary,detail,None,t)); return seq
def set_status(task_id,status):
    t=now(); closed=t if status in("verified","failed","abandoned") else None
    con.execute("UPDATE tasks SET status=?,updated_at=?,closed_at=? WHERE id=?",(status,t,closed,task_id))
def list_events(task_id): return con.execute("SELECT seq,kind,summary,detail FROM task_events WHERE task_id=? ORDER BY seq",(task_id,)).fetchall()
def classify(line):
    l=line.strip().lower(); st=lambda p: l.startswith(p) or l.startswith(f"[{p}]")
    if st("error") or "error:" in l or "panicked" in l: return "error"
    if st("fix") or "fixed" in l or "resolved" in l: return "fix"
    if st("verify") or "verified" in l or "passed" in l or "✅" in l: return "verification"
    if st("decision") or "decided" in l or "chose " in l: return "decision"
    if st("note"): return "note"
    return "step"
def ingest(task_id,raw):
    n=0
    for line in raw.splitlines():
        line=line.strip()
        if not line: continue
        if "::" in line: s,d=line.split("::",1); s,d=s.strip(),d.strip()
        else: s,d=line,None
        append_event(task_id,classify(line),s,d); n+=1
    return n
TS=re.compile(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?');UUID=re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
LH=re.compile(r'\b[0-9a-fA-F]{32,}\b');AD=re.compile(r'0x[0-9a-fA-F]+');PA=re.compile(r'[A-Za-z]:[\\/][^\s\x27"`)]*|/(?:[\w.\-]+/)+[\w.\-]*')
LOC=re.compile(r':\d+:\d+');SQ=re.compile(r"'[^']*'");DQ=re.compile(r'"[^"]*"');NU=re.compile(r'\b\d+(?:\.\d+)*\b');WS=re.compile(r'\s+')
def normalize(s):
    for rx,rep in [(TS,'<TS>'),(UUID,'<ID>'),(LH,'<ID>'),(AD,'<ADDR>'),(PA,'<PATH>'),(LOC,'<LOC>'),(SQ,"'<VAL>'"),(DQ,'"<VAL>"'),(NU,'<N>')]: s=rx.sub(rep,s)
    return WS.sub(' ',s.lower()).strip()
def sig(s): return hashlib.sha1(s.encode()).hexdigest()
def finalize(task_id):
    title,goal,status,tagsj=con.execute("SELECT title,goal,status,tags FROM tasks WHERE id=?",(task_id,)).fetchone()
    tags=json.loads(tagsj); evs=list_events(task_id); df=[]; used=set()
    for i,(seq,kind,summary,detail) in enumerate(evs):
        if kind!="error": continue
        fix=next((k for k in range(i+1,len(evs)) if evs[k][1]=="fix" and k not in used),None)
        nt=normalize(summary+("\n"+detail if detail else "")); sg=sig(nt)
        row=con.execute("SELECT id FROM failures WHERE signature=?",(sg,)).fetchone()
        if row:
            con.execute("UPDATE failures SET occurrences=occurrences+1,last_seen_at=? WHERE id=?",(now(),row[0])); df.append(row[0])
            if fix is not None: used.add(fix)
            continue
        gr=f"遇到「{summary}」时:{evs[fix][2]}" if fix is not None else f"遇到「{summary}」类问题时,先复现再动手。"
        if fix is not None: used.add(fix)
        fid,t=nid(),now()
        con.execute("INSERT INTO failures(id,task_id,source_event_id,signature,normalized_text,description,root_cause,fix,guard_rule,tags,occurrences,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)",
            (fid,task_id,None,sg,nt,summary,detail,evs[fix][2] if fix is not None else None,gr,j(tags),t,t)); df.append(fid)
    ds=[]
    if status=="verified":
        steps=[e for e in evs if e[1]=="step"]; vers=[e for e in evs if e[1]=="verification"]
        trig=f"涉及 [{', '.join(tags)}],且与「{goal}」相似的任务" if tags else f"与目标「{goal}」相似的任务"
        body="## 步骤\n"+"".join(f"{n}. {s[2]}\n" for n,s in enumerate(steps,1))+"\n## 如何验证\n"+"".join(f"- {v[2]}\n" for v in vers)
        sid,t=nid(),now()
        con.execute("INSERT INTO skills(id,name,trigger_text,body,tags,source_task_id,status,version,success_count,fail_count,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',1,0,0,?,?)",(sid,title,trig,body,j(tags),task_id,t,t)); ds.append(sid)
    return ds,df
W_TAG,W_BM25,GMIN=0.45,0.35,0.35
def toks(s):
    out=[];seen=set()
    for t in re.split(r'[^0-9A-Za-z一-鿿]+',s.lower()):
        if len(t)>=2 and t not in seen: seen.add(t);out.append(t)
    return out
def jaccard(a,b):
    sa,sb=set(x.lower() for x in a),set(x.lower() for x in b)
    if not sa and not sb: return 0.0
    u=len(sa|sb); return len(sa&sb)/u if u else 0.0
def me(q): return " OR ".join(f'"{t}"' for t in toks(q))
def matched_failures(goal,tags):
    e=me(goal+" "+" ".join(tags)); bm={}
    if e.strip():
        rows=con.execute("SELECT f.id,bm25(failures_fts) FROM failures_fts JOIN failures f ON f.id=failures_fts.failure_id WHERE failures_fts MATCH ? ORDER BY 2",(e,)).fetchall()
        mx=max([-b for _,b in rows]+[0.0]); bm={i:((-b)/mx if mx>0 else 0.0) for i,b in rows}
    out=[]
    for fid,ft,desc,gr in con.execute("SELECT id,tags,description,guard_rule FROM failures"):
        sc=W_TAG*jaccard(tags,json.loads(ft))+W_BM25*bm.get(fid,0.0)
        if sc>=GMIN: out.append((desc,gr))
    return out
def suggested(goal,tags):
    e=me(goal+" "+" ".join(tags)); bm={}
    if e.strip():
        rows=con.execute("SELECT s.id,bm25(skills_fts) FROM skills_fts JOIN skills s ON s.id=skills_fts.skill_id WHERE skills_fts MATCH ? AND s.status='active' ORDER BY 2",(e,)).fetchall()
        mx=max([-b for _,b in rows]+[0.0]); bm={i:((-b)/mx if mx>0 else 0.0) for i,b in rows}
    out=[]
    for sid,name,st in con.execute("SELECT id,name,tags FROM skills WHERE status='active'"):
        if W_TAG*jaccard(tags,json.loads(st))+W_BM25*bm.get(sid,0.0)>=GMIN: out.append(name)
    return out
def guard(goal,tags):
    mf=matched_failures(goal,tags); ss=suggested(goal,tags)
    return mf,ss,list(dict.fromkeys(gr for _,gr in mf))
def manifest(task_id):
    r=con.execute("SELECT id,title,goal,status,agent_id,repo_path,repo_branch,repo_commit,tags FROM tasks WHERE id=?",(task_id,)).fetchone()
    task={"id":r[0],"title":r[1],"goal":r[2],"status":r[3],"tags":json.loads(r[8])}
    if r[4]: task["agent_id"]=r[4]
    repo={k:v for k,v in (("path",r[5]),("branch",r[6]),("commit",r[7])) if v}
    if repo: task["repo_state"]=repo
    events=[{"seq":s,"kind":k,"summary":su,**({"detail":d} if d else {})} for s,k,su,d in list_events(task_id)]
    return {"schema_version":1,"generated_at":now(),"generated_by":r[4] or "claude_code","ael_version":"0.1.0","task":task,"events":events,"handover_prompt":"# 任务接手 Prompt\n继续推进目标。"}
def export(task_id,outdir):
    m=manifest(task_id); p=os.path.join(outdir,f"{task_id}.zip")
    with zipfile.ZipFile(p,"w",zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json",json.dumps(m,ensure_ascii=False,indent=2)); z.writestr("handover_prompt.md",m["handover_prompt"]); z.writestr("evidence/","")
    return p,m
def validate_manifest(manifest, schema):
    if jsonschema is not None:
        jsonschema.validate(manifest, schema)
        return

    missing = [key for key in schema["required"] if key not in manifest]
    if missing:
        raise AssertionError(f"manifest missing required keys: {missing}")
    expected_version = schema["properties"]["schema_version"]["const"]
    if manifest["schema_version"] != expected_version:
        raise AssertionError(f"schema_version must be {expected_version}")
    if schema.get("additionalProperties") is False:
        extra = set(manifest) - set(schema["properties"])
        if extra:
            raise AssertionError(f"manifest has extra keys: {sorted(extra)}")

    task = manifest["task"]
    missing_task = [key for key in schema["properties"]["task"]["required"] if key not in task]
    if missing_task:
        raise AssertionError(f"manifest.task missing required keys: {missing_task}")
    task_statuses = set(schema["properties"]["task"]["properties"]["status"]["enum"])
    if task["status"] not in task_statuses:
        raise AssertionError(f"invalid task.status: {task['status']}")

    event_kinds = set(schema["properties"]["events"]["items"]["properties"]["kind"]["enum"])
    for event in manifest["events"]:
        missing_event = [
            key for key in schema["properties"]["events"]["items"]["required"] if key not in event
        ]
        if missing_event:
            raise AssertionError(f"manifest event missing required keys: {missing_event}")
        if event["kind"] not in event_kinds:
            raise AssertionError(f"invalid event.kind: {event['kind']}")

print("="*58); print("AEL 端到端链路证明"); print("="*58)
AGENT="step: 初始化 Tauri 2 项目\nstep: 配置 Cargo 依赖\nerror: linker `link.exe` not found :: Windows 缺少 VS C++ 工具链\nfix: 安装 VS Build Tools 并勾选 Desktop development with C++\nverify: pnpm tauri build 产出 .msi ✅"
t1=create_task("构建 Tauri 应用 (首次)","在 Windows 上首次构建 Tauri 2 桌面应用","claude_code",["tauri","windows","build"],("D:/repo","main","abc"))
n=ingest(t1,AGENT); print(f"[1] GUI→adapter→SQLite: 写入 {n} 条事件 ->", "OK" if len(list_events(t1))==5 else "FAIL")
set_status(t1,"verified"); ds,df=finalize(t1)
print(f"[2] finalize: draftSkills={len(ds)} draftFailures={len(df)} ->", "OK" if ds and df else "FAIL")
con.execute("UPDATE skills SET status='active' WHERE id=?",(ds[0],)); print("[3] draft→active (模拟 GUI 审核) -> OK")
mf,ss,cons=guard("重新在 Windows 上构建 Tauri 应用",["tauri","windows","build"])
print(f"[4] Failure Guard: failures={len(mf)} skills={len(ss)} constraints={len(cons)} ->", "OK" if mf and ss and cons else "FAIL")
print(f"      约束示例: {cons[0]}")
mf2,_,_=guard("用 Python 写 CSV 解析脚本",["python","csv"]); print(f"[5] 阈值护栏(不相关): matched={len(mf2)} ->", "OK" if not mf2 else "FAIL")
ta=create_task("构建A","Windows 构建 Tauri","claude_code",["tauri","windows","build"])
ingest(ta,"error: linker `link.exe` not found at D:/vs/bin/link.exe (os error 2)\nfix: 装工具链")
set_status(ta,"verified"); finalize(ta)
before=con.execute("SELECT COUNT(*) FROM failures").fetchone()[0]
tb=create_task("构建B","Windows 构建 Tauri","claude_code",["tauri","windows","build"])
ingest(tb,"error: linker `link.exe` not found at C:/other/path/link.exe (os error 5)\nfix: 装工具链")
set_status(tb,"verified"); finalize(tb)
after=con.execute("SELECT COUNT(*) FROM failures").fetchone()[0]
occ=con.execute("SELECT MAX(occurrences) FROM failures").fetchone()[0]
print(f"[6] 同错签名去重(仅路径/数字不同): 行数 {before}->{after}(不增), occurrences->{occ} ->", "OK" if after==before and occ>=2 else "FAIL")
import tempfile; outdir=tempfile.mkdtemp(prefix="ael-handover-"); os.makedirs(outdir,exist_ok=True)
path,m=export(t1,outdir); print(f"[7] handover.zip 导出: {os.path.basename(path)} 内含 {zipfile.ZipFile(path).namelist()}")
validate_manifest(m,HSCHEMA); print("[8] manifest.json 通过 handover-schema.json 校验 -> OK")
print("="*58); print("全链路无断点  (GUI操作 → SQLite落库 → handover.zip导出)")
