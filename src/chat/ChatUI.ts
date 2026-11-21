import type { Store } from '../store';
import { SpeechInput, VOICE_STORE_KEY, DEFAULT_VOICE_SETTINGS, rankZhVoices, type VoiceSettings } from '../voice/TTS';
import { asset } from '../util/asset';

interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/** 轻量 Markdown 转义 + 行内格式化（不引入额外依赖） */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMessage(raw: string): string {
  const escaped = escapeHtml(raw);
  // 代码块
  let out = escaped.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
  });
  // 行内代码
  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // 加粗 / 斜体
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 链接
  out = out.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return out.replace(/\n/g, '<br>');
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export class ChatUI {
  private store: Store;
  private root: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private settingsPanel: HTMLElement;
  private keyInput: HTMLInputElement;
  private endpointInput: HTMLInputElement;
  private modelInput: HTMLInputElement;
  private avatarFile: HTMLInputElement;
  private userAvatar: string | null = null;
  private loading = false;
  private currentStreamEl: HTMLElement | null = null;
  private voiceBtn!: HTMLButtonElement;
  private micBtn!: HTMLButtonElement;
  private speechInput = new SpeechInput();
  private voiceSettings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };

  /** 她的聊天头像（对话气泡左侧那张脸） */
  private static readonly HER_AVATAR = asset('avatar/her.png');

  onSend: (text: string) => Promise<void> = async () => {};

  constructor(store: Store) {
    this.store = store;
    this.root = this.createDOM();
    this.messagesEl = this.root.querySelector('.messages')!;
    this.inputEl = this.root.querySelector('.input-area textarea')!;
    this.sendBtn = this.root.querySelector('.input-area .send-btn')!;
    this.settingsPanel = this.root.querySelector('.settings-overlay')!;
    this.keyInput = this.root.querySelector('.key-input') as HTMLInputElement;
    this.endpointInput = this.root.querySelector('.endpoint-input') as HTMLInputElement;
    this.modelInput = this.root.querySelector('.model-input') as HTMLInputElement;
    this.avatarFile = this.root.querySelector('.avatar-file') as HTMLInputElement;
    this.voiceBtn = this.root.querySelector('.voice-btn') as HTMLButtonElement;
    this.micBtn = this.root.querySelector('.mic-btn') as HTMLButtonElement;
    this.bindEvents();
  }

  private createDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'chat-container';
    el.innerHTML = `
      <div class="chat-header">
        <h2>💬 和 DeepSeek 娘聊天</h2>
        <div class="header-actions">
          <button type="button" class="icon-btn voice-btn" title="语音朗读开关">🔇</button>
          <button type="button" class="icon-btn mic-btn" title="语音输入">🎤</button>
          <button type="button" class="icon-btn settings-btn" title="API 设置">⚙️</button>
        </div>
      </div>
      <div class="messages" role="log" aria-live="polite"></div>
      <form class="input-area">
        <textarea placeholder="输入消息… (Enter 发送，Shift+Enter 换行)" rows="1"></textarea>
        <button type="submit" class="send-btn" disabled>➤</button>
      </form>
      <div class="settings-overlay" style="display:none">
        <div class="settings-panel">
          <h3>🔑 API 设置</h3>
          <p class="hint">Key 不一定要 DeepSeek 官方的。任何 <b>OpenAI 兼容</b>的接口都能用 —— 中转站、自建网关、别家兼容端点，填上「接口地址 + Key」就行。<br>什么都不填也能聊，只是回复靠内置台词。</p>
          <label class="field-label">API Key</label>
          <input type="password" class="key-input" placeholder="sk-xxxxxxxxxxxx" />
          <span class="key-status"></span>
          <label class="field-label">接口地址（可选，留空就用 DeepSeek 官方）</label>
          <input type="text" class="key-input endpoint-input" placeholder="https://api.deepseek.com/v1" />
          <label class="field-label">模型名（可选，留空就用 deepseek-chat）</label>
          <input type="text" class="key-input model-input" placeholder="deepseek-chat" />
          <label class="field-label">我的头像</label>
          <div class="avatar-setting">
            <div class="avatar-preview"><span>👤</span></div>
            <button type="button" class="secondary pick-avatar">选一张图</button>
            <button type="button" class="secondary clear-avatar">恢复默认</button>
            <input type="file" class="avatar-file" accept="image/*" style="display:none" />
          </div>
          <label class="field-label">语音</label>
          <div class="voice-setting">
            <label class="voice-row check"><input type="checkbox" class="voice-enabled" /> 收到回复后朗读</label>
            <label class="voice-row">音色 <select class="voice-select"></select></label>
            <label class="voice-row">语速 <input type="range" class="voice-rate" min="0.6" max="1.6" step="0.05" /><span class="voice-val voice-rate-val"></span></label>
            <label class="voice-row">音高 <input type="range" class="voice-pitch" min="0.6" max="1.8" step="0.05" /><span class="voice-val voice-pitch-val"></span></label>
            <label class="voice-row">音量 <input type="range" class="voice-volume" min="0" max="1" step="0.05" /><span class="voice-val voice-volume-val"></span></label>
            <p class="hint voice-hint">用系统自带的中文语音（Chrome / Edge 有）。列表里声音多的话挑一个顺耳的。</p>
          </div>
          <div class="settings-actions">
            <button type="button" class="secondary close-settings">取消</button>
            <button type="button" class="save-key">保存</button>
          </div>
        </div>
      </div>
    `;
    return el;
  }

  private bindEvents() {
    const form = this.root.querySelector('.input-area') as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });

    this.inputEl.addEventListener('input', () => {
      this.sendBtn.disabled = !this.inputEl.value.trim() || this.loading;
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });

    this.root.querySelector('.settings-btn')!.addEventListener('click', () => this.openSettings());
    this.root.querySelector('.close-settings')!.addEventListener('click', () => this.closeSettings());
    this.settingsPanel.addEventListener('click', (e) => {
      if (e.target === this.settingsPanel) this.closeSettings();
    });
    this.root.querySelector('.save-key')!.addEventListener('click', () => this.saveKey());
    this.keyInput.addEventListener('input', () => this.updateKeyStatus());
    this.root.querySelector('.pick-avatar')!.addEventListener('click', () => this.avatarFile.click());
    this.avatarFile.addEventListener('change', () => { void this.onAvatarPicked(); });
    this.root.querySelector('.clear-avatar')!.addEventListener('click', () => { void this.clearAvatar(); });
    this.voiceBtn.addEventListener('click', () => { void this.toggleVoice(); });
    this.micBtn.addEventListener('click', () => this.toggleMic());
  }

  private async submit() {
    const text = this.inputEl.value.trim();
    if (!text || this.loading) return;
    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';
    this.sendBtn.disabled = true;
    await this.onSend(text);
  }

  async openSettings() {
    const saved = (await this.store.get<string>('deepseek_key')) || '';
    this.keyInput.value = saved;
    this.endpointInput.value = (await this.store.get<string>('deepseek_endpoint')) || '';
    this.modelInput.value = (await this.store.get<string>('deepseek_model')) || '';
    this.userAvatar = (await this.store.get<string>('user_avatar')) || null;
    const savedVoice = await this.store.get<VoiceSettings>(VOICE_STORE_KEY);
    this.voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...(savedVoice || {}) };
    this.fillVoiceControls();
    this.renderAvatarPreview();
    this.updateKeyStatus();
    this.settingsPanel.style.display = 'flex';
    setTimeout(() => this.keyInput.focus(), 50);
  }

  /** ---- 语音 ---- */
  private async toggleVoice() {
    this.voiceSettings = { ...this.voiceSettings, enabled: !this.voiceSettings.enabled };
    await this.store.set(VOICE_STORE_KEY, this.voiceSettings);
    this.renderVoiceButton();
    this.emitVoiceSettings();
    this.addMessage('system', this.voiceSettings.enabled ? '语音朗读打开了，回复会念出来' : '语音朗读关掉了', false);
  }

  private renderVoiceButton() {
    this.voiceBtn.textContent = this.voiceSettings.enabled ? '🔊' : '🔇';
    this.voiceBtn.classList.toggle('on', this.voiceSettings.enabled);
    this.voiceBtn.title = this.voiceSettings.enabled ? '语音朗读：开' : '语音朗读：关';
  }

  private emitVoiceSettings() {
    window.dispatchEvent(new CustomEvent('voice-settings-change', { detail: { ...this.voiceSettings } }));
  }

  private toggleMic() {
    if (!this.speechInput.supported) {
      this.addMessage('system', '这个浏览器没有语音识别，Chrome 或 Edge 才有', false);
      return;
    }
    this.speechInput.start(
      (text) => {
        this.inputEl.value = text;
        this.inputEl.dispatchEvent(new Event('input'));
      },
      () => this.micBtn.classList.remove('on'),
    );
    this.micBtn.classList.toggle('on', this.speechInput.isListening);
  }

  /** 把已保存的语音设置写进面板控件 */
  private fillVoiceControls() {
    const q = (sel: string) => this.settingsPanel.querySelector(sel) as HTMLInputElement;
    q('.voice-enabled').checked = this.voiceSettings.enabled;
    q('.voice-rate').value = String(this.voiceSettings.rate);
    q('.voice-pitch').value = String(this.voiceSettings.pitch);
    q('.voice-volume').value = String(this.voiceSettings.volume);
    this.renderVoiceValues();
    this.fillVoiceOptions();
    if (!this.speechInput.supported) {
      const hint = this.settingsPanel.querySelector('.voice-hint');
      if (hint) hint.textContent += '（当前浏览器不支持语音识别，麦克风按钮用不了）';
    }
  }

  private renderVoiceValues() {
    const q = (sel: string) => this.settingsPanel.querySelector(sel) as HTMLElement;
    q('.voice-rate-val').textContent = this.voiceSettings.rate.toFixed(2) + '×';
    q('.voice-pitch-val').textContent = this.voiceSettings.pitch.toFixed(2);
    q('.voice-volume-val').textContent = Math.round(this.voiceSettings.volume * 100) + '%';
  }

  private fillVoiceOptions() {
    const sel = this.settingsPanel.querySelector('.voice-select') as HTMLSelectElement | null;
    if (!sel || !('speechSynthesis' in window)) return;
    const fill = () => {
      const ranked = rankZhVoices(window.speechSynthesis.getVoices());
      if (!ranked.length) return;
      const zh = ranked.filter((v) => v.lang.toLowerCase().startsWith('zh'));
      const list = zh.length ? zh : ranked;
      sel.innerHTML = list
        .map((v) => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`)
        .join('');
      if (this.voiceSettings.voiceURI) sel.value = this.voiceSettings.voiceURI;
      else if (list[0]) sel.value = list[0].voiceURI;
    };
    fill();
    window.speechSynthesis.onvoiceschanged = fill;
  }

  /** 面板里的语音控件 → 设置对象，并在保存时落盘 */
  private collectVoiceSettings(): VoiceSettings {
    const q = (sel: string) => this.settingsPanel.querySelector(sel) as HTMLInputElement;
    const sel = this.settingsPanel.querySelector('.voice-select') as HTMLSelectElement | null;
    return {
      enabled: q('.voice-enabled').checked,
      voiceURI: sel?.value || '',
      rate: Number(q('.voice-rate').value) || 1,
      pitch: Number(q('.voice-pitch').value) || 1,
      volume: Number(q('.voice-volume').value),
    };
  }

  private closeSettings() {
    this.settingsPanel.style.display = 'none';
  }

  private updateKeyStatus() {
    const status = this.settingsPanel.querySelector('.key-status')!;
    const v = this.keyInput.value.trim();
    if (!v) {
      status.textContent = '未设置 Key（现在用内置台词陪你）';
      status.className = 'key-status';
    } else if (v.startsWith('sk-')) {
      status.textContent = '✅ 看着像 DeepSeek 官方 Key';
      status.className = 'key-status valid';
    } else {
      status.textContent = '✅ 已填写（第三方 Key 记得把接口地址也填上）';
      status.className = 'key-status valid';
    }
  }

  private async saveKey() {
    const key = this.keyInput.value.trim();
    const endpoint = this.endpointInput.value.trim();
    const model = this.modelInput.value.trim();
    await this.store.set('deepseek_key', key);
    await this.store.set('deepseek_endpoint', endpoint);
    await this.store.set('deepseek_model', model);
    window.dispatchEvent(new CustomEvent('deepseek-key-change', { detail: key }));
    window.dispatchEvent(new CustomEvent('deepseek-endpoint-change', { detail: endpoint }));
    window.dispatchEvent(new CustomEvent('deepseek-model-change', { detail: model }));
    this.voiceSettings = this.collectVoiceSettings();
    await this.store.set(VOICE_STORE_KEY, this.voiceSettings);
    this.renderVoiceButton();
    this.emitVoiceSettings();
    this.closeSettings();
    this.addMessage('assistant', key ? '好耶，聪明模式开启啦～ ✨' : '好，那我用自带的小脑袋陪你聊～');
  }

  /** 气泡头像：她是那张脸，我是自己选的图，系统消息用灯泡 */
  private avatarHTML(role: ChatMsg['role']): string {
    if (role === 'user') {
      return this.userAvatar
        ? `<div class="avatar"><img class="avatar-img" src="${this.userAvatar}" alt="我"></div>`
        : `<div class="avatar">👤</div>`;
    }
    if (role === 'system') return `<div class="avatar">💡</div>`;
    return `<div class="avatar"><img class="avatar-img" src="${ChatUI.HER_AVATAR}" alt="DeepSeek 娘"></div>`;
  }

  private async loadVoiceState() {
    const saved = await this.store.get<VoiceSettings>(VOICE_STORE_KEY);
    this.voiceSettings = { ...DEFAULT_VOICE_SETTINGS, ...(saved || {}) };
    this.renderVoiceButton();
    this.emitVoiceSettings();
  }

  private async loadUserAvatar() {
    this.userAvatar = (await this.store.get<string>('user_avatar')) || null;
    this.renderAvatarPreview();
    this.refreshUserAvatars();
    // 历史消息是异步恢复的，晚一拍再刷一遍头像
    setTimeout(() => this.refreshUserAvatars(), 900);
  }

  private renderAvatarPreview() {
    const box = this.root.querySelector('.avatar-preview') as HTMLElement | null;
    if (!box) return;
    box.innerHTML = this.userAvatar ? `<img src="${this.userAvatar}" alt="我">` : '<span>👤</span>';
  }

  private refreshUserAvatars() {
    this.messagesEl.querySelectorAll('.message.user .avatar').forEach(a => {
      a.innerHTML = this.userAvatar ? `<img class="avatar-img" src="${this.userAvatar}" alt="我">` : '👤';
    });
  }

  private async onAvatarPicked() {
    const file = this.avatarFile.files?.[0];
    if (!file) return;
    const dataUrl = await this.toSquareDataUrl(file, 192);
    if (!dataUrl) return;
    this.userAvatar = dataUrl;
    await this.store.set('user_avatar', dataUrl);
    this.renderAvatarPreview();
    this.refreshUserAvatars();
    this.avatarFile.value = '';
  }

  private async clearAvatar() {
    this.userAvatar = null;
    await this.store.set('user_avatar', '');
    this.renderAvatarPreview();
    this.refreshUserAvatars();
  }

  /** 把选中的图片中心裁成正方形并缩放，免得撑爆消息列表 */
  private toSquareDataUrl(file: File, size: number): Promise<string | null> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(img.width, img.height) || 1;
        const cv = document.createElement('canvas');
        cv.width = size;
        cv.height = size;
        const ctx = cv.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); resolve(null); return; }
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  mount(parent: HTMLElement) {
    parent.appendChild(this.root);
    this.loadSavedKey();
    void this.loadVoiceState();
    void this.loadUserAvatar();
    this.bindGlobalEvents();
  }

  private async loadSavedKey() {
    const saved = (await this.store.get<string>('deepseek_key')) || '';
    window.dispatchEvent(new CustomEvent('deepseek-key-change', { detail: saved }));
  }

  private bindGlobalEvents() {
    window.addEventListener('chat-add-message', ((e: any) => {
      this.addMessage(e.detail.role, e.detail.content);
    }) as EventListener);
    window.addEventListener('chat-stream-start', (() => this.streamStart()) as EventListener);
    window.addEventListener('chat-stream-append', ((e: any) => this.streamAppend(e.detail)) as EventListener);
    window.addEventListener('chat-stream-end', (() => this.streamEnd()) as EventListener);
    window.addEventListener('chat-set-loading', ((e: any) => this.setLoading(e.detail)) as EventListener);
  }

  addMessage(role: ChatMsg['role'], content: string, save = true) {
    this.currentStreamEl = null;
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.innerHTML = `
      ${this.avatarHTML(role)}
      <div class="bubble">
        <div class="content">${formatMessage(content)}</div>
        <span class="time">${formatTime(Date.now())}</span>
      </div>
    `;
    this.messagesEl.appendChild(div);
    this.scrollToBottom();
    if (save && role !== 'system') this.store.addChatMessage(role, content);
    if (save && role === 'assistant' && content.trim()) {
      window.dispatchEvent(new CustomEvent('chat-reply-done', { detail: content }));
    }
  }

  streamStart() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
      ${this.avatarHTML('assistant')}
      <div class="bubble"><div class="content"></div><span class="time">${formatTime(Date.now())}</span></div>
    `;
    this.messagesEl.appendChild(div);
    this.currentStreamEl = div.querySelector('.content');
    this.scrollToBottom();
  }

  streamAppend(chunk: string) {
    if (!this.currentStreamEl) this.streamStart();
    this.currentStreamEl!.innerHTML = formatMessage(this.currentStreamEl!.textContent! + chunk);
    this.scrollToBottom();
  }

  streamEnd() {
    if (this.currentStreamEl) {
      const full = this.currentStreamEl.textContent || '';
      this.store.addChatMessage('assistant', full);
      this.currentStreamEl = null;
      if (full.trim()) window.dispatchEvent(new CustomEvent('chat-reply-done', { detail: full }));
    }
  }

  setLoading(v: boolean) {
    this.loading = v;
    this.sendBtn.disabled = v || !this.inputEl.value.trim();
    let indicator = this.messagesEl.querySelector('.typing') as HTMLElement | null;
    if (v && !indicator) {
      indicator = document.createElement('div');
      indicator.className = 'message assistant typing';
      indicator.innerHTML = `${this.avatarHTML('assistant')}<div class="bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
      this.messagesEl.appendChild(indicator);
      this.scrollToBottom();
    } else if (!v && indicator) {
      indicator.remove();
    }
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  onResize() {}

  getElement() { return this.root; }
}
