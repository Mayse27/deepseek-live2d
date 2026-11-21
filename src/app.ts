import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';
import { Live2DManager } from './live2d/model';
import { pickZoneLine, normalizeZone } from './live2d/zoneLines';
import { ChatUI } from './chat/ChatUI';
import { DeepSeekAPI } from './chat/DeepSeekAPI';
import { PluginManager } from './plugins/PluginManager';
import { Store, DEFAULT_LAYOUT } from './store';
import { BuiltinPlugins } from './plugins/builtins';
import { RoomUI } from './ui/RoomUI';
import { asset } from './util/asset';
import { VoicePlayer } from './voice/TTS';

let app: PIXI.Application;
let live2d: Live2DManager;
let chatUI: ChatUI;
let api: DeepSeekAPI;
let pluginManager: PluginManager;
let store: Store;
let roomUI: RoomUI;
let voice: VoicePlayer;
let currentAffection = 0;

function showLoading(show: boolean, text?: string) {
  let overlay = document.querySelector('.loading-overlay') as HTMLElement | null;
  if (show && !overlay) {
    overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = `
      <img class="logo-img" src="${asset('icon/loading.png')}" alt="Loading">
      <h1>DeepSeek 娘 · 互动小屋</h1>
      <p class="loading-text">正在准备房间…</p>
      <div class="spinner"></div>
    `;
    document.body.appendChild(overlay);
  }
  if (!show && overlay) {
    overlay.classList.add('hidden');
    setTimeout(() => overlay?.remove(), 600);
  }
  if (text && overlay) {
    const t = overlay.querySelector('.loading-text');
    if (t) t.textContent = text;
  }
}

/** 让 canvas 的实际尺寸跟随舞台区（桌面是左半屏，手机是上半屏） */
function fitStage() {
  const el = roomUI?.getStageEl?.();
  const w = Math.max(1, Math.round(el ? el.clientWidth : window.innerWidth));
  const h = Math.max(1, Math.round(el ? el.clientHeight : window.innerHeight));
  if (!app) return;
  app.renderer.resize(w, h);
  live2d?.onResize();
}

