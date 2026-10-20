/**
 * image_rename —— Typora 图片自定义重命名插件
 * 命名模板与冲突策略对齐 Obsidian「Image Converter」插件的
 * 「自定义图片名称 / 如果输出文件已存在」设置样式。
 *
 * 原理（零侵入）：监听编辑区 #write 的 DOM 变动，图片插入后
 * 调用 Typora 原生 imgEdit.moveImageTo_ 完成改名——它会同时
 * 改磁盘文件名、按当前设置把新路径相对化并重写整块 Markdown
 * 源码（与右键「重命名/移动图片到…」完全同一条链路），不断链。
 *
 * 支持的占位符（与 Image Converter 一致）：
 *   {notename}          当前笔记名
 *   {notename_nospaces} 笔记名（空格转下划线）
 *   {notefolder}        笔记所在文件夹名
 *   {imagename}         原图片文件名（不含扩展名）
 *   {filetype} / {ext}  扩展名（不含点）
 *   {date}              2026-10-16        {time}   18-44-30
 *   {YYYY} {MM} {DD}    年 / 月 / 日（补零）
 *   {HH}   {mm} {ss}    时 / 分 / 秒（补零）
 *   {date:FORMAT}       自定义格式，支持 YYYY YY MM DD HH mm ss dddd
 *   {timestamp}         Unix 时间戳（秒）
 *   {weekday} {month}   星期几 / 月份英文名
 *   {today} {yesterday} {tomorrow}
 *
 * 冲突策略（CONFLICT_MODE）：
 *   increment  添加数字后缀（-1、-2 等）  ← 默认，同 Image Converter
 *   skip       已存在同名则保持原名不动
 */

const fs = require("fs");
const path = require("path");

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

class ImageRenamePlugin extends (global.BasePlugin || class {}) {
  constructor(fixedName, config, i18n) {
    super(fixedName, config, i18n);
    this.fixedName = fixedName || "image_rename";
    // 本会话内已处理过的绝对路径（旧名+新名都记），防止重渲染后二次改名
    this.renamed = new Set();
  }

  // ---- 配置 ----
  options() {
    const c = this.config || {};
    return {
      pattern: c.PATTERN || "Image{notename}-{date}  {HH}：{mm}",
      conflictMode: c.CONFLICT_MODE || "increment", // increment | skip
      recentMs: c.RECENT_MS != null ? c.RECENT_MS : 20000,
      renameAuto: c.RENAME_AUTO != null ? c.RENAME_AUTO : true,
      keepUrlRaw: c.KEEP_URL_RAW != null ? c.KEEP_URL_RAW : true,
      // 别名同步轮询：间隔越短越“即时”，重试次数保证原生链路完成前不漏
      postfixDelay: c.POSTFIX_DELAY != null ? c.POSTFIX_DELAY : 200,
      postfixTries: c.POSTFIX_TRIES != null ? c.POSTFIX_TRIES : 20,
    };
  }

  log(msg) {
    console.log("[ImageRename] " + msg);
  }

  // 文件调试日志：写入插件目录 debug.log（用于诊断 alt 同步链路）
  debugLog(msg) {
    try {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      const line = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")} ${msg}`;
      console.log("[ImageRename] " + line);
      fs.appendFileSync(path.join(__dirname || ".", "debug.log"), line + "\n");
    } catch (e) {}
  }

  // ---- 生命周期 ----
  process() {
    // KEEP_URL_RAW（默认开）：关闭 Typora 的“图片URL转义”，让 Markdown 链接保持可读中文
    // （否则用户开启 autoEscapeImageURL 时，保存后链接会变成 %XX 编码）
    if (!this.options().keepUrlRaw) {
      // 保持用户自己的 Typora 设置
    } else {
      try {
        if (typeof File !== "undefined" && File.option) File.option.autoEscapeImageURL = false;
      } catch (e) {}
    }
    this.start();
  }

