import sqlite3, sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

con = sqlite3.connect(":memory:")
con.execute("PRAGMA foreign_keys=ON")
contract_dir = Path(__file__).resolve().parent
schema = (contract_dir / "schema.sql").read_text(encoding="utf-8")

# 1) schema executes
try:
    con.executescript(schema)
    print("[1] schema executescript: OK")
except Exception as e:
    print("[1] FAILED:", e); sys.exit(1)

# confirm FTS5 actually compiled in (the CREATE VIRTUAL TABLE would have thrown otherwise)
tabs = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("    tables:", tabs)

cur = con.cursor()
ts = "2026-06-07T00:00:00Z"

# 2) insert task + events
cur.execute("INSERT INTO tasks(id,title,goal,status,agent_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
            ("t1","Fix Tauri build","make windows build pass","in_progress","claude_code",ts,ts))
cur.execute("INSERT INTO task_events(id,task_id,seq,kind,summary,detail,created_at) VALUES (?,?,?,?,?,?,?)",
            ("e1","t1",1,"error","linker not found","link.exe missing at D:\\vs\\... line 42",ts))
cur.execute("INSERT INTO task_events(id,task_id,seq,kind,summary,created_at) VALUES (?,?,?,?,?,?)",
            ("e2","t1",2,"fix","installed C++ build tools",ts))
print("[2] task + events insert: OK")

# 3) UNIQUE(task_id,seq) enforced
try:
    cur.execute("INSERT INTO task_events(id,task_id,seq,kind,summary,created_at) VALUES (?,?,?,?,?,?)",
                ("e3","t1",1,"note","dup seq",ts))
    print("[3] FAILED: duplicate seq allowed"); sys.exit(1)
except sqlite3.IntegrityError:
    print("[3] UNIQUE(task_id,seq): enforced OK")

# 4) CHECK constraint on status
try:
    cur.execute("INSERT INTO tasks(id,title,goal,status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
                ("tx","bad","bad","not_a_status",ts,ts))
    print("[4] FAILED: bad status allowed"); sys.exit(1)
except sqlite3.IntegrityError:
    print("[4] CHECK(status): enforced OK")

