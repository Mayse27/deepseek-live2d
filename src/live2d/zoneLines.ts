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