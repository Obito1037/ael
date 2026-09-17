# verify_scenarios.py — Phase 3 两个验收场景的可执行佐证(无 Rust 工具链时用)。
# 复刻 db/engine 实际操作,跑通两个场景,并打印场景 2 真实生成的接手 Prompt。
# 权威测试是 src-tauri/tests/scenarios_tests.rs(cargo test)。
import sqlite3, re, hashlib, uuid, json, os, datetime, sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA = open(f"{ROOT}/contracts/schema.sql", encoding="utf-8").read()

def now(): return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
def nid(): return str(uuid.uuid4())
def j(t): return json.dumps(t, ensure_ascii=False)

con = sqlite3.connect(":memory:"); con.executescript(SCHEMA); con.execute("PRAGMA foreign_keys=ON")

def create_task(title, goal, agent, tags, repo=None):
    i, t = nid(), now()
    con.execute("INSERT INTO tasks(id,title,goal,status,agent_id,repo_path,repo_branch,repo_commit,tags,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?,?,?,?,?)",
        (i, title, goal, agent, repo and repo[0], repo and repo[1], repo and repo[2], j(tags), t, t)); return i
def append_event(task_id, kind, summary, detail=None):
    i, t = nid(), now()
    seq = con.execute("SELECT COALESCE(MAX(seq),0)+1 FROM task_events WHERE task_id=?", (task_id,)).fetchone()[0]
    con.execute("INSERT INTO task_events(id,task_id,seq,kind,summary,detail,evidence_ref,created_at) VALUES(?,?,?,?,?,?,?,?)", (i, task_id, seq, kind, summary, detail, None, t))
def set_status(task_id, status):
    t = now(); closed = t if status in ("verified","failed","abandoned") else None
    con.execute("UPDATE tasks SET status=?,updated_at=?,closed_at=? WHERE id=?", (status, t, closed, task_id))
def get_task(task_id): return con.execute("SELECT id,title,goal,status,agent_id,repo_path,repo_branch,repo_commit,tags FROM tasks WHERE id=?", (task_id,)).fetchone()
def list_events(task_id): return con.execute("SELECT seq,kind,summary,detail FROM task_events WHERE task_id=? ORDER BY seq", (task_id,)).fetchall()

# normalize + signature
TS=re.compile(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?');UUID=re.compile(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}')
LH=re.compile(r'\b[0-9a-fA-F]{32,}\b');AD=re.compile(r'0x[0-9a-fA-F]+');PA=re.compile(r'[A-Za-z]:[\\/][^\s\x27"`)]*|/(?:[\w.\-]+/)+[\w.\-]*')
LOC=re.compile(r':\d+:\d+');SQ=re.compile(r"'[^']*'");DQ=re.compile(r'"[^"]*"');NU=re.compile(r'\b\d+(?:\.\d+)*\b');WS=re.compile(r'\s+')
def normalize(s):
    for rx,rep in [(TS,'<TS>'),(UUID,'<ID>'),(LH,'<ID>'),(AD,'<ADDR>'),(PA,'<PATH>'),(LOC,'<LOC>'),(SQ,"'<VAL>'"),(DQ,'"<VAL>"'),(NU,'<N>')]: s=rx.sub(rep,s)
    return WS.sub(' ', s.lower()).strip()
def sig(s): return hashlib.sha1(s.encode()).hexdigest()

def finalize(task_id):
    _,title,goal,status,_,_,_,_,tagsj = get_task(task_id); tags=json.loads(tagsj)
    evs=list_events(task_id); df=[]; used=set()
    for i,(seq,kind,summary,detail) in enumerate(evs):
        if kind!="error": continue
        fix=next((k for k in range(i+1,len(evs)) if evs[k][1]=="fix" and k not in used),None)
        nt=normalize(summary+("\n"+detail if detail else "")); sg=sig(nt)
        row=con.execute("SELECT id FROM failures WHERE signature=?",(sg,)).fetchone()
        if row:
            con.execute("UPDATE failures SET occurrences=occurrences+1,last_seen_at=? WHERE id=?",(now(),row[0])); df.append(row[0])
            if fix is not None: used.add(fix); continue
        gr=f"遇到「{summary}」时:{evs[fix][2]}" if fix is not None else f"遇到「{summary}」类问题时,先复现再动手。"
        if fix is not None: used.add(fix)
        fid,t=nid(),now()
        con.execute("INSERT INTO failures(id,task_id,source_event_id,signature,normalized_text,description,root_cause,fix,guard_rule,tags,occurrences,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)",
            (fid,task_id,None,sg,nt,summary,detail,evs[fix][2] if fix is not None else None,gr,j(tags),t,t)); df.append((fid,gr))
    return df

W_TAG,W_BM25,GMIN=0.45,0.35,0.35
def toks(s):
    out=[];seen=set()
    for t in re.split(r'[^0-9A-Za-z一-鿿]+', s.lower()):
        if len(t)>=2 and t not in seen: seen.add(t); out.append(t)
    return out
def jaccard(a,b):
    sa,sb=set(x.lower() for x in a),set(x.lower() for x in b)
    if not sa and not sb: return 0.0
    u=len(sa|sb); return len(sa&sb)/u if u else 0.0
