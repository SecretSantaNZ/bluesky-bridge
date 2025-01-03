export function buildPager<T extends Record<string, unknown>, D>(
  filtersTemplate: T,
  filterFunc: (filters: T) => Array<D>
) {
  // @ts-expect-error we need alpine globally so don't want to import here
  // as that would result in it being bundled
  const internalData = Alpine.reactive({ filters: filtersTemplate, page: 1 });
  const filters = new Proxy(internalData.filters, {
    set(target, property, value) {
      internalData.page = 1;
      target[property] = value;
      return true;
    },
  });
  return {
    filters,
    get filtered() {
      return filterFunc(filters);
    },
    get startInd() {
      return (internalData.page - 1) * 25;
    },
    get endInd() {
      return Math.min(internalData.page * 25, this.filtered.length);
    },
    get pageSelect() {
      return String(internalData.page);
    },
    set pageSelect(strVal) {
      internalData.page = parseInt(strVal);
    },
    get pageData() {
      return this.filtered.slice(this.startInd, this.endInd);
    },
    get pages() {
      const count = this.filtered.length;
      const pages = [];
      for (let i = 0; i * 25 < count; i++) {
        pages.push({
          key: `${i + 1}`,
          display: `Page ${i + 1}: ${i * 25 + 1} - ${Math.min((i + 1) * 25, count)}`,
        });
      }
      return pages;
    },
  };
}
