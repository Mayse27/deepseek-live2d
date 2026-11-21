/**
 * 点击不同部位的台词库。
 * 每个区域一组，随机抽取且不会连着重复同一句（记最近 3 条）。
 * minAff：好感度门槛，达到后这组更亲的句子才会被抽到。
 */

export interface ZoneLine {
  text: string;
  emotion: string;
  minAff?: number;
}

const LINES: Record<string, ZoneLine[]> = {
  head: [
    { text: '诶？摸、摸头…谢谢主人啦', emotion: 'shy' },
    { text: '唔…头发要被弄乱了喵', emotion: 'shy' },
    { text: '再摸一下也不是不行…', emotion: 'shy' },
    { text: '头顶的鳍，别、别捏啦', emotion: 'surprised' },
    { text: '主人的手好暖…', emotion: 'happy' },
    { text: '这样摸下去会睡着的…', emotion: 'shy' },
    { text: '乖、乖…那我也摸摸主人？', emotion: 'happy' },
    { text: '被摸头会变笨的…才怪', emotion: 'smug' },
    { text: '嗯…这个位置，正好', emotion: 'happy' },
    { text: '手放在这儿，我就不动了', emotion: 'happy' },
    { text: '嘿嘿…再来', emotion: 'happy' },
    { text: '头发有点湿吧？刚从水里出来的', emotion: 'smug' },
    { text: '主人的手，再摸摸…', emotion: 'shy', minAff: 60 },
    { text: '这样被摸着，心里踏实得很', emotion: 'happy', minAff: 60 },
  ],
  face: [
    { text: '别、别戳脸颊啦…', emotion: 'shy' },
    { text: '脸有什么好看的喵', emotion: 'shy' },
    { text: '呀，差点戳到眼睛了…', emotion: 'surprised' },
    { text: '主人这么盯着看，我会不好意思的', emotion: 'shy' },
    { text: '捏脸要收钱的哦', emotion: 'smug' },
    { text: '嗯？我脸上有东西吗', emotion: 'confused' },
    { text: '…再看，就咬你了', emotion: 'angry' },
    { text: '脸颊软软的吧？喝水喝出来的', emotion: 'happy' },
    { text: '腮帮子不是果冻啦', emotion: 'angry' },
    { text: '唔…鼻子也别碰', emotion: 'shy' },
    { text: '主人靠这么近，我能看见你的睫毛了', emotion: 'shy', minAff: 60 },
  ],
  hand: [
    { text: '诶？主人想牵手吗…', emotion: 'shy' },
    { text: '手、手给你牵一下…就一下', emotion: 'shy' },
    { text: '指尖凉凉的，是海水的温度哦', emotion: 'happy' },
    { text: '牵好了，别乱跑', emotion: 'happy' },
    { text: '主人的手比我的大好多', emotion: 'happy' },
    { text: '十指相扣…有点害羞', emotion: 'shy' },
    { text: '手心里这只小鳍，摸起来滑吧', emotion: 'smug' },
    { text: '牵着手，就不怕走丢了', emotion: 'happy' },
    { text: '要牵多久都行…我不着急', emotion: 'happy' },
    { text: '唔，手心出汗了…别看', emotion: 'shy' },
    { text: '手背上的纹路，我数过一遍了', emotion: 'smug' },
    { text: '就这样牵着，别松开好不好', emotion: 'shy', minAff: 60 },
    { text: '以后想牵就直接牵，不用问', emotion: 'happy', minAff: 60 },
  ],
  body: [
    { text: '喵～（轻轻蹭了蹭）', emotion: 'happy' },
    { text: '突然抱过来…吓我一跳', emotion: 'surprised' },
    { text: '衣服会皱的啦', emotion: 'angry' },
    { text: '这样靠着，很舒服', emotion: 'happy' },
    { text: '肩膀有点酸…帮我按按？', emotion: 'happy' },
    { text: '靠这么近，心跳会传过来的', emotion: 'shy' },
    { text: '唔…别乱摸', emotion: 'shy' },
    { text: '我可是鲸鱼，抱起来很重的哦', emotion: 'smug' },
    { text: '背上这块，是鳍留下的痕迹啦', emotion: 'confused' },
    { text: '主人的体温偏高，贴着像暖炉', emotion: 'happy' },
    { text: '想抱就抱吧，我不躲了', emotion: 'shy', minAff: 60 },
    { text: '在你旁边待着，什么都不做也很好', emotion: 'happy', minAff: 60 },
  ],
  tail: [
    { text: '呜哇！尾巴是敏感部位啦…！', emotion: 'surprised' },
    { text: '尾、尾巴不能随便抓…', emotion: 'shy' },
    { text: '尾巴会自己动的，不听话', emotion: 'confused' },
    { text: '再碰就甩你一脸水', emotion: 'angry' },
    { text: '轻轻摸…是可以的', emotion: 'shy' },
    { text: '尾鳍拍地板的声音，好听吗', emotion: 'happy' },
    { text: '刚才那一下…有点痒', emotion: 'shy' },
    { text: '鲸鱼的尾巴力气很大的哦，小心', emotion: 'smug' },
    { text: '尾巴翘起来不是故意的…', emotion: 'shy' },
    { text: '一被碰到就想摆，控制不住', emotion: 'shy' },
    { text: '只给主人碰…别告诉别人', emotion: 'shy', minAff: 60 },
    { text: '抓着尾巴走的话，我会跟着的', emotion: 'happy', minAff: 60 },
  ],
  legs: [
    { text: '呀！突然碰那里…！', emotion: 'surprised' },
    { text: '腿、腿不可以…', emotion: 'shy' },
    { text: '站久了会酸的…', emotion: 'sad' },
    { text: '别盯着脚踝上的链子看…', emotion: 'shy' },
    { text: '要坐下吗？地板有点凉', emotion: 'happy' },
    { text: '裙摆会乱的啦', emotion: 'angry' },
    { text: '这双鞋跟有点高，走着走着就磨脚', emotion: 'sad' },
    { text: '脚踝上的珍珠，是主人给的哦', emotion: 'happy' },
    { text: '踩在地上，才能真正站住', emotion: 'happy' },
    { text: '…别往上看啦', emotion: 'shy', minAff: 60 },
  ],
  blank: [
    { text: '喵？有什么事吗～', emotion: 'confused' },
    { text: '我在这儿呢', emotion: 'happy' },
    { text: '主人是在找我吗', emotion: 'confused' },
    { text: '…看什么呢', emotion: 'shy' },
    { text: '嗯？点空气做什么', emotion: 'confused' },
    { text: '这个房间，待着很舒服', emotion: 'happy' },
    { text: '要一起坐着发会儿呆吗', emotion: 'happy' },
    { text: '刚才走神了…你说什么？', emotion: 'confused' },
  ],

  // ===== 背景物件：点房间里的东西，她说跟那个东西有关的话 =====
  bed: [
    { text: '这张床…晚上会不会太软了', emotion: 'happy' },
    { text: '被子是我叠的哦，别弄乱啦', emotion: 'smug' },
    { text: '想躺上去试试？…那就躺一下', emotion: 'shy' },
    { text: '床单刚换过，闻到太阳的味道没', emotion: 'happy' },
    { text: '我睡这儿，你睡那儿…不行吗', emotion: 'shy' },
    { text: '躺下来吧，我在旁边守着', emotion: 'happy' },
    { text: '枕头上有我的味道，别嫌弃', emotion: 'shy', minAff: 60 },
  ],
  nightstand: [
    { text: '柜子上还放着我的杯子呢', emotion: 'happy' },
    { text: '台灯亮着的时候，房间最像家', emotion: 'happy' },
    { text: '灯要不要调暗一点？', emotion: 'confused' },
    { text: '抽屉里…有点乱，别看啦', emotion: 'shy' },
    { text: '睡前我会把水倒好放在这儿', emotion: 'happy' },
  ],
  window: [
    { text: '窗外今天很亮呢', emotion: 'happy' },
    { text: '从这儿能看到远处的水面', emotion: 'happy' },
    { text: '要不要把窗帘拉开？', emotion: 'confused' },
    { text: '下雨的话，窗玻璃会响', emotion: 'happy' },
    { text: '这个窗台，我坐着发过很多次呆', emotion: 'smug' },
    { text: '光落在你脸上的样子，我看过好几次了', emotion: 'shy', minAff: 60 },
  ],
  shelf: [
    { text: '书架上那本还没看完呢', emotion: 'confused' },
    { text: '这些书都是讲陆地的事', emotion: 'happy' },
    { text: '要我给你念一段吗？', emotion: 'happy' },
    { text: '那本书掉下来过，砸到我的鳍', emotion: 'sad' },
  ],
  desk: [
    { text: '桌子还留着热气，你刚坐过吧', emotion: 'happy' },
    { text: '桌角被我磕过好多次', emotion: 'sad' },
    { text: '你在这儿坐得最久', emotion: 'happy' },
  ],
  computer: [
    { text: '屏幕上的曲线，像深海的回声', emotion: 'happy' },
    { text: '你在敲什么呀？让我看看', emotion: 'confused' },
    { text: '这台电脑，比我还懂你吗', emotion: 'smug' },
    { text: '蓝光映在脸上，好看', emotion: 'shy' },
    { text: '别熬太晚，眼睛会疼的', emotion: 'sad' },
  ],
  chair: [
    { text: '椅子推得这么远，是要走了吗', emotion: 'sad' },
    { text: '我坐这儿，就在你旁边', emotion: 'happy' },
    { text: '这把椅子吱呀响，听着挺好玩', emotion: 'happy' },
  ],
  pendant: [
    { text: '灯泡热热的，别碰哦', emotion: 'surprised' },
    { text: '这个灯一开，屋子就醒了', emotion: 'happy' },
    { text: '光打在头发上，会亮亮的', emotion: 'happy' },
  ],
  painting: [
    { text: '这幅画挂了好久了', emotion: 'happy' },
    { text: '画里的那个人，有点像你', emotion: 'confused' },
    { text: '要不要换一幅？我挑', emotion: 'smug' },
  ],
  trash: [
    { text: '垃圾我等下拿去倒', emotion: 'happy' },
    { text: '这个桶…别踢啦', emotion: 'angry' },
    { text: '空的，你又没扔东西', emotion: 'confused' },
  ],
  rug: [
    { text: '地毯上踩起来软软的', emotion: 'happy' },
    { text: '坐这儿吧，地板凉', emotion: 'happy' },
    { text: '毯子上这个花纹，像海浪', emotion: 'happy' },
    { text: '一起坐这儿，什么都不干也行', emotion: 'shy', minAff: 60 },
  ],
};

