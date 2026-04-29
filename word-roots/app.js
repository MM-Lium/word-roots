/* =============================================
   WORD ROOT EXPLORER — app.js
   Main Application Logic
   ============================================= */

// ─── State ───────────────────────────────────
const State = {
  importedWords: [],      // { word, definition, analysis }
  currentTab: 'search',
  dbFilter: 'all',
  dbQuery: '',
  searchHistory: [],
};

// ─── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderDB();
  renderDBStats();
  setupDragDrop();
  setupKeyListeners();
  // Load saved words from localStorage
  loadSavedWords();
  loadSearchHistory();
  // Auto-search from URL ?q= param (e.g. coming from cefr.html)
  const urlQ = new URLSearchParams(window.location.search).get('q');
  if (urlQ && /^[a-zA-Z'-]+$/.test(urlQ.trim())) {
    const input = document.getElementById('searchInput');
    input.value = urlQ.trim();
    performSearch();
    // Clean up URL without reloading
    history.replaceState({}, '', window.location.pathname);
  }
});


// ─── Tab Navigation ────────────────────────────
function showTab(name) {
  State.currentTab = name;
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.add('active');
  document.getElementById('nav' + name.charAt(0).toUpperCase() + name.slice(1))?.classList.add('active');
  if (name === 'browse') renderBrowse();
}

// ─── Key Listeners ──────────────────────────────
function setupKeyListeners() {
  const input = document.getElementById('searchInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') performSearch();
  });
}

// ─── Search & Analysis ──────────────────────────
function quickSearch(word) {
  showTab('search');
  document.getElementById('searchInput').value = word;
  performSearch();
}

