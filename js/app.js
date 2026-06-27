// app.js — entry, hash router, page renderers

import { loadAll, getChapters, getWordsForList, getScenesForChapter, getScene, getWords } from './data.js';
import { el, toast, openModal, closeModal } from './ui.js';
import { storage, wordKeyOf, parseWordKey } from './storage.js';
import { isLLMConfigured, getLLMConfig } from './llm.js';
import { runCloze } from './modes/cloze.js';
import { runUpgrade } from './modes/upgrade.js';
import { runScene } from './modes/scene.js';
import {
  overallProgress, chapterProgress, listProgress,
  getWeakWords, getRecentWords, getMasteredWords,
} from './stats.js';
import { nextWordInList } from './modes/common.js';

// ---------- boot ----------

const app = document.getElementById('app');

boot();

async function boot() {
  showSplash();
  try {
    await loadAll();
  } catch (e) {
    app.innerHTML = '';
    app.appendChild(el('div', { class: 'banner error' },
      `数据加载失败: ${e.message}。请确认 index.html 是通过 HTTP 服务器访问的（直接 file:// 打开会被浏览器拒绝 fetch JSON）。`));
    return;
  }
  hideSplash();
  window.addEventListener('hashchange', route);
  // First-time LLM setup nudge
  if (!isLLMConfigured()) {
    setTimeout(() => promptLLMSetup(), 600);
  }
  route();
}

function showSplash() {
  app.innerHTML = `
    <div style="padding:80px 0;text-align:center;color:var(--text-muted);">
      <div class="dot-flashing"></div> 加载词表中…
    </div>`;
}
function hideSplash() { /* route will overwrite */ }

// ---------- router ----------

