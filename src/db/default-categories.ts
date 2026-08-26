import type { CategoryKind } from './schema';

/**
 * 開一個新帳號時預設帶的分類。
 *
 * 規格書 2.1 的既有分類 + 2026-08-10 確認的收入來源。這只是起點 ——
 * 每個人的分類是各自獨立的一份，之後在 /categories 頁面自己增減，
 * 改到面目全非也不會影響到別人。
 *
 * 為什麼新帳號要複製一份而不是共用一張表：分類是很個人的東西。
 * Gino 有「壇費」「道場」，媽媽大概兩個都用不到，卻會需要別的。
 * 共用的話兩個人的下拉選單裡都會塞滿對方的東西。
 */
export const DEFAULT_CATEGORIES: { name: string; kind: CategoryKind; isFixed?: boolean }[] = [
  // 變動支出
  { name: '餐食', kind: 'expense' },
  { name: '雜支', kind: 'expense' },
  { name: '交通', kind: 'expense' },
  { name: '食材採買', kind: 'expense' },
  { name: '道場', kind: 'expense' },
  { name: '醫療', kind: 'expense' },
  { name: '健身', kind: 'expense' },
  // 固定支出
  { name: '房租', kind: 'expense', isFixed: true },
  { name: '壇費', kind: 'expense', isFixed: true },
  // AI 對不上分類時的落點，不要刪
  { name: '未分類', kind: 'expense' },
  // 收入
  { name: '工讀薪水', kind: 'income' },
  { name: '家人給的', kind: 'income' },
  { name: '朋友還錢／代墊收回', kind: 'income' },
  { name: '實驗室計畫', kind: 'income' },
  { name: '未分類', kind: 'income' },
];

/** 轉成可以直接 insert 的樣子。sortOrder 照陣列順序，畫面上就是這個排序 */
export function defaultCategoryRows(userId: string) {
  return DEFAULT_CATEGORIES.map((c, i) => ({
    userId,
    name: c.name,
    kind: c.kind,
    isFixed: c.isFixed ?? false,
    sortOrder: i,
  }));
}