async function performSearch() {
  const word = document.getElementById('searchInput').value.trim();
  if (!word) { showToast('請輸入一個英文單字！'); return; }
  if (!/^[a-zA-Z'-]+$/.test(word)) { showToast('請輸入純英文單字'); return; }

  // Save to history
  addToSearchHistory(word);

  const analysis = WordAnalyzer.analyze(word);
  renderAnalysisResult(analysis);

  const dictPromise = fetchDefinition(word);
  const transPromise = fetchTranslation(word);

  const dictData = await dictPromise;
  renderDefinition(dictData, word);

  const transData = await transPromise;
  if (transData) {
    document.getElementById('resultWordTranslation').textContent = transData;
  }
  renderRelatedWords(analysis);
  renderExtendedWords(word.toLowerCase());
  renderWordRelationships(word.toLowerCase());
}

function renderAnalysisResult(analysis) {
  if (!analysis) return;

  const resultArea = document.getElementById('resultArea');
  const emptyState  = document.getElementById('emptyState');
  resultArea.style.display = 'block';
  emptyState.style.display = 'none';

  // --- Word Title & Translation clear ---
  document.getElementById('resultWordTitle').textContent = analysis.word;
  document.getElementById('resultWordTranslation').textContent = '翻譯中...';

  // --- Cambridge link ---
  document.getElementById('cambridgeLink').href =
    `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(analysis.word)}`;

  // --- Score Badge ---
  const total = analysis.prefixes.length + analysis.roots.length + analysis.suffixes.length;
  document.getElementById('resultScoreBadge').textContent = `找到 ${total} 個字根字首`;

  // --- Clear POS badges (filled after dict fetch) ---
  document.getElementById('posBadges').innerHTML = '';

  // --- Show definition loading state ---
  const defArea = document.getElementById('wordDefinitionArea');
  defArea.style.display = 'block';
  document.getElementById('definitionLoading').style.display = 'flex';
  document.getElementById('definitionEntries').innerHTML = '';

  // --- Hide related words until ready ---
  document.getElementById('relatedWordsSection').style.display = 'none';

  // --- Breakdown ---
  const bdEl = document.getElementById('wordBreakdown');
  const parts = analysis.breakdown;
  if (parts.length) {
    bdEl.innerHTML = parts.map((p, i) =>
      `${i > 0 ? '<span class="breakdown-plus">+</span>' : ''}
       <span class="breakdown-part ${p.type}">${p.text}</span>`
    ).join('');
  } else {
    bdEl.innerHTML = `<span class="breakdown-part root">${analysis.word.toLowerCase()}</span>`;
  }

  // --- Analysis Cards ---
  const grid = document.getElementById('analysisGrid');
  grid.innerHTML = '';

  const all = [
    ...analysis.prefixes.map(x => ({ ...x, _role: 'prefix' })),
    ...analysis.roots.map(x => ({ ...x, _role: 'root' })),
    ...analysis.suffixes.map(x => ({ ...x, _role: 'suffix' })),
  ];

  if (all.length === 0) {
    grid.innerHTML = `
      <div class="no-results" style="grid-column:1/-1">
        <div style="font-size:40px;margin-bottom:12px">🔍</div>
        <div style="font-size:16px;font-weight:600;margin-bottom:8px">未找到明確字根字首</div>
        <div style="font-size:13px;color:var(--text-muted)">這個單字可能是基礎詞根，或暫時未收錄在資料庫中</div>
      </div>`;
    return;
  }

  // Deduplicate by affix
  const seen = new Set();
  all.forEach(item => {
    const key = item.affix + item._role;
    if (seen.has(key)) return;
    seen.add(key);

    const typeLabel = { prefix: '字首', root: '字根', suffix: '字尾' }[item._role];
    const typeIcon  = { prefix: '⬛', root: '🔵', suffix: '🔶' }[item._role];
    const wordLower = analysis.word.toLowerCase();

    const card = document.createElement('div');
    card.className = `analysis-card ${item._role}`;
    card.innerHTML = `
      <div class="card-type-badge ${item._role}">${typeIcon} ${typeLabel}</div>
      <div class="card-affix">${item.affix}</div>
      <div class="card-meaning">${item.meaning}</div>
      <div class="card-origin">起源：${item.origin}</div>
      <div class="card-examples">
        ${item.examples.slice(0, 6).map(ex => {
          const isCurrentWord = ex.toLowerCase() === wordLower;
          return `<span class="example-chip ${isCurrentWord ? 'highlighted' : ''}"
            onclick="quickSearch('${ex}')">${ex}</span>`;
        }).join('')}
      </div>`;
    grid.appendChild(card);
  });
}

// ─── Dictionary API ──────────────────────────────
async function fetchTranslation(word) {
  try {
    const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(word)}`);
    const data = await res.json();
    return data && data[0] && data[0][0] ? data[0][0][0] : null;
  } catch (e) {
    return null;
  }
}

async function fetchDefinition(word) {
  try {
    const resp = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) ? data[0] : null;
  } catch {
    return null;
  }
}

// ─── AI API ──────────────────────────────
async function fetchAICollocations(word) {
  const apiKey = localStorage.getItem('GEMINI_API_KEY');
  if (!apiKey) return null;
  
  const cacheKey = `ai_colloc_${word.toLowerCase()}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch(e){}
  }

  try {
    const prompt = `Provide 3 common English collocations or patterns for the word '${word}'. Output strictly a JSON array of objects with keys: "pattern" (the grammatical pattern, e.g. "Determine + whether/if"), "meaning" (traditional Chinese meaning of the pattern), "example_en" (an English example sentence), and "example_zh" (traditional Chinese translation of the example). Do not include any other text or markdown formatting outside the JSON array.`;
    
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    });
    
    if (!response.ok) return null;
    const data = await response.json();
    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.length > 0) {
      localStorage.setItem(cacheKey, JSON.stringify(parsed));
      return parsed;
    }
  } catch(e) {
    console.error("AI Collocations Error:", e);
  }
  return null;
}

function renderDefinition(data, word) {
  const loading   = document.getElementById('definitionLoading');
  const entries   = document.getElementById('definitionEntries');
  const posBadges = document.getElementById('posBadges');
  loading.style.display = 'none';

  if (!data || !data.meanings) {
    entries.innerHTML = `<div class="def-error">⚠️ 未找到「${word}」的定義，請點擊上方 Cambridge 連結查詢</div>`;
    return;
  }

  // POS badges (unique)
  const posSet = new Set(data.meanings.map(m => m.partOfSpeech));
  const posZhMap = { noun:'名詞 n.', verb:'動詞 v.', adjective:'形容詞 adj.',
    adverb:'副詞 adv.', preposition:'介系詞 prep.', conjunction:'連接詞 conj.' };
  const posClsSet = new Set(['noun','verb','adjective','adverb','preposition','conjunction']);
  posBadges.innerHTML = [...posSet].map(pos => {
    const cls = posClsSet.has(pos) ? pos : 'other';
    return `<span class="pos-badge ${cls}">${posZhMap[pos] || pos}</span>`;
  }).join('');

  // Definitions grouped by POS (max 2 POS, 3 defs each)
  entries.innerHTML = data.meanings.slice(0, 3).map((m, mi) => {
    const defs = m.definitions.slice(0, 3);
    return `<div class="def-entry">
      <div class="def-entry-pos">${m.partOfSpeech}</div>
      ${defs.map((d, i) => `
        <div class="def-item">
          <span class="def-num">${i + 1}.</span>
          <div>
            <div class="def-text">${d.definition}</div>
            ${d.example ? `<div class="def-example">"${d.example}"</div>` : ''}
          </div>
        </div>`).join('')}
    </div>${mi < data.meanings.slice(0,3).length - 1 ? '<hr style="border:none;border-top:1px solid var(--border-subtle);margin:10px 0">' : ''}`;
  }).join('');
}