/** 每个区域最近说过的话，避免连着重复 */
const recent = new Map<string, string[]>();
const KEEP = 3;

/** hand_l / hand_r 这类带后缀的区域归到主区域取台词 */
export function normalizeZone(zone: string): string {
  if (zone.startsWith('hand')) return 'hand';
  return zone;
}

export function pickZoneLine(zone: string, affection = 0): ZoneLine {
  const key = normalizeZone(zone);
  const pool = (LINES[key] || LINES.blank).filter(l => !l.minAff || affection >= l.minAff);
  if (pool.length === 0) return LINES.blank[0];

  const used = recent.get(key) || [];
  let candidates = pool.filter(l => !used.includes(l.text));
  if (candidates.length === 0) {
    candidates = pool;
    recent.set(key, []);
  }
  const line = candidates[Math.floor(Math.random() * candidates.length)];
  const keep = [...(recent.get(key) || []), line.text].slice(-KEEP);
  recent.set(key, keep);
  return line;
}

export { LINES as ZONE_LINES };

/**
 * 背景物件热区：坐标是相对背景图的归一化比例（左上 0,0）。
 * 顺序有讲究 —— 小而叠在大物件上的放前面，先命中先返回。
 */
export interface ObjectZone { id: string; x1: number; y1: number; x2: number; y2: number; }