function parseHash() {
  const h = (location.hash || '#/').replace(/^#/, '');
  const parts = h.split('/').filter(Boolean);
  return parts;
}

function navigate(hash) {
  if (location.hash === hash) {
    route();
  } else {
    location.hash = hash;
  }
}

function route() {
  const parts = parseHash();
  const [section, a, b, c] = parts;

  // highlight nav
  document.querySelectorAll('.site-nav a').forEach(a => a.classList.remove('active'));
  const navMap = { '': 'home', review: 'review', stats: 'stats', settings: 'settings' };
  const cur = navMap[section] || '';
  document.querySelector(`.site-nav a[data-nav="${cur}"]`)?.classList.add('active');

  if (!section) return renderHome();
  if (section === 'unit' && a != null && b != null) return renderUnit(a, +b);
  if (section === 'train' && a && b != null && c != null) {
    return renderTrain(a, b, +c);
  }
  if (section === 'review') return renderReview();
  if (section === 'stats') return renderStats();
  if (section === 'settings') return renderSettings();
  renderHome();
}

// ---------- Home ----------

function renderHome() {
  const op = overallProgress();
  app.innerHTML = '';

  app.appendChild(el('div', { class: 'row between mb-4' }, [
    el('div', {}, [
      el('h1', {}, '雅思词汇真经 · 遣词造句训练'),
      el('p', { class: 'muted' }, '背了不用等于没背。每个单元给你 6-10 个本单元的词，写一段 100-180 词的回应，让 LLM 逐词打分。'),
    ]),
    el('div', { class: 'col gap-2', style: 'min-width:200px;' }, [
      el('div', { class: 'small muted' }, '总体进度'),
      el('div', { class: 'mono' }, `${op.attempted}/${op.total} 词 · 平均 ${op.avgScore} 分`),
      bar(op.ratio),
    ]),
  ]));

  if (!isLLMConfigured()) {
    app.appendChild(el('div', { class: 'banner warn mb-4' }, [
      el('strong', {}, '⚠ 还没配置 LLM。'),
      ' 主模式"段落造句"依赖 LLM 评分，请先到 ',
      el('a', { href: '#/settings' }, '设置'),
      ' 填写 endpoint + API key + model。DeepSeek / OpenAI / OpenRouter / Ollama 都行。',
    ]));
  }

  // chapters grid
  const grid = el('div', { class: 'grid cols-3 mt-4' });
  for (const ch of getChapters()) {
    const cp = chapterProgress(ch.chapter);
    const card = el('a', {
      class: 'card hover',
      href: `#/unit/${ch.chapter}/${ch.lists[0]}`,
    }, [
      el('div', { class: 'row between' }, [
        el('div', {}, [
          el('div', { class: 'small muted' }, `Chapter ${ch.chapter}`),
          el('h3', { style: 'margin:0;' }, ch.name),
        ]),
        el('div', { class: 'small muted' }, `${ch.lists.length} 个 List · ${ch.count} 词`),
      ]),
      el('div', { class: 'mt-3' }, [
        el('div', { class: 'small muted' }, `已练 ${cp.attempted}/${cp.total} · 掌握 ${cp.mastered}`),
        bar(cp.ratio),
      ]),
    ]);
    grid.appendChild(card);
  }
  app.appendChild(grid);

  app.appendChild(el('div', { class: 'row gap-2 mt-5' }, [
    el('a', { class: 'btn', href: '#/review' }, '错题复习'),
    el('a', { class: 'btn', href: '#/stats' }, '查看统计'),
    el('a', { class: 'btn ghost', href: '#/settings' }, '设置'),
  ]));
}

function bar(ratio, kind = '') {
  const r = Math.max(0, Math.min(1, ratio || 0));
  const pct = (r * 100).toFixed(1);
  return el('div', { class: `bar ${kind}` }, [
    el('i', { style: `width:${pct}%` }),
  ]);
}

// ---------- Unit ----------

function renderUnit(chapter, list) {
  const ch = getChapters().find(c => c.chapter === String(chapter));
  if (!ch) {
    app.innerHTML = ''; app.appendChild(el('div', { class: 'empty' }, '找不到该章节。'));
    return;
  }
  const words = getWordsForList(chapter, list);
  const lp = listProgress(chapter, list);

  app.innerHTML = '';

  // breadcrumb + header
  app.appendChild(el('div', { class: 'mb-4' }, [
    el('div', { class: 'small muted' }, [
      el('a', { href: '#/' }, '主页'),
      ' / ',
      `Chapter ${ch.chapter} ${ch.name}`,
      ' / ',
      `List ${list}`,
    ]),
    el('div', { class: 'row between mt-2' }, [
      el('h1', {}, `${ch.name} · List ${list}`),
      el('div', {}, [
        el('span', { class: 'chip' }, `${words.length} 词`),
        el('span', { class: 'chip accent' }, `已练 ${lp.attempted}`),
        el('span', { class: 'chip success' }, `掌握 ${lp.mastered}`),
        ' ',
      ]),
    ]),
  ]));

  // progress bar
  app.appendChild(bar(lp.ratio, 'success'));
  app.appendChild(el('div', { class: 'small muted mt-2 mb-4' },
    `本单元进度：${lp.attempted}/${lp.total} (${(lp.ratio * 100).toFixed(0)}%) · 平均分 ${lp.avgScore}`));

  // --- 主推：段落造句（hero mode）---
  const scenes = getScenesForChapter(chapter);
  const sceneReady = scenes.length > 0;
  const llmReady = isLLMConfigured();
  const heroCard = el('div', { class: 'card' });
  heroCard.style.background = 'linear-gradient(180deg, #fafbff 0%, #ffffff 100%)';
  heroCard.style.borderColor = '#dbe5fb';
  heroCard.style.padding = '28px';

  const heroBadge = el('div', { class: 'chip accent' }, '🎯 推荐');
  const heroTitle = el('h2', { style: 'margin:8px 0 4px;' }, '段落造句');
  const heroDesc = el('p', { class: 'muted', style: 'margin:0 0 16px;max-width:640px;' },
    `给你 ${scenes[0]?.count || 8} 个本单元的词，写一段 100-180 词的回应。LLM 按雅思写作标准评分，并对每个目标词给出使用反馈——哪个用得自然、哪个用得别扭、哪个完全没用上。`);
  heroCard.append(heroBadge, heroTitle, heroDesc);

  const heroCta = el('button', { class: 'btn accent lg' }, '开始段落造句 →');
  heroCta.disabled = !sceneReady || !llmReady;
  heroCta.title = !sceneReady ? '该章节暂无情境题' : !llmReady ? '需先配置 LLM' : '';
  if (!heroCta.disabled) {
    heroCta.addEventListener('click', () => navigate(`#/train/scene/${chapter}/${scenes[0].id}`));
  } else {
    heroCta.style.opacity = '0.55';
  }
  const heroCtaWrap = el('div', { class: 'row gap-3 mt-2' }, [heroCta]);
  if (!sceneReady) heroCtaWrap.appendChild(el('span', { class: 'small muted' }, '该章节暂无情境题。'));
  else if (!llmReady) heroCtaWrap.appendChild(el('a', { class: 'small', href: '#/settings' }, '先去设置页配置 LLM →'));
  heroCard.appendChild(heroCtaWrap);

  // 多场景提示
  if (scenes.length > 1) {
    const switchRow = el('div', { class: 'small muted mt-3' }, [
      `本章节共 ${scenes.length} 个情境题：`,
      ...scenes.map((s, i) => el('a', {
        href: `#/train/scene/${chapter}/${s.id}`,
        style: 'margin-right:10px;',
      }, `${i + 1}. ${s.id}`)),
    ]);
    heroCard.appendChild(switchRow);
  }
  app.appendChild(heroCard);

  // --- 辅助模式 ---
  app.appendChild(el('h3', { class: 'mt-5 muted', style: 'font-weight:500;' }, '辅助训练'));
  const auxGrid = el('div', { class: 'grid cols-2' });

  // 快速单句（cloze）
  const clozeCard = el('div', { class: 'card hover' });
  clozeCard.appendChild(el('div', { class: 'chip' }, '📝 快速热身手'));
  clozeCard.appendChild(el('h4', { style: 'margin:6px 0 4px;' }, '看词造句'));
  clozeCard.appendChild(el('p', { class: 'small muted', style: 'margin:0;' }, '看一个单词和中文释义，30 秒写一句英文。不需要 LLM，本地基础检查。'));
  clozeCard.style.cursor = 'pointer';
  clozeCard.addEventListener('click', () => {
    const first = words[0];
    navigate(`#/train/cloze/${chapter}/${list}/${first.index}`);
  });
  auxGrid.appendChild(clozeCard);

  // 句子升级
  const upgradeCard = el('div', { class: 'card hover' });
  upgradeCard.appendChild(el('div', { class: 'chip warn' }, '📈 高级'));
  upgradeCard.appendChild(el('h4', { style: 'margin:6px 0 4px;' }, '句子升级'));
  upgradeCard.appendChild(el('p', { class: 'small muted', style: 'margin:0;' }, '把朴素句改成"雅思风"。LLM 从升级幅度/语法/用词档次评分。'));
  if (!llmReady) {
    upgradeCard.style.opacity = '0.55';
    upgradeCard.appendChild(el('div', { class: 'small muted mt-2' }, '需先配置 LLM'));
  } else {
    upgradeCard.style.cursor = 'pointer';
    upgradeCard.addEventListener('click', () => {
      const first = words[0];
      navigate(`#/train/upgrade/${chapter}/${list}/${first.index}`);
    });
  }
  auxGrid.appendChild(upgradeCard);

  app.appendChild(auxGrid);

  // word list
  app.appendChild(el('h2', { class: 'mt-5' }, '本单元词汇'));
  const list2 = el('div', { class: 'list' });
  for (const w of words) {
    const key = wordKeyOf(w);
    const p = storage.getProgress(key);
    const item = el('div', { class: 'list-item' });
    item.appendChild(el('span', { class: 'word' }, `${w.word}`));
    item.appendChild(el('span', { class: 'def' }, w.definition || '—'));
    const meta = el('div', { class: 'meta' });
    if (p) {
      if ((p.score || 0) >= 7) meta.appendChild(el('span', { class: 'chip success' }, `✓ ${p.score || 0}`));
      else if ((p.score || 0) >= 5) meta.appendChild(el('span', { class: 'chip accent' }, `${p.score || 0}`));
      else meta.appendChild(el('span', { class: 'chip error' }, `${p.score || 0}`));
      meta.appendChild(el('span', { class: 'badge' }, `${p.attempts}`));
    } else {
      meta.appendChild(el('span', { class: 'chip' }, '未练'));
    }
    // small actions
    const acts = el('div', { class: 'row gap-2' });
    const cb = el('a', { class: 'btn sm', href: `#/train/cloze/${chapter}/${list}/${w.index}` }, '造句');
    acts.appendChild(cb);
    meta.appendChild(acts);
    item.appendChild(meta);
    list2.appendChild(item);
  }
  app.appendChild(list2);

  // list selector (other lists in same chapter)
  if (ch.lists.length > 1) {
    const sel = el('div', { class: 'row gap-2 mt-4' }, [
      el('span', { class: 'small muted' }, '切换 List:'),
      ...ch.lists.map(l => el('a', {
        class: `chip ${l === list ? 'accent' : ''}`,
        href: `#/unit/${chapter}/${l}`,
      }, `List ${l}`)),
    ]);
    app.appendChild(sel);
  }
}

// ---------- Train wrapper ----------

function renderTrain(mode, chapter, listOrIndex, wordIndex) {
  // For cloze/upgrade: chapter/list/wordIndex
  // For scene: chapter/sceneId
  if (mode === 'scene') {
    const sceneId = listOrIndex; // shift naming
    const scene = getScene(sceneId);
    if (!scene) { app.innerHTML = ''; app.appendChild(el('div', { class: 'empty' }, '找不到该情境。')); return; }
    const words = getWordsForList(chapter, scene.list);
    // pick N target words from the list — exclude ones already mastered recently to add variety
    const targets = pickTargets(words, scene.count || 4);
    if (!isLLMConfigured()) {
      renderSettings({ redirectAfter: `#/train/scene/${chapter}/${sceneId}` });
      return;
    }
    app.innerHTML = '';
    app.appendChild(el('div', { class: 'small muted mb-3' }, [
      el('a', { href: '#/' }, '主页'),
      ' / ',
      el('a', { href: `#/unit/${chapter}/${scene.list}` }, `Chapter ${chapter}`),
      ' / 情境造句',
    ]));
    const container = el('div', {});
    app.appendChild(container);
    runScene({
      scene,
      entries: targets,
      container,
      onAdvance: () => {
        // next scene in same chapter
        const all = getScenesForChapter(chapter);
        const idx = all.findIndex(s => s.id === scene.id);
        const nextScene = all[(idx + 1) % all.length];
        if (nextScene && nextScene.id !== scene.id) {
          navigate(`#/train/scene/${chapter}/${nextScene.id}`);
        } else {
          navigate(`#/unit/${chapter}/${scene.list}`);
        }
      },
    });
    return;
  }

  // cloze / upgrade
  const words = getWordsForList(chapter, listOrIndex);
  const idx = words.findIndex(w => w.index === wordIndex);
  const entry = idx >= 0 ? words[idx] : words[0];
  if (!entry) { app.innerHTML = ''; app.appendChild(el('div', { class: 'empty' }, '该单元暂无单词。')); return; }

  if ((mode === 'upgrade') && !isLLMConfigured()) {
    renderSettings({ redirectAfter: `#/train/${mode}/${chapter}/${listOrIndex}/${wordIndex}` });
    return;
  }

  app.innerHTML = '';
  app.appendChild(el('div', { class: 'row between mb-3' }, [
    el('div', { class: 'small muted' }, [
      el('a', { href: '#/' }, '主页'),
      ' / ',
      el('a', { href: `#/unit/${chapter}/${listOrIndex}` }, `Chapter ${chapter} List ${listOrIndex}`),
      ` / ${mode === 'cloze' ? '看词造句' : '句子升级'}`,
    ]),
    el('div', { class: 'small muted' }, `${idx + 1} / ${words.length}`),
  ]));

  const container = el('div', {});
  app.appendChild(container);

  const onAdvance = (_verdict) => {
    const next = nextWordInList(words, wordKeyOf(entry), +1);
    if (next && next.index !== entry.index) {
      navigate(`#/train/${mode}/${chapter}/${listOrIndex}/${next.index}`);
    } else {
      // completed list
      toast('🎉 完成本单元！', 'success');
      navigate(`#/unit/${chapter}/${listOrIndex}`);
    }
  };

  if (mode === 'cloze') runCloze({ entry, container, onAdvance });
  else if (mode === 'upgrade') runUpgrade({ entry, container, onAdvance });
}

function pickTargets(words, count) {
  // Light variety: shuffle + prefer words without recent progress.
  // Hard cap at min(count, words.length) — never ask for more targets
  // than the unit actually has.
  const cap = Math.min(count || 8, words.length);
  if (cap <= 0) return [];
  const arr = words.slice();
  // stable-ish shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const picked = [];
  // prioritize unmastered
  for (const w of arr) {
    const p = storage.getProgress(wordKeyOf(w));
    const fresh = !p || (p.attempts || 0) < 2 || (p.score || 0) < 7;
    if (fresh) picked.push(w);
    if (picked.length >= cap) break;
  }
  if (picked.length < cap) {
    for (const w of arr) {
      if (!picked.includes(w)) picked.push(w);
      if (picked.length >= cap) break;
    }
  }
  return picked;
}

// ---------- Review ----------

function renderReview() {
  const weak = getWeakWords(50);
  app.innerHTML = '';
  app.appendChild(el('h1', {}, '错题复习'));
  app.appendChild(el('p', { class: 'muted' }, `当前 ${weak.length} 个薄弱词。点击任一词进入"看词造句"重新巩固。`));

  if (!weak.length) {
    app.appendChild(el('div', { class: 'empty mt-4' }, '还没有错题。练一些单元，错题会自动出现在这里。'));
    return;
  }
  const list = el('div', { class: 'list' });
  for (const x of weak) {
    const w = x.word;
    const item = el('div', { class: 'list-item' });
    item.appendChild(el('span', { class: 'word' }, w.word));
    item.appendChild(el('span', { class: 'def' }, w.definition || '—'));
    const meta = el('div', { class: 'meta' }, [
      el('span', { class: 'chip error' }, `score ${x.score}`),
      el('span', { class: 'chip' }, `try ${x.attempts}`),
      el('a', { class: 'btn sm', href: `#/train/cloze/${w.chapter}/${w.list}/${w.index}` }, '重练'),
    ]);
    item.appendChild(meta);
    list.appendChild(item);
  }
  app.appendChild(list);
}

// ---------- Stats ----------

function renderStats() {
  const op = overallProgress();
  const recent = getRecentWords(10);
  const mastered = getMasteredWords(10);

  app.innerHTML = '';
  app.appendChild(el('h1', {}, '统计'));

  const grid = el('div', { class: 'grid cols-3' });
  grid.appendChild(statCard('总词数', `${op.total}`));
  grid.appendChild(statCard('已练', `${op.attempted} (${(op.ratio * 100).toFixed(0)}%)`));
  grid.appendChild(statCard('已掌握', `${op.mastered} (${(op.mastery * 100).toFixed(0)}%)`));
  grid.appendChild(statCard('平均分', `${op.avgScore}`));
  grid.appendChild(statCard('错题数', `${storage.getWeak().length}`));
  grid.appendChild(statCard('历史场景', `${storage.getHistory().length}`));
  app.appendChild(grid);

  app.appendChild(el('h2', { class: 'mt-5' }, '最近练的'));
  app.appendChild(buildWordTable(recent));
  app.appendChild(el('h2', { class: 'mt-5' }, '掌握最好'));
  app.appendChild(buildWordTable(mastered));

  app.appendChild(el('div', { class: 'row gap-2 mt-5' }, [
    el('button', { class: 'btn ghost danger', onClick: () => {
      openModal({
        title: '清空所有本地数据？',
        body: '将删除全部进度、设置、错题记录。此操作不可恢复。',
        actions: [
          { label: '取消', kind: 'ghost' },
          { label: '确认清空', kind: 'primary', onClick: () => { storage.clearAll(); toast('已清空。', 'success'); navigate('#/stats'); } },
        ],
      });
    } }, '清空所有本地数据'),
    el('button', { class: 'btn', onClick: () => {
      const data = storage.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ielts-trainer-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } }, '导出进度 JSON'),
  ]));
}

function statCard(label, value) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'small muted' }, label),
    el('div', { style: 'font-size:28px;font-weight:600;font-family:var(--font-serif);margin-top:4px;' }, value),
  ]);
}
function buildWordTable(arr) {
  const list = el('div', { class: 'list' });
  if (!arr.length) {
    list.appendChild(el('div', { class: 'empty' }, '暂无数据。'));
    return list;
  }
  for (const x of arr) {
    const w = x.word;
    if (!w) continue;
    const p = storage.getProgress(wordKeyOf(w));
    list.appendChild(el('div', { class: 'list-item' }, [
      el('span', { class: 'word' }, w.word),
      el('span', { class: 'def' }, w.definition || '—'),
      el('div', { class: 'meta' }, [
        el('span', { class: 'chip' }, `${w.chapter_name} · L${w.list}`),
        el('span', { class: `chip ${(p?.score||0) >= 7 ? 'success' : (p?.score||0) >= 5 ? 'accent' : 'error'}` }, `score ${p?.score ?? '—'}`),
      ]),
    ]));
  }
  return list;
}

