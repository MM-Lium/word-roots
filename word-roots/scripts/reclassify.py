import json, os, math

WORD_DIR = "/Users/mingliu/Desktop/Ming_Git/Side-app/word-roots/word"
OUT_DIR  = "/Users/mingliu/Desktop/Ming_Git/Side-app/word-roots/word/cefr"
os.makedirs(OUT_DIR, exist_ok=True)

# CEFR word map
A1 = set("a able about after again age ago all also always am an and angry another any are around as ask at away back bad ball be beautiful because bed big black blue book both boy bread brother brown bus but buy by cake call can car cat chair children city clean close cold come cook cool correct cost country dad dark daughter day dead dear deep desk different difficult dirty do dog door down draw dream drink drive dry each early east easy eat eight either else end enough even every eye face fall family far fast feel few fine first fish five fly food foot for four free fresh friend from full funny get girl give glad go good great green grey group grow guess hand happen hard have head hello help here high him his home hope hot house how hungry i ice idea in inside is it its just keep kid kind know large last late laugh learn leave left let lie light like little live long look lot low make man many mean meet milk mind money more most mouth move much name near need never new next nice night no north not now of office old one open or other out own paper park part people picture place plan play poor pretty public put quick quiet rain read ready red remember rice rich right road room round run sad safe same say school see see short shout sing sit six sky sleep slow small smart smile snow so some sorry sound south special stand star start still stop street strong study such summer sun sure sweet table take talk tall teach ten thank that the then there these think this three time tired to today together tomorrow tree true try turn two under up use very wait walk want warm wash water we weak wear well wet what when where which white who why wide will wind winter wish with word work world write wrong yes young you zero zoo".split())

A2 = set("accident action activity address adult afternoon agree allow animal answer appear area army art autumn bank beach believe belong blood boat body bottle bread bridge build busy butter camera candy care car catch cause center certain chance class clock cloud coast color common continue cook corner cost country cover dance danger date death decide describe difference difficult dinner direction discover distance dream drive earth edge evening exam example factory fall farm farmer feeling finger forest fruit game ghost gift glass glasses gold ground group guide gun hair happen hate health heart hill history holiday homework hope horse hurt husband ice idea impossible inside interest iron job joke joy juice king kiss kitchen kite knife lake lamp land laugh law leader leaf left lesson letter level life lion list little look lot love lunch magazine mail map marriage mean meat meet middle mile milk mind minute miss mistake moment morning mouse movie mud music nation nature news newspaper noise nurse ocean office orange other else outside pair pants parent part party pass past picture plant player playground pocket police pond pool practice price print problem queen radio rain rainbow reach reason reply rest return rise river road robot rock rope rose rule sad sail salt sand save school sea season second seed sense shape shape sheep shirt shoe shop shoulder shout show side silver singer sister size skill skin sky sleep smell smile smoke snake soap song soul sound soup south space speech spoon sport stair star station stone store story street student study sugar summer sun sunday surprise swim table tail tale taste teacher tiger thing tiger touch town toy train trouble turn vegetable view visit voice war wash waste watch weather weekend weight welcome width wife wind winter wish wood worker world worry writer zoo".split())

B1 = set("ability absence academic accept achieve affect announce apply argue assist attend attract avoid background behavior belief benefit blame budget calculate capital career challenge citizen climate combine communicate compare compete complain complete concept concern conclude connect consider contact control decision demand depend deserve develop discuss disturb divide earn economy encourage energy ensure establish estimate expand expect experience express extend factor feature focus form generate global handle identify image improve include increase indicate influence inform involve judge limit loss manage measure mention method mention notice obtain official operate opportunity organize outcome perform permit physical positive predict prefer prevent produce program promote protect provide publish quality realize recognize record reduce reflect refuse relate release rely remove replace represent require resource responsibility result role select separate serve situation society solve source standard struggle succeed suggest supply support survive system technology theory tradition translate type value variety".split())