// ─── Related Words ───────────────────────────────
function findRelatedWords(analysis) {
  const currentWord = analysis.word.toLowerCase();
  const relatedMap  = new Map();

  const matched = [
    ...analysis.prefixes.map(x => ({ affix: x.affix, type: 'prefix', examples: x.examples })),
    ...analysis.roots.map(x   => ({ affix: x.affix, type: 'root',   examples: x.examples })),
    ...analysis.suffixes.map(x => ({ affix: x.affix, type: 'suffix', examples: x.examples })),
  ];

  matched.forEach(({ affix, type, examples }) => {
    examples.forEach(ex => {
      const exLower = ex.toLowerCase();
      if (exLower === currentWord) return;
      if (!relatedMap.has(exLower)) relatedMap.set(exLower, { word: ex, via: [] });
      const entry = relatedMap.get(exLower);
      if (!entry.via.find(v => v.affix === affix)) entry.via.push({ affix, type });
    });
  });

  return [...relatedMap.values()]
    .sort((a, b) => b.via.length - a.via.length)
    .slice(0, 24);
}

function renderRelatedWords(analysis) {
  const section = document.getElementById('relatedWordsSection');
  const grid    = document.getElementById('relatedWordsGrid');
  const related  = findRelatedWords(analysis);

  if (!related.length) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  grid.innerHTML = related.map(item => {
    const viaHtml = item.via.map(v =>
      `<span class="via-${v.type}">${v.affix}</span>`
    ).join('、');
    return `
      <div class="related-word-card" onclick="quickSearch('${item.word}')">
        <div class="related-word-name">${item.word}</div>
        <div class="related-word-via">共享字根：${viaHtml}</div>
      </div>`;
  }).join('');
}

async function renderExtendedWords(word) {
  const section = document.getElementById('extendedWordsSection');
  const grid = document.getElementById('extendedWordsGrid');
  
  // hide initially
  section.style.display = 'none';
  grid.innerHTML = '';

  if (word.length < 4) return; // Ignore very short words to avoid noise
  
  const base = word.endsWith('e') ? word.slice(0, -1) : word;
  
  try {
    // Fetch prefix extensions (words ending with the searched word)
    const pfRes = await fetch(`https://api.datamuse.com/words?sp=*${word}&md=pd&max=30`);
    const pfData = await pfRes.json();
    
    // Fetch suffix extensions (words starting with base)
    const sfRes = await fetch(`https://api.datamuse.com/words?sp=${base}*&md=pd&max=30`);
    const sfData = await sfRes.json();
    
    const combined = [...pfData, ...sfData];
    // Filter out the word itself and exact match forms
    const filtered = combined.filter(item => {
      const w = item.word.toLowerCase();
      // Drop plural/conjugations tightly identical
      if (w === word || w === word + 's' || w === word + 'd' || w === word + 'ed' || w === word + 'ing') return false;
      // Drop words that don't actually contain the base or word
      return w.includes(base) && w.length > word.length;
    });

    // Deduplicate
    const uniqueMap = new Map();
    filtered.forEach(x => {
      if (!uniqueMap.has(x.word)) {
        uniqueMap.set(x.word, x);
      }
    });
    
    let results = Array.from(uniqueMap.values());
    results.sort((a, b) => b.score - a.score);
    results = results.slice(0, 24); // top 24

    if (results.length > 0) {
      section.style.display = 'block';
      grid.innerHTML = results.map((item, idx) => {
        let typeHtml = '';
        if (item.word.startsWith(base)) {
          typeHtml = `<span class="via-suffix">延伸字尾</span>`;
        } else if (item.word.endsWith(word)) {
          typeHtml = `<span class="via-prefix">延伸字首</span>`;
        } else {
           typeHtml = `<span class="via-root">衍生詞彙</span>`;
        }

        let posTag = item.tags && item.tags.length > 0 ? `<span class="word-pos">[${item.tags[0]}]</span>` : '';

        return `
          <div class="related-word-card" onclick="quickSearch('${item.word}')">
            <div class="related-word-name">${item.word} ${posTag}</div>
            <div class="related-word-via">${typeHtml}</div>
            <div class="related-word-via" style="margin-top:4px" id="extTrans_${idx}">翻譯中...</div>
          </div>`;
      }).join('');

      // Fetch translations asynchronously
      results.forEach((item, idx) => {
        fetchTranslation(item.word).then(trans => {
          const el = document.getElementById(`extTrans_${idx}`);
          if (el) el.textContent = trans || item.word;
        }).catch(() => {
          const el = document.getElementById(`extTrans_${idx}`);
          if (el) el.textContent = item.word;
        });
      });
    }
  } catch (err) {
    console.error("Failed to fetch extended words:", err);
  }
}

