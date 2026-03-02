// Cube Tools — Chrome Extension for Redash
// Unified tabbed panel: NL→SQL | AI Analysis | DuckDB SQL Inspector

(function () {
  'use strict';

  const CUBE_API = 'http://localhost:4000/cubejs-api/v1';
  const AI_API = 'http://localhost:8787';

  // ── Caches ──────────────────────────────────────────────────────

  let _schemaCache = null;
  const _aiCache = new Map();
  const _nlCache = new Map();

  async function hashString(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashPayload(sql, columns, rows) {
    return hashString(JSON.stringify({ sql, columns, rows }));
  }

  async function loadSchema() {
    if (_schemaCache) return _schemaCache;
    const res = await fetch(`${CUBE_API}/meta`);
    if (!res.ok) throw new Error('Cannot fetch Cube schema');
    const meta = await res.json();
    _schemaCache = {};
    for (const cube of meta.cubes || []) {
      for (const m of cube.measures || []) _schemaCache[m.name] = 'measure';
      for (const d of cube.dimensions || []) _schemaCache[d.name] = 'dimension';
    }
    return _schemaCache;
  }

  // ── UI Setup ──────────────────────────────────────────────────────

  function createUI() {
    // Single floating button
    const btn = document.createElement('button');
    btn.id = 'cube-unified-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
        <line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
      Cube Tools`;
    document.body.appendChild(btn);

    // Unified tabbed panel
    const panel = document.createElement('div');
    panel.id = 'cube-unified-panel';
    panel.innerHTML = `
      <div class="cu-header">
        <div class="cu-tabs">
          <button class="cu-tab active" data-tab="nl2sql">SQL変換</button>
          <button class="cu-tab" data-tab="ai">AI分析</button>
          <button class="cu-tab" data-tab="duckdb">DuckDB SQL</button>
        </div>
        <button class="cu-close">&times;</button>
      </div>
      <div class="cu-body">
        <div class="cu-content active" data-content="nl2sql">
          <div class="nl-input-area">
            <textarea class="nl-textarea" placeholder="例: ジャンル別の評価数トップ10を見たい" rows="2"></textarea>
            <button class="nl-submit">SQL生成</button>
          </div>
          <div class="nl-result">
            <div class="nl-status">自然言語でデータの質問を入力し、Cube SQL を生成します</div>
          </div>
        </div>
        <div class="cu-content" data-content="ai">
          <div class="ai-status">Redash でクエリを実行してから「AI分析」タブを開いてください</div>
        </div>
        <div class="cu-content" data-content="duckdb">
          <div class="ci-status">Redash でクエリを実行してからこのタブを開いてください</div>
        </div>
      </div>`;
    document.body.appendChild(panel);

    // Toggle panel
    btn.addEventListener('click', () => panel.classList.toggle('open'));
    panel.querySelector('.cu-close').addEventListener('click', () => panel.classList.remove('open'));

    // Draggable panel
    makeDraggable(panel, panel.querySelector('.cu-header'));

    // Position near query editor on first open
    let positioned = false;
    const positionPanel = () => {
      if (positioned) return;
      positioned = true;
      const editor = document.querySelector('.query-editor-wrapper, .ace_editor, .query__editor');
      if (editor) {
        const rect = editor.getBoundingClientRect();
        panel.style.left = Math.max(0, rect.right - panel.offsetWidth) + 'px';
        panel.style.top = Math.max(0, rect.top) + 'px';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
      }
    };
    const origToggle = btn.onclick;
    btn.addEventListener('click', positionPanel);

    // Tab switching
    panel.querySelectorAll('.cu-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.cu-tab').forEach(t => t.classList.remove('active'));
        panel.querySelectorAll('.cu-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        panel.querySelector(`.cu-content[data-content="${tab.dataset.tab}"]`).classList.add('active');
        if (tab.dataset.tab === 'ai') runAIAnalysis();
        if (tab.dataset.tab === 'duckdb') inspectCurrentQuery();
      });
    });

    // NL2SQL submit
    panel.querySelector('.nl-submit').addEventListener('click', runNL2SQL);
    panel.querySelector('.nl-textarea').addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runNL2SQL();
      }
    });

    observeQueryExecution();
  }

  // ── Redash Interaction ──────────────────────────────────────────

  function getRedashSQL() {
    const aceEditor = document.querySelector('.ace_editor');
    if (aceEditor && aceEditor.env && aceEditor.env.editor) return aceEditor.env.editor.getValue();
    const aceLines = document.querySelectorAll('.ace_line');
    if (aceLines.length > 0) return Array.from(aceLines).map(l => l.textContent).join('\n');
    const queryText = document.querySelector('.query-editor-text');
    if (queryText) return queryText.textContent;
    return null;
  }

  function setRedashSQL(sql) {
    const aceEditor = document.querySelector('.ace_editor');
    if (aceEditor && aceEditor.env && aceEditor.env.editor) {
      aceEditor.env.editor.setValue(sql, -1);
      aceEditor.env.editor.clearSelection();
      return true;
    }
    return false;
  }

  function captureRedashResults() {
    const container = document.querySelector('.table-visualization-container');
    if (!container) return null;
    const headerCells = container.querySelectorAll('.ant-table-thead th.ant-table-cell');
    if (!headerCells.length) return null;
    const columns = Array.from(headerCells)
      .map(th => {
        const titleEl = th.querySelector('.ant-table-column-title');
        return (titleEl || th).textContent.trim();
      })
      .filter(c => c.length > 0);
    if (!columns.length) return null;
    const bodyRows = container.querySelectorAll('.ant-table-tbody tr.ant-table-row');
    if (!bodyRows.length) return null;
    const rows = [];
    for (let i = 0; i < Math.min(bodyRows.length, 200); i++) {
      const cells = bodyRows[i].querySelectorAll('td.ant-table-cell');
      const row = {};
      cells.forEach((cell, j) => {
        if (j < columns.length) {
          const text = cell.textContent.trim();
          const num = Number(text.replace(/,/g, ''));
          row[columns[j]] = isNaN(num) || text === '' ? text : num;
        }
      });
      rows.push(row);
    }
    return { columns, rows };
  }

  function observeQueryExecution() {
    const refresh = () => {
      setTimeout(() => {
        const panel = document.getElementById('cube-unified-panel');
        if (!panel || !panel.classList.contains('open')) return;
        const activeTab = panel.querySelector('.cu-tab.active');
        if (activeTab && activeTab.dataset.tab === 'duckdb') inspectCurrentQuery();
      }, 1000);
    };
    document.addEventListener('click', (e) => {
      if (e.target.closest('.execute-button, button[data-test="execute-button"]')) refresh();
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') refresh();
    });
  }

  // ── NL → SQL ──────────────────────────────────────────────────

  async function runNL2SQL() {
    const textarea = document.querySelector('.nl-textarea');
    const resultDiv = document.querySelector('.nl-result');
    const question = textarea.value.trim();

    if (!question) {
      resultDiv.innerHTML = '<div class="nl-status">質問を入力してください</div>';
      return;
    }

    const cacheKey = await hashString(question);
    const cached = _nlCache.get(cacheKey);
    if (cached) {
      renderNL2SQLResult(resultDiv, cached);
      return;
    }

    resultDiv.innerHTML = `
      <div class="nl-streaming">
        <div class="nl-spinner"></div>
        <span>SQL生成中...</span>
      </div>`;

    try {
      const res = await fetch(`${AI_API}/nl2sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();

      if (data.error) {
        resultDiv.innerHTML = `<div class="nl-error">${escapeHtml(data.explanation)}</div>`;
        return;
      }

      _nlCache.set(cacheKey, data);
      renderNL2SQLResult(resultDiv, data);
    } catch (err) {
      resultDiv.innerHTML = `
        <div class="nl-error">${escapeHtml(err.message)}</div>
        <div class="nl-status" style="margin-top:12px">
          AI バックエンドに接続できません。<br>
          <code>cd ai-consultant && uvicorn server:app --port 8787</code>
        </div>`;
    }
  }

  function renderNL2SQLResult(container, data) {
    container.innerHTML = `
      <div class="nl-section">
        <div class="nl-section-title">生成SQL</div>
        <pre class="nl-sql-output">${highlightSQL(data.sql)}</pre>
        <div class="nl-actions">
          <button class="nl-btn nl-copy">コピー</button>
          <button class="nl-btn nl-insert">Redashに挿入</button>
        </div>
      </div>
      <div class="nl-section">
        <div class="nl-section-title">説明</div>
        <div class="nl-explanation">${escapeHtml(data.explanation)}</div>
      </div>`;

    container.querySelector('.nl-copy').addEventListener('click', function () {
      navigator.clipboard.writeText(data.sql);
      this.textContent = 'Copied!';
      setTimeout(() => this.textContent = 'コピー', 1500);
    });

    container.querySelector('.nl-insert').addEventListener('click', function () {
      if (setRedashSQL(data.sql)) {
        this.textContent = '挿入完了!';
        setTimeout(() => this.textContent = 'Redashに挿入', 1500);
      } else {
        this.textContent = 'エディタ未検出';
        setTimeout(() => this.textContent = 'Redashに挿入', 1500);
      }
    });
  }

  // ── DuckDB SQL Inspector ────────────────────────────────────────

  async function cubeExplain(cubeJsonQuery) {
    const res = await fetch(`${CUBE_API}/sql?query=${encodeURIComponent(JSON.stringify(cubeJsonQuery))}`);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cube API error: ${res.status} ${err}`);
    }
    const data = await res.json();
    return {
      duckdbSQL: data.sql?.sql?.[0] || 'N/A',
      params: data.sql?.sql?.[1] || [],
    };
  }

  async function sqlToCubeQuery(sql) {
    const schema = await loadSchema();
    const normalized = sql.replace(/\s+/g, ' ').trim();
    const measures = [];
    const dimensions = [];
    let orderBy = [];
    let limit = null;
    const filters = [];

    const fromMatch = normalized.match(/FROM\s+"?(\w+)"?/i);
    if (!fromMatch) return null;
    const cubeName = fromMatch[1];

    const selectMatch = normalized.match(/SELECT\s+([\s\S]*?)\s+FROM/i);
    if (!selectMatch) return null;

    for (const col of selectMatch[1].split(',').map(c => c.trim())) {
      let memberName;
      const colMatch = col.match(/"?(\w+)"?\s*\.\s*"?(\w+)"?/);
      const simpleMatch = col.match(/^"?(\w+)"?$/);
      const aggMatch = col.match(/(SUM|AVG|COUNT|MIN|MAX)\s*\(\s*"?(\w+)"?\s*\.\s*"?(\w+)"?\s*\)/i);

      if (colMatch) memberName = `${colMatch[1]}.${colMatch[2]}`;
      else if (aggMatch) memberName = `${aggMatch[2]}.${aggMatch[3]}`;
      else if (simpleMatch) memberName = `${cubeName}.${simpleMatch[1]}`;
      else continue;

      const kind = schema[memberName];
      if (kind === 'measure') measures.push(memberName);
      else if (kind === 'dimension') dimensions.push(memberName);
      else dimensions.push(memberName);
    }

    if (!measures.length && !dimensions.length) return null;

    const orderMatch = normalized.match(/ORDER\s+BY\s+([\s\S]*?)(?:LIMIT|$)/i);
    if (orderMatch) {
      for (const part of orderMatch[1].split(',')) {
        const om = part.trim().match(/"?(\w+)"?\s*\.\s*"?(\w+)"?\s*(?:(ASC|DESC))?/i);
        if (om) orderBy.push([`${om[1]}.${om[2]}`, (om[3] || 'ASC').toLowerCase()]);
      }
    }

    const limitMatch = normalized.match(/LIMIT\s+(\d+)/i);
    if (limitMatch) limit = parseInt(limitMatch[1]);

    const whereMatch = normalized.match(/WHERE\s+([\s\S]*?)(?:GROUP|ORDER|LIMIT|$)/i);
    if (whereMatch) {
      for (const cond of whereMatch[1].split(/\s+AND\s+/i)) {
        const fm = cond.trim().match(/"?(\w+)"?\s*\.\s*"?(\w+)"?\s*(=|!=|>|<|>=|<=|LIKE)\s*'?([^']*)'?/i);
        if (fm) {
          const opMap = { '=': 'equals', '!=': 'notEquals', '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte', 'LIKE': 'contains' };
          filters.push({ member: `${fm[1]}.${fm[2]}`, operator: opMap[fm[3].toUpperCase()] || 'equals', values: [fm[4]] });
        }
      }
    }

    const query = {};
    if (measures.length) query.measures = measures;
    if (dimensions.length) query.dimensions = dimensions;
    if (orderBy.length) query.order = orderBy;
    if (limit) query.limit = limit;
    if (filters.length) query.filters = filters;
    return query;
  }

  async function inspectCurrentQuery() {
    const body = document.querySelector('.cu-content[data-content="duckdb"]');
    const sql = getRedashSQL();

    if (!sql || sql.trim().length < 10) {
      body.innerHTML = '<div class="ci-status">クエリが見つかりません。Redash エディタに SQL を入力してください。</div>';
      return;
    }

    body.innerHTML = '<div class="ci-status">Analyzing...</div>';

    try {
      const cubeQuery = await sqlToCubeQuery(sql);
      if (!cubeQuery || (!cubeQuery.measures?.length && !cubeQuery.dimensions?.length)) {
        body.innerHTML = `
          <div class="ci-section">
            <div class="ci-section-title">Redash Query</div>
            <pre>${escapeHtml(sql)}</pre>
          </div>
          <div class="ci-error">Cube テーブルへのクエリを検出できませんでした。<br>"CubeName"."member" 形式のカラム指定が必要です。</div>`;
        return;
      }

      const result = await cubeExplain(cubeQuery);
      body.innerHTML = `
        <div class="ci-section">
          <div class="ci-section-title">Redash Query (入力)</div>
          <pre>${highlightSQL(sql)}</pre>
        </div>
        <div class="ci-section">
          <div class="ci-section-title">Cube Semantic Query (中間)</div>
          <pre>${escapeHtml(JSON.stringify(cubeQuery, null, 2))}</pre>
        </div>
        <div class="ci-section">
          <div class="ci-section-title">DuckDB SQL (実際に実行される)
            <button class="ci-copy" data-target="duckdb-sql">Copy</button>
          </div>
          <pre id="duckdb-sql">${highlightSQL(result.duckdbSQL)}</pre>
        </div>
        ${result.params.length ? `
        <div class="ci-section">
          <div class="ci-section-title">Parameters</div>
          <pre>${escapeHtml(JSON.stringify(result.params))}</pre>
        </div>` : ''}`;

      body.querySelectorAll('.ci-copy').forEach(b => {
        b.addEventListener('click', () => {
          const target = document.getElementById(b.dataset.target);
          navigator.clipboard.writeText(target.textContent);
          b.textContent = 'Copied!';
          setTimeout(() => b.textContent = 'Copy', 1500);
        });
      });
    } catch (err) {
      body.innerHTML = `
        <div class="ci-section">
          <div class="ci-section-title">Redash Query</div>
          <pre>${highlightSQL(sql)}</pre>
        </div>
        <div class="ci-error">${escapeHtml(err.message)}</div>
        <div class="ci-status" style="margin-top:12px">
          Cube.js API (${CUBE_API}) に接続できない場合:<br>
          <code>bash tools/cube-bi.sh</code> で起動してください
        </div>`;
    }
  }

  // ── AI Analysis ─────────────────────────────────────────────────

  async function runAIAnalysis() {
    const body = document.querySelector('.cu-content[data-content="ai"]');
    const sql = getRedashSQL();
    const data = captureRedashResults();

    if (!data || !data.rows.length) {
      body.innerHTML = '<div class="ai-status">結果テーブルが見つかりません。先にクエリを実行してください。</div>';
      return;
    }

    const cacheKey = await hashPayload(sql, data.columns, data.rows);
    const cached = _aiCache.get(cacheKey);
    if (cached) {
      renderAnalysis(body, cached);
      return;
    }

    body.innerHTML = `
      <div class="ai-streaming">
        <div class="ai-spinner"></div>
        <span>Claude が分析中...</span>
      </div>
      <details class="ai-thinking-details">
        <summary class="ai-thinking-toggle">Thinking</summary>
        <div class="ai-thinking-content"></div>
      </details>
      <div class="ai-partial"></div>`;

    try {
      const res = await fetch(`${AI_API}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql || '(unknown)', columns: data.columns, rows: data.rows }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = JSON.parse(line.slice(6));
          if (payload.type === 'thinking') {
            const tc = body.querySelector('.ai-thinking-content');
            if (tc) tc.textContent += payload.text;
          } else if (payload.type === 'partial') {
            const partial = body.querySelector('.ai-partial');
            if (partial) partial.textContent += payload.text;
          } else if (payload.type === 'complete') {
            _aiCache.set(cacheKey, payload.data);
            renderAnalysis(body, payload.data);
          } else if (payload.type === 'error') {
            body.innerHTML = `<div class="ai-error">エラー: ${escapeHtml(payload.message)}</div>`;
          }
        }
      }
    } catch (err) {
      body.innerHTML = `
        <div class="ai-error">${escapeHtml(err.message)}</div>
        <div class="ai-status" style="margin-top:12px">
          AI バックエンドに接続できません。<br>
          <code>cd ai-consultant && uvicorn server:app --port 8787</code>
        </div>`;
    }
  }

  function renderAnalysis(container, data) {
    const sev = { info: ['badge-info', 'INFO'], warning: ['badge-warning', 'WARNING'], critical: ['badge-critical', 'CRITICAL'] };
    const pri = { high: ['badge-critical', 'HIGH'], medium: ['badge-warning', 'MEDIUM'], low: ['badge-info', 'LOW'] };

    let html = `<div class="ai-section">
      <div class="ai-section-title">概要</div>
      <div class="ai-summary">${escapeHtml(data.summary)}</div>
    </div>`;

    if (data.insights?.length) {
      html += '<div class="ai-section"><div class="ai-section-title">インサイト</div>';
      for (const ins of data.insights) {
        const [cls, lbl] = sev[ins.severity] || ['', ins.severity];
        html += `<div class="ai-card"><div class="ai-card-header">
          <span class="ai-badge ${cls}">${lbl}</span>
          <strong>${escapeHtml(ins.title)}</strong>
        </div><p>${escapeHtml(ins.description)}</p></div>`;
      }
      html += '</div>';
    }

    if (data.charts?.length) {
      html += '<div class="ai-section"><div class="ai-section-title">チャート</div>';
      for (let i = 0; i < data.charts.length; i++) {
        html += `<div class="ai-chart-container">
          <div class="ai-chart-title">${escapeHtml(data.charts[i].title)}</div>
          <canvas id="ai-chart-${i}"></canvas>
        </div>`;
      }
      html += '</div>';
    }

    if (data.actions?.length) {
      html += '<div class="ai-section"><div class="ai-section-title">推奨アクション</div>';
      for (const act of data.actions) {
        const [cls, lbl] = pri[act.priority] || ['', act.priority];
        html += `<div class="ai-card"><div class="ai-card-header">
          <span class="ai-badge ${cls}">${lbl}</span>
          <strong>${escapeHtml(act.action)}</strong>
        </div><p>${escapeHtml(act.rationale)}</p></div>`;
      }
      html += '</div>';
    }

    container.innerHTML = html;

    if (data.charts?.length && typeof Chart !== 'undefined') {
      for (let i = 0; i < data.charts.length; i++) {
        const spec = data.charts[i];
        const canvas = document.getElementById(`ai-chart-${i}`);
        if (!canvas) continue;
        new Chart(canvas, {
          type: spec.type,
          data: { labels: spec.labels, datasets: spec.datasets },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 } } } },
            scales: spec.type !== 'pie' && spec.type !== 'doughnut' ? {
              x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1e293b' } },
              y: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#1e293b' } },
            } : undefined,
          },
        });
      }
    }
  }

  // ── Draggable ─────────────────────────────────────────────────────

  function makeDraggable(el, handle) {
    let dragging = false, startX, startY, origX, origY;

    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', (e) => {
      // Don't drag when clicking buttons/tabs inside header
      if (e.target.closest('button')) return;
      dragging = true;
      handle.style.cursor = 'grabbing';
      const rect = el.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origX = rect.left;
      origY = rect.top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      el.style.left = Math.max(0, origX + dx) + 'px';
      el.style.top = Math.max(0, origY + dy) + 'px';
      el.style.bottom = 'auto';
      el.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        handle.style.cursor = 'grab';
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function highlightSQL(sql) {
    let escaped = escapeHtml(sql);
    const kws = ['SELECT', 'FROM', 'WHERE', 'ORDER BY', 'GROUP BY', 'LIMIT', 'AS',
                  'AND', 'OR', 'ON', 'JOIN', 'LEFT', 'INNER', 'DESC', 'ASC',
                  'SUM', 'AVG', 'COUNT', 'MIN', 'MAX', 'HAVING', 'DISTINCT',
                  'ATTACH', 'READ_ONLY'];
    for (const kw of kws) {
      escaped = escaped.replace(new RegExp(`\\b(${kw})\\b`, 'gi'), '<span class="kw">$1</span>');
    }
    escaped = escaped.replace(/(\w+\.\w+)(?=\s+AS\b)/gi, '<span class="tbl">$1</span>');
    escaped = escaped.replace(/&#39;([^&]*)&#39;/g, '<span class="str">\'$1\'</span>');
    return escaped;
  }

  // ── Init ──────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI);
  } else {
    createUI();
  }
})();
