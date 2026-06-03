// 条件评估器现已统一到 shared/plugin-condition.ts（前后端共用）。
// 此处保留再导出，避免改动现有的 `./condition` 引用。
export { evaluateCondition } from "~~/shared/plugin-condition";
