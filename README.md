# 雅思词汇真经 · 遣词造句训练

一个针对《雅思词汇真经》每单元设计的**遣词造句**训练网站 —— 不是让你背单词，而是让你**用**单词。

> 痛点：背了一堆词，真正要写/说的时候就是想不起来。
> 解法：每个单词都被强制放进一个真实句子里去写出来，再用 LLM 评分。

## 三种训练模式

每个单元（List）都有这三种训练，按需切换：

1. **看词造句（Cloze-write）** — 看英文单词 + 中文释义，自己写一句英文把词用进去。本地基础检查（是否含目标词、长度、标点、大小写），LLM 评分语法/自然度/用词。

2. **句子升级（Upgrade）** — 给一个朴素句（用最基础的词汇），任务是把句子"升级"成雅思/学术风格的更复杂表达。LLM 从升级幅度、语法、用词档次三方面评分。

3. **情境造句（Scene-write）** — 给一个雅思常见话题（"Describe a natural landscape…"等），从本单元抽 4 个目标词，要求写一段 80-180 词的回应。LLM 按雅思写作标准（任务回应、词汇、语法、连贯）评分并给出 band 分。

## 数据来源

- 词表：《雅思词汇真经》彩色单词表
- 共 **22 个章节**、**63 个 List**、约 **3,700 个单词**
- 提取自配套 PDF（`scripts/extract_words.py`）

## LLM 配置

本工具采用 **OpenAI 兼容协议**，可接入任何支持该协议的端点：

| 服务 | endpoint | model 示例 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| OpenRouter | `https://openrouter.ai/api/v1` | `anthropic/claude-3.5-sonnet` |
| Ollama（本地）| `http://localhost:11434/v1` | `llama3.1:8b` |

**配置保存**：进入 `设置` 页填写 endpoint / API key / model 后点"保存"。所有信息只存到你浏览器的 localStorage，从不上传任何服务器。

**第一次访问**：网站会弹窗提示去配置 LLM。"看词造句"模式即使没 LLM 也能用（本地基础检查），但"句子升级"和"情境造句"必须有 LLM。

## 本地运行

直接双击 `index.html` 在浏览器中打开**不会工作**（浏览器拒绝 `file://` 协议的 fetch）。需要启动一个简单的 HTTP 服务器：

```bash
# 方案 A：Python（任一版本 3.x）
cd ielts-vocab-trainer
python -m http.server 8080
# 然后浏览器打开 http://localhost:8080

# 方案 B：Node.js
npx serve .

# 方案 C：VS Code 装 Live Server 扩展，右键 index.html → Open with Live Server
```

## 部署到 GitHub Pages

1. 把整个 `ielts-vocab-trainer/` 目录 push 到 GitHub 仓库的默认分支。
2. 进入 GitHub 仓库页面 → Settings → Pages → Source 选 `Deploy from a branch` → 选 `main` 分支和 `/ (root)`。
3. 等待约 1-2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`。

> 如果要部署到 user page（`username.github.io` 域名），把 `index.html` 等放在仓库根；如果部署到 project page，路径会自动带上 `/<仓库名>/`，本项目代码已经按相对路径写（`data/words.json` 等），两种部署方式都通用。

## 项目结构

```
ielts-vocab-trainer/
├── index.html              # SPA 入口
├── css/                    # 极简白样式
│   ├── base.css
│   ├── components.css
│   └── train.css
├── js/
│   ├── app.js              # 路由 + 页面渲染
│   ├── data.js             # 词表/章节/场景加载与索引
│   ├── storage.js          # localStorage 封装
│   ├── llm.js              # OpenAI 兼容 client
│   ├── stats.js            # 进度/错题聚合
│   ├── ui.js               # DOM 工具 + toast + modal
│   └── modes/
│       ├── cloze.js        # 看词造句
│       ├── upgrade.js      # 句子升级
│       ├── scene.js        # 情境造句
│       └── common.js       # 训练模式共享工具
├── data/
│   ├── words.json          # 3,700 词条
│   ├── chapters.json       # 章节摘要
│   └── scenes.json         # 26 个情境造句 prompts
└── README.md
```

## 数据结构

`data/words.json` 每条记录：
```json
{
  "chapter": "1",
  "chapter_name": "自然地理",
  "list": 1,
  "page": 1,
  "index": 1,
  "word": "atmosphere",
  "definition": "大气层；气氛 working~",
  "raw": "atmosphere n. 大气层；气氛 working~"
}
```

## 进度数据本地化

所有进度、设置、错题都存在浏览器的 localStorage：

- `ielts_trainer:progress` — 每词进度（attempts / score / lastSeen / samples）
- `ielts_trainer:settings` — LLM 配置
- `ielts_trainer:weak_words` — 错题队列
- `ielts_trainer:history` — 最近训练历史

可在统计页导出 JSON 备份。

## 重新提取词表

如果 PDF 更新或源数据有变：
```bash
python scripts/extract_words.py
```
（脚本读取 `雅思词汇真经 彩色单词表 表格.pdf`，输出到 `data/raw/`）

## License

源码：MIT
词表内容：仅供个人学习使用，版权归原书作者所有。