def me(q): return " OR ".join(f'"{t}"' for t in toks(q))
def check_guard(goal,tags):
    e=me(goal+" "+" ".join(tags)); bm={}
    if e.strip():
        rows=con.execute("SELECT f.id,bm25(failures_fts) FROM failures_fts JOIN failures f ON f.id=failures_fts.failure_id WHERE failures_fts MATCH ? ORDER BY 2",(e,)).fetchall()
        mx=max([-b for _,b in rows]+[0.0]); bm={i:((-b)/mx if mx>0 else 0.0) for i,b in rows}
    mf=[]
    for fid,ft,desc,gr in con.execute("SELECT id,tags,description,guard_rule FROM failures"):
        if W_TAG*jaccard(tags,json.loads(ft))+W_BM25*bm.get(fid,0.0)>=GMIN: mf.append((desc,gr))
    return mf, list(dict.fromkeys(gr for _,gr in mf))

LABEL={"step":"步骤","error":"错误","fix":"修复","verification":"验证","decision":"决策","note":"备注"}
def generate_handover_prompt(task_id):
    _,title,goal,status,agent,rp,rb,rc,tagsj=get_task(task_id); tags=json.loads(tagsj); evs=list_events(task_id)
    mf,_=check_guard(goal,tags)
    p=[]; p.append("# 任务接手 Prompt\n"); p.append("你将接手一个进行中的任务。读完本文即可继续,无需向人重新确认上下文。\n")
    p.append("## 任务"); p.append(f"- 标题:{title}"); p.append(f"- 目标:{goal}"); p.append(f"- 状态:{status}")
    if tags: p.append(f"- 标签:{', '.join(tags)}")
    if rp: p.append(f"- 仓库:{rp}(branch {rb or '-'} @ {rc or '-'});接手前请把工作树对齐到该 commit/branch。")
    p.append("\n## 已经做了什么(证据链,按时序)")
    for s_,k,su,d in evs:
        p.append(f"{s_:>3}. [{LABEL[k]}] {su}")
        if d: p.append(f"      ↳ {d}")
    # 本任务的坑与决策
    pit=[]; used=set()
    for i,(s_,k,su,d) in enumerate(evs):
        if k!="error": continue
        fx=next((m for m in range(i+1,len(evs)) if evs[m][1]=="fix" and m not in used),None)
        if fx is not None: used.add(fx)
        pit.append((su, evs[fx][2] if fx is not None else None))
    dec=[(su,d) for _,k,su,d in evs if k=="decision"]
    if pit or dec:
        p.append("\n## 此前的坑与决策(本任务,接手必读)")
        for prob,fix in pit:
            p.append(f"- 坑:{prob}  →  已处理:{fix}" if fix else f"- 坑(尚未解决):{prob}")
        for d_,r in dec:
            p.append(f"- 决策:{d_}(理由:{r})" if r else f"- 决策:{d_}")
    if mf:
        p.append("\n## 必须规避的坑(历史失败)")
        for desc,gr in mf: p.append(f"- {desc} → 约束:{gr}")
    p.append("\n## 你的下一步")
    p.append("先对齐上面的约束与未决问题,再继续推进目标。每做一步,把过程作为新事件追加到本任务的证据链,便于下一次交接。")
    return "\n".join(p)

# ================= 场景 1 =================
print("="*60); print("场景 1 · 不重复犯错"); print("="*60)
tags=["tauri","windows","build"]
a=create_task("首次构建 Tauri","在 Windows 上构建 Tauri 2 桌面应用","claude_code",tags)
append_event(a,"step","配置 Cargo 依赖")
append_event(a,"error","linker `link.exe` not found","Windows 缺少 VS C++ 工具链")
append_event(a,"fix","安装 VS Build Tools 并勾选 C++ 桌面开发")
set_status(a,"failed")
df=finalize(a)
fid,gr=df[0]
hassig=con.execute("SELECT signature,guard_rule FROM failures WHERE id=?",(fid,)).fetchone()
print(f"制造失败 → 进 failures: signature={hassig[0][:12]}…  guard_rule 非空={bool(hassig[1])}")
mf,cons=check_guard("再次在 Windows 上构建 Tauri 应用",tags)
ok1 = bool(mf) and bool(cons) and cons[0]==gr
print(f"相似新任务开始 → Guard 命中={len(mf)} 注入约束={len(cons)}")
print(f"  注入: {cons[0]}")
print("场景 1 ->", "PASS ✅" if ok1 else "FAIL ❌")

# ================= 场景 2 =================
print("\n"+"="*60); print("场景 2 · 零上下文接手"); print("="*60)
b=create_task("实现登录模块","为应用实现 JWT 登录与会话刷新","claude_code",["auth","frontend"],("D:/app","feat/auth","9a8b7c"))
append_event(b,"step","搭建登录路由与表单")
append_event(b,"decision","采用 JWT 而非服务端 session","前后端分离、无状态,水平扩展更简单")
append_event(b,"error","token 校验中间件返回 401","密钥读取早于环境变量加载")
append_event(b,"fix","调整初始化顺序,先加载 env 再注册中间件")
append_event(b,"step","刷新令牌逻辑写到一半,尚未完成")
set_status(b,"blocked")
prompt=generate_handover_prompt(b)
need=["实现登录模块","JWT","无状态","401","初始化顺序","feat/auth","9a8b7c","你的下一步"]
ok2=all(x in prompt for x in need)
print("交接 Prompt 自给自足检查:", "PASS ✅" if ok2 else "FAIL ❌")
print(f"  覆盖要点: {[x for x in need if x in prompt]}")
print("\n----- 实际生成的接手 Prompt(交给另一个 agent 即可继续)-----\n")
print(prompt)
print("\n"+"="*60)
print("两个验收场景:", "全部通过 ✅" if (ok1 and ok2) else "存在失败 ❌")