# 5) skill insert + FTS auto-populate
cur.execute("""INSERT INTO skills(id,name,trigger_text,body,tags,source_task_id,status,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            ("s1","Tauri windows build fix","windows tauri build link error",
             "install VS C++ build tools then cargo clean",'["tauri","windows","build"]',
             "t1","active",ts,ts))
rows = cur.execute("SELECT skill_id,name FROM skills_fts WHERE skills_fts MATCH 'tauri windows'").fetchall()
print("[5] skills_fts auto-populate + MATCH:", rows)
assert rows and rows[0][0]=="s1", "FTS search failed"

# 6) skill UPDATE keeps FTS in sync
cur.execute("UPDATE skills SET body=? , updated_at=? WHERE id=?",
            ("install msvc toolchain then rebuild",ts,"s1"))
r = cur.execute("SELECT body FROM skills_fts WHERE skill_id='s1'").fetchone()
print("[6] FTS sync on UPDATE:", r)
assert r and "msvc" in r[0]

# 7) failure insert + FTS
cur.execute("""INSERT INTO failures(id,task_id,source_event_id,signature,normalized_text,description,
               root_cause,fix,guard_rule,tags,created_at,last_seen_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            ("f1","t1","e1","sha1abc","linker not found <PATH> <LOC>","linker not found",
             "missing C++ tools","install build tools",
             "构建前确认已装 VS Build Tools(含 C++ 桌面开发)",'["tauri","windows"]',ts,ts))
fr = cur.execute("SELECT failure_id FROM failures_fts WHERE failures_fts MATCH 'linker'").fetchall()
print("[7] failures_fts MATCH:", fr); assert fr

# 8) skill_usages auto-maintains counts
cur.execute("INSERT INTO skill_usages(id,skill_id,task_id,outcome,created_at) VALUES (?,?,?,?,?)",
            ("u1","s1","t1","helped",ts))
cur.execute("INSERT INTO skill_usages(id,skill_id,task_id,outcome,created_at) VALUES (?,?,?,?,?)",
            ("u2","s1","t1","harmful",ts))
sc,fc = cur.execute("SELECT success_count,fail_count FROM skills WHERE id='s1'").fetchone()
print(f"[8] count auto-maintain: success={sc} fail={fc}"); assert (sc,fc)==(1,1)

# 9) FK cascade: deleting task removes its events; SET NULL on skill/failure
cur.execute("DELETE FROM tasks WHERE id='t1'")
ev = cur.execute("SELECT COUNT(*) FROM task_events WHERE task_id='t1'").fetchone()[0]
sk_src = cur.execute("SELECT source_task_id FROM skills WHERE id='s1'").fetchone()[0]
fa_src = cur.execute("SELECT task_id FROM failures WHERE id='f1'").fetchone()[0]
print(f"[9] cascade: events_left={ev}, skill.source_task_id={sk_src}, failure.task_id={fa_src}")
assert ev==0 and sk_src is None and fa_src is None

# 10) skill DELETE removes FTS row
cur.execute("DELETE FROM skills WHERE id='s1'")
left = cur.execute("SELECT COUNT(*) FROM skills_fts WHERE skill_id='s1'").fetchone()[0]
print(f"[10] FTS cleanup on DELETE: rows_left={left}"); assert left==0

# 11) agent runtime tables persist sessions + transcript
cur.execute("INSERT INTO tasks(id,title,goal,status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            ("ta","Agent task","run codex","in_progress",ts,ts))
cur.execute("""INSERT INTO agent_profiles(id,kind,display_name,executable,default_args,enabled,updated_at)
               VALUES (?,?,?,?,?,?,?)""",
            ("codex","codex","Codex CLI","codex",'[]',1,ts))
cur.execute("""INSERT INTO agent_sessions(id,task_id,profile_id,agent_id,status,cwd,command_line,started_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            ("sess1","ta","codex","codex","running","D:/repo","codex",ts,ts))
cur.execute("""INSERT INTO terminal_chunks(id,session_id,seq,direction,text,created_at)
               VALUES (?,?,?,?,?,?)""",
            ("chunk1","sess1",1,"output","hello",ts))
cur.execute("""INSERT INTO workspace_locks(id,repo_path,owner_session_id,lock_kind,created_at)
               VALUES (?,?,?,?,?)""",
            ("lock1","D:/repo","sess1","write",ts))
session_count = cur.execute("SELECT COUNT(*) FROM agent_sessions WHERE task_id='ta'").fetchone()[0]
chunk_count = cur.execute("SELECT COUNT(*) FROM terminal_chunks WHERE session_id='sess1'").fetchone()[0]
lock_count = cur.execute("SELECT COUNT(*) FROM workspace_locks WHERE owner_session_id='sess1'").fetchone()[0]
print(f"[11] agent runtime persist: sessions={session_count} chunks={chunk_count} locks={lock_count}")
assert session_count == 1 and chunk_count == 1 and lock_count == 1

# 12) deleting task cascades agent sessions + transcript
cur.execute("DELETE FROM tasks WHERE id='ta'")
session_left = cur.execute("SELECT COUNT(*) FROM agent_sessions WHERE id='sess1'").fetchone()[0]
chunk_left = cur.execute("SELECT COUNT(*) FROM terminal_chunks WHERE session_id='sess1'").fetchone()[0]
lock_left = cur.execute("SELECT COUNT(*) FROM workspace_locks WHERE owner_session_id='sess1'").fetchone()[0]
print(f"[12] agent runtime cascade: sessions_left={session_left} chunks_left={chunk_left} locks_left={lock_left}")
assert session_left == 0 and chunk_left == 0 and lock_left == 0

# 13) v4 治理层:actor 默认值 + CHECK
cur.execute("INSERT INTO tasks(id,title,goal,status,created_at,updated_at) VALUES (?,?,?,?,?,?)",
            ("tg","Gov task","governance","in_progress",ts,ts))
cur.execute("INSERT INTO task_events(id,task_id,seq,kind,summary,created_at) VALUES (?,?,?,?,?,?)",
            ("eg1","tg",1,"decision","链接器探测下沉到 build.rs",ts))
actor = cur.execute("SELECT actor FROM task_events WHERE id='eg1'").fetchone()[0]
assert actor == "ai", f"actor default wrong: {actor}"
cur.execute("""INSERT INTO task_events(id,task_id,seq,kind,summary,actor,session_id,anchor_file,anchor_lines,created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            ("eg2","tg",2,"fix","vcvars 注入","human",None,"src/build.rs","12-40",ts))
try:
    cur.execute("INSERT INTO task_events(id,task_id,seq,kind,summary,actor,created_at) VALUES (?,?,?,?,?,?,?)",
                ("eg3","tg",3,"note","bad actor","robot",ts))
    print("[13] FAILED: bad actor allowed"); sys.exit(1)
except sqlite3.IntegrityError:
    print("[13] task_events.actor default + CHECK: OK")

# 14) skills 保鲜期字段
cur.execute("""INSERT INTO skills(id,name,trigger_text,body,origin_agent,origin_model,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            ("sg1","gov skill","trigger","body","claude_code","opus-4.8",ts,ts))
fresh = cur.execute("SELECT freshness FROM skills WHERE id='sg1'").fetchone()[0]
assert fresh == "fresh"
cur.execute("UPDATE skills SET freshness='needs_revalidation' WHERE id='sg1'")
try:
    cur.execute("UPDATE skills SET freshness='rotten' WHERE id='sg1'")
    print("[14] FAILED: bad freshness allowed"); sys.exit(1)
except sqlite3.IntegrityError:
    print("[14] skills.freshness default + CHECK: OK")

# 15) policy_decisions 账本
cur.execute("""INSERT INTO policy_decisions(id,task_id,rule_id,action,verdict,command_text,reason,decided_by,created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            ("pd1","tg","destructive_fs","hold","denied","rm -rf ~/repo","破坏性删除","human",ts))
try:
    cur.execute("""INSERT INTO policy_decisions(id,rule_id,action,verdict,command_text,reason,decided_by,created_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                ("pd2","x","escalate","denied","cmd","r","policy",ts))
    print("[15] FAILED: bad action allowed"); sys.exit(1)
except sqlite3.IntegrityError:
    print("[15] policy_decisions insert + CHECK(action): OK")

# 16) adrs 编号唯一
cur.execute("""INSERT INTO adrs(id,task_id,number,title,status,context,decision,created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            ("adr1","tg",1,"链接器探测下沉","accepted","Windows 构建失败","探测逻辑放 build.rs",ts))
try:
    cur.execute("""INSERT INTO adrs(id,number,title,status,context,decision,created_at)
                   VALUES (?,?,?,?,?,?,?)""",
                ("adr2",1,"dup","accepted","c","d",ts))
    print("[16] FAILED: duplicate adr number allowed"); sys.exit(1)
except sqlite3.IntegrityError:
    print("[16] adrs UNIQUE(number): OK")

# 17) commit_links 去重 + 级联
cur.execute("""INSERT INTO commit_links(id,task_id,repo_path,commit_hash,subject,created_at)
               VALUES (?,?,?,?,?,?)""",
            ("cl1","tg","D:/repo","abc123","fix: linker",ts))
try:
    cur.execute("""INSERT INTO commit_links(id,task_id,repo_path,commit_hash,created_at)
                   VALUES (?,?,?,?,?)""",
                ("cl2","tg","D:/repo","abc123",ts))
    print("[17] FAILED: duplicate commit link allowed"); sys.exit(1)
except sqlite3.IntegrityError:
    print("[17] commit_links UNIQUE(repo,hash): OK")
cur.execute("DELETE FROM tasks WHERE id='tg'")
cl_left = cur.execute("SELECT COUNT(*) FROM commit_links WHERE task_id='tg'").fetchone()[0]
pd_task = cur.execute("SELECT task_id FROM policy_decisions WHERE id='pd1'").fetchone()[0]
adr_task = cur.execute("SELECT task_id FROM adrs WHERE id='adr1'").fetchone()[0]
print(f"[18] governance cascade: commit_links_left={cl_left} policy.task={pd_task} adr.task={adr_task}")
assert cl_left == 0 and pd_task is None and adr_task is None

con.commit()
print("\nALL CHECKS PASSED ✅")
