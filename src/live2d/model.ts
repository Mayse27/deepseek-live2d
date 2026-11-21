import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

export interface CharacterConfig {
  schema: number;
  id: string;
  name: string;
  model: string;
  author: string;
  license: string;
  source: string;
  framing: { zoom: number; y: number };
  tail: string[];
  zones: Array<{ id: string; from: number; to: number; xFrom?: number; xTo?: number }>;
  emotions: Record<string, {
    expression?: string;
    face?: Record<string, number>;
    gaze?: [number, number];
  }>;
  actions: Record<string, {
    ms: number;
    tracks: Record<string, Array<[number, number]>>;
  }>;
}

export interface EmotionState {
  name: string;
  expression?: string;
  params: Record<string, number>;
  gaze?: [number, number];
  timestamp: number;
}

export class Live2DManager {
  private app: PIXI.Application;
  private model: Live2DModel | null = null;
  private character: CharacterConfig | null = null;
  private internalModel: any = null; // Cubism 内部模型
  private currentEmotion: EmotionState | null = null;
  private idleTimer: number | null = null;
  private blinkTimer: number | null = null;
  private breathValue = 0;
  private breathDir = 1;

  // 参数缓存
  private paramCache: Map<string, number> = new Map();
  private paramTargets: Map<string, number> = new Map();
  private paramSpeeds: Map<string, number> = new Map();

  // 点击触发的肢体动作：关键帧插值，参数用模型真实值（角度是 ±30，不是 ±1）
  private reaction: {
    frames: Record<string, Array<[number, number]>>;
    start: number;
    duration: number;
  } | null = null;

  // 用户可调的角色布局：原始尺寸缓存 + 缩放倍率/水平位置/垂直位置
  private baseW = 3326;
  private baseH = 4992;
  private userLayout = { scaleMul: 1, offsetX: 0.5, offsetY: 0.95 };
  /** 说话时的嘴型驱动 */
  private talking = false;
  private mouthPhase = 0;

  constructor(app: PIXI.Application) {
    this.app = app;
  }

  async loadModel(modelPath: string, characterPath: string) {
    // 加载角色配置
    const charRes = await fetch(characterPath);
    this.character = await charRes.json();

    // 加载 Live2D 模型
    this.model = await Live2DModel.from(modelPath, { autoInteract: false });
    this.internalModel = this.model.internalModel;

    // 自适应缩放与定位（模型原始尺寸可能很大，如 3326×4992）
    this.app.stage.addChild(this.model);
    this.layout();

    // 保留库的原生 update（累加 deltaTime，驱动 Cubism 呼吸/眨眼/物理/待机动作），
    // 在此之上叠加我们的自定义参数动画。直接覆盖会让 deltaTime 恒为 0，角色冻结。
    const nativeUpdate = this.model.update.bind(this.model);
    this.model.update = (delta: number) => {
      nativeUpdate(delta);
      this.onModelUpdate(delta);
    };

    // 初始化眨眼
    this.startBlink();

    console.log('[Live2D] 模型加载完成:', this.character!.name);
  }

  private onModelUpdate(delta: number) {
    if (!this.internalModel) return;

    // 呼吸参数
    this.breathValue += 0.003 * this.breathDir;
    if (this.breathValue > 1) { this.breathValue = 1; this.breathDir = -1; }
    if (this.breathValue < -1) { this.breathValue = -1; this.breathDir = 1; }
    this.setParam('ParamBreath', this.breathValue * 0.5);

    // 平滑插值到目标参数
    for (const [id, target] of this.paramTargets) {
      const current = this.paramCache.get(id) || 0;
      const speed = this.paramSpeeds.get(id) || 0.1;
      const next = current + (target - current) * speed;
      this.setParam(id, next);
      if (Math.abs(next - target) < 0.01) {
        this.paramTargets.delete(id);
        this.paramSpeeds.delete(id);
      }
    }

    // 点击肢体动作关键帧（不经过 setParam 的 ±1 夹断）
    if (this.reaction) {
      const t = (performance.now() - this.reaction.start) / this.reaction.duration;
      if (t >= 1) {
        for (const id of Object.keys(this.reaction.frames)) this.writeParam(id, 0);
        this.reaction = null;
      } else {
        for (const [id, frames] of Object.entries(this.reaction.frames)) {
          let value = 0;
          for (let i = 0; i < frames.length - 1; i++) {
            const [t1, v1] = frames[i];
            const [t2, v2] = frames[i + 1];
            if (t >= t1 && t <= t2) {
              const local = t2 === t1 ? 0 : (t - t1) / (t2 - t1);
              value = v1 + (v2 - v1) * local;
              break;
            }
          }
          this.writeParam(id, value);
        }
      }
    }

    // 说话时嘴跟着动（TTS 拿不到音频流，用不规则节奏模拟开合）
    if (this.talking) {
      this.mouthPhase += delta * 0.012;
      const wave =
        Math.abs(Math.sin(this.mouthPhase) * 0.55) +
        Math.abs(Math.sin(this.mouthPhase * 2.7) * 0.22);
      this.writeParam('ParamMouthOpenY', Math.min(1, 0.08 + wave));
    }
  }

