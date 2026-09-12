/** 多页 Catalog 按 section id 过滤 demo 区块。未传 sections 时渲染全部。 */
export function showCatalogSection(sections: string[] | undefined, id: string) {
  return !sections?.length || sections.includes(id);
}
