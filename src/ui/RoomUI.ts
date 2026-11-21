import type { Store } from '../store';
import type { PluginManager, ToolButton, RoomAction } from '../plugins/PluginManager';
import type { ChatUI } from '../chat/ChatUI';
import { asset } from '../util/asset';

interface Choice { id: string; name: string; color?: string; gradient?: string; light?: string; desc: string; need?: number; }

const SKINS: Choice[] = [
  { id: 'default', name: '原版', color: '#7ec8e3', desc: '初始配色' },
  { id: 'sakura', name: '樱花', color: '#ffb7c5', desc: '淡粉樱花调' },
  { id: 'night', name: '夜色', color: '#8b7ec8', desc: '深紫夜色调' },
  { id: 'gold', name: '鎏金', color: '#ffd700', desc: '暖金贵族调' },
];

const MOODS: Choice[] = [
  // 每个时段一张独立背景图，光线差异画在图片里；gradient 只用于选项色块展示
  {
    id: 'morning', name: '早晨',
    gradient: 'linear-gradient(135deg, #ffd9a0, #ffb8a0 50%, #a8d8ff)',
    desc: '晨光微熹，暖意渐起',
  },
  {
    id: 'noon', name: '中午',
    gradient: 'linear-gradient(135deg, #fff8e0, #bfe6ff 50%, #8fc8ff)',
    desc: '日光明媚，通透明亮',
  },
  {
    id: 'dusk', name: '黄昏',
    gradient: 'linear-gradient(135deg, #ff9a5c, #d45c6b 50%, #6a3a7a)',
    desc: '夕阳西下，丁达尔光束',
  },
  {
    id: 'night', name: '夜晚',
    gradient: 'linear-gradient(135deg, #1a2a5e, #0d1b3e 50%, #050b1f)',
    desc: '月色清冷，静谧深蓝',
  },
];

export class RoomUI {
  private store: Store;
  private plugins: PluginManager;
  private chatUI: ChatUI;
  private root: HTMLElement;
  private toolbar: HTMLElement;
  private bubble: HTMLElement;
  private toastContainer: HTMLElement;
  private modalHost: HTMLElement;
  private stageEl!: HTMLElement;
  private speechTimer: number | null = null;
  private bgIndex = 0;

  constructor(store: Store, plugins: PluginManager, chatUI: ChatUI) {
    this.store = store;
    this.plugins = plugins;
    this.chatUI = chatUI;

    this.root = document.createElement('div');
    this.root.className = 'room';
    this.root.innerHTML = `
      <div class="stage-area">
        <div class="bg-layer bg-a show"></div>
        <div class="bg-layer bg-b"></div>
        <div class="character-tag">
          <h1>🐋 DeepSeek 娘</h1>
          <div class="status"><span class="status-dot"></span><span>在线 · 陪你待着</span></div>
        </div>
        <div class="speech-bubble"></div>
        <div class="floaters"></div>
        <button class="tools-fab" title="打开工具箱">☰</button>
      </div>
      <div class="side-panel">
        <div class="toolbar"></div>
      </div>
    `;
    this.toolbar = this.root.querySelector('.toolbar')!;
    this.stageEl = this.root.querySelector('.stage-area')!;
    this.bubble = this.root.querySelector('.speech-bubble')!;
    this.createFloaters();

    this.toastContainer = document.createElement('div');
    this.toastContainer.className = 'toast-container';
    this.modalHost = document.createElement('div');
  }

  /** 舞台容器（PIXI canvas 要挂进这里，尺寸跟它走） */
  getStageEl(): HTMLElement {
    return this.stageEl;
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.root);
    document.body.appendChild(this.toastContainer);
    document.body.appendChild(this.modalHost);

    // 聊天区挂载到侧栏
    this.chatUI.mount(this.root.querySelector('.side-panel')!);

