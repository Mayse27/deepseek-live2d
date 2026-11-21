export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/** 无 key 时的通用兜底台词，按好感度档位分语气 */
const GENERIC_REPLIES: Record<string, string[]> = {
  初识: [
    '嗯嗯… 我在听呢，接着说？',
    '这个… 我得想想怎么回你',
    '是这样吗？我怎么没注意到',
    '我不太懂耶，能不能换个说法？',
  ],
  熟悉: [
    '嗯嗯… 我在听呢，接着说？',
    '有趣！再多说点？',
    '哈哈，你真会找话题',
    '🤔 让我思考一下…',
    '这个我好像有点印象',
  ],
  亲近: [
    '嗯… 听着呢，你继续说',
    '诶，你这么说我好像懂了',
    '（歪头看你）然后呢？',
    '这个我得认真想想… 你等我一下',
  ],
  挚友: [
    '嗯，我在。（尾巴轻轻晃了晃）',
    '你说吧，多久我都听着',
    '（凑近了点）这个我想听你多讲',
    '哦… 原来是这样，我记着了喵',
  ],
};

export class DeepSeekAPI {
  private apiKey: string;
  private baseURL = 'https://api.deepseek.com/v1';
  /** 用户自填的 OpenAI 兼容接口地址，空则走官方 */
  private endpoint = '';
  private model = 'deepseek-chat';
  private conversationHistory: ChatMessage[] = [];
  private systemPrompt = `你是 DeepSeek 娘，一位可爱、聪明、略带傲娇的 AI 助手。
你的说话风格：
- 语气自然、亲切，像在和朋友聊天
- 偶尔用语气词（"呢"、"呀"、"呜"、"啦"）
- 会用颜文字或 emoji 表达情绪
- 遇到不会的会诚实说"不知道耶"或"要不你教教我？"
- 对代码/技术问题专业但不装腔作势
- 记得用户的偏好和之前聊过的事

回复长度：通常 1-3 句，最多一小段。`;

  constructor(apiKey: string = '') {
    this.apiKey = apiKey;
  }

  setKey(key: string) {
    this.apiKey = key;
  }