async function renderWordRelationships(word) {
  const section = document.getElementById('wordRelationshipsSection');
  const container = document.getElementById('relationshipsContainer');
  
  section.style.display = 'none';
  container.innerHTML = '';
  if (!word || word.length < 2) return;

  try {
    let html = '';
    let hasData = false;

    // 1. Fetch Synonyms and Antonyms from Datamuse (always available)
    const [synRes, antRes] = await Promise.all([
      fetch(`https://api.datamuse.com/words?rel_syn=${word}&max=15`),
      fetch(`https://api.datamuse.com/words?rel_ant=${word}&max=15`)
    ]);
    const synData = await synRes.json();
    const antData = await antRes.json();

    const renderGroup = (title, items) => {
      if (!items || items.length === 0) return '';
      hasData = true;
      const chips = items.map(i => {
        const textToDisplay = i.displayWord || i.word;
        return `<div class="relationship-chip" onclick="quickSearch('${i.word}')">${textToDisplay}</div>`;
      }).join('');
      return `
        <div class="relationship-group">
          <div class="relationship-group-title">${title}</div>
          <div class="relationship-chips">${chips}</div>
        </div>
      `;
    };

    html += renderGroup('同義字 (Synonyms)', synData);
    html += renderGroup('反義字 (Antonyms)', antData);

    // 2. Collocations - Check Local DB first, then AI, then Fallback
    let aiKeyMsgHtml = '';
    const hasApiKey = !!localStorage.getItem('GEMINI_API_KEY');
    if (!hasApiKey) {
        aiKeyMsgHtml = `<div style="font-size:12px; color:var(--text-muted); margin-top:8px;">💡 想要每個單字都有完美句型？前往 <button class="btn-ghost" style="padding:2px 4px; font-size:12px" onclick="openSettingsModal()">⚙️ 設定</button> 綁定免費 AI</div>`;
    }

    if (window.COLLOCATIONS_DB && window.COLLOCATIONS_DB[word]) {
      const localGroups = window.COLLOCATIONS_DB[word];
      hasData = true;
      html += renderCollocationGroups(localGroups, "常見搭配詞與句型 (Collocations & Patterns)");
    } else {
      let aiData = await fetchAICollocations(word);
      if (aiData) {
        hasData = true;
        html += renderCollocationGroups(aiData, "🤖 AI 搭配詞與句型 (AI Generated)");
      } else {
        // Fallback: Fetch basic collocations from Datamuse
        const bgaRes = await fetch(`https://api.datamuse.com/words?rel_bga=${word}&max=15`);
        let colDataRaw = await bgaRes.json();
        let colData = [];
        
        if (colDataRaw.length > 0) {
          colData = colDataRaw.map(i => ({ ...i, displayWord: `${word} ${i.word}` }));
        } else {
          const bgbRes = await fetch(`https://api.datamuse.com/words?rel_bgb=${word}&max=15`);
          colDataRaw = await bgbRes.json();
          colData = colDataRaw.map(i => ({ ...i, displayWord: `${i.word} ${word}` }));
        }
        html += renderGroup('常見搭配詞 (Collocations)', colData) + aiKeyMsgHtml;
      }
    }

    function renderCollocationGroups(groups, title) {
      let collHtml = `<div class="relationship-group"><div class="relationship-group-title">${title}</div><div class="collocation-list">`;
      groups.forEach(g => {
        collHtml += `
          <div class="collocation-item">
            <div class="collocation-header">
              <span class="collocation-pattern">${g.pattern}</span>
              <span class="collocation-meaning">${g.meaning}</span>
            </div>
            <div class="collocation-example">
              <div class="collocation-ex-en">${g.example_en}</div>
              <div class="collocation-ex-zh">${g.example_zh}</div>
            </div>
          </div>
        `;
      });
      collHtml += `</div></div>`;
      return collHtml;
    }

    if (hasData) {
      container.innerHTML = html;
      section.style.display = 'block';
    }
  } catch (err) {
    console.error("Failed to fetch word relationships:", err);
  }
}