// ---------- Settings ----------

function renderSettings({ redirectAfter } = {}) {
  const cur = getLLMConfig();
  app.innerHTML = '';
  app.appendChild(el('h1', {}, '设置'));

  app.appendChild(el('div', { class: 'settings-section' }, [
    el('h3', {}, 'LLM 评分配置'),
    el('p', { class: 'muted small' }, [
      '本训练需要 LLM 来评分（句子升级、情境造句必填；看词造句也能用到）。',
      '本工具采用 OpenAI 兼容协议，',
      '可接入 OpenAI / DeepSeek / OpenRouter / 月之暗面 / Ollama 等任何兼容端点。',
    ]),
    el('div', { class: 'banner' }, [
      el('strong', {}, '提示：'),
      ' API key 仅保存在你浏览器的 localStorage，从不上传任何服务器。',
      '推荐快速选择：',
      el('a', { href: 'https://platform.deepseek.com', target: '_blank', rel: 'noopener' }, ' DeepSeek '),
      '（便宜、中文友好）或 ',
      el('a', { href: 'https://openrouter.ai', target: '_blank', rel: 'noopener' }, ' OpenRouter '),
      '（一个 key 用多家模型）。',
    ]),

    el('div', { class: 'grid cols-2 mt-4' }, [
      labeled('Endpoint', el('input', {
        class: 'input', id: 'cfg-endpoint',
        placeholder: 'https://api.openai.com/v1',
        value: cur.endpoint,
      }), 'OpenAI 兼容 API 的根 URL，必须包含 /v1。'),
      labeled('Model', el('input', {
        class: 'input', id: 'cfg-model',
        placeholder: 'gpt-4o-mini',
        value: cur.model,
      }), '具体模型名，例如 gpt-4o-mini / deepseek-chat / claude-3-5-sonnet。'),
    ]),
    labeled('API Key', el('input', {
      class: 'input', id: 'cfg-key', type: 'password',
      placeholder: 'sk-...', value: cur.apiKey,
    }), '只在本机存储，不上传任何地方。'),
    el('div', { class: 'row gap-2 mt-4' }, [
      el('button', { class: 'btn primary', onClick: save }, '保存'),
      el('button', { class: 'btn', onClick: test }, '测试连接'),
    ]),
    el('div', { id: 'cfg-test-out', class: 'mt-3' }),
  ]));

  app.appendChild(el('div', { class: 'settings-section' }, [
    el('h3', {}, '推荐配置示例'),
    el('div', { class: 'card soft small mono' }, [
      'OpenAI:    endpoint = https://api.openai.com/v1    model = gpt-4o-mini\n',
      'DeepSeek:  endpoint = https://api.deepseek.com/v1  model = deepseek-chat\n',
      'OpenRouter: endpoint = https://openrouter.ai/api/v1 model = anthropic/claude-3.5-sonnet\n',
      'Ollama:    endpoint = http://localhost:11434/v1    model = llama3.1:8b',
    ]),
  ]));

  function save() {
    const endpoint = document.getElementById('cfg-endpoint').value.trim();
    const apiKey = document.getElementById('cfg-key').value.trim();
    const model = document.getElementById('cfg-model').value.trim() || 'gpt-4o-mini';
    if (!endpoint || !apiKey) { toast('请填写 endpoint 和 API key。', 'warn'); return; }
    storage.setSettings({ llmEndpoint: endpoint, llmApiKey: apiKey, llmModel: model });
    toast('已保存。', 'success');
    if (redirectAfter) navigate(redirectAfter);
  }
  async function test() {
    const out = document.getElementById('cfg-test-out');
    out.innerHTML = '';
    out.appendChild(el('div', { class: 'small muted' }, '测试中…'));
    save();
    const { chatCompletion } = await import('./llm.js');
    try {
      const t0 = Date.now();
      const reply = await chatCompletion({
        messages: [
          { role: 'system', content: 'You are a connectivity test. Reply with exactly the word OK.' },
          { role: 'user', content: 'ping' },
        ],
        temperature: 0,
      });
      const dt = Date.now() - t0;
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'banner success' },
        `✅ 连接成功 (${dt}ms)：模型回复 " ${reply.slice(0, 60)} "`));
    } catch (e) {
      out.innerHTML = '';
      out.appendChild(el('div', { class: 'banner error' }, `❌ 失败：${e.message}`));
    }
  }

  // pre-fill redirect context note
  if (redirectAfter) {
    app.appendChild(el('div', { class: 'banner warn mt-3' },
      `保存后将自动跳转到：${redirectAfter}`));
  }
}

function labeled(label, input, hint) {
  const wrap = el('div', { class: 'mb-3' }, [
    el('label', { class: 'label', for: input.id }, label),
    input,
    hint ? el('div', { class: 'hint' }, hint) : null,
  ]);
  return wrap;
}

function promptLLMSetup() {
  openModal({
    title: '欢迎！先配置一下 LLM',
    body: el('div', {}, [
      el('p', {}, '本训练依赖 LLM 做评分（句子升级、情境造句必填）。请先到设置页填写 endpoint + API key + model。'),
      el('p', { class: 'small muted' }, 'DeepSeek / OpenAI / OpenRouter / Ollama 等任何 OpenAI 兼容端点都行。'),
      el('p', { class: 'small muted' }, '也可以先点击"稍后"，但 LLM 模式暂时用不了。'),
    ]),
    actions: [
      { label: '稍后', kind: 'ghost' },
      { label: '去设置', kind: 'primary', onClick: () => navigate('#/settings') },
    ],
  });
}