  /** 由语音模块控制：开始/停止说话 */
  setTalking(on: boolean) {
    this.talking = on;
    if (!on) {
      this.mouthPhase = 0;
      this.writeParam('ParamMouthOpenY', 0);
    }
  }

  // 直接写核心模型，保留模型真实范围（角度 ±30、尾巴 ±45）
  private writeParam(id: string, value: number) {
    if (!this.internalModel) return;
    try {
      this.internalModel.coreModel.setParameterValueById(id, value);
    } catch {}
  }

  // 播放一段点击肢体反应；可被打断，新动作直接覆盖旧的
  playReaction(zone: string) {
    const R: Record<string, { d: number; f: Record<string, Array<[number, number]>> }> = {
      head: { d: 1100, f: {
        ParamAngleX: [[0, 0], [0.3, -12], [0.6, 12], [0.85, -6], [1, 0]],
        ParamAngleZ: [[0, 0], [0.5, 6], [1, 0]],
      } },
      face: { d: 900, f: {
        ParamAngleY: [[0, 0], [0.4, 12], [0.7, -8], [1, 0]],
        ParamAngleZ: [[0, 0], [0.5, -10], [1, 0]],
      } },
      tail: { d: 1300, f: {
        'Param_Angle_Rotation_2_ArtMesh367': [[0, 0], [0.25, 34], [0.55, -26], [0.8, 18], [1, 0]],
        'Param_Angle_Rotation_4_ArtMesh367': [[0, 0], [0.3, 28], [0.6, -22], [1, 0]],
        ParamAngleZ: [[0, 0], [0.5, 8], [1, 0]],
      } },
      body: { d: 1200, f: {
        ParamBodyAngleZ: [[0, 0], [0.35, 14], [0.7, -14], [1, 0]],
        ParamBodyAngleY: [[0, 0], [0.5, 10], [1, 0]],
      } },
      legs: { d: 1000, f: {
        ParamBodyAngleX: [[0, 0], [0.35, -14], [0.7, 10], [1, 0]],
        ParamAngleZ: [[0, 0], [0.5, -10], [1, 0]],
      } },
      // 被牵到手：手腕抬起 + 头微微歪，像真的在看那只手
      hand: { d: 1200, f: {
        'Param_arm_R1': [[0, 0], [0.3, 18], [0.6, 12], [1, 0]],
        'Param_arm_R2': [[0, 0], [0.35, -14], [0.7, -6], [1, 0]],
        'Param_arm_L1': [[0, 0], [0.3, 10], [0.7, 4], [1, 0]],
        ParamAngleY: [[0, 0], [0.45, 10], [0.8, 4], [1, 0]],
        ParamAngleZ: [[0, 0], [0.4, -7], [1, 0]],
      } },
    };
    const preset = R[zone] || R.body;
    this.reaction = { frames: preset.f, start: performance.now(), duration: preset.d };
  }

  setParam(id: string, value: number) {
    if (!this.internalModel) return;
    const clamped = Math.max(-1, Math.min(1, value));
    this.paramCache.set(id, clamped);
    try {
      this.internalModel.coreModel.setParameterValueById(id, clamped);
    } catch {}
  }

