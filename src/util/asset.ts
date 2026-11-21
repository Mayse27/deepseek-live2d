/**
 * 静态资源路径解析。
 *
 * 部署到 https://<用户>.github.io/<仓库>/ 这类子路径时，写死的 /model/x.json
 * 会指向域名根目录、直接 404。统一走 asset()，让路径跟着 vite 的 base 走。
 */
const BASE = import.meta.env.BASE_URL || './';

export function asset(p: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(p)) return p;
  return BASE.replace(/\/+$/, '') + '/' + p.replace(/^\/+/, '');
}