B2 = set("abstract accommodate accumulate adapt administer adopt advocate allocate analyze anticipate approach apparent assess attribute authentic autonomous beneficial clarify collaborate compensate compile comprehend comprehensive consistent constitute contradict contribute coordinate correlate criteria cumulative demonstrate derive determine differentiate distribute document dominate dominant dynamic eliminate emerge emphasize empirical enhance equivalent evaluate evolve exclude exhibit explicit exploit facilitate fluctuate fundamental formulate highlight implement incorporate initiate integrate interpret investigate justify logical legitimate monitor negotiate modify obtain perceive perceive possess prioritize rational regulatory resilient rigorous robust simulate sophisticated strategic subjective substantial sustain systematic theoretical transform transparent undermine utilize validate verify viable widespread".split())

C1 = set("abstraction accountability alleviate ambiguous articulate brevity catalyst coherent collaborate commence conceive contemplate contentious corroborate cultivate deliberate delineate discriminate elaborate eloquent elicit empirical epistemize exacerbate exert facilitate formidable galvanize hypothesis illuminate impede incentive indispensable inevitable inherent instigate integrity intervention intuition jurisdiction legitimacy manifestation methodology mitigate mobilize nuanced ostensibly paramount paradigm paradox pervasive plausible postulate predominant profound prolific rationale reconcile reinstate relinquish replicate rhetoric rigor resilient salient scrutinize solidarity spectrum stereotype substantive succinct tenacious tenuous trajectory unanimous validate volatile underlying unprecedented widespread".split())

def get_level(word):
    w = word.lower()
    if w in A1: return "A1"
    if w in A2: return "A2"
    if w in B1: return "B1"
    if w in B2: return "B2"
    if w in C1: return "C1"
    # fallback by length
    n = len(w)
    if n <= 4: return "A2"
    if n <= 6: return "B1"
    if n <= 9: return "B2"
    return "C1"

KEEP = {"n","v","adj","adv"}
SKIP = {"o.k.","okay","accordingto","good-by","good-bye","xmas"}
POS_ZH = {"n":"名詞","v":"動詞","adj":"形容詞","adv":"副詞"}
LEVELS = ["A1","A2","B1","B2","C1","C2"]
LEVEL_TITLE = {
    "A1":"入門級 A1 (Beginner)",
    "A2":"基礎級 A2 (Elementary)",
    "B1":"中級 B1 (Intermediate)",
    "B2":"中高級 B2 (Upper-Intermediate)",
    "C1":"高級 C1 (Advanced)",
    "C2":"精通級 C2 (Proficiency)",
}

# Read all 6 JSONs, deduplicate by (word_lower, pos)
entries = {}
for i in range(1, 7):
    path = os.path.join(WORD_DIR, f"word-{i}.json")
    data = json.load(open(path, encoding="utf-8"))
    for e in data:
        w = e.get("word","").strip()
        defs = e.get("definitions",[])
        if not defs or not w: continue
        pos = defs[0].get("partOfSpeech","")
        if pos not in KEEP or w.lower() in SKIP: continue
        key = (w.lower(), pos)
        if key not in entries:
            entries[key] = {
                "word": w,
                "pos": pos,
                "posZh": POS_ZH[pos],
                "definition": defs[0].get("text",""),
            }

print(f"Total unique entries: {len(entries)}")

# Group by CEFR level (one entry per unique word - prefer n > v > adj > adv)
POS_PRI = {"n":0,"v":1,"adj":2,"adv":3}
best = {}
for (wl, pos), e in entries.items():
    if wl not in best or POS_PRI.get(pos,9) < POS_PRI.get(best[wl]["pos"],9):
        best[wl] = e

buckets = {lv:[] for lv in LEVELS}
for wl, e in best.items():
    lv = get_level(e["word"])
    buckets[lv].append(e)

for lv in LEVELS:
    buckets[lv].sort(key=lambda x: x["word"].lower())
    print(f"  {lv}: {len(buckets[lv])} words")