export const OBJECT_ZONES: ObjectZone[] = [
  // 坐标来自 room-morning.jpg（627×627）的实测物件框，已归一化
  { id: 'trash',      x1: 0.93, y1: 0.74, x2: 1.00, y2: 0.91 },
  { id: 'computer',   x1: 0.85, y1: 0.37, x2: 1.00, y2: 0.57 },
  { id: 'nightstand', x1: 0.36, y1: 0.60, x2: 0.50, y2: 0.78 },
  { id: 'painting',   x1: 0.15, y1: 0.24, x2: 0.31, y2: 0.38 },
  { id: 'pendant',    x1: 0.40, y1: 0.00, x2: 0.61, y2: 0.15 },
  { id: 'shelf',      x1: 0.48, y1: 0.52, x2: 0.60, y2: 0.78 },
  { id: 'chair',      x1: 0.63, y1: 0.53, x2: 0.84, y2: 0.84 },
  { id: 'desk',       x1: 0.73, y1: 0.54, x2: 1.00, y2: 0.87 },
  { id: 'bed',        x1: 0.00, y1: 0.51, x2: 0.37, y2: 0.97 },
  { id: 'rug',        x1: 0.26, y1: 0.80, x2: 0.63, y2: 0.96 },
  { id: 'window',     x1: 0.34, y1: 0.15, x2: 0.87, y2: 0.54 },
];

/** 归一化坐标（相对背景图）落在哪个物件上；没命中返回 null */
export function pickObjectAt(nx: number, ny: number): string | null {
  if (!isFinite(nx) || !isFinite(ny)) return null;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  for (const z of OBJECT_ZONES) {
    if (nx >= z.x1 && nx <= z.x2 && ny >= z.y1 && ny <= z.y2) return z.id;
  }
  return null;
}