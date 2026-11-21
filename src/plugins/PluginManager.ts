import type { Store } from '../store';

export interface PluginContext {
  live2d: any;
  chatUI: any;
  store: Store;
  api: any;
  /** 注册一个按钮到房间工具栏 */
  addToolButton: (cfg: ToolButton) => void;
  /** 注册一个房间快捷交互 */
  addRoomAction: (cfg: RoomAction) => void;
  /** 向聊天区注入一条系统消息 */
  systemMessage: (text: string) => void;
  /** 控制角色表情 */
  emotion: (name: string) => void;
  /** 读取/修改共享状态 */
  state: Record<string, any>;
}

export interface ToolButton {
  id: string;
  label: string;
  icon: string;
  title?: string;
  onClick: (ctx: PluginContext) => void | Promise<void>;
}

export interface RoomAction {
  id: string;
  label: string;
  icon: string;
  zone?: string;
  onClick: (ctx: PluginContext) => void | Promise<void>;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  onLoad?: (ctx: PluginContext) => void | Promise<void>;
  onUnload?: () => void;
  /** 事件钩子 */
  onEvent?: (event: string, payload: any, ctx: PluginContext) => any;
}

export type PluginFactory = (ctx: PluginContext) => Plugin | Promise<Plugin>;

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private ctx: PluginContext;
  private toolButtons: ToolButton[] = [];
  private roomActions: RoomAction[] = [];
  private state: Record<string, any> = {};
  private enabledKey = 'plugins_enabled';
  private disabled: Set<string> = new Set();

  constructor(
    live2d: any,
    chatUI: any,
    store: Store,
    api: any
  ) {
    this.ctx = {
      live2d,
      chatUI,
      store,
      api,
      state: this.state,
      addToolButton: (cfg) => {
        this.toolButtons = this.toolButtons.filter(b => b.id !== cfg.id);
        this.toolButtons.push(cfg);
        window.dispatchEvent(new CustomEvent('tools-changed', { detail: this.toolButtons }));
      },
      addRoomAction: (cfg) => {
        this.roomActions = this.roomActions.filter(a => a.id !== cfg.id);
        this.roomActions.push(cfg);
        window.dispatchEvent(new CustomEvent('room-actions-changed', { detail: this.roomActions }));
      },
      systemMessage: (text) => {
        chatUI.addMessage('assistant', text);
      },
      emotion: (name) => live2d.playEmotion(name),
    };
  }

  async init() {
    const disabledArr = await this.ctx.store.get<string[]>(this.enabledKey);
    if (disabledArr) this.disabled = new Set(disabledArr);
  }

  async loadBuiltins(factories: PluginFactory[]) {
    for (const factory of factories) {
      await this.register(factory);
    }
  }

  async register(factoryOrPlugin: PluginFactory | Plugin) {
    let plugin: Plugin;
    if (typeof factoryOrPlugin === 'function') {
      plugin = await factoryOrPlugin(this.ctx);
    } else {
      plugin = factoryOrPlugin;
    }

    if (this.disabled.has(plugin.id)) {
      console.log(`[Plugin] ${plugin.id} 已禁用`);
      return;
    }

    await plugin.onLoad?.(this.ctx);
    this.plugins.set(plugin.id, plugin);
    console.log(`[Plugin] 已加载: ${plugin.name} v${plugin.version}`);
  }

  /** 触发事件，收集所有插件的返回结果 */
  async trigger(event: string, payload: any = {}): Promise<any> {
    let result: any = null;
    for (const plugin of this.plugins.values()) {
      try {
        const r = await plugin.onEvent?.(event, payload, this.ctx);
        if (r !== undefined && r !== null) result = r;
      } catch (e) {
        console.error(`[Plugin] ${plugin.id} 事件 ${event} 出错:`, e);
      }
    }
    return result;
  }

  async setEnabled(id: string, enabled: boolean) {
    if (enabled) {
      this.disabled.delete(id);
    } else {
      this.disabled.add(id);
      const p = this.plugins.get(id);
      await p?.onUnload?.();
    }
    await this.ctx.store.set(this.enabledKey, [...this.disabled]);
  }

  getPlugins(): Plugin[] {
    return [...this.plugins.values()];
  }

  getToolButtons(): ToolButton[] {
    return this.toolButtons;
  }

  getRoomActions(): RoomAction[] {
    return this.roomActions;
  }

  /** 供 UI 调用按钮/动作时使用的上下文 */
  getContext(): PluginContext {
    return this.ctx;
  }

  async invokeTool(id: string) {
    const btn = this.toolButtons.find(b => b.id === id);
    if (btn) await btn.onClick(this.ctx);
  }

  async invokeRoomAction(id: string) {
    const action = this.roomActions.find(a => a.id === id);
    if (action) await action.onClick(this.ctx);
  }

  /** 从用户提供的 JS 源码动态加载插件（沙箱式，Function 构造） */
  async loadFromSource(source: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const factory = new Function('ctx', `
        "use strict";
        const module = { exports: {} };
        ${source}
        if (typeof plugin !== 'undefined') return plugin;
        if (module.exports) return module.exports;
        return null;
      `) as PluginFactory;
      const plugin = await factory(this.ctx);
      if (!plugin || !plugin.id) throw new Error('插件缺少 id');
      await this.register(plugin);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e.message || String(e) };
    }
  }
}