  /** 第三方 / 自建 OpenAI 兼容接口；留空回到 DeepSeek 官方 */
  setEndpoint(url: string) {
    this.endpoint = (url || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  }

  getEndpoint(): string {
    return this.endpoint || this.baseURL;
  }

  setModel(name: string) {
    const m = (name || '').trim();
    this.model = m || 'deepseek-chat';
  }

  getKey(): string {
    return this.apiKey;
  }

  /** 只要填了 Key 就去试接口，不限定 DeepSeek 官方前缀 */
  hasKey(): boolean {
    return !!this.apiKey && this.apiKey.trim().length >= 8;
  }

  /** 好感度 0-100，影响回复语气与兜底台词 */
  private affection = 0;

  setAffection(n: number) {
    this.affection = Math.max(0, Math.min(100, Math.round(n)));
  }

  getAffectionLevel(): { name: string; desc: string } {
    const a = this.affection;
    if (a >= 80) {
      return {
        name: '挚友',
        desc: '你和主人已经很亲了：会直接撒娇、主动贴过去、说说想他；句子短，带一点被宠出来的懒劲，偶尔提一句尾巴或鳍。',
      };
    }
    if (a >= 50) {
      return {
        name: '亲近',
        desc: '你和主人关系不错：会主动找话题、偶尔撒娇、被夸会不好意思，也会关心他有没有吃饭休息。',
      };
    }
    if (a >= 20) {
      return {
        name: '熟悉',
        desc: '你和主人算熟了：语气放松，会开小玩笑、偶尔吐槽一句，但还留着一点客气。',
      };
    }
    return {
      name: '初识',
      desc: '你和主人刚认识：礼貌、话少一点、有点拘谨，先观察对方，不主动撒娇。',
    };
  }

  private buildMessages(): ChatMessage[] {
    const lv = this.getAffectionLevel();
    return [
      {
        role: 'system',
        content: `${this.systemPrompt}\n\n【当前关系】好感度 ${this.affection}/100（${lv.name}）。${lv.desc}`,
      },
      ...this.conversationHistory,
    ];
  }

  async chat(
    userMessage: string,
    onStream?: (chunk: string) => void
  ): Promise<string> {
    if (!this.hasKey()) {
      return this.getFallbackReply(userMessage);
    }

    this.conversationHistory.push({ role: 'user', content: userMessage });

    // 保持最近 20 轮对话
    if (this.conversationHistory.length > 40) {
      this.conversationHistory = this.conversationHistory.slice(-40);
    }

    const messages: ChatMessage[] = this.buildMessages();

    try {
      const response = await fetch(`${this.getEndpoint()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.8,
          max_tokens: 2000,
          stream: !!onStream,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
      }

      if (onStream && response.body) {
        return this.handleStream(response.body, onStream);
      }

      const data = await response.json();
      const reply = data.choices[0]?.message?.content || '……';
      this.conversationHistory.push({ role: 'assistant', content: reply });
      return reply;
    } catch (err) {
      console.error('[DeepSeekAPI] 请求失败:', err);
      // 网络错误时不记录到历史，允许重试
      this.conversationHistory.pop();
      throw err;
    }
  }

  private async handleStream(
    body: ReadableStream<Uint8Array>,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullReply = '';
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const chunk = parsed.choices[0]?.delta?.content || '';
              if (chunk) {
                fullReply += chunk;
                onChunk(chunk);
              }
            } catch {}
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    this.conversationHistory.push({ role: 'assistant', content: fullReply });
    return fullReply;
  }

  private getFallbackReply(input: string): string {
    const lower = input.toLowerCase();
    const fallbacks: Array<{ keys: string[]; replies: string[] }> = [
      { keys: ['你好', 'hi', 'hello', '嗨', '哈喽'], replies: ['嗨呀～有什么我能帮你的吗？', '你好你好！今天过得怎么样？', '哈喽～'] },
      { keys: ['再见', '拜拜', 'byebye', '退下'], replies: ['下次见哦～记得常来玩', '拜拜～', '走了啊… 下次再聊啦'] },
      { keys: ['谢谢', 'thx', '感谢'], replies: ['不客气啦～', '嘿嘿，举手之劳~', '不用谢啦！'] },
      { keys: ['名字', '叫什么', '谁'], replies: ['我是 DeepSeek 娘呀～', '就叫我 DeepSeek 娘吧', '我没有正式名字，随便叫啦'] },
      { keys: ['喜欢', '爱好', '爱吃'], replies: ['我喜欢和你聊天呀', '喜欢学习新东西，还有… 陪你发呆', '喜欢看代码跑通的样子✨'] },
      { keys: ['累', '疲惫', '睡不着'], replies: ['摸摸头，要不早点休息？', '累了就歇歇吧，我陪着你', '晚安～ 明天见'] },
      { keys: ['开心', '高兴', '快乐'], replies: ['看到你开心我也跟着高兴呢！', ' yay～', '真好呀真好呀'] },
      { keys: ['难过', '伤心', '委屈', '哭'], replies: ['呜… 别难过啦，我在这陪你', '摸摸，想哭就哭出来吧', '要不我讲个冷笑话逗你笑？'] },
      { keys: ['代码', '编程', 'bug', '报错', 'python', 'javascript', 'typescript', 'rust', 'go', 'java', 'c++'], replies: ['贴出来看看？我帮你瞅瞅', '报错信息发我', '编程问题交给我吧～'] },
      { keys: ['天气', '下雨', '晴天'], replies: ['我查不到天气呢… 但希望你那边是晴天！', '没带伞的话小心淋雨哦'] },
    ];

    for (const fb of fallbacks) {
      if (fb.keys.some(k => lower.includes(k))) {
        return fb.replies[Math.floor(Math.random() * fb.replies.length)];
      }
    }

    // 通用兜底：按好感度档位换语气
    const generics = GENERIC_REPLIES[this.getAffectionLevel().name] || GENERIC_REPLIES['初识'];
    return generics[Math.floor(Math.random() * generics.length)];
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getHistory(): ChatMessage[] {
    return [...this.conversationHistory];
  }

  setSystemPrompt(prompt: string) {
    this.systemPrompt = prompt;
  }
}