export async function createApp() {
  const root = document.getElementById('app')!;
  showLoading(true, '正在准备房间…');

  // 1. PIXI Application（v7 同步构造）
  app = new PIXI.Application({
    width: 800,
    height: 600,
    backgroundAlpha: 0,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: true,
  });

  // 2. 注册 Live2D Ticker
  Live2DModel.registerTicker(PIXI.Ticker);

  // 3. 存储
  store = new Store();
  await store.init();

  // 4. 加载 Live2D 模型
  showLoading(true, '鲸鱼娘正在游过来…');
  live2d = new Live2DManager(app);
  try {
    await live2d.loadModel(asset('model/newfish.model3.json'), asset('model/character.json'));
    // 恢复用户保存的角色布局（大小/左右/上下）；手动保存过就锁住，不让自动比例覆盖
    const savedLayout = await store.getLayout();
    live2d.setUserLayout(savedLayout);
    if (savedLayout.locked && savedLayout.lockRefH && savedLayout.lockBase) {
      live2d.restoreLock(savedLayout.lockRefH, savedLayout.lockBase);
    }
    live2d.startIdleMotion();
  } catch (e) {
    console.error('[Live2D] 模型加载失败', e);
    showLoading(true, '模型加载失败，将使用简化模式…');
    await new Promise(r => setTimeout(r, 1500));
  }

  // 5. 聊天 UI
  chatUI = new ChatUI(store);

  // 6. API
  const savedKey = (await store.get<string>('deepseek_key')) || '';
  const savedEndpoint = (await store.get<string>('deepseek_endpoint')) || '';
  const savedModel = (await store.get<string>('deepseek_model')) || '';
  api = new DeepSeekAPI(savedKey);
  api.setEndpoint(savedEndpoint);
  api.setModel(savedModel);

  // 7. 插件系统
  pluginManager = new PluginManager(live2d, chatUI, store, api);
  await pluginManager.init();
  await pluginManager.loadBuiltins(BuiltinPlugins);

  // 8. 房间 UI（会挂载聊天区）
  roomUI = new RoomUI(store, pluginManager, chatUI);
  roomUI.mount(root);
  // canvas 挂进舞台区，尺寸跟舞台走（手机上舞台只占半屏，不能再按窗口算）
  const stageMount = document.createElement('div');
  stageMount.className = 'stage-canvas';
  stageMount.appendChild(app.view as HTMLCanvasElement);
  roomUI.getStageEl().appendChild(stageMount);

  // 9. 事件绑定
  chatUI.onSend = async (text: string) => pluginReply(text);
  bindGlobalEvents();

  // 10. 恢复聊天记录
  const history = await store.getChatHistory();
  // 只恢复最近 30 条，且不重复保存
  history.slice(-30).forEach(msg => {
    if (msg.role !== 'system') chatUI.addMessage(msg.role, msg.content, false);
  });

  // 11. resize：始终按舞台区的真实尺寸重算（手机断点、地址栏收放都会变）
  fitStage();
  window.addEventListener('resize', () => fitStage());
  window.addEventListener('orientationchange', () => setTimeout(() => fitStage(), 250));
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => fitStage());
    ro.observe(roomUI.getStageEl());
  }

  // 12. Key 变更
  window.addEventListener('deepseek-key-change', ((e: any) => {
    api.setKey(e.detail || '');
  }) as EventListener);

  window.addEventListener('deepseek-endpoint-change', ((e: any) => {
    api.setEndpoint(e.detail || '');
  }) as EventListener);

  window.addEventListener('deepseek-model-change', ((e: any) => {
    api.setModel(e.detail || '');
  }) as EventListener);

  // 12a. 好感度 → 影响她的语气（有 key 时写进 systemPrompt，没 key 时换兜底台词池）
  currentAffection = await store.getAffection();
  api.setAffection(currentAffection);
  window.addEventListener('affection-changed', ((e: any) => {
    currentAffection = Number(e.detail) || 0;
    api.setAffection(currentAffection);
  }) as EventListener);

  // 12b. 角色布局实时调整（滑块拖动时应用，点保存才写库）
  window.addEventListener('layout-preview', ((e: any) => {
    live2d.setUserLayout(e.detail || {});
  }) as EventListener);
  window.addEventListener('layout-save', (async (e: any) => {
    live2d.setUserLayout(e.detail || {});
    // 点保存即锁定：此后窗口怎么变，都只按舞台高度等比跟随，不会被自动比例打回默认
    live2d.lockLayout();
    const lock = live2d.getLockState();
    await store.setLayout({ ...live2d.getUserLayout(), locked: true, lockRefH: lock.lockRefH, lockBase: lock.lockBase });
    roomUI.toast('角色位置已保存～以后换窗口也保持这个大小');
  }) as EventListener);
  window.addEventListener('layout-reset', (async () => {
    live2d.unlockLayout();
    live2d.setUserLayout(DEFAULT_LAYOUT);
    await store.setLayout({ ...DEFAULT_LAYOUT });
    roomUI.toast('已恢复默认，跟着窗口自动调整');
  }) as EventListener);

  // 12c. 语音：她说话时驱动嘴型，收到回复后朗读
  voice = new VoicePlayer();
  voice.onStateChange = (speaking: boolean) => live2d.setTalking(speaking);
  voice.applySettings((await store.get<any>('voice_settings')) || {});
  window.addEventListener('voice-settings-change', ((e: any) => {
    voice.applySettings(e.detail || {});
  }) as EventListener);
  window.addEventListener('chat-reply-done', ((e: any) => {
    const text = String(e.detail || '');
    if (text) voice.speak(text);
  }) as EventListener);

  // 13. 点击模型
  app.stage.eventMode = 'static';
  app.stage.hitArea = new PIXI.Rectangle(0, 0, app.screen.width, app.screen.height);

  app.stage.on('pointertap', (e: PIXI.FederatedPointerEvent) => {
    const zone = live2d.hitTest(e.global.x, e.global.y);
    if (zone) {
      pluginManager.trigger('zone-click', { zone });
      // head/tail 走房间动作（加好感度 + 系统消息）
      const action = pluginManager.getRoomActions().find(a => a.zone === zone);
      if (action) pluginManager.invokeRoomAction(action.id);
      // 每个区域都有可见反馈：表情 + 动作 + 头顶气泡（台词随机且不连着重复）
      const line = pickZoneLine(zone, currentAffection);
      live2d.playEmotion(line.emotion);
      live2d.playReaction(normalizeZone(zone));
      roomUI.showSpeech(line.text);
    } else {
      // 点在空白处：轻点头，偶尔搭一句
      const line = pickZoneLine('blank', currentAffection);
      live2d.playEmotion(line.emotion);
      live2d.playReaction('body');
      if (Math.random() < 0.6) roomUI.showSpeech(line.text);
    }
  });

  showLoading(false);
  // 仅在没有任何历史时显示欢迎语，且不入库（避免刷新后反复累积）
  if (history.length === 0) {
    setTimeout(() => {
      chatUI.addMessage('assistant', '嗨呀～我是 DeepSeek 娘！点我、摸摸头，或者跟我聊聊天吧 🐋', false);
      roomUI.showSpeech('你好呀！今天想聊些什么呢？✨');
    }, 700);
  }

  console.log('[DeepSeek娘] 启动完成 ✨');
}