// ─── Import & JSON ──────────────────────────────
function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('jsonInput').value = e.target.result;
    showToast(`✅ 已載入：${file.name}`);
    processJSONImport();
  };
  reader.readAsText(file);
}

function setupDragDrop() {
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = ev => {
        document.getElementById('jsonInput').value = ev.target.result;
        processJSONImport();
        showToast(`✅ 已載入：${file.name}`);
      };
      reader.readAsText(file);
    } else {
      showToast('請上傳 .json 格式的檔案');
    }
  });
}

function loadSampleJSON() {
  const sample = JSON.stringify([
    { "word": "transportation", "definition": "運輸、交通" },
    { "word": "autobiography", "definition": "自傳" },
    { "word": "microscope", "definition": "顯微鏡" },
    { "word": "democracy", "definition": "民主" },
    { "word": "impossible", "definition": "不可能的" },
    { "word": "transformation", "definition": "變形、轉化" },
    { "word": "biology", "definition": "生物學" },
    { "word": "international", "definition": "國際的" },
    { "word": "photograph", "definition": "照片" },
    { "word": "psychology", "definition": "心理學" },
    { "word": "incredible", "definition": "難以置信的" },
    { "word": "revolution", "definition": "革命、轉動" }
  ], null, 2);
  document.getElementById('jsonInput').value = sample;
  showToast('已載入範例資料');
}

