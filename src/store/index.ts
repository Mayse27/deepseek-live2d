import { openDB, type IDBPDatabase } from 'idb';

export interface ChatRecord {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

const DB_NAME = 'deepseek-live2d';
const DB_VERSION = 1;
const MAX_HISTORY = 200;

/** 角色布局偏好：scaleMul 倍率，offsetX/offsetY 为舞台内的比例位置 */
export interface LayoutPref {
  scaleMul: number;
  offsetX: number;
  offsetY: number;
  /** true = 主人手动保存过，窗口变化时不再套用自动比例 */
  locked?: boolean;
  /** 锁定时记录的舞台高度与基准缩放，用于按新高度等比跟随 */
  lockRefH?: number;
  lockBase?: number;
}

export const DEFAULT_LAYOUT: LayoutPref = {
  scaleMul: 1,
  offsetX: 0.5,
  offsetY: 0.9,
  locked: false,
  lockRefH: 0,
  lockBase: 0,
};

class Store {
  private db: IDBPDatabase | null = null;
  private memory: Record<string, any> = {};

  async init() {
    try {
      this.db = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          if (!db.objectStoreNames.contains('chat')) {
            db.createObjectStore('chat', { keyPath: 'id', autoIncrement: true });
          }
        },
      });
    } catch (e) {
      console.warn('[Store] IndexedDB 不可用，回退到内存存储', e);
      this.db = null;
    }
  }

  async get<T = any>(key: string): Promise<T | undefined> {
    if (!this.db) return this.memory[key];
    try {
      return (await this.db.get('kv', key)) as T | undefined;
    } catch {
      return this.memory[key];
    }
  }

  async set(key: string, value: any): Promise<void> {
    this.memory[key] = value;
    if (!this.db) return;
    try {
      await this.db.put('kv', value, key);
    } catch {}
  }

  async delete(key: string): Promise<void> {
    delete this.memory[key];
    if (!this.db) return;
    try {
      await this.db.delete('kv', key);
    } catch {}
  }

  async addChatMessage(role: 'user' | 'assistant' | 'system', content: string) {
    const rec: ChatRecord = { role, content, timestamp: Date.now() };
    if (!this.db) return;
    try {
      await this.db.add('chat', rec);
      // 修剪历史
      const count = await this.db.count('chat');
      if (count > MAX_HISTORY) {
        const old = await this.db.getAllKeys('chat');
        for (const key of old.slice(0, count - MAX_HISTORY)) {
          await this.db.delete('chat', key);
        }
      }
    } catch {}
  }

  async getChatHistory(): Promise<ChatRecord[]> {
    if (!this.db) return [];
    try {
      return await this.db.getAll('chat');
    } catch {
      return [];
    }
  }

  async clearChatHistory() {
    if (!this.db) return;
    try {
      await this.db.clear('chat');
    } catch {}
  }

  async getAffection(): Promise<number> {
    return (await this.get<number>('affection')) ?? 0;
  }

  async setAffection(v: number) {
    const n = Math.max(0, Math.min(100, Math.round(v)));
    await this.set('affection', n);
  }

  async addAffection(delta: number): Promise<number> {
    const cur = await this.getAffection();
    const next = Math.max(0, Math.min(100, cur + delta));
    await this.setAffection(next);
    return next;
  }

  async getSkins(): Promise<any[]> {
    return (await this.get<any[]>('skins')) ?? [];
  }

  async addSkin(skin: any) {
    const list = await this.getSkins();
    const next = list.filter((s) => s.id !== skin.id).concat([skin]);
    await this.set('skins', next);
  }

  async setCurrentSkin(id: string) {
    await this.set('current_skin', id);
  }

  async getCurrentSkin(): Promise<string> {
    return (await this.get<string>('current_skin')) ?? 'default';
  }

  /** 用户可调的角色布局（大小/左右/上下；locked 表示手动保存过，不再被自动比例覆盖） */
  async getLayout(): Promise<LayoutPref> {
    const DEFAULT: LayoutPref = { ...DEFAULT_LAYOUT };
    const saved = await this.get<LayoutPref>('char_layout_v4');
    if (!saved) return DEFAULT;
    return {
      scaleMul: typeof saved.scaleMul === 'number' ? saved.scaleMul : DEFAULT.scaleMul,
      offsetX: typeof saved.offsetX === 'number' ? saved.offsetX : DEFAULT.offsetX,
      offsetY: typeof saved.offsetY === 'number' ? saved.offsetY : DEFAULT.offsetY,
      locked: saved.locked === true,
      lockRefH: typeof saved.lockRefH === 'number' ? saved.lockRefH : 0,
      lockBase: typeof saved.lockBase === 'number' ? saved.lockBase : 0,
    };
  }
  async setLayout(v: LayoutPref) {
    await this.set('char_layout_v4', v);
  }
}

export { Store };
