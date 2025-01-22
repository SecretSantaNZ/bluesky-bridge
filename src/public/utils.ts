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
      const pages: Array<{ key: string; display: string }> = [];
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

export function replaceMatch<T extends { match_id: number }>(
  matches: ReadonlyArray<T>,
  newMatch: T
): Array<T> {
  let present = false;
  const newMatches = matches.map((match) => {
    if (match.match_id === newMatch.match_id) {
      present = true;
      return newMatch;
    } else {
      return match;
    }
  });
  if (!present) {
    newMatches.push(newMatch);
  }
  return newMatches;
}

export function removeMatch<T extends { match_id: number }>(
  matches: ReadonlyArray<T>,
  matchId: number
): Array<T> {
  return matches.filter((match) => match.match_id !== matchId);
}

export function replaceTracking<T extends { tracking_id: number }>(
  trackings: ReadonlyArray<T>,
  newTracking: T
): Array<T> {
  let present = false;
  const newTrackings = trackings.map((tracking) => {
    if (tracking.tracking_id === newTracking.tracking_id) {
      present = true;
      return newTracking;
    } else {
      return tracking;
    }
  });
  if (!present) {
    newTrackings.push(newTracking);
  }
  return newTrackings;
}

export function removeTracking<T extends { tracking_id: number }>(
  trackings: ReadonlyArray<T>,
  trackingId: number
): Array<T> {
  return trackings.filter((tracking) => tracking.tracking_id !== trackingId);
}
