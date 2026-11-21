import type { Plugin, PluginFactory, PluginContext } from '../PluginManager';

/** 好感度系统 */
const CLICK_COOLDOWN = 60 * 1000; // 点她一次的好感度冷却：1 分钟内只算一次

const affectionPlugin: PluginFactory = (ctx: PluginContext) => {
  return {
    id: 'affection',
    name: '好感度系统',
    version: '1.1.0',
    description: '聊天每轮 +1，点她一次 +1（1 分钟内只算一次）',

    async onLoad() {
      const affection = await ctx.store.getAffection();

      ctx.addToolButton({
        id: 'affection-display',
        label: `❤️ ${affection}`,
        icon: '❤️',
        title: '当前好感度',
        onClick: async () => {
          const a = await ctx.store.getAffection();
          const level = a >= 80 ? '挚友' : a >= 50 ? '亲近' : a >= 20 ? '熟悉' : '初识';
          const tip = a >= 80 ? ' — 你是我最重要的人呢…' : a >= 50 ? ' — 今天也陪着我吧' : '';
          ctx.systemMessage(`好感度：${a}/100（${level}）${tip}`);
          ctx.emotion(a >= 50 ? 'happy' : 'shy');
        },
      });

      // 摸头：动作与表情，好感度统一在 zone-click 里加（带冷却）
      ctx.addRoomAction({
        id: 'pat-head',
        label: '摸摸头',
        icon: '🫶',
        zone: 'head',
        onClick: async () => {
          ctx.emotion('shy');
          ctx.live2d?.playReaction?.('head');
        },
      });

      // 碰尾巴：同上
      ctx.addRoomAction({
        id: 'touch-tail',
        label: '碰碰尾巴',
        icon: '🐟',
        zone: 'tail',
        onClick: async () => {
          ctx.emotion('surprised');
          ctx.live2d?.playReaction?.('tail');
        },
      });
    },

    async onEvent(event, _payload, ctx) {
      // 对话：每一轮 +1
      if (event === 'user-message') {
        const v = await ctx.store.addAffection(1);
        window.dispatchEvent(new CustomEvent('affection-changed', { detail: v }));
        if (v >= 50 && Math.random() < 0.15) {
          ctx.systemMessage('（悄悄凑近了些）今天也陪我聊这么久… 谢谢你呀');
        }
        return null;
      }

      // 点她：+1，1 分钟内只算一次（时间戳落库，刷新也拦得住）
      if (event === 'zone-click') {
        const now = Date.now();
        const last = (await ctx.store.get<number>('aff_last_click')) || 0;
        if (now - last < CLICK_COOLDOWN) return null;
        await ctx.store.set('aff_last_click', now);
        const v = await ctx.store.addAffection(1);
        window.dispatchEvent(new CustomEvent('affection-changed', { detail: v }));
      }
      return null;
    },
  };
};

/** 主题配色系统 */
const skinPlugin: PluginFactory = (ctx: PluginContext) => {
  const skins = [
    { id: 'default', name: '原版', color: '#7ec8e3', desc: '海蓝鲸鱼，最初的样子' },
    { id: 'sakura', name: '樱花', color: '#ffb7c5', desc: '淡粉樱花调' },
    { id: 'night', name: '夜色', color: '#8b7ec8', desc: '深紫夜色调' },
    { id: 'gold', name: '鎏金', color: '#ffd700', desc: '暖金贵族调' },
  ];

  return {
    id: 'skins',
    name: '主题配色',
    version: '1.1.0',
    description: '自由切换界面主题配色，全部可选',

    async onLoad() {
      ctx.addToolButton({
        id: 'skin-switch',
        label: '🎨 主题配色',
        icon: '🎨',
        title: '切换主题配色',
        onClick: () => {
          window.dispatchEvent(new CustomEvent('open-skin-panel'));
        },
      });

      window.addEventListener('skin-selected', async (e: any) => {
        const id = e.detail;
        await ctx.store.setCurrentSkin(id);
        document.documentElement.setAttribute('data-skin', id);
        const skin = skins.find(s => s.id === id);
        if (skin) ctx.systemMessage(`换上了「${skin.name}」配色～`);
      });

      // 初始化
      const current = await ctx.store.getCurrentSkin();
      document.documentElement.setAttribute('data-skin', current);
    },

    onEvent(event, payload, ctx) {
      if (event === 'get-skins') return skins;
      return null;
    },
  };
};

/** 房间氛围插件（时段光线由 RoomUI 统一处理，这里只负责工具栏入口与提示） */
const roomPlugin: PluginFactory = (ctx: PluginContext) => {
  const moodNames: Record<string, string> = {
    morning: '早晨', noon: '中午', dusk: '黄昏', night: '夜晚',
  };
  return {
    id: 'room-mood',
    name: '房间氛围',
    version: '1.1.0',
    description: '切换房间时段光线',
    async onLoad() {
      ctx.addToolButton({
        id: 'mood-switch',
        label: '🌙 氛围',
        icon: '🌙',
        title: '切换房间时段光线',
        onClick: () => { window.dispatchEvent(new CustomEvent('open-mood-panel')); },
      });
      window.addEventListener('mood-selected', (e: any) => {
        const name = moodNames[e.detail];
        if (name) ctx.systemMessage(`房间光线变成了「${name}」`);
      });
    },
    onEvent(event) {
      if (event === 'get-moods') return moodNames;
      return null;
    },
  };
};

/** 定时关怀插件 */
const carePlugin: PluginFactory = (ctx: PluginContext) => {
  return {
    id: 'care',
    name: '定时关怀',
    version: '1.0.0',
    description: '久聊提醒休息、喝水',
    async onLoad() {
      let messageCount = 0;
      let interval: number | undefined;
      interval = window.setInterval(() => {
        if (messageCount >= 10) {
          ctx.systemMessage('聊了这么久啦，记得起来喝口水、活动一下哦～ 🐋');
          ctx.emotion('happy');
          messageCount = 0;
        }
      }, 60000);
      window.addEventListener('chat-sent', () => messageCount++);
      (this as any)._interval = interval;
    },
    onUnload() {
      if ((this as any)._interval) clearInterval((this as any)._interval);
    },
    onEvent(event) {
      if (event === 'user-message') return null;
      return null;
    },
  };
};

export const BuiltinPlugins: PluginFactory[] = [
  affectionPlugin,
  skinPlugin,
  roomPlugin,
  carePlugin,
];