  // 供框架 commander / hotkeys 调用
  call(action) {
    if (action === "rename-all") this.renameAll();
    else if (action === "rename-selected") this.renameSelected();
    else if (action === "decode-links") this.decodeAllLinks();
    else if (action === "sync-alt") this.syncAllAlt();
    else if (action === "preview") this.log("命名预览: " + this.buildName("png") + ".png");
  }

  start() {
    if (typeof File === "undefined") {
      setTimeout(() => this.start(), 800);
      return;
    }
    const mount = document.getElementById("write");
    if (!mount) {
      setTimeout(() => this.start(), 800);
      return;
    }
    this.mount = mount;
    this.observer = new MutationObserver((muts) => this.onMutations(muts));
    this.observer.observe(mount, { childList: true, subtree: true });
    // 每次会话重置调试日志，避免无限增长
    try {
      fs.writeFileSync(path.join(__dirname || ".", "debug.log"),
        "---- session " + new Date().toLocaleString() + " ----\n");
    } catch (e) {}
    this.log("已挂载图片重命名监听（#write）");
    this.log("命名预览: " + this.buildName("png") + ".png");
  }

  onMutations(muts) {
    if (!this.options().renameAuto) return;
    const imgs = [];
    for (const m of muts) {
      for (const n of m.addedNodes) this.collect(n, imgs);
    }
    if (!imgs.length) return;
    // 稍候，确保 Typora 已把图片写入磁盘、src 与 .md-img-loaded 就绪
    setTimeout(() => {
      for (const img of imgs) this.handle(img, false);
    }, 300);
  }