    this.renderToolbar();
    this.bindEvents();
    // 恢复已保存的时段背景（首次直接切换，不做淡入）
    this.store.get<string>('mood').then(id => this.applyMood(id || 'morning', true));
  }

  private createFloaters() {
    const host = this.root.querySelector('.floaters')!;
    const emojis = ['🐋', '💧', '✨', '🫧', '⭐', '💙'];
    for (let i = 0; i < 12; i++) {
      const f = document.createElement('div');
      f.className = 'floater';
      f.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      f.style.left = Math.random() * 100 + '%';
      f.style.fontSize = (12 + Math.random() * 16) + 'px';
      f.style.animationDuration = (12 + Math.random() * 14) + 's';
      f.style.animationDelay = (-Math.random() * 20) + 's';
      host.appendChild(f);
    }
  }

  /** 收集全部工具项（工具栏和手机端抽屉共用同一份清单） */
  private collectTools(): Array<{ key: string; icon: string; label: string; title: string; run: () => void }> {
    const items: Array<{ key: string; icon: string; label: string; title: string; run: () => void }> = [];

    for (const btn of this.plugins.getToolButtons()) {
      items.push({
        key: `tool:${btn.id}`,
        icon: btn.icon,
        label: btn.label.replace(btn.icon, '').trim(),
        title: btn.title || btn.label,
        run: () => this.plugins.invokeTool(btn.id),
      });
    }

    // 房间动作按钮（摸头/碰尾巴改为直接点角色触发，不在工具栏显示）
    const hiddenActions = new Set(['pat-head', 'touch-tail']);
    for (const action of this.plugins.getRoomActions()) {
      if (hiddenActions.has(action.id)) continue;
      items.push({
        key: `action:${action.id}`,
        icon: action.icon,
        label: action.label,
        title: action.label,
        run: () => this.plugins.invokeRoomAction(action.id),
      });
    }

    // 固定功能按钮
    const extras: Array<[string, string, () => void]> = [
      ['🎛️', '调整角色', () => this.openLayoutPanel()],
      ['🧩', '插件', () => this.openPluginPanel()],
      ['📝', '清空聊天', () => this.clearChat()],
      ['ℹ️', '关于', () => this.showAbout()],
    ];
    for (const [icon, label, fn] of extras) {
      items.push({ key: `extra:${label}`, icon, label, title: label, run: fn });
    }

    return items;
  }

  private renderToolbar() {
    this.toolbar.innerHTML = '';
    for (const item of this.collectTools()) {
      const el = document.createElement('button');
      el.className = 'tool-btn';
      el.title = item.title;
      el.dataset.toolKey = item.key;
      el.innerHTML = `${item.icon} ${item.label}`;
      el.addEventListener('click', item.run);
      this.toolbar.appendChild(el);
    }
  }

  /** 手机端：舞台右上角按钮打开的抽屉，把所有工具收进一层 */
  private openToolsDrawer() {
    const overlay = this.modal('🧰 工具箱', '<div class="tools-drawer"></div>');
    const host = overlay.querySelector('.tools-drawer') as HTMLElement;
    for (const item of this.collectTools()) {
      const el = document.createElement('button');
      el.className = 'tool-btn';
      el.title = item.title;
      el.dataset.toolKey = item.key;
      el.innerHTML = `${item.icon} ${item.label}`;
      el.addEventListener('click', () => {
        overlay.remove();
        item.run();
      });
      host.appendChild(el);
    }
  }

  private bindEvents() {
    this.root.querySelector('.tools-fab')!.addEventListener('click', () => this.openToolsDrawer());

    window.addEventListener('tools-changed', () => this.renderToolbar());
    window.addEventListener('room-actions-changed', () => this.renderToolbar());

    window.addEventListener('affection-changed', ((e: any) => {
      const v = e.detail;
      // 更新好感度按钮文字
      const btn = [...this.toolbar.querySelectorAll('.tool-btn')].find(b => (b as HTMLElement).title === '当前好感度');
      if (btn) btn.innerHTML = `❤️ ${v}`;
    }) as EventListener);

    window.addEventListener('open-skin-panel', () => this.openSkinPanel());
    window.addEventListener('open-mood-panel', () => this.openMoodPanel());

    // 角色说话气泡（由 setSpeech 调用）
    window.addEventListener('show-speech', ((e: any) => this.showSpeech(e.detail.text)) as EventListener);
  }

  showSpeech(text: string) {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    if (this.speechTimer) clearTimeout(this.speechTimer);
    this.speechTimer = window.setTimeout(() => this.bubble.classList.remove('show'), 3500);
  }

  toast(text: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toastContainer.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity 0.3s';
      setTimeout(() => t.remove(), 300);
    }, 2500);
  }

  private modal(title: string, bodyHtml: string): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-panel">
        <h3>${title}</h3>
        ${bodyHtml}
        <div class="modal-actions">
          <button class="secondary close-modal">关闭</button>
        </div>
      </div>
    `;
    this.modalHost.appendChild(overlay);
    overlay.querySelector('.close-modal')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    return overlay;
  }

  private openLayoutPanel() {
    const cur = (window as any).__APP__.getLive2D().getUserLayout() as { scaleMul: number; offsetX: number; offsetY: number };
    const row = (id: string, label: string, min: number, max: number, step: number, val: number, fmt: (v: number) => string) => `
      <div class="layout-row">
        <div class="layout-row-head"><span>${label}</span><span class="layout-val" id="lv-${id}">${fmt(val)}</span></div>
        <input type="range" class="layout-slider" id="ls-${id}" min="${min}" max="${max}" step="${step}" value="${val}">
      </div>`;
    const pct = (v: number) => Math.round(v * 100) + '%';
    const overlay = this.modal('🎛️ 调整角色', `
      <p class="hint">拖滑块实时预览，满意了点「保存」，刷新后依然生效。改大小会自动把脚底补回地板，不会飘起来。</p>
      <div class="layout-panel">
        ${row('scaleMul', '人物大小', 0.4, 2.2, 0.02, cur.scaleMul, v => Math.round(v * 100) + '%')}
        ${row('offsetX', '左右位置', 0.1, 0.9, 0.01, cur.offsetX, pct)}
        ${row('offsetY', '上下位置', 0.5, 1.0, 0.01, cur.offsetY, pct)}
      </div>
      <div class="modal-actions" style="margin-top:18px">
        <button class="secondary layout-reset">恢复默认</button>
        <button class="layout-save">保存</button>
      </div>
    `);
    const read = () => ({
      scaleMul: +(overlay.querySelector('#ls-scaleMul') as HTMLInputElement).value,
      offsetX: +(overlay.querySelector('#ls-offsetX') as HTMLInputElement).value,
      offsetY: +(overlay.querySelector('#ls-offsetY') as HTMLInputElement).value,
    });
    const syncLabels = () => {
      const v = read();
      (overlay.querySelector('#lv-scaleMul') as HTMLElement).textContent = Math.round(v.scaleMul * 100) + '%';
      (overlay.querySelector('#lv-offsetX') as HTMLElement).textContent = pct(v.offsetX);
      (overlay.querySelector('#lv-offsetY') as HTMLElement).textContent = pct(v.offsetY);
    };
    overlay.querySelectorAll('.layout-slider').forEach(s => {
      s.addEventListener('input', () => {
        syncLabels();
        window.dispatchEvent(new CustomEvent('layout-preview', { detail: read() }));
      });
    });
    overlay.querySelector('.layout-save')!.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('layout-save', { detail: read() }));
      overlay.remove();
    });
    overlay.querySelector('.layout-reset')!.addEventListener('click', () => {
      window.dispatchEvent(new Event('layout-reset'));
      (overlay.querySelector('#ls-scaleMul') as HTMLInputElement).value = '1';
      (overlay.querySelector('#ls-offsetX') as HTMLInputElement).value = '0.5';
      (overlay.querySelector('#ls-offsetY') as HTMLInputElement).value = '0.95';
      syncLabels();
      this.toast('已恢复默认位置');
    });
  }

  private async openSkinPanel() {
    const current = await this.store.getCurrentSkin();
    const cards = SKINS.map(s => {
      return `<div class="choice-card ${s.id === current ? 'active' : ''}" data-skin="${s.id}">
        <div class="choice-swatch" style="background:linear-gradient(135deg, ${s.color}, ${s.color}88)"></div>
        <div class="choice-name">${s.name}</div>
        <div class="choice-desc">${s.desc}</div>
      </div>`;
    }).join('');
    const overlay = this.modal('🎨 主题配色', `<p class="hint">四套配色随便换，不锁好感度～</p><div class="choice-grid">${cards}</div>`);
    overlay.querySelectorAll('.choice-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = (card as HTMLElement).dataset.skin!;
        window.dispatchEvent(new CustomEvent('skin-selected', { detail: id }));
        overlay.remove();
        this.toast('已切换配色～');
      });
    });
  }

  private async openMoodPanel() {
    const current = (await this.store.get<string>('mood')) || 'morning';
    const cards = MOODS.map(m => `
      <div class="choice-card ${m.id === current ? 'active' : ''}" data-mood="${m.id}">
        <div class="choice-swatch" style="background:${m.gradient}"></div>
        <div class="choice-name">${m.name}</div>
        <div class="choice-desc">${m.desc}</div>
      </div>`).join('');
    const overlay = this.modal('🌙 房间氛围 · 时段光线', `<div class="choice-grid">${cards}</div>`);
    overlay.querySelectorAll('.choice-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = (card as HTMLElement).dataset.mood!;
        this.applyMood(id);
        overlay.querySelectorAll('.choice-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        overlay.remove();
        this.toast('房间光线已切换～');
      });
    });
  }

  private applyMood(id: string, instant = false) {
    const m = MOODS.find(x => x.id === id) || MOODS[0];
    const url = asset(`bg/room-${m.id}.jpg`);
    const layers = this.root.querySelectorAll('.bg-layer') as NodeListOf<HTMLElement>;
    const current = layers[this.bgIndex];
    const next = layers[1 - this.bgIndex];

    const swap = () => {
      if (instant) next.style.transition = 'none';
      next.style.backgroundImage = `url('${url}')`;
      void next.offsetWidth; // 强制回流，保证过渡生效
      next.classList.add('show');
      current.classList.remove('show');
      if (instant) {
        void next.offsetWidth;
        next.style.transition = '';
      }
      this.bgIndex = 1 - this.bgIndex;
    };

    if (instant) {
      swap();
    } else {
      const img = new Image();
      img.onload = swap;
      img.onerror = swap;
      img.src = url;
    }

    this.store.set('mood', m.id);
    // 首次恢复不播报，免得每次打开都多一条系统消息
    if (!instant) window.dispatchEvent(new CustomEvent('mood-selected', { detail: m.id }));
  }

  private openPluginPanel() {
    const plugins = this.plugins.getPlugins();
    const rows = plugins.map(p => `
      <div class="plugin-row">
        <div class="plugin-info">
          <div class="plugin-name">${p.name} <span style="opacity:.5;font-size:.7rem">v${p.version}</span></div>
          <div class="plugin-desc">${p.description || ''}</div>
        </div>
        <div class="toggle on" data-plugin="${p.id}"></div>
      </div>`).join('');
    const overlay = this.modal('🧩 插件管理', `
      <p class="hint">内置插件已启用。开发者可在下方加载自定义 JS 插件。</p>
      <div class="plugin-list">${rows}</div>
      <div style="margin-top:16px">
        <button class="tool-btn load-plugin-btn" style="width:100%">➕ 加载自定义 JS 插件</button>
      </div>
    `);
    overlay.querySelector('.load-plugin-btn')!.addEventListener('click', () => {
      overlay.remove();
      this.openPluginEditor();
    });
  }

  private openPluginEditor() {
    const overlay = this.modal('➕ 自定义插件', `
      <p class="hint">写一个返回 plugin 对象的 JS 片段。示例已填好，直接点「加载」试试。</p>
      <textarea class="plugin-code" style="width:100%;height:220px;background:#0c0c18;color:#e8e6f5;border:1px solid var(--border);border-radius:10px;padding:12px;font-family:'JetBrains Mono',monospace;font-size:.78rem;box-sizing:border-box">${EXAMPLE_PLUGIN}</textarea>
      <div class="modal-actions" style="margin-top:12px">
        <button class="secondary close-modal2">取消</button>
        <button class="load-plugin-confirm">加载</button>
      </div>
    `);
    overlay.querySelector('.close-modal2')!.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.load-plugin-confirm')!.addEventListener('click', async () => {
      const code = (overlay.querySelector('.plugin-code') as HTMLTextAreaElement).value;
      const result = await (window as any).__APP__.getPlugins().loadFromSource(code);
      if (result.ok) {
        this.toast('插件加载成功！');
        overlay.remove();
      } else {
        alert('插件加载失败：' + result.error);
      }
    });
  }

  private clearChat() {
    if (!confirm('清空所有聊天记录？')) return;
    this.chatUI.getElement().querySelector('.messages')!.innerHTML = '';
    this.store.clearChatHistory();
    this.toast('聊天记录已清空');
  }

  private showAbout() {
    this.modal('ℹ️ 关于', `
      <p class="hint" style="line-height:1.8">
        <b>DeepSeek 娘 · 互动小屋</b><br>
        一个基于 Live2D 的互动聊天网页。<br><br>
        🐋 模型：鲸鱼娘（作者授权）<br>
        🤖 智能：DeepSeek API（可选，填自己的 Key）<br>
        💾 数据：全部保存在你本地浏览器<br>
        🧩 支持好感度、换装、插件扩展<br><br>
        在设置 ⚙️ 里填 Key 获得智能对话；不填也能用内置回复互动～<br><br>
        <span style="font-size:0.82em;opacity:0.7">
        🖼️ 背景：温馨日系小屋四时段（早/中/晚/夜），四宫格原图拆分使用
        </span>
      </p>
    `);
  }

  onResize() {}
}

const EXAMPLE_PLUGIN = `// 一个最简单的自定义插件
const plugin = {
  id: 'my-first-plugin',
  name: '我的插件',
  version: '1.0.0',
  onLoad(ctx) {
    ctx.addToolButton({
      id: 'hello-btn',
      label: '打招呼',
      icon: '👋',
      onClick: () => {
        ctx.systemMessage('这是你的自定义插件在说话！');
        ctx.emotion('happy');
      }
    });
  },
  onEvent(event, payload) {
    if (event === 'user-message' && payload.text.includes('插件')) {
      return { handled: false };
    }
    return null;
  }
};
plugin;`;
