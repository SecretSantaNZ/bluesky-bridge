function buildPager(filtersTemplate, filterFunc) {
  const internalData = Alpine.reactive({ filters: filtersTemplate, page: 1 });
  const filters = new Proxy(internalData.filters, {
    set(target, property, value, receiver) {
      internalData.page = 1;
      target[property] = value;
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