  collect(node, out) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === "IMG") out.push(node);
    if (node.querySelectorAll) {
      node.querySelectorAll("img").forEach((i) => out.push(i));
    }
  }

  // ---- 核心：处理单张图片 ----
  handle(img, force) {
    if (!img || !img.tagName) return;
    const span = img.closest(".md-image") || img.closest("[md-inline]") || img.parentElement;
    if (!span) return;
    if (img.dataset.renamed === "1") return;

    const src = img.getAttribute && img.getAttribute("src");
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return;

    // 取图片绝对路径：优先 Typora 官方 API
    const imgEdit = (typeof File !== "undefined" && File.editor && File.editor.imgEdit) || null;
    let abs = null;
    try {
      if (imgEdit && typeof imgEdit.getSrcFromDom === "function") {
        abs = imgEdit.getSrcFromDom(span, true);
      }
    } catch (e) {}
    if (!abs) abs = this.resolve(src);
    if (!abs || !fs.existsSync(abs)) return;
    abs = path.resolve(abs);

    // 幂等保护 1：本会话已处理过该路径
    if (this.renamed.has(abs)) {
      img.dataset.renamed = "1";
      return;
    }

    if (!force) {
      // 只处理“刚生成”的图片，避免误伤手动命名的旧图
      try {
        const st = fs.statSync(abs);
        if (Date.now() - st.mtimeMs > this.options().recentMs) return;
      } catch (e) {
        return;
      }
      // 只在 Typora 配置的目标图片文件夹内生效
      const target = this.targetFolder();
      if (target && this.norm(path.dirname(abs)) !== this.norm(target)) return;
    }

    const ext = (path.extname(abs).slice(1) || "png").toLowerCase();
    const origBase = path.basename(abs).replace(/\.[^.]+$/, "");
    const newName = this.buildName(ext, origBase);

    // 幂等保护 2：文件名已符合模板（重渲染场景）则不再改
    if (origBase === newName) {
      img.dataset.renamed = "1";
      this.renamed.add(abs);
      return;
    }

    const newAbs = this.uniqueName(path.dirname(abs), newName, ext);
    if (!newAbs) { // skip 模式：同名已存在则保持原名
      img.dataset.renamed = "1";
      this.renamed.add(abs);
      return;
    }
    if (path.resolve(newAbs) === abs) {
      img.dataset.renamed = "1";
      this.renamed.add(abs);
      return;
    }

    // 记入已处理集合（新旧路径都记，先于异步操作）
    this.renamed.add(abs);
    this.renamed.add(path.resolve(newAbs));

    // ---- 首选：Typora 原生改名链路（文件+Markdown源+undo 全同步）----
    // moveImageTo_(span, 新完整路径, 旧绝对路径, 新路径为完整文件名, 删除原文件)
    try {
      const jq = (typeof $ !== "undefined") ? $ : (typeof window !== "undefined" && window.$);
      if (imgEdit && typeof imgEdit.moveImageTo_ === "function" && jq) {
        const $span = jq(span);
        if ($span && $span.length) {
          const blockEl = span.closest("[cid]");
          const cid = blockEl && blockEl.getAttribute("cid");
          img.dataset.renamed = "1";
          // 方案A（零轮询）：原生改名前先把 alt 写入源码——原生 N 改写路径时会保留 alt，一次到位。
          // 仅当图片处于含 .md-content 的源码态才生效；失败时退回轮询兜底。
          let preOk = false;
          try { preOk = this.presetAlt(cid, path.basename(abs), newName); } catch (e) { preOk = false; this.debugLog("presetAlt 异常 " + (e && e.message)); }
          imgEdit.moveImageTo_($span, newAbs, abs, true, true);
          this.debugLog("handle 原生链路 " + path.basename(abs) + " -> " + path.basename(newAbs) + " cid=" + cid + " 方案A=" + preOk);
          this.log(path.basename(abs) + "  ->  " + path.basename(newAbs) + (preOk ? "（方案A 零轮询）" : "（原生链路）"));
          if (!preOk) this.schedulePostFix(cid, newName, newAbs); // 兜底：方案A 未生效再轮询
          return;
        }
      }
    } catch (e) {
      this.log("原生改名失败，回退手动模式: " + e.message);
    }

    // ---- 降级：手动改名 + 更新 DOM（旧版 Typora 兜底）----
    try {
      fs.renameSync(abs, newAbs);
      const rel = this.toRel(path.resolve(newAbs));
      img.setAttribute("src", rel);
      if (span.hasAttribute && span.hasAttribute("data-src")) {
        span.setAttribute("data-src", rel);
      }
      img.dataset.renamed = "1";
      this.log(path.basename(abs) + "  ->  " + path.basename(newAbs));
    } catch (e) {
      this.renamed.delete(abs);
      this.log("改名失败: " + e.message);
    }
  }

  // ---- 链接美化：解码 %XX 编码 + 同步 alt 为新文件名 ----
  schedulePostFix(cid, newName, newAbs, tries) {
    const o = this.options();
    const delay = o.postfixDelay;
    const max = tries != null ? tries : o.postfixTries;
    const attempt = (left) => {
      setTimeout(() => {
        const ok = this.postFixBlock(cid, newName, newAbs);
        this.debugLog("postFix 尝试(剩" + left + ") ok=" + ok + " alt=" + newName);
        if (!ok && left > 0) attempt(left - 1); // 原生链路异步，未就绪则重试
      }, delay);
    };
    attempt(max);
  }

  // 清理 img src：去 file:// 前缀、去 ?lastModify=... / #... 缓存参数、解码 %XX
  cleanSrc(s) {
    s = (s || "").replace(/^file:\/\//, "").replace(/[?#].*$/, "");
    try { s = decodeURIComponent(s); } catch (e) {}
    return s;
  }

  // 在块内按“解码后 src 的 basename”定位图片，返回 { img, span } 或 null
  findImgInBlock(block, base) {
    for (const im of block.querySelectorAll("img")) {
      const s = this.cleanSrc(im.getAttribute("src"));
      if (s.replace(/\\/g, "/").endsWith(base)) {
        return { img: im, span: im.closest(".md-image") || im.parentElement };
      }
    }
    return null;
  }

  // 方案A：在原生改名之前，把源码里目标图的 alt 改为 altName。
  // 仅当图片 span 含 .md-content（源码态）时生效；改写后不 brush（保留节点，让后续 moveImageTo_ 正常接管），
  // 由原生 N 改写路径时把新 alt 一并带出。返回 true=已改写，false=无源码态、需走轮询兜底。
  presetAlt(cid, matchBase, altName) {
    let block = null;
    try {
      const b = File.editor.findElemById && File.editor.findElemById(cid);
      block = b && (b[0] || b);
    } catch (e) {}
    if (!block || !block.querySelectorAll) return false;
    const hit = this.findImgInBlock(block, matchBase);
    if (!hit || !hit.span) return false;

    const nodes = hit.span.querySelectorAll(".md-content, .md-meta");
    for (const content of nodes) {
      const text = content.textContent || "";
      if (!text || text.indexOf("![") < 0) continue;
      const re = /!\[([^\]]*)\]\(([^()]+)\)/g;
      let m;
      while ((m = re.exec(text))) {
        let dec = m[2];
        try { dec = decodeURIComponent(m[2]); } catch (e) {}
        if (dec.replace(/\\/g, "/").endsWith(matchBase)) {
          const fixed = text.replace(m[0], () => `![${altName}](${dec})`);
          if (fixed !== text) {
            content.textContent = fixed;
            try { File.editor.undo.addSnap(cid, 2); } catch (e) {}
            try {
              const node = (typeof $ !== "undefined")
                ? File.editor.findNodeByElem($(block)) : null;
              if (node) File.editor.store(node, true);
              else File.editor.store(cid, true);
            } catch (e) {
              try { File.editor.store(cid, true); } catch (e2) {}
            }
          }
          return true;
        }
      }
    }
    return false;
  }

  // 把块内目标图片的 alt 改为 altName。三策略逐级兜底，返回 "A"/"C"/"B"/null
  fixAlt(block, cid, base, altName) {
    const hit = this.findImgInBlock(block, base);
    if (!hit || !hit.span) return null;

    // 策略A：图片 span 内的 .md-content/.md-meta 源码文本（与原生 N 同构）
    const nodes = hit.span.querySelectorAll(".md-content, .md-meta");
    for (const content of nodes) {
      const text = content.textContent || "";
      if (!text || text.indexOf("![") < 0) continue;
      const re = /!\[([^\]]*)\]\(([^()]+)\)/g;
      let m;
      while ((m = re.exec(text))) {
        let dec = m[2];
        try { dec = decodeURIComponent(m[2]); } catch (e) {}
        if (dec.replace(/\\/g, "/").endsWith(base)) {
          const fixed = text.replace(m[0], () => `![${altName}](${dec})`);
          if (fixed !== text) {
            content.textContent = fixed;
            try { File.editor.undo.addSnap(cid, 2); } catch (e) {}
            // 原生 N 序列：textContent → store 写回模型 → brushNode 重渲染
            try {
              const node = (typeof $ !== "undefined")
                ? File.editor.findNodeByElem($(block)) : null;
              if (node) File.editor.store(node, true);
              else File.editor.store(cid, true);
            } catch (e) {
              try { File.editor.store(cid, true); } catch (e2) {}
            }
            File.editor.brush.brushNode(cid);
          }
          return "A";
        }
      }
    }

    // 策略C：直接改内部 Markdown 模型（nodeMap），不受 DOM 渲染态影响
    try {
      const node = File.editor.nodeMap && File.editor.nodeMap.allNodes
        ? File.editor.nodeMap.allNodes.get(cid) : null;
      if (node && typeof node.get === "function" && typeof node.set === "function") {
        const text = node.get("text") || "";
        this.debugLog("fixAlt: 模型文本=" + JSON.stringify(String(text).slice(0, 140)));
        const re = /!\[([^\]]*)\]\(([^()]+)\)/g;
        let m;
        while ((m = re.exec(text))) {
          let dec = m[2];
          try { dec = decodeURIComponent(m[2]); } catch (e) {}
          if (dec.replace(/\\/g, "/").endsWith(base)) {
            const fixed = text.replace(m[0], () => `![${altName}](${dec})`);
            if (fixed !== text) {
              try { File.editor.undo.addSnap(cid, 2); } catch (e) {}
              node.set("text", fixed);
              File.editor.brush.brushNode(cid);
            }
            return "C";
          }
        }
        this.debugLog("fixAlt: 模型文本未命中目标图");
      } else {
        this.debugLog("fixAlt: nodeMap 不可用");
      }
    } catch (e) {
      this.debugLog("fixAlt: 策略C异常 " + (e && e.message));
    }

    // 策略B：渲染态兜底——改 img 的 alt 属性后 store（序列化器从 img.alt 重建 ![alt](src)）
    try {
      if (hit.img.setAttribute) hit.img.setAttribute("alt", altName);
      try {
        const node = (typeof $ !== "undefined")
          ? File.editor.findNodeByElem($(block)) : null;
        if (node) File.editor.store(node, true);
        else File.editor.store(cid, true);
      } catch (e) {
        try { File.editor.store(cid, true); } catch (e2) {}
      }
      File.editor.brush.brushNode(cid);
      return "B";
    } catch (e) {
      this.debugLog("fixAlt: 策略B异常 " + (e && e.message));
      return null;
    }
  }

  // 返回 false 表示原生链路尚未完成（允许重试）
  postFixBlock(cid, newName, newAbs) {
    try {
      let block = null;
      try {
        const $b = File.editor.findElemById && File.editor.findElemById(cid);
        block = $b && ($b[0] || $b);
      } catch (e) {}
      if (!block || !block.querySelectorAll) {
        this.debugLog("postFix: block 未找到 cid=" + cid);
        return false;
      }

      const base = path.basename(newAbs).replace(/\\/g, "/");
      const altName = String(newName).replace(/\]/g, "");
      const hit = this.findImgInBlock(block, base);
      if (!hit) {
        let srcs = "";
        block.querySelectorAll("img").forEach((im) => {
          srcs += this.cleanSrc(im.getAttribute("src")) + " | ";
        });
        this.debugLog("postFix: 目标图未命中 base=" + base + " 实际src=" + srcs);
        return false; // 原生链路尚未完成，允许重试
      }

      // 诊断：渲染态结构
      this.debugLog("postFix: 命中 md-content=" + hit.span.querySelectorAll(".md-content").length
        + " md-meta=" + hit.span.querySelectorAll(".md-meta").length
        + " img.alt=" + (hit.img.getAttribute("alt") || ""));
      const how = this.fixAlt(block, cid, base, altName);
      this.debugLog("postFix: 策略=" + how + " alt=" + altName);
      if (how) this.log("已同步图片别名(" + how + "): " + altName);
      return true;
    } catch (e) {
      this.debugLog("postFix 异常: " + (e && e.message));
      return true;
    }
  }

  // 手动命令：把文档内所有图片链接里的 %XX 编码还原为可读中文（空格保留 %20）
  decodeAllLinks() {
    if (!this.mount) return;
    let count = 0;
    this.mount.querySelectorAll("img").forEach((img) => {
      const span = img.closest(".md-image") || img.parentElement;
      const block = span && span.closest("[cid]");
      const content = span && (span.querySelector(".md-content") || span.querySelector(".md-meta"));
      if (!block || !content) return;
      const text = content.textContent || "";
      if (!/%[0-9A-Fa-f]{2}/.test(text)) return;
      const fixed = text.replace(/(\]\()([^()]+)(\))/g, (mm, pre, target, post) => {
        let dec = target;
        try { dec = decodeURIComponent(target); } catch (e) {}
        return pre + dec.replace(/\\/g, "/") + post;
      });
      if (fixed === text) return;
      const cid = block.getAttribute("cid");
      content.textContent = fixed;
      try { File.editor.undo.addSnap(cid, 2); } catch (e) {}
      // 同 postFixBlock：必须 store 写回模型，否则重渲染回滚
      try {
        const node = (typeof $ !== "undefined")
          ? File.editor.findNodeByElem($(block)) : null;
        if (node) File.editor.store(node, true);
        else File.editor.store(cid, true);
      } catch (e) {
        try { File.editor.store(cid, true); } catch (e2) {}
      }
      File.editor.brush.brushNode(cid);
      count++;
    });
    this.log("已解码 " + count + " 个含编码的图片链接");
  }

  // 手动命令：把文档内所有图片的 alt（别名）同步为其文件名（不含扩展名）
  syncAllAlt() {
    if (!this.mount) return;
    let count = 0;
    this.mount.querySelectorAll("img").forEach((img) => {
      const span = img.closest(".md-image") || img.parentElement;
      const block = span && span.closest("[cid]");
      if (!block) return;
      const src = this.cleanSrc(img.getAttribute("src"));
      const base = src.replace(/\\/g, "/").split("/").pop();
      if (!base || /^(https?:|data:|blob:)/i.test(src)) return;
      const name = base.replace(/\.[^.]+$/, "").replace(/\]/g, "");
      if ((img.getAttribute("alt") || "") === name) return; // 已一致，跳过
      const cid = block.getAttribute("cid");
      const how = this.fixAlt(block, cid, base, name);
      if (how) count++;
    });
    this.log("已同步 " + count + " 个图片别名为文件名");
  }

  // ---- 命名引擎（对齐 Image Converter 语义）----
  buildName(ext, origBase) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const dateStr = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

    const map = {
      "{notename}": this.noteName(),
      "{notename_nospaces}": this.noteName().replace(/\s+/g, "_"),
      "{notefolder}": this.noteFolder(),
      "{parentfolder}": this.noteFolder(2),
      "{imagename}": origBase || "image",
      "{filetype}": ext,
      "{ext}": ext,
      "{date}": dateStr,
      "{time}": `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`,
      "{YYYY}": String(d.getFullYear()),
      "{MM}": p(d.getMonth() + 1),
      "{DD}": p(d.getDate()),
      "{HH}": p(d.getHours()),
      "{mm}": p(d.getMinutes()),
      "{ss}": p(d.getSeconds()),
      "{timestamp}": String(Math.floor(Date.now() / 1000)),
      "{weekday}": WEEKDAYS[d.getDay()],
      "{month}": MONTHS[d.getMonth()],
      "{today}": dateStr,
      "{YYYY-MM-DD}": dateStr,
      "{yesterday}": this.shiftDate(-1),
      "{tomorrow}": this.shiftDate(1),
    };

    let name = this.options().pattern;
    for (const [k, v] of Object.entries(map)) name = name.replaceAll(k, v);

    // {date:FORMAT} —— moment 风格（支持子集）
    name = name.replace(/\{date:([^}]+)\}/g, (_, fmt) => this.formatDate(d, fmt));

    // Windows 非法文件名净化：半角冒号转全角（贴合你的 Obsidian 预设写法），其余转下划线
    name = name.replace(/:/g, "：").replace(/[\\/*?"<>|]/g, "_").trim();
    return name;
  }

  formatDate(d, fmt) {
    const p = (n) => String(n).padStart(2, "0");
    return fmt
      .replace(/YYYY/g, String(d.getFullYear()))
      .replace(/YY/g, String(d.getFullYear()).slice(-2))
      .replace(/MMMM/g, MONTHS[d.getMonth()])
      .replace(/MMM/g, MONTHS[d.getMonth()].slice(0, 3))
      .replace(/dddd/g, WEEKDAYS[d.getDay()])
      .replace(/ddd/g, WEEKDAYS[d.getDay()].slice(0, 3))
      .replace(/MM/g, p(d.getMonth() + 1))
      .replace(/DD/g, p(d.getDate()))
      .replace(/HH/g, p(d.getHours()))
      .replace(/mm/g, p(d.getMinutes()))
      .replace(/ss/g, p(d.getSeconds()));
  }

  shiftDate(days) {
    const d = new Date(Date.now() + days * 86400000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // 冲突处理：increment → 名称-1、名称-2 ...（同 Image Converter handleNameConflicts）
  uniqueName(dir, base, ext) {
    const first = path.join(dir, `${base}.${ext}`);
    if (!fs.existsSync(first)) return first;
    if (this.options().conflictMode === "skip") return null;
    let i = 1;
    while (fs.existsSync(path.join(dir, `${base}-${i}.${ext}`))) i++;
    return path.join(dir, `${base}-${i}.${ext}`);
  }

  // 当前笔记完整路径：官方属性是 File.filePath（方法 getFilePath 不存在！）
  curFilePath() {
    try {
      if (typeof File === "undefined") return "";
      return (File.filePath || (File.bundle && File.bundle.filePath) || "");
    } catch (e) {
      return "";
    }
  }

  noteName() {
    try {
      const fp = this.curFilePath();
      const n = fp ? path.basename(fp).replace(/\.[^.]+$/, "") : "";
      return n.replace(/[\\/:*?"<>|]/g, "_") || "未命名";
    } catch (e) {
      return "未命名";
    }
  }

  noteFolder(level) {
    try {
      const fp = this.curFilePath();
      if (!fp) return "";
      const dir = path.dirname(fp);
      if (level === 2) return path.basename(path.dirname(dir)) || "";
      return path.basename(dir) || "";
    } catch (e) {
      return "";
    }
  }

  // ---- 路径工具 ----
  resolve(src) {
    src = src.replace(/^file:\/\//i, "").replace(/[#?].*$/, "");
    try {
      src = decodeURI(src);
    } catch (e) {}
    if (/^[a-zA-Z]:[\\/]/.test(src) || /^\//.test(src)) return src;
    let folder = "";
    try {
      folder = (typeof File !== "undefined" && typeof File.getMountFolder === "function")
        ? (File.getMountFolder() || "") : "";
    } catch (e) {}
    if (!folder) return null;
    return path.join(folder, src);
  }

  toRel(abs) {
    let folder = "";
    try {
      folder = (typeof File !== "undefined" && typeof File.getMountFolder === "function")
        ? (File.getMountFolder() || "") : "";
    } catch (e) {}
    if (!folder) return abs;
    let rel = path.relative(folder, abs).replace(/\\/g, "/");
    if (!/^(\.\.\/|\.\/)/.test(rel) && !/^[a-zA-Z]:/.test(rel) && rel[0] !== "/") {
      rel = "./" + rel;
    }
    return rel;
  }

  norm(p) {
    return (p || "").replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  }

  targetFolder() {
    try {
      const ie = File.editor && File.editor.imgEdit;
      if (ie && typeof ie.getTargetImageStorageFolder === "function") {
        return ie.getTargetImageStorageFolder() || null;
      }
    } catch (e) {}
    return null;
  }

  // ---- 手动命令 ----
  renameAll() {
    if (!this.mount) return;
    this.mount.querySelectorAll("img").forEach((img) => this.handle(img, true));
    this.log("已对文档内全部图片执行重命名");
  }

  renameSelected() {
    if (!this.mount) return;
    const sel = (window.getSelection && window.getSelection()) || null;
    let node = sel && sel.anchorNode;
    while (node && node !== this.mount) {
      if (node.nodeType === 1) {
        const img = node.tagName === "IMG" ? node : node.querySelector("img");
        if (img) {
          this.handle(img, true);
          return;
        }
      }
      node = node.parentNode;
    }
    this.log("未找到选中的图片");
  }
}

module.exports = ImageRenamePlugin;
module.exports.plugin = ImageRenamePlugin;