function processJSONImport() {
  const raw = document.getElementById('jsonInput').value.trim();
  if (!raw) { showToast('請輸入 JSON 內容'); return; }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    showToast('❌ JSON 格式錯誤，請檢查格式');
    return;
  }

  if (!Array.isArray(parsed)) { showToast('JSON 應為陣列格式'); return; }

  // Normalise entries
  const words = parsed.map(item => {
    if (typeof item === 'string') return { word: item, definition: '' };
    if (typeof item === 'object' && item !== null) {
      return { word: item.word || item.Word || Object.values(item)[0], definition: item.definition || item.def || item.meaning || '' };
    }
    return null;
  }).filter(x => x && x.word && /^[a-zA-Z'-]+$/.test(x.word.trim()));

  if (!words.length) { showToast('未找到有效的英文單字'); return; }

  // Analyse
  const analysed = words.map(w => ({
    ...w,
    word: w.word.trim(),
    analysis: WordAnalyzer.analyze(w.word.trim())
  }));

  // Merge into imported list
  analysed.forEach(item => {
    const existing = State.importedWords.findIndex(x => x.word.toLowerCase() === item.word.toLowerCase());
    if (existing >= 0) State.importedWords[existing] = item;
    else State.importedWords.unshift(item);
  });

  saveWords();
  renderImportResults(analysed, words.length);
  showToast(`✅ 已分析 ${words.length} 個單字！`);
}

function renderImportResults(results, total) {
  const container = document.getElementById('importResults');
  const meta = document.getElementById('importResultsMeta');
  const list  = document.getElementById('importWordList');
  container.style.display = 'block';
  meta.textContent = `共 ${total} 個單字`;
  list.innerHTML = '';

  results.forEach((item, idx) => {
    const analysis = item.analysis;
    const prefixes = analysis?.prefixes || [];
    const roots    = analysis?.roots || [];
    const suffixes = analysis?.suffixes || [];

    const row = document.createElement('div');
    row.className = 'import-word-item';
    row.id = `importItem${idx}`;
    row.innerHTML = `
      <div>
        <div class="import-item-word">${item.word}</div>
        ${item.definition ? `<div class="import-item-def">${item.definition}</div>` : ''}
      </div>
      <div class="import-item-chips">
        ${prefixes.length ? `<span class="import-item-chip has-prefix">${prefixes[0]?.affix}</span>` : ''}
        ${roots.length   ? `<span class="import-item-chip has-root">${roots[0]?.affix}</span>` : ''}
        ${suffixes.length ? `<span class="import-item-chip has-suffix">${suffixes[0]?.affix}</span>` : ''}
        ${(!prefixes.length && !roots.length && !suffixes.length) ? '<span style="font-size:11px;color:var(--text-muted)">無資料</span>' : ''}
      </div>
      <span class="import-arrow">▶</span>
      <div class="import-word-detail">
        ${renderMiniAnalysis(analysis)}
      </div>`;

    row.addEventListener('click', () => {
      row.classList.toggle('expanded');
    });
    list.appendChild(row);
  });
}

function renderMiniAnalysis(analysis) {
  if (!analysis) return '<div style="color:var(--text-muted);font-size:13px">分析失敗</div>';
  const all = [
    ...analysis.prefixes.map(x => ({ ...x, _role: 'prefix' })),
    ...analysis.roots.map(x => ({ ...x, _role: 'root' })),
    ...analysis.suffixes.map(x => ({ ...x, _role: 'suffix' })),
  ];
  if (!all.length) return `<div style="color:var(--text-muted);font-size:13px">未找到明確字根字首記錄</div>`;
  return `<div style="display:flex;flex-direction:column;gap:8px">` + 
    [...new Map(all.map(x => [x.affix + x._role, x])).values()].map(item => `
      <div style="display:flex;align-items:baseline;gap:10px;font-size:13px">
        <span class="card-type-badge ${item._role}" style="margin:0;flex-shrink:0">
          ${{ prefix:'字首', root:'字根', suffix:'字尾' }[item._role]}
        </span>
        <span style="font-family:var(--font-mono);font-weight:600;color:var(--text-primary)">${item.affix}</span>
        <span style="color:var(--text-secondary)">${item.meaning}</span>
        <span style="color:var(--text-muted);font-size:11px">(${item.origin})</span>
      </div>`).join('') + '</div>';
}

// ─── Export ────────────────────────────────────
function exportResults() {
  const data = State.importedWords.map(item => ({
    word: item.word,
    definition: item.definition,
    prefixes: (item.analysis?.prefixes || []).map(p => ({ affix: p.affix, meaning: p.meaning })),
    roots:    (item.analysis?.roots    || []).map(r => ({ affix: r.affix, meaning: r.meaning })),
    suffixes: (item.analysis?.suffixes || []).map(s => ({ affix: s.affix, meaning: s.meaning })),
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'word-roots-analysis.json';
  a.click();
  showToast('✅ 已匯出分析結果');
}

// ─── Browse ─────────────────────────────────────
let browseFilter = '';
let browseSort   = 'recent';

function filterBrowse(val) { browseFilter = val.toLowerCase(); renderBrowse(); }
function sortBrowse(val)   { browseSort = val; renderBrowse(); }

function renderBrowse() {
  const grid = document.getElementById('browseGrid');
  if (!State.importedWords.length) {
    grid.innerHTML = `
      <div class="browse-empty">
        <div class="browse-empty-icon">📭</div>
        <div>尚未匯入任何單字</div>
        <button class="btn-primary" onclick="showTab('import')" style="margin-top:16px">前往匯入</button>
      </div>`;
    return;
  }

  let words = [...State.importedWords];
  if (browseFilter) words = words.filter(w => w.word.toLowerCase().includes(browseFilter));
  if (browseSort === 'alpha')  words.sort((a,b) => a.word.localeCompare(b.word));
  if (browseSort === 'score')  words.sort((a,b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));

  grid.innerHTML = words.map(item => `
    <div class="browse-card" onclick="quickSearch('${item.word}');showTab('search')">
      <div class="browse-card-word">${item.word}</div>
      ${item.definition ? `<div class="browse-card-def">${item.definition}</div>` : ''}
      <div class="browse-card-chips">
        ${(item.analysis?.prefixes || []).slice(0,2).map(p => `<span class="browse-chip p">${p.affix}</span>`).join('')}
        ${(item.analysis?.roots    || []).slice(0,2).map(r => `<span class="browse-chip r">${r.affix}</span>`).join('')}
        ${(item.analysis?.suffixes || []).slice(0,2).map(s => `<span class="browse-chip s">${s.affix}</span>`).join('')}
      </div>
    </div>`).join('');
}

// ─── Database ─────────────────────────────────
let dbCurrentFilter = 'all';

function setDBFilter(filter, btn) {
  dbCurrentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderDB();
}

function filterDB(val) {
  State.dbQuery = val.toLowerCase();
  renderDB();
}

function renderDB() {
  const grid = document.getElementById('dbGrid');
  let items = window.ROOTS_DB || [];

  if (dbCurrentFilter !== 'all') items = items.filter(x => x.type === dbCurrentFilter);
  if (State.dbQuery) {
    items = items.filter(x =>
      x.affix.toLowerCase().includes(State.dbQuery) ||
      x.meaning.includes(State.dbQuery) ||
      x.examples.some(e => e.toLowerCase().includes(State.dbQuery))
    );
  }

  grid.innerHTML = items.length
    ? items.map(item => `
        <div class="db-card ${item.type}">
          <div class="db-card-head">
            <div class="db-card-affix ${item.type}">${item.affix}</div>
            <span class="db-type-pill ${item.type}">${{ prefix:'字首', root:'字根', suffix:'字尾' }[item.type]}</span>
          </div>
          <div class="db-card-meaning">${item.meaning}</div>
          <div class="db-card-origin">起源：${item.origin}</div>
          <div class="db-card-examples">
            ${item.examples.slice(0, 5).map(ex =>
              `<span class="db-example" onclick="quickSearch('${ex}');showTab('search')">${ex}</span>`
            ).join('')}
          </div>
        </div>`).join('')
    : `<div class="no-results"><div style="font-size:36px;margin-bottom:12px">🔍</div>找不到符合條件的結果</div>`;
}

function renderDBStats() {
  const el = document.getElementById('dbStats');
  const db = window.ROOTS_DB || [];
  const prefixCount = db.filter(x => x.type === 'prefix').length;
  const rootCount   = db.filter(x => x.type === 'root').length;
  const suffixCount = db.filter(x => x.type === 'suffix').length;
  el.innerHTML = `
    <div class="db-stat">總計 <span>${db.length}</span> 筆</div>
    <div class="db-stat">字首 <span style="color:#a78bfa">${prefixCount}</span></div>
    <div class="db-stat">字根 <span style="color:#22d3ee">${rootCount}</span></div>
    <div class="db-stat">字尾 <span style="color:#fbbf24">${suffixCount}</span></div>
  `;
}

// ─── Persistence ─────────────────────────────
function saveWords() {
  try {
    localStorage.setItem('wordRootImported', JSON.stringify(State.importedWords));
  } catch {}
}

function loadSavedWords() {
  try {
    const saved = localStorage.getItem('wordRootImported');
    if (saved) State.importedWords = JSON.parse(saved);
  } catch {}
}

function addToSearchHistory(word) {
  const w = word.toLowerCase();
  State.searchHistory = State.searchHistory.filter(x => x !== w);
  State.searchHistory.unshift(w);
  if (State.searchHistory.length > 15) State.searchHistory.pop();
  saveSearchHistory();
  renderSearchHistory();
}

function saveSearchHistory() {
  try {
    localStorage.setItem('wordRootSearchHistory', JSON.stringify(State.searchHistory));
  } catch {}
}

function loadSearchHistory() {
  try {
    const saved = localStorage.getItem('wordRootSearchHistory');
    if (saved) State.searchHistory = JSON.parse(saved);
  } catch {}
  renderSearchHistory();
}

function renderSearchHistory() {
  const container = document.getElementById('searchHistoryContainer');
  const tagsWrap = document.getElementById('searchHistoryTags');
  if (!container || !tagsWrap) return;
  if (State.searchHistory.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  tagsWrap.innerHTML = State.searchHistory.map(w => 
    `<button class="history-tag" onclick="quickSearch('${w}')">${w}</button>`
  ).join('');
}

function clearSearchHistory() {
  State.searchHistory = [];
  saveSearchHistory();
  renderSearchHistory();
}

// ─── Toast ────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