  setParamSmooth(id: string, target: number, speed = 0.1) {
    this.paramTargets.set(id, target);
    this.paramSpeeds.set(id, speed);
  }

  getParam(id: string): number {
    return this.paramCache.get(id) || 0;
  }

  // 表情播放
  async playEmotion(name: string) {
    if (!this.character || !this.model) return;

    const emo = this.character.emotions[name];
    if (!emo) return;

    this.currentEmotion = {
      name,
      expression: emo.expression,
      params: emo.face || {},
      gaze: emo.gaze,
      timestamp: Date.now(),
    };

    // 1. 播放 Expression
    if (emo.expression && this.internalModel?.expressionManager) {
      try {
        await this.internalModel.expressionManager.setExpression(emo.expression);
      } catch (e) {
        console.warn('[Live2D] 表情播放失败:', emo.expression, e);
      }
    }

    // 2. 面部参数
    for (const [param, value] of Object.entries(emo.face || {})) {
      this.setParamSmooth(param, value, 0.15);
    }

    // 3. 视线
    if (emo.gaze) {
      this.setParamSmooth('ParamEyeBallX', emo.gaze[0], 0.2);
      this.setParamSmooth('ParamEyeBallY', emo.gaze[1], 0.2);
    }

    // 4. 几秒后回归中性
    setTimeout(() => this.returnToNeutral(), 3000 + Math.random() * 2000);
  }

  private returnToNeutral() {
    if (!this.currentEmotion) return;
    // 重置面部参数
    for (const param of Object.keys(this.currentEmotion.params)) {
      this.setParamSmooth(param, 0, 0.05);
    }
    this.setParamSmooth('ParamEyeBallX', 0, 0.05);
    this.setParamSmooth('ParamEyeBallY', 0, 0.05);
    // 清除表情
    if (this.internalModel?.expressionManager) {
      try {
        this.internalModel.expressionManager.resetExpression();
      } catch {}
    }
    this.currentEmotion = null;
  }

  // 动作播放
  async playAction(name: string) {
    if (!this.character || !this.model?.internalModel?.motionManager) return;

    const action = this.character.actions[name];
    if (!action) return;

    try {
      // 这里简化：直接用内置 motion，实际可按 tracks 驱动参数
      await this.model.internalModel.motionManager.startMotion(`motion_${name}`, 0, 3);
    } catch {
      // 兜底：手动驱动参数
      this.playActionManual(action);
    }
  }

  private playActionManual(action: { ms: number; tracks: Record<string, Array<[number, number]>> }) {
    const startTime = Date.now();
    const duration = action.ms;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);

      for (const [param, keyframes] of Object.entries(action.tracks)) {
        let value = 0;
        for (let i = 0; i < keyframes.length - 1; i++) {
          const [t1, v1] = keyframes[i];
          const [t2, v2] = keyframes[i + 1];
          if (t >= t1 && t <= t2) {
            const localT = (t - t1) / (t2 - t1);
            value = v1 + (v2 - v1) * localT;
            break;
          }
        }
        this.setParam(param, value);
      }

