// 条件评估器现已统一到 shared/plugin-condition.ts（前后端共用），消除前后端实现漂移。
// 此处再导出，保持 app/utils 的自动导入与现有引用不变。
export { evaluateCondition } from "~~/shared/plugin-condition";
export type { Condition, FieldCondition, Operator } from "~~/shared/plugin-condition";
