function getInternalData<T>(element: object, key: string, defaultValue: T): T {
  const internalData = (element['ss-internal-data'] ?? {}) as Record<
    string,
    unknown
  >;
  element['ss-internal-data'] = internalData;

  const value = (internalData[key] ?? defaultValue) as T;
  internalData[key] = value;
  return value;
}

function setInternalData<T>(element: object, key: string, value: T) {
  const internalData = (element['ss-internal-data'] ?? {}) as Record<
    string,
    unknown
  >;
  element['ss-internal-data'] = internalData;

  internalData[key] = value;
}

function incrementInternalData(element: object, key: string): number {
  const current = getInternalData(element, key, 0);
  const incremented = current + 1;
  setInternalData(element, key, incremented);
  return incremented;
}

function decrementInternalData(element: object, key: string): number {
  const current = getInternalData(element, key, 0);
  const decremented = Math.max(current - 1, 0);
  setInternalData(element, key, decremented);
  return decremented;
}

export function startRequest(source: Element) {
  const requestCount = incrementInternalData(source, 'requestCount');
  // Request already in flight, don't need to disable everything
  // again
  if (requestCount > 1) return;

  source.setAttribute('aria-busy', 'true');
  const disabledElements = getInternalData<Array<Node>>(
    source,
    'disabledElements',
    []
  );
  for (const toDisable of document.querySelectorAll(
    '[aria-busy] input, [aria-busy] button[type="submit"], [aria-busy] select, [aria-busy] form'
  )) {
    incrementInternalData(toDisable, 'inRequestCount');
    // @ts-expect-error not everything has disabled
    // but we know it does
    toDisable.disabled = true;

    if (!disabledElements.includes(toDisable)) {
      disabledElements.push(toDisable);
    }
  }
}

export function endRequest(source: Element) {
  const requestCount = decrementInternalData(source, 'requestCount');
  // Still another request in flight, do not enable
  if (requestCount > 0) {
    // Set aria-busy if we're not done, this stops alpine ajax clearing it
    source.setAttribute('aria-busy', 'true');
    return;
  }

  const disabledElements = getInternalData<Array<Node>>(
    source,
    'disabledElements',
    []
  );
  const remainingDisabledElements: Array<Node> = [];
  for (const node of disabledElements) {
    const inRequestCount = decrementInternalData(node, 'inRequestCount');
    if (inRequestCount === 0) {
      // @ts-expect-error not everything has disabled
      // but we know it does
      node.disabled = false;
      setInternalData(node, 'inRequestCount', 0);
    } else {
      remainingDisabledElements.push(node);
    }
  }

  setInternalData(source, 'disabledElements', remainingDisabledElements);
  source.removeAttribute('xx-aria-busy');
  source.removeAttribute('aria-busy');
}