      if (t < 1) requestAnimationFrame(animate);
    };
    animate();
  }

  // 待机动作（随机眨眼、呼吸、微动）
  startIdleMotion() {
    this.idleTimer = window.setInterval(() => {
      if (this.currentEmotion) return;
      // 随机微表情
      if (Math.random() < 0.02) {
        const emotions = ['happy', 'shy', 'confused', 'smug', 'sleepy'];
        this.playEmotion(emotions[Math.floor(Math.random() * emotions.length)]);
      }
      // 随机视线
      if (Math.random() < 0.05) {
        this.setParamSmooth('ParamEyeBallX', (Math.random() - 0.5) * 0.8, 0.1);
        this.setParamSmooth('ParamEyeBallY', (Math.random() - 0.5) * 0.6, 0.1);
      }
      // 随机身体微动
      if (Math.random() < 0.03) {
        this.setParamSmooth('ParamAngleZ', (Math.random() - 0.5) * 5, 0.05);
        this.setParamSmooth('ParamBodyAngleY', (Math.random() - 0.5) * 3, 0.05);
      }
    }, 1000);
  }

  // 眨眼
  startBlink() {
    this.blinkTimer = window.setInterval(() => {
      if (this.currentEmotion?.name === 'sleepy') return;
      if (Math.random() < 0.3) {
        this.setParam('ParamEyeLOpen', 0);
        this.setParam('ParamEyeROpen', 0);
        setTimeout(() => {
          this.setParam('ParamEyeLOpen', 1);
          this.setParam('ParamEyeROpen', 1);
        }, 150);
      }
    }, 3000 + Math.random() * 2000);
  }

  // 点击测试：用显示包围盒归一化（与 e.global 同为 stage 坐标系，单位一致）
  hitTest(x: number, y: number): string | null {
    if (!this.character || !this.model) return null;

    const bounds = this.model.getBounds();
    if (!bounds.width || !bounds.height) return null;
    const normX = (x - bounds.x) / bounds.width;
    const normY = (y - bounds.y) / bounds.height;
    // 落在模型显示区之外视为空白
    if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return null;

    for (const zone of this.character.zones) {
      if (normY >= zone.from && normY <= zone.to) {
        const xFrom = zone.xFrom || 0;
        const xTo = zone.xTo === undefined ? 1 - xFrom : zone.xTo;
        if (normX >= xFrom && normX <= xTo) {
          return zone.id;
        }
      }
    }
    return null;
  }

  // 依据模型真实尺寸与舞台可见区，自适应缩放并居中
  private layout() {
    if (!this.model) return;
    const W = this.app.screen.width;
    const H = this.app.screen.height;
    // 右侧聊天面板 420px；窄屏(<=860)时聊天移到下方，舞台占满宽度
    const stageW = window.innerWidth <= 860 ? W : Math.max(320, W - 420);

    // 还原模型原始尺寸（model.width 已含当前 scale）
    const origW = (this.model.width / this.model.scale.x) || 3326;
    const origH = (this.model.height / this.model.scale.y) || 4992;

    // 目标：角色占舞台高度约 62%，符合站在小屋里的正常身高比例，宽高取小值防溢出
    // 舞台变宽（全屏/大屏）时视野横向拉长，角色按宽高比小幅补正，保持"相对画面"的观感一致；
    // 只影响角色缩放，不动背景与面板。
    const refRatio = 0.758; // 标准布局基准：舞台宽 / 画面高
    const ratio = stageW / Math.max(1, H);
    const sizeBoost = Math.max(1, Math.pow(ratio / refRatio, 0.35));
    let base = (H * 0.62 * sizeBoost) / origH;
    const maxByW = (stageW * 0.92) / origW;
    if (base > maxByW) base = maxByW;
    const scale = base * this.userLayout.scaleMul;

    // 锚点放画布底边；offsetY 表示的是「鞋底」落在舞台高度的哪个比例。
    // moc3 画布下方有大量透明留白（这套模型实测约 29.8% 模型高度），
    // 直接把画布底边当地面线会让角色悬空，所以把那段留白补回去。
    this.model.anchor.set(0.5, 1.0);
    this.model.scale.set(scale);

    const FOOT_BLANK = 0.168;
    const displayH = origH * scale;
    const footY = Math.min(H - 8, H * this.userLayout.offsetY);
    const posY = footY + displayH * FOOT_BLANK;

    this.model.position.set(stageW * this.userLayout.offsetX, posY);
  }

  /** 设置用户可调布局，实时生效 */
  setUserLayout(layout: Partial<{ scaleMul: number; offsetX: number; offsetY: number }>) {
    if (layout.scaleMul !== undefined) this.userLayout.scaleMul = Math.max(0.4, Math.min(2.2, layout.scaleMul));
    if (layout.offsetX !== undefined) this.userLayout.offsetX = Math.max(0.1, Math.min(0.9, layout.offsetX));
    if (layout.offsetY !== undefined) this.userLayout.offsetY = Math.max(0.5, Math.min(1, layout.offsetY));
    this.layout();
  }

  getUserLayout() {
    return { ...this.userLayout };
  }

  onResize() {
    this.layout();
  }

  destroy() {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.blinkTimer) clearInterval(this.blinkTimer);
    this.model?.destroy();
  }
}