CATEGORIES = {
    "體能與運動": ["跑", "跳", "球", "運動", "體育", "賽", "游", "騎", "步"],
    "飲食與烹飪": ["吃", "喝", "食物", "餐", "水", "肉", "果", "菜", "酒", "茶", "麵", "蛋", "咖啡", "甜", "飯", "麵包", "蛋糕", "湯", "糖", "鹽"],
    "交通與旅遊": ["車", "船", "飛機", "交通", "路", "街", "火車", "地鐵", "公車", "輪", "票", "遊", "旅行", "飯店", "飛", "橋", "站"],
    "商業與工作": ["辦公", "公司", "老闆", "錢", "業", "買", "賣", "商", "工", "廠", "會議", "管理", "客", "服務", "工作", "職", "薪", "銀"],
    "學校與教育": ["學", "校", "課", "教", "書", "考", "筆", "師", "大學", "科學", "語言", "字", "讀", "寫", "成績"],
    "自然與環境": ["天", "地", "海", "雲", "雨", "雪", "樹", "花", "草", "動物", "狗", "貓", "鳥", "魚", "太陽", "月亮", "星星", "山", "河", "湖", "風", "氣象", "島"],
    "人物與感官": ["人", "男", "女", "孩", "父", "母", "兄", "弟", "姐", "妹", "親", "朋友", "妻", "夫", "頭", "手", "腳", "腿", "眼", "耳", "口", "鼻", "身", "病", "醫", "藥", "痛", "血", "看", "聽"],
    "情感與溝通": ["愛", "恨", "喜", "怒", "哀", "樂", "想", "感", "怕", "氣", "哭", "笑", "愁", "說", "話", "語", "問", "答", "叫", "喊", "音", "唱"],
    "生活與物品": ["房", "門", "窗", "床", "桌", "椅", "洗", "衣", "鞋", "帽", "袋", "燈", "電視", "杯", "盤", "刀", "紙", "筆", "信", "包"],
    "時間與測量": ["時", "日", "月", "年", "秒", "分", "鐘", "早", "晚", "今", "昨", "明", "長", "短", "高", "低", "大", "小", "多", "少", "遠", "近", "歲"]
}

def get_category(definition):
    for cat, keywords in CATEGORIES.items():
        if any(k in definition for k in keywords):
            return cat
    return "基礎與其他詞彙"

# Write files grouped by category instead of 40-word chunks
index = []
for lv in LEVELS:
    words = buckets[lv]
    # Group words in current level by category
    cat_buckets = {c: [] for c in CATEGORIES.keys()}
    cat_buckets["基礎與其他詞彙"] = []
    
    for w in words:
        c = get_category(w["definition"])
        cat_buckets[c].append(w)
        
    part_count = 1
    # For each category, if it has words, output it as a part
    for cat_name, chunk in cat_buckets.items():
        if not chunk: continue
        # Sort chunk alphabetically
        chunk.sort(key=lambda x: x["word"].lower())
        
        # If a chunk is extremely large (e.g., >60), we could sub-chunk it, but user said broad direction is fine.
        # Let's just output one JSON per category per level.
        fname = f"{lv}-{part_count}.json"
        
        title_str = f"{LEVEL_TITLE[lv]} - {cat_name}"
        out = {
            "level": lv,
            "part": part_count,
            "totalParts": 0, # Will fix totalParts after we know how many parts this level has
            "title": title_str,
            "count": len(chunk),
            "words": [{"word":e["word"],"pos":e["pos"],"posZh":e["posZh"],"definition":e["definition"],"cefr":lv} for e in chunk]
        }
        # Save temp data to index
        index.append({"_data": out, "file": fname, "level": lv, "part": part_count, "title": title_str, "count": len(chunk)})
        part_count += 1

# Fix totalParts and write JSONs
level_total_parts = {}
for item in index:
    lv = item["level"]
    level_total_parts[lv] = max(level_total_parts.get(lv, 0), item["part"])

final_index = []
for item in index:
    out = item.pop("_data")
    out["totalParts"] = level_total_parts[out["level"]]
    fname = item["file"]
    
    json.dump(out, open(os.path.join(OUT_DIR, fname),"w",encoding="utf-8"), ensure_ascii=False, indent=2)
    final_index.append(item)
    print(f"  ✅ {fname} - {item['title']} ({item['count']} words)")

json.dump(final_index, open(os.path.join(OUT_DIR,"index.json"),"w",encoding="utf-8"), ensure_ascii=False, indent=2)
print(f"\nDone! {len(index)} files written to {OUT_DIR}")