async function pluginReply(text: string) {
  window.dispatchEvent(new Event('chat-sent'));
  chatUI.addMessage('user', text);
  chatUI.setLoading(true);

  try {
    // 插件拦截
    const r = await pluginManager.trigger('user-message', {
      text, api, live2d, chatUI,
    });
    if (r?.handled) {
      chatUI.setLoading(false);
      return;
    }

    if (api.hasKey()) {
      window.dispatchEvent(new Event('chat-stream-start'));
      let full = '';
      const reply = await api.chat(text, (chunk) => {
        full += chunk;
        window.dispatchEvent(new CustomEvent('chat-stream-append', { detail: chunk }));
      });
      window.dispatchEvent(new Event('chat-stream-end'));
      // 若流式已有内容，避免重复；否则补一条
      if (!full && reply) chatUI.addMessage('assistant', reply);
      window.dispatchEvent(new CustomEvent('show-speech', { detail: { text: reply.slice(0, 40) } }));
      live2d.playEmotion(analyzeEmotion(reply));
      pluginManager.trigger('chat-reply', { text: reply });
    } else {
      // 兜底回复：短延迟模拟思考
      await new Promise(r => setTimeout(r, 400 + Math.random() * 500));
      const reply = await api.chat(text); // 无 key 时走内置兜底回复
      chatUI.addMessage('assistant', reply);
      window.dispatchEvent(new CustomEvent('show-speech', { detail: { text: reply } }));
      live2d.playEmotion(analyzeEmotion(reply));
    }
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : String(err);
    chatUI.addMessage('assistant', `呜… 请求没成功：${msg}\n\n顺手查这几样：① Key 有没有粘错；② 接口地址要带 /v1（比如 https://xxx.com/v1）；③ 模型名填对方要求的那个（DeepSeek 官方是 deepseek-chat）。`);
    live2d.playEmotion('sad');
  } finally {
    chatUI.setLoading(false);
  }
}

function bindGlobalEvents() {
  // 表情气泡联动
  window.addEventListener('chat-reply', ((e: any) => {
    if (e.detail?.text) roomUI.showSpeech(e.detail.text.slice(0, 40));
  }) as EventListener);
}

function analyzeEmotion(text: string): string {
  const t = text.toLowerCase();
  if (/开心|高兴|哈哈|嘿嘿|太好了|😊|😄|yay|喜欢你|最爱/.test(t)) return 'happy';
  if (/害羞|脸红|不好意思|诶|😳|讨厌啦/.test(t)) return 'shy';
  if (/难过|伤心|呜|委屈|哭|😢|抱歉/.test(t)) return 'sad';
  if (/生气|愤怒|气死|哼|😠/.test(t)) return 'angry';
  if (/惊讶|震惊|哇|诶？|😲|居然/.test(t)) return 'surprised';
  if (/困惑|不懂|什么|咦|😕|不懂耶/.test(t)) return 'confused';
  if (/得意|厉害|嘿嘿|😏|当然/.test(t)) return 'smug';
  if (/睡|困|晚安|😴|休息/.test(t)) return 'sleepy';
  if (/担心|担忧|小心|😟/.test(t)) return 'worried';
  return 'neutral';
}

(window as any).__APP__ = {
  getApp: () => app,
  getLive2D: () => live2d,
  getChat: () => chatUI,
  getAPI: () => api,
  getVoice: () => voice,
  getStore: () => store,
  getPlugins: () => pluginManager,
  getRoom: () => roomUI,
};