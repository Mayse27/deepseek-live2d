/**
 * 语音：朗读（speechSynthesis）+ 语音输入（webkitSpeechRecognition）
 * 零依赖、零额外 Key，全在本机浏览器里跑。
 */

export interface VoiceSettings {
  /** 收到回复后自动朗读 */
  enabled: boolean;
  /** 选中的音色 voiceURI，空 = 自动挑中文女声 */
  voiceURI: string;
  rate: number; // 0.5 ~ 2
  pitch: number; // 0.5 ~ 2
  volume: number; // 0 ~ 1
}

export const VOICE_STORE_KEY = 'voice_settings';

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  voiceURI: '',
  rate: 1,
  pitch: 1.15,
  volume: 1,
};

/** 说话前把 markdown / emoji 洗掉，只留下能读的字 */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '，代码我放在屏幕上了，')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~|]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** 长句切短，避免 Chrome 一次读太久被截断 */
export function splitSentences(text: string, maxLen = 80): string[] {
  const parts = text
    .split(/(?<=[。！？!?\n；;])/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= maxLen) {
      out.push(p);
      continue;
    }
    let buf = '';
    for (const ch of p) {
      buf += ch;
      if (buf.length >= maxLen && /[，,、\s]/.test(ch)) {
        out.push(buf.trim());
        buf = '';
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.length ? out : [text];
}

/**
 * 给系统语音打分排序：中文优先，自然音色次之，女声再其次，明确的男声压到后面。
 * 默认音色就用排在最前面的那个。
 */
export function rankZhVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    const n = v.name.toLowerCase();
    if (v.lang.toLowerCase().startsWith('zh')) s += 100;
    if (/natural|neural/.test(n)) s += 40;
    if (/xiaoxiao|晓晓/.test(n)) s += 30;
    if (/xiaoyi|晓伊|yaoyao|瑶瑶|huihui|慧慧|xiaoqiu|晓秋/.test(n)) s += 22;
    if (/female|女/.test(n)) s += 20;
    if (/yunjian|云健|yunyang|云扬|yunque|云雀|kangkang|康康|yunxia|云夏|yunxi|云希|xiaobei|晓北|yunye|云野/.test(n)) s -= 60;
    if (v.localService) s += 5;
    return s;
  };
  return voices.slice().sort((a, b) => score(b) - score(a));
}

export class VoicePlayer {
  private settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
  private synth: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  private queue: string[] = [];
  private playing = false;
  private current: SpeechSynthesisUtterance | null = null;
  /** 说话状态变化（true = 正在出声，用来驱动嘴型） */
  onStateChange: (speaking: boolean) => void = () => {};

  get supported() {
    return !!this.synth;
  }

  getSettings(): VoiceSettings {
    return { ...this.settings };
  }

  applySettings(patch: Partial<VoiceSettings>) {
    this.settings = { ...this.settings, ...patch };
    if (!this.settings.enabled) this.cancel();
  }

  /** 中文女声排前面 */
  listVoices(): SpeechSynthesisVoice[] {
    if (!this.synth) return [];
    return rankZhVoices(this.synth.getVoices());
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const voices = this.listVoices();
    if (!voices.length) return null;
    if (this.settings.voiceURI) {
      const hit = voices.find((v) => v.voiceURI === this.settings.voiceURI);
      if (hit) return hit;
    }
    return voices[0];
  }

  /** 朗读一段文字（会先清掉队列，只读最新的） */
  speak(raw: string) {
    if (!this.synth || !this.settings.enabled) return;
    const text = cleanForSpeech(raw);
    if (!text) return;
    this.cancel();
    this.queue = splitSentences(text);
    this.playing = true;
    this.onStateChange(true);
    this.next();
  }

  private next() {
    if (!this.synth) return;
    const line = this.queue.shift();
    if (!line) {
      this.playing = false;
      this.current = null;
      this.onStateChange(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(line);
    const v = this.pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = 'zh-CN';
    }
    u.rate = this.settings.rate;
    u.pitch = this.settings.pitch;
    u.volume = this.settings.volume;
    u.onend = () => {
      if (this.playing) this.next();
    };
    u.onerror = () => {
      if (this.playing) this.next();
    };
    this.current = u;
    this.synth.speak(u);
  }

  cancel() {
    this.queue = [];
    this.playing = false;
    this.current = null;
    if (this.synth) {
      try {
        this.synth.cancel();
      } catch {}
    }
    this.onStateChange(false);
  }

  get isSpeaking() {
    return this.playing;
  }
}

/** 语音输入（Chrome / Edge 自带识别，需要 https 或 localhost） */
export class SpeechInput {
  private rec: any = null;
  private listening = false;

  get supported(): boolean {
    const w = window as any;
    return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
  }

  get isListening() {
    return this.listening;
  }

  /** 返回是否成功开始 */
  start(onText: (text: string, final: boolean) => void, onEnd?: () => void): boolean {
    const w = window as any;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return false;
    if (this.listening) {
      this.stop();
      return false;
    }
    const rec = new Ctor();
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      let text = '';
      let isFinal = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) isFinal = true;
      }
      if (text) onText(text.trim(), isFinal);
    };
    rec.onerror = () => {
      this.listening = false;
      onEnd?.();
    };
    rec.onend = () => {
      this.listening = false;
      onEnd?.();
    };

    try {
      rec.start();
      this.rec = rec;
      this.listening = true;
      return true;
    } catch {
      this.listening = false;
      return false;
    }
  }

  stop() {
    try {
      this.rec?.stop();
    } catch {}
    this.rec = null;
    this.listening = false;
  }
}