// Word Analysis Engine
// Analyzes a word and finds matching roots, prefixes, and suffixes

window.WordAnalyzer = {

  // Analyze a single word
  analyze(word) {
    if (!word) return null;
    
    const lower = word.toLowerCase().trim();
    const results = {
      word: word,
      prefixes: [],
      roots: [],
      suffixes: [],
      breakdown: [],
      score: 0
    };

    const db = window.ROOTS_DB;

    // --- Prefix matching ---
    const prefixCandidates = db.filter(r => r.type === 'prefix');
    for (const p of prefixCandidates) {
      const key = p.affix.replace(/-/g, '');
      if (lower.startsWith(key) && lower.length > key.length) {
        results.prefixes.push({ ...p, matched: key, position: 'start' });
      }
    }
    // Sort by match length descending (prefer longer matches)
    results.prefixes.sort((a, b) => b.matched.length - a.matched.length);

    // --- Suffix matching ---
    const suffixCandidates = db.filter(r => r.type === 'suffix');
    for (const s of suffixCandidates) {
      const key = s.affix.replace(/-/g, '');
      if (lower.endsWith(key) && lower.length > key.length) {
        results.suffixes.push({ ...s, matched: key, position: 'end' });
      }
    }
    results.suffixes.sort((a, b) => b.matched.length - a.matched.length);

    // --- Root matching ---
    const rootCandidates = db.filter(r => r.type === 'root');
    for (const r of rootCandidates) {
      const key = r.affix.replace(/-/g, '');
      if (lower.includes(key) && key.length >= 3) {
        const idx = lower.indexOf(key);
        results.roots.push({ ...r, matched: key, position: idx });
      }
    }
    results.roots.sort((a, b) => b.matched.length - a.matched.length);

    // --- Build breakdown ---
    results.breakdown = this._buildBreakdown(lower, results);
    results.score = results.prefixes.length + results.roots.length + results.suffixes.length;

    return results;
  },

  // Build a visual breakdown string highlighting parts
  _buildBreakdown(word, results) {
    const parts = [];
    let remaining = word;
    
    // Try to find the best prefix + root + suffix combination
    const bestPrefix = results.prefixes[0];
    const bestSuffix = results.suffixes[0];
    
    let prefixKey = bestPrefix ? bestPrefix.matched : '';
    let suffixKey = bestSuffix ? bestSuffix.matched : '';
    
    // Make sure prefix and suffix don't overlap
    if (prefixKey && suffixKey && (prefixKey.length + suffixKey.length) >= word.length) {
      suffixKey = '';
    }

    const coreStart = prefixKey.length;
    const coreEnd = word.length - suffixKey.length;
    const core = word.slice(coreStart, coreEnd);

    if (prefixKey) parts.push({ text: prefixKey, type: 'prefix' });
    if (core) parts.push({ text: core, type: 'root' });
    if (suffixKey) parts.push({ text: suffixKey, type: 'suffix' });

    return parts;
  },

  // Batch analyze an array of words
  analyzeAll(words) {
    return words.map(w => this.analyze(typeof w === 'string' ? w : w.word || w));
  },

  // Search the database for a root/prefix/suffix
  searchDB(query) {
    const q = query.toLowerCase();
    return window.ROOTS_DB.filter(r =>
      r.affix.toLowerCase().includes(q) ||
      r.meaning.includes(q) ||
      r.examples.some(e => e.toLowerCase().includes(q))
    );
  }